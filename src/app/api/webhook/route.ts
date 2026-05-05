// POST /api/webhook
// Reçoit les événements Stripe (payment_intent.succeeded, checkout.session.completed…)
// Met à jour le statut de commande dans Supabase et déclenche l'email de confirmation.
//
// Dans Stripe Dashboard → Webhooks → ajouter : https://votre-domaine.vercel.app/api/webhook
// Événements à cocher : checkout.session.completed, payment_intent.payment_failed

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-04-10' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // clé service (pas anon) pour bypass RLS
);

// Désactiver le body parsing de Next.js — Stripe a besoin du raw body pour vérifier la signature
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

  let event: Stripe.Event;

  try {
    const rawBody = await req.text();
    event = stripe.webhooks.constructEvent(rawBody, sig!, webhookSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Signature invalide';
    console.error('[webhook] Signature invalide:', message);
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 });
  }

  // ── Paiement confirmé ──────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    const orderRef = `FAN-${Date.now()}`;

    // 1. Mettre à jour la commande en base (si elle existe déjà avec session_id)
    const { error: updateError } = await supabase
      .from('orders')
      .update({ status: 'paid', stripe_session_id: session.id, ref: orderRef })
      .eq('stripe_session_id', session.id);

    if (updateError) {
      // La commande n'existe pas encore — l'insérer
      await supabase.from('orders').insert({
        ref: orderRef,
        customer_email: session.customer_email,
        total: (session.amount_total ?? 0) / 100,
        status: 'paid',
        stripe_session_id: session.id,
        created_at: new Date().toISOString(),
      });
    }

    // 2. Envoyer l'email de confirmation via /api/send-email
    if (session.customer_email) {
      await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: session.customer_email,
          subject: `Commande confirmée ${orderRef} — FansFR`,
          type: 'order-confirmation',
          data: {
            orderRef,
            total: ((session.amount_total ?? 0) / 100).toFixed(2),
            items: [], // détail non disponible ici — récupérer depuis metadata si besoin
            deliveryMode: session.metadata?.delivery_mode || 'domicile',
          },
        }),
      });
    }
  }

  // ── Paiement échoué ────────────────────────────────────────────────
  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as Stripe.PaymentIntent;
    console.warn('[webhook] Paiement échoué:', intent.id);
    // Optionnel : envoyer un email d'échec, logger, etc.
  }

  return NextResponse.json({ received: true });
}
