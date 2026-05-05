// POST /api/orders   → créer une commande (après paiement confirmé)
// GET  /api/orders   → lister les commandes de l'utilisateur connecté

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Vérifie le JWT Supabase de l'utilisateur depuis le header Authorization
async function getUser(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

// ── Créer une commande ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      items,           // [{ name, price, qty, color, size }]
      total,           // float €
      shipping_mode,   // 'domicile' | 'relais' | 'main-propre'
      shipping_address,
      relay_point_id,
      relay_point_name,
      slot,            // créneau main propre
      customer_email,  // si non connecté
      stripe_session_id,
    } = body;

    if (!items?.length || !total) {
      return NextResponse.json({ error: 'items et total requis' }, { status: 400 });
    }

    // Récupérer l'utilisateur connecté (optionnel)
    const user = await getUser(req);
    const email = customer_email || user?.email || 'anonymous@fansfr.fr';

    const orderRef = `FAN-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const { data, error } = await supabaseAdmin
      .from('orders')
      .insert({
        ref: orderRef,
        user_id: user?.id || null,
        customer_email: email,
        items: JSON.stringify(items),
        total: parseFloat(total),
        shipping_mode: shipping_mode || 'domicile',
        shipping_address: shipping_address || null,
        relay_point_id: relay_point_id || null,
        relay_point_name: relay_point_name || null,
        slot: slot || null,
        status: stripe_session_id ? 'paid' : 'pending',
        stripe_session_id: stripe_session_id || null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    // Envoyer l'email de confirmation
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://fansfr.fr';
    await fetch(`${siteUrl}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email,
        subject: `Commande confirmée ${orderRef} — FansFR`,
        type: 'order-confirmation',
        data: {
          orderRef,
          items,
          total: parseFloat(total).toFixed(2),
          deliveryMode: shipping_mode,
          slot,
          relayPoint: relay_point_name ? { name: relay_point_name, address: shipping_address } : null,
        },
      }),
    }).catch((e) => console.error('Email confirmation failed:', e));

    return NextResponse.json({
      success: true,
      order: data,
      ref: orderRef,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    console.error('[/api/orders POST]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Lister les commandes de l'utilisateur ─────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const user = await getUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('id, ref, total, status, shipping_mode, created_at, items, relay_point_name, slot')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    const orders = (data || []).map((o) => ({
      ...o,
      items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items,
    }));

    return NextResponse.json({ orders, total: orders.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    console.error('[/api/orders GET]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
