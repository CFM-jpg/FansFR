-- ============================================================
-- FansFR — Schéma Supabase
-- Coller dans : Dashboard Supabase → SQL Editor → Run
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";

-- ── Produits ──────────────────────────────────────────────────────────
create table if not exists products (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  description   text,
  price_sell    numeric(10,2) not null,
  price_buy     numeric(10,2) default 0,
  price_old     numeric(10,2),
  category      text default 'T-shirts',
  badge         text,
  emoji         text default '👕',
  supplier      text,
  colors        text[]    default '{}',
  images        text[]    default '{}',
  stock         jsonb     default '{}',    -- ex: {"XS":5,"S":10,"M":8}
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ── Commandes ─────────────────────────────────────────────────────────
create table if not exists orders (
  id                 uuid primary key default uuid_generate_v4(),
  ref                text unique not null,
  user_id            uuid references auth.users(id) on delete set null,
  customer_email     text not null,
  items              jsonb not null default '[]',
  total              numeric(10,2) not null,
  status             text not null default 'pending',
  -- 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled'
  shipping_mode      text,  -- 'domicile' | 'relais' | 'main-propre'
  shipping_address   text,
  relay_point_id     text,
  relay_point_name   text,
  slot               text,  -- créneau main propre
  stripe_session_id  text,
  tracking_number    text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- ── Alertes retour en stock ───────────────────────────────────────────
create table if not exists stock_alerts (
  id            uuid primary key default uuid_generate_v4(),
  email         text not null,
  product_id    uuid references products(id) on delete cascade,
  product_name  text,
  notified      boolean default false,
  notified_at   timestamptz,
  created_at    timestamptz default now()
);

-- Index pour éviter les doublons
create unique index if not exists stock_alerts_email_product
  on stock_alerts (email, product_id);

-- ── Fournisseurs ──────────────────────────────────────────────────────
create table if not exists suppliers (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  contact_email   text,
  contact_phone   text,
  avg_lead_days   int default 7,
  notes           text,
  created_at      timestamptz default now()
);

-- ── Row Level Security ────────────────────────────────────────────────

-- Produits : lecture publique, écriture admin uniquement (via service role)
alter table products enable row level security;
create policy "Produits lisibles par tous"
  on products for select using (true);
create policy "Produits modifiables par service role uniquement"
  on products for all using (auth.role() = 'service_role');

-- Commandes : chaque utilisateur voit ses propres commandes
alter table orders enable row level security;
create policy "Commandes visibles par le propriétaire"
  on orders for select
  using (auth.uid() = user_id);
create policy "Commandes insérables par service role"
  on orders for insert with check (auth.role() = 'service_role');
create policy "Commandes modifiables par service role"
  on orders for update using (auth.role() = 'service_role');

-- Alertes stock : insert public, lecture/admin via service role
alter table stock_alerts enable row level security;
create policy "Alertes insérables par tous"
  on stock_alerts for insert with check (true);
create policy "Alertes visibles par service role"
  on stock_alerts for select using (auth.role() = 'service_role');
create policy "Alertes modifiables par service role"
  on stock_alerts for update using (auth.role() = 'service_role');

-- ── Trigger updated_at automatique ───────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger trg_products_updated_at
  before update on products
  for each row execute function update_updated_at();

create trigger trg_orders_updated_at
  before update on orders
  for each row execute function update_updated_at();
