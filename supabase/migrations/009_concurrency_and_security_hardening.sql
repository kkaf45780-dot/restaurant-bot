-- =====================================================================
-- 009: Concurrency, Idempotency Uniqueness & Atomic Coupon/Stock Guards
-- =====================================================================

-- 1. Enforce unique idempotency keys per restaurant so concurrent duplicate
--    POST /api/orders requests cannot insert duplicate order rows.
drop index if exists public.idx_orders_rest_idempotency;
create unique index if not exists uq_orders_rest_idempotency
  on public.orders (restaurant_id, idempotency_key)
  where idempotency_key is not null and idempotency_key <> '';

-- 2. Track employee password rotation timestamp so previously issued tokens
--    can be invalidated upon password change.
alter table public.employees
  add column if not exists password_changed_at timestamptz;

-- 3. Replace non-checking increment_coupon_usage with atomic limit-enforced version
drop function if exists public.increment_coupon_usage(text, text);
create or replace function public.increment_coupon_usage(
  p_restaurant_id text,
  p_code text
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_updated_id text;
begin
  update public.coupons
  set used_count = used_count + 1
  where restaurant_id = p_restaurant_id
    and upper(code) = upper(p_code)
    and is_active = true
    and (usage_limit = 0 or used_count < usage_limit)
  returning id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

create or replace function public.decrement_coupon_usage(
  p_restaurant_id text,
  p_code text
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.coupons
  set used_count = greatest(0, used_count - 1)
  where restaurant_id = p_restaurant_id
    and upper(code) = upper(p_code);
end;
$$;

-- 4. Atomic claim for order stock deduction (prevents concurrent double-deduct)
create or replace function public.claim_order_stock_deduction(
  p_restaurant_id text,
  p_order_id text
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_id text;
begin
  update public.orders
  set stock_deducted = true
  where id = p_order_id
    and restaurant_id = p_restaurant_id
    and stock_deducted = false
  returning id into v_id;

  return v_id is not null;
end;
$$;

-- 5. Restrict RPC execute permissions to service_role only (never anon/authenticated)
revoke all on function public.increment_coupon_usage(text, text) from public, anon, authenticated;
grant execute on function public.increment_coupon_usage(text, text) to service_role;

revoke all on function public.decrement_coupon_usage(text, text) from public, anon, authenticated;
grant execute on function public.decrement_coupon_usage(text, text) to service_role;

revoke all on function public.claim_order_stock_deduction(text, text) from public, anon, authenticated;
grant execute on function public.claim_order_stock_deduction(text, text) to service_role;
