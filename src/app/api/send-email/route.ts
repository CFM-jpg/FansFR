// POST /api/send-email
// Envoie des emails transactionnels via Resend.
// La clé Resend reste côté serveur — jamais exposée au frontend.
//
// Body attendu :
// {
//   to: string,
//   subject: string,
//   type: 'order-confirmation' | 'stock-alert' | 'custom',
//   data: object,   // données pour construire le template
//   html?: string,  // HTML brut (pour type:'custom')
//   from?: string,  // override expéditeur
// }

import { NextRequest, NextResponse } from 'next/server';

const RESEND_API = 'https://api.resend.com/emails';

// ── Templates ────────────────────────────────────────────────────────

function templateOrderConfirmation(data: {
  orderRef: string;
  items: { name: string; qty: number; price: number }[];
  total: string;
  deliveryMode: string;
  slot?: string;
  relayPoint?: { name: string; address: string };
}) {
  const itemsHtml = data.items
    .map(
      (i) =>
        `<tr><td style="padding:4px 0;font-size:14px">${i.name} × ${i.qty}</td>
         <td style="text-align:right;font-size:14px">${(i.price * i.qty).toFixed(2)} €</td></tr>`
    )
    .join('');

  let deliveryBlock = '';
  if (data.deliveryMode === 'main-propre') {
    deliveryBlock = `<div style="background:#fdf9f0;border:1px solid #c9a84c;border-radius:6px;padding:12px;margin-top:16px">
      <strong style="color:#c9a84c">Remise en main propre — Angers</strong><br>
      Créneau : ${data.slot || 'À confirmer par email'}
    </div>`;
  } else if (data.deliveryMode === 'relais') {
    deliveryBlock = `<div style="background:#f4f4f0;border-radius:6px;padding:12px;margin-top:16px">
      <strong>Point relais</strong><br>
      ${data.relayPoint?.name || ''} — ${data.relayPoint?.address || ''}
    </div>`;
  } else {
    deliveryBlock = `<div style="background:#f4f4f0;border-radius:6px;padding:12px;margin-top:16px">
      <strong>Livraison à domicile</strong><br>Colissimo — Délai estimé : 2–4 jours ouvrés
    </div>`;
  }

  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff">
      <div style="background:#0a0a0a;padding:24px;text-align:center">
        <h1 style="color:#fafaf8;font-size:24px;margin:0;letter-spacing:.08em">Fans<span style="color:#c9a84c">FR</span></h1>
        <p style="color:#666;font-size:12px;margin:4px 0 0">Votre commande est confirmée ✓</p>
      </div>
      <div style="padding:32px 24px">
        <h2 style="font-size:18px;margin:0 0 8px">Merci pour votre commande !</h2>
        <p style="color:#666;font-size:14px">Référence : <strong>${data.orderRef}</strong></p>
        <table style="width:100%;border-collapse:collapse;margin:24px 0">${itemsHtml}
          <tr style="border-top:1px solid #eee">
            <td style="padding-top:8px;font-weight:600">Total</td>
            <td style="text-align:right;padding-top:8px;font-weight:600">${data.total} €</td>
          </tr>
        </table>
        ${deliveryBlock}
        <p style="margin-top:24px;font-size:12px;color:#999">
          Pour toute question : <a href="mailto:contact@fansfr.fr">contact@fansfr.fr</a> · Retours sous 14 jours
        </p>
      </div>
      <div style="background:#f4f4f0;padding:16px;text-align:center;font-size:11px;color:#999">
        © 2025 FansFR SASU — SIRET 123 456 789 00012 — Angers, France
      </div>
    </div>`;
}

function templateStockAlert(data: { productName: string; productUrl?: string }) {
  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff">
      <div style="background:#0a0a0a;padding:24px;text-align:center">
        <h1 style="color:#fafaf8;font-size:24px;margin:0;letter-spacing:.08em">Fans<span style="color:#c9a84c">FR</span></h1>
      </div>
      <div style="padding:32px 24px">
        <h2 style="font-size:20px;margin:0 0 12px">Bonne nouvelle ! 🎉</h2>
        <p style="font-size:15px;color:#333;line-height:1.6">
          Le produit <strong>"${data.productName}"</strong> que vous attendiez est 
          de nouveau disponible sur notre boutique.
        </p>
        <p style="font-size:14px;color:#666">Dépêchez-vous, les stocks sont limités !</p>
        <a href="${data.productUrl || 'https://fansfr.fr'}" 
           style="display:inline-block;background:#c9a84c;color:#000;padding:12px 28px;
                  border-radius:3px;text-decoration:none;font-weight:500;margin-top:20px;font-size:14px">
          Acheter maintenant →
        </a>
        <p style="margin-top:24px;font-size:11px;color:#aaa">
          Vous recevez cet email car vous avez demandé à être alerté pour ce produit.<br>
          <a href="https://fansfr.fr/unsubscribe" style="color:#aaa">Se désabonner</a>
        </p>
      </div>
      <div style="background:#f4f4f0;padding:16px;text-align:center;font-size:11px;color:#999">
        © 2025 FansFR SASU — Angers, France
      </div>
    </div>`;
}

// ── Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY manquante' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const {
      to,
      subject,
      type,
      data = {},
      html: customHtml,
      from = process.env.RESEND_FROM || 'FansFR <commandes@fansfr.fr>',
    } = body;

    if (!to || !subject) {
      return NextResponse.json({ error: 'to et subject sont requis' }, { status: 400 });
    }

    // Choisir le template
    let html = customHtml || '';
    if (type === 'order-confirmation') html = templateOrderConfirmation(data);
    if (type === 'stock-alert') html = templateStockAlert(data);

    if (!html) {
      return NextResponse.json({ error: 'HTML vide — précisez type ou html' }, { status: 400 });
    }

    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    });

    const result = await res.json();

    if (!res.ok) {
      console.error('[/api/send-email] Resend error:', result);
      return NextResponse.json({ error: result.message || 'Erreur Resend' }, { status: 502 });
    }

    return NextResponse.json({ id: result.id, to, subject });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    console.error('[/api/send-email]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
