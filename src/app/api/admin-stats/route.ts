// GET /api/admin-stats
// Retourne les statistiques du tableau de bord admin :
// - Ventes totales, marge globale
// - Commandes récentes
// - Produits en rupture de stock
// - Clients en attente de notification de retour en stock
//
// Requiert : header x-admin-key

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const adminKey = req.headers.get('x-admin-key');
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  try {
    const [ordersRes, productsRes, alertsRes, pendingOrdersRes] = await Promise.all([
      // Commandes des 30 derniers jours
      supabase
        .from('orders')
        .select('id, ref, customer_email, total, status, created_at, shipping_mode')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(50),

      // Tous les produits (pour calcul marge + stocks)
      supabase
        .from('products')
        .select('id, name, price_sell, price_buy, stock, category'),

      // Alertes stock non notifiées
      supabase
        .from('stock_alerts')
        .select('id, email, product_id, product_name, created_at')
        .eq('notified', false)
        .order('created_at', { ascending: false }),

      // Commandes en attente (non expédiées)
      supabase
        .from('orders')
        .select('id, ref, customer_email, total, status, shipping_mode, created_at')
        .in('status', ['paid', 'pending'])
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const orders = ordersRes.data || [];
    const products = productsRes.data || [];
    const alerts = alertsRes.data || [];
    const pendingOrders = pendingOrdersRes.data || [];

    // ── Calculs ──────────────────────────────────────────────────────

    // CA total (30j)
    const totalRevenue = orders
      .filter((o) => o.status === 'paid')
      .reduce((sum, o) => sum + (o.total || 0), 0);

    // Marge globale estimée (si prix d'achat renseigné)
    const totalMargin = products.reduce((sum, p) => {
      const margin = (p.price_sell || 0) - (p.price_buy || 0);
      return sum + (margin > 0 ? margin : 0);
    }, 0);

    // Produits en rupture (stock total = 0)
    const outOfStock = products.filter((p) => {
      const total = Object.values(
        (p.stock as Record<string, number>) || {}
      ).reduce((a, b) => a + (b as number), 0);
      return total === 0;
    });

    // Produits avec stock faible (< 5 unités)
    const lowStock = products.filter((p) => {
      const total = Object.values(
        (p.stock as Record<string, number>) || {}
      ).reduce((a, b) => a + (b as number), 0);
      return total > 0 && total < 5;
    });

    // Commandes par statut
    const ordersByStatus = orders.reduce((acc, o) => {
      acc[o.status] = (acc[o.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Alertes groupées par produit
    const alertsByProduct = alerts.reduce((acc, a) => {
      const key = a.product_id || a.product_name;
      if (!acc[key]) {
        acc[key] = { product_id: a.product_id, product_name: a.product_name, count: 0 };
      }
      acc[key].count++;
      return acc;
    }, {} as Record<string, { product_id: string; product_name: string; count: number }>);

    return NextResponse.json({
      // Métriques globales
      revenue_30d: parseFloat(totalRevenue.toFixed(2)),
      orders_30d: orders.length,
      margin_catalog: parseFloat(totalMargin.toFixed(2)),

      // Commandes
      orders_pending: pendingOrders,
      orders_by_status: ordersByStatus,
      recent_orders: orders.slice(0, 10),

      // Stocks
      out_of_stock: outOfStock.map((p) => ({ id: p.id, name: p.name, category: p.category })),
      low_stock: lowStock.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        total_stock: Object.values((p.stock as Record<string, number>) || {}).reduce(
          (a, b) => a + (b as number), 0
        ),
      })),

      // Alertes retour en stock
      stock_alerts_total: alerts.length,
      stock_alerts_by_product: Object.values(alertsByProduct).sort((a, b) => b.count - a.count),

      generated_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    console.error('[/api/admin-stats]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
