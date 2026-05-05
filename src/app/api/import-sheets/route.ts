// POST /api/import-sheets
// Lit un Google Sheet via l'API Google Sheets v4 (clé serveur) et retourne
// les produits normalisés prêts à être prévisualisés puis publiés.
//
// Body : { sheet_url: string }  ou  { sheet_id: string }
// Réponse : { products: NormalizedProduct[], total: number }

import { NextRequest, NextResponse } from 'next/server';

const COLUMN_MAP: Record<string, string> = {
  nom: 'name', name: 'name',
  description: 'description', desc: 'description',
  prix_vente: 'price', prix: 'price', price: 'price', price_sell: 'price',
  prix_achat: 'buyPrice', cout: 'buyPrice', cost: 'buyPrice', price_buy: 'buyPrice',
  fournisseur: 'supplier', supplier: 'supplier',
  couleurs: 'colors', colors: 'colors',
  tailles: 'sizes', sizes: 'sizes',
  stock: 'stock',
  images: 'images', image: 'images',
  categorie: 'cat', category: 'cat', cat: 'cat',
  badge: 'badge',
  emoji: 'emoji',
};

interface RawRow {
  name?: string;
  description?: string;
  price?: string;
  buyPrice?: string;
  supplier?: string;
  colors?: string;
  sizes?: string;
  stock?: string;
  images?: string;
  cat?: string;
  badge?: string;
  emoji?: string;
  [key: string]: string | undefined;
}

interface NormalizedProduct {
  id: number;
  name: string;
  description: string;
  price: number;
  buyPrice: number;
  cat: string;
  emoji: string;
  badge: string | null;
  supplier: string;
  colors: string[];
  images: string[];
  stock: Record<string, number>;
}

function normalizeRow(obj: RawRow, idx: number): NormalizedProduct {
  const sizes = (obj.sizes || 'XS,S,M,L,XL').split(',').map((s) => s.trim());
  const stockRaw = (obj.stock || '10').split(',');
  const stock: Record<string, number> = {};
  sizes.forEach((s, i) => {
    stock[s] = parseInt(stockRaw[i] ?? stockRaw[0] ?? '10', 10);
  });

  return {
    id: 1000 + idx,
    name: obj.name || `Produit ${idx + 1}`,
    description: obj.description || '',
    price: parseFloat(obj.price || '0') || 0,
    buyPrice: parseFloat(obj.buyPrice || '0') || 0,
    cat: obj.cat || 'T-shirts',
    emoji: obj.emoji || '👕',
    badge: obj.badge || null,
    supplier: obj.supplier || '',
    colors: (obj.colors || '#0a0a0a').split(',').map((c) => c.trim()),
    images: (obj.images || '')
      .split(',')
      .map((i) => i.trim())
      .filter(Boolean),
    stock,
  };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GOOGLE_SHEETS_API_KEY manquante' }, { status: 500 });
  }

  try {
    const body = await req.json();
    let sheetId: string = body.sheet_id || '';

    // Extraire l'ID depuis l'URL si sheet_url fourni
    if (!sheetId && body.sheet_url) {
      const match = (body.sheet_url as string).match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (!match) {
        return NextResponse.json({ error: 'URL Google Sheet invalide' }, { status: 400 });
      }
      sheetId = match[1];
    }

    if (!sheetId) {
      return NextResponse.json({ error: 'sheet_id ou sheet_url requis' }, { status: 400 });
    }

    // Appel API Google Sheets
    const range = body.range || 'A1:Z1000';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;

    const res = await fetch(url);

    if (!res.ok) {
      const errData = await res.json();
      const errMsg = errData?.error?.message || `HTTP ${res.status}`;
      // Accès refusé → guide l'utilisateur
      if (res.status === 403) {
        return NextResponse.json(
          { error: 'Accès refusé. Assurez-vous que le Google Sheet est "Partagé avec des lecteurs" ou "Public".' },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: errMsg }, { status: res.status });
    }

    const data = await res.json();
    const rows: string[][] = data.values || [];

    if (rows.length < 2) {
      return NextResponse.json({ error: 'Sheet vide ou sans données' }, { status: 422 });
    }

    // Ligne 1 = en-têtes
    const headers = rows[0].map((h) =>
      h.toLowerCase().trim().replace(/ /g, '_')
    );

    const products: NormalizedProduct[] = rows
      .slice(1)
      .filter((row) => row.some((cell) => cell?.trim()))
      .map((row, idx) => {
        const obj: RawRow = {};
        headers.forEach((h, i) => {
          const key = COLUMN_MAP[h] || h;
          obj[key] = (row[i] || '').toString().trim();
        });
        return normalizeRow(obj, idx);
      });

    return NextResponse.json({ products, total: products.length, sheet_id: sheetId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    console.error('[/api/import-sheets]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
