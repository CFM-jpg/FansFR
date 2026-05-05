// POST /api/checkout
// Crée une session Stripe Checkout et retourne l'URL de redirection.
// Appelé par le frontend via : sb.callEdgeFunction('create-checkout-session', {...})
// → à remplacer par fetch('/api/checkout', { method:'POST', body:JSON.stringify({...}) })

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-04-10',
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { line_items, shipping_cost, discount, success_url, cancel_url, customer_email } = body;

    if (!line_items?.length) {
      return NextResponse.json({ error: 'Panier vide' }, { status: 400 });
    }

    // Construire les line_items Stripe
    const stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = line_items.map(
      (item: { name: string; amount: number; qty: number }) => ({
        price_data: {
          currency: 'eur',
          product_data: { name: item.name },
          unit_amount: item.amount, // en centimes
        },
        quantity: item.qty,
      })
    );

    // Frais de port comme line_item séparé
    if (shipping_cost > 0) {
      stripeLineItems.push({
        price_data: {
          currency: 'eur',
          product_data: { name: 'Frais de livraison' },
          unit_amount: shipping_cost,
        },
        quantity: 1,
      });
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      line_items: stripeLineItems,
      mode: 'payment',
      success_url: success_url || `${process.env.NEXT_PUBLIC_SITE_URL}?order=success`,
      cancel_url: cancel_url || process.env.NEXT_PUBLIC_SITE_URL,
      customer_email: customer_email || undefined,
      payment_intent_data: {
        metadata: { source: 'fansfr' },
      },
    };

    // Code promo → remise en pourcentage via coupon Stripe
    if (discount > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: discount, // en centimes
        currency: 'eur',
        duration: 'once',
      });
      sessionParams.discounts = [{ coupon: coupon.id }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url, session_id: session.id });
  } catch (err: unknown) {
    console.error('[/api/checkout]', err);
    const message = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
