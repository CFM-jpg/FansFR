// GET /api/products
// Endpoint public — retourne le catalogue produits sans prix d'achat ni marges.
// Utilisé par le frontend pour charger le catalogue depuis Supabase.
//
// Paramètres :
//   ?category=T-shirts
//   ?color=%23000000    (URL-encodé)
//   ?min_price=20&max_price=100
//   ?in_stock=true
//   ?search=hoodie
//   ?sort=price_asc | price_desc | newest
//   ?limit=20&offset=0

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Client public (clé anon — RLS appliqué)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const category  = searchParams.get('category');
    const search    = searchParams.get('search');
    const minPrice  = searchParams.get('min_price');
    const maxPrice  = searchParams.get('max_price');
    const inStock   = searchParams.get('in_stock') === 'true';
    const sort      = searchParams.get('sort') || 'newest';
    const limit     = Math.min(parseInt(searchParams.get('limit') || '24', 10), 100);
    const offset    = parseInt(searchParams.get('offset') || '0', 10);

    // Champs publics uniquement — pas de price_buy
    let query = supabase
      .from('products')
      .select(
        'id, name, description, price_sell, price_old, category, badge, emoji, colors, images, stock, created_at',
        { count: 'exact' }
      );

    if (category) query = query.eq('category', category);
    if (search)   query = query.ilike('name', `%${search}%`);
    if (minPrice) query = query.gte('price_sell', parseFloat(minPrice));
    if (maxPrice) query = query.lte('price_sell', parseFloat(maxPrice));

    // Tri
    switch (sort) {
      case 'price_asc':  query = query.order('price_sell', { ascending: true });  break;
      case 'price_desc': query = query.order('price_sell', { ascending: false }); break;
      default:           query = query.order('created_at', { ascending: false });
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    let products = data || [];

    // Filtre in_stock côté serveur (stock est un JSONB)
    if (inStock) {
      products = products.filter((p) => {
        const total = Object.values(
          (p.stock as Record<string, number>) || {}
        ).reduce((a, b) => a + (b as number), 0);
        return total > 0;
      });
    }

    // Normaliser pour le frontend (compatible avec la structure PRODUCTS du HTML)
    const normalized = products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price_sell,
      priceOld: p.price_old || null,
      cat: p.category,
      badge: p.badge,
      emoji: p.emoji || '👕',
      colors: p.colors || ['#0a0a0a'],
      images: p.images || [],
      stock: p.stock || {},
    }));

    return NextResponse.json({
      products: normalized,
      total: count ?? products.length,
      limit,
      offset,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    console.error('[/api/products]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
