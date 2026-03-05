create extension if not exists "pgcrypto";

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_id text unique not null,
  customer_name text not null,
  contact_number text not null,
  address text not null,
  fulfillment_type text not null,
  notes text,
  items jsonb not null,
  total numeric(10,2) not null,
  message_text text not null,
  messenger_sent boolean not null default false,
  messenger_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_orders_created_at on public.orders (created_at desc);
