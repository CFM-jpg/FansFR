// POST /api/stock-alerts          → inscrire un email pour un produit
// POST /api/stock-alerts/trigger  → déclencher les notifications (admin uniquement)
// GET  /api/stock-alerts?product_id=xxx  → lister les emails en attente (admin)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Inscription ───────────────────────────────────────────────────────
// Body : { email, product_id, product_name }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, email, product_id, product_name } = body;

    // ── Déclencher les alertes (admin) ──────────────────────────────
    if (action === 'trigger') {
      return await triggerAlerts(body);
    }

    // ── Inscription client ──────────────────────────────────────────
    if (!email || !product_id) {
      return NextResponse.json({ error: 'email et product_id requis' }, { status: 400 });
    }

    // Vérifier si déjà inscrit
    const { data: existing } = await supabase
      .from('stock_alerts')
      .select('id')
      .eq('email', email)
      .eq('product_id', product_id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ message: 'Déjà inscrit pour ce produit', already: true });
    }

    const { data, error } = await supabase.from('stock_alerts').insert({
      email,
      product_id,
      product_name: product_name || '',
      created_at: new Date().toISOString(),
      notified: false,
    }).select().single();

    if (error) throw error;

    return NextResponse.json({ success: true, id: data.id, email, product_id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    console.error('[/api/stock-alerts POST]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Lister les inscrits pour un produit (admin) ───────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get('product_id');

  // Vérification admin via header secret
  const adminKey = req.headers.get('x-admin-key');
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  try {
    let query = supabase
      .from('stock_alerts')
      .select('id, email, product_id, product_name, created_at, notified')
      .eq('notified', false)
      .order('created_at', { ascending: false });

    if (productId) {
      query = query.eq('product_id', productId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ alerts: data, total: data?.length ?? 0 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Déclenchement des notifications ──────────────────────────────────
async function triggerAlerts(body: {
  product_id: string;
  product_name: string;
  product_url?: string;
  admin_key?: string;
}) {
  const { product_id, product_name, product_url, admin_key } = body;

  if (admin_key !== process.env.ADMIN_SECRET_KEY) {
    return NextResponse.json({ error: 'Clé admin invalide' }, { status: 401 });
  }

  if (!product_id) {
    return NextResponse.json({ error: 'product_id requis' }, { status: 400 });
  }

  // Récupérer tous les emails non encore notifiés pour ce produit
  const { data: alerts, error } = await supabase
    .from('stock_alerts')
    .select('id, email')
    .eq('product_id', product_id)
    .eq('notified', false);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!alerts?.length) {
    return NextResponse.json({ message: 'Aucun client en attente', sent: 0 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://fansfr.fr';
  let sent = 0;
  const failed: string[] = [];

  for (const alert of alerts) {
    try {
      const res = await fetch(`${siteUrl}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: alert.email,
          subject: `🎉 "${product_name}" est de nouveau disponible — FansFR`,
          type: 'stock-alert',
          data: { productName: product_name, productUrl: product_url || siteUrl },
        }),
      });

      if (res.ok) {
        // Marquer comme notifié
        await supabase
          .from('stock_alerts')
          .update({ notified: true, notified_at: new Date().toISOString() })
          .eq('id', alert.id);
        sent++;
      } else {
        failed.push(alert.email);
      }
    } catch {
      failed.push(alert.email);
    }
  }

  return NextResponse.json({
    success: true,
    sent,
    failed: failed.length,
    product_id,
    product_name,
  });
}
