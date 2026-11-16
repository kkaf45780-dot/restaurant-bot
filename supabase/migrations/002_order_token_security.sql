-- =====================================================================
-- Migration 002: Security Hardening — order_token UUID + RLS Lockdown
-- =====================================================================

create extension if not exists pgcrypto;

-- 1. إضافة عمود order_token العشوائي الفريد للطلبات ومنع IDOR
alter table public.orders
  add column if not exists order_token uuid;

-- Backfill للطلبات الحالية التي لا تملك token
update public.orders
set order_token = gen_random_uuid()
where order_token is null;

alter table public.orders
  alter column order_token set default gen_random_uuid(),
  alter column order_token set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_order_token_unique'
  ) then
    alter table public.orders add constraint orders_order_token_unique unique (order_token);
  end if;
end $$;

create index if not exists idx_orders_order_token on public.orders (order_token);

-- 2. إضافة حقول كلمة المرور المشفرة للموظفين وإجبار التغيير عند أول دخول
alter table public.employees
  add column if not exists password_hash text,
  add column if not exists must_change_password boolean not null default true;

-- 3. إغلاق القراءة العامة المباشرة لجدول الطلبات (تُقرأ عبر Worker باستخدام order_token فقط)
drop policy if exists "Public read orders by order number" on public.orders;
drop policy if exists "Public insert orders" on public.orders;

-- 4. جدول بنود الطلبات العلائقي إن لم يكن موجوداً
create table if not exists public.order_items (
  id text primary key default gen_random_uuid()::text,
  order_id text not null references public.orders(id) on delete cascade,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  item_id text not null,
  item_name text not null,
  unit_price numeric(10, 2) not null,
  quantity integer not null check (quantity > 0),
  line_total numeric(10, 2) not null,
  selected_size_id text,
  selected_size_label text,
  selected_extras jsonb not null default '[]'::jsonb,
  item_notes text,
  created_at timestamptz not null default now()
);

alter table public.order_items enable row level security;

drop policy if exists "Admins manage order_items" on public.order_items;
create policy "Admins manage order_items" on public.order_items
  for all using (public.is_restaurant_admin(restaurant_id)) with check (public.is_restaurant_admin(restaurant_id));
