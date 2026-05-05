// GET /api/relay-points?postal_code=49000&country=FR&carrier=mondial_relay,inpost,colissimo
// Proxy vers l'API Sendcloud pour récupérer les points relais.
// Les clés Sendcloud (pub + secret) restent côté serveur.

import { NextRequest, NextResponse } from 'next/server';

interface SendcloudPoint {
  id: number;
  name: string;
  street: string;
  house_number: string;
  postal_code: string;
  city: string;
  carrier: string;
  distance?: number;
  opening_hours?: string[][];
  latitude?: number;
  longitude?: number;
  formatted_opening_times?: Record<string, string[]>;
}

// Points relais de démonstration (Angers) — utilisés si Sendcloud n'est pas configuré
const DEMO_POINTS = [
  {
    id: 'PR1', name: 'Tabac Presse Jean Jaurès',
    address: '12 Boulevard Jean Jaurès, 49000 Angers',
    network: 'Mondial Relay', hours: 'Lun–Sam 8h–20h',
    distance: '0.3 km', lat: 47.4760, lng: -0.5618,
  },
  {
    id: 'PR2', name: 'InPost — Superette Casino',
    address: '44 Rue de Rennes, 49000 Angers',
    network: 'InPost Locker', hours: '24h/24 7j/7',
    distance: '0.7 km', lat: 47.4722, lng: -0.5589,
  },
  {
    id: 'PR3', name: 'Bureau de Poste Angers Centre',
    address: '1 Rue Franklin Roosevelt, 49000 Angers',
    network: 'Colissimo', hours: 'Lun–Ven 8h30–18h',
    distance: '1.1 km', lat: 47.4738, lng: -0.5562,
  },
  {
    id: 'PR4', name: 'Mondial Relay — Pharmacie Vaillant',
    address: '86 Rue du Mail, 49000 Angers',
    network: 'Mondial Relay', hours: 'Lun–Sam 9h–19h30',
    distance: '1.4 km', lat: 47.4780, lng: -0.5640,
  },
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const postalCode = searchParams.get('postal_code') || '49000';
  const country    = searchParams.get('country') || 'FR';
  const limit      = parseInt(searchParams.get('limit') || '8', 10);

  const pubKey = process.env.SENDCLOUD_PUBLIC_KEY;
  const secKey = process.env.SENDCLOUD_SECRET_KEY;

  // Mode démo si Sendcloud non configuré
  if (!pubKey || !secKey) {
    return NextResponse.json({ points: DEMO_POINTS, demo: true });
  }

  try {
    const encoded = Buffer.from(`${pubKey}:${secKey}`).toString('base64');
    const url = `https://servicepoints.sendcloud.sc/api/v2/service-points/?country=${country}&postal_code=${postalCode}&limit=${limit}`;

    const res = await fetch(url, {
      headers: { Authorization: `Basic ${encoded}` },
    });

    if (!res.ok) {
      console.error('[relay-points] Sendcloud error:', res.status);
      return NextResponse.json({ points: DEMO_POINTS, demo: true });
    }

    const data = await res.json();

    if (!data.results?.length) {
      return NextResponse.json({ points: DEMO_POINTS, demo: true });
    }

    // Normaliser les données Sendcloud
    const points = data.results.map((p: SendcloudPoint) => {
      const todayIdx = new Date().getDay(); // 0=dim, 1=lun…
      const dayLabels = ['dim','lun','mar','mer','jeu','ven','sam'];
      const todayKey = dayLabels[todayIdx];
      const todayHours = p.formatted_opening_times?.[todayKey]?.[0] || 'Voir horaires';

      return {
        id: p.id,
        name: p.name,
        address: `${p.street} ${p.house_number}, ${p.postal_code} ${p.city}`,
        network: p.carrier,
        hours: todayHours,
        distance: p.distance ? (p.distance / 1000).toFixed(1) + ' km' : '?',
        lat: p.latitude,
        lng: p.longitude,
      };
    });

    return NextResponse.json({ points, total: points.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    console.error('[relay-points]', err);
    // Fallback démo en cas d'erreur réseau
    return NextResponse.json({ points: DEMO_POINTS, demo: true, error: message });
  }
}
