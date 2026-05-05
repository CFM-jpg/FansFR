// POST /api/save-product   → créer ou mettre à jour un produit
// GET  /api/save-product   → lister tous les produits (admin)
// DELETE /api/save-product → supprimer un produit
//
// Toutes les opérations d'écriture nécessitent le header : x-admin-key

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Service role → bypass RLS pour l'admin
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function isAdmin(req: NextRequest): boolean {
  return req.headers.get('x-admin-key') === process.env.ADMIN_SECRET_KEY;
}

// ── Créer / Modifier un produit ───────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      id,          // si fourni → update, sinon → insert
      name,
      description,
      price_sell,
      price_buy,
      category,
      badge,
      supplier,
      colors,      // string[] ex: ['#000','#fff']
      images,      // string[] URLs
      stock,       // object ex: { XS:5, S:10, M:8 }
      emoji,
    } = body;

    if (!name || price_sell == null) {
      return NextResponse.json({ error: 'name et price_sell sont requis' }, { status: 400 });
    }

    const payload = {
      name,
      description: description || '',
      price_sell: parseFloat(price_sell),
      price_buy: parseFloat(price_buy ?? 0),
      category: category || 'T-shirts',
      badge: badge || null,
      supplier: supplier || '',
      colors: Array.isArray(colors) ? colors : [colors || '#0a0a0a'],
      images: Array.isArray(images) ? images : [],
      stock: stock || {},
      emoji: emoji || '👕',
      updated_at: new Date().toISOString(),
    };

    let result;

    if (id) {
      // Mise à jour
      const { data, error } = await supabase
        .from('products')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      // Création
      const { data, error } = await supabase
        .from('products')
        .insert({ ...payload, created_at: new Date().toISOString() })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    // Calcul de la marge pour la réponse
    const margin = payload.price_sell - payload.price_buy;
    const marginPct = payload.price_sell > 0
      ? Math.round((margin / payload.price_sell) * 100)
      : 0;

    return NextResponse.json({
      success: true,
      product: result,
      margin: { amount: margin.toFixed(2), percent: marginPct },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    console.error('[/api/save-product POST]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Lister les produits (admin — inclut prix d'achat et marges) ───────
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const lowStock = searchParams.get('low_stock') === 'true';

    let query = supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });

    if (category) query = query.eq('category', category);

    const { data, error } = await query;
    if (error) throw error;

    // Enrichir avec les marges
    let products = (data || []).map((p) => {
      const margin = (p.price_sell || 0) - (p.price_buy || 0);
      const marginPct = p.price_sell > 0
        ? Math.round((margin / p.price_sell) * 100)
        : 0;
      const totalStock = Object.values(p.stock as Record<string, number> || {}).reduce(
        (a: number, b) => a + (b as number), 0
      );
      return {
        ...p,
        margin_amount: margin.toFixed(2),
        margin_percent: marginPct,
        margin_class: marginPct < 30 ? 'low' : marginPct < 45 ? 'ok' : 'good',
        total_stock: totalStock,
      };
    });

    if (lowStock) {
      products = products.filter((p) => p.total_stock < 5);
    }

    return NextResponse.json({ products, total: products.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Supprimer un produit ──────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true, deleted_id: id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
