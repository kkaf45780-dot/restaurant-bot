-- Restrict direct public access to coupon operational fields and storage mutations.
-- Public menu/coupon presentation and validation are served through the Cloudflare Worker,
-- which sanitizes coupon data and validates codes server-side.
-- Admin image uploads also go through /api/admin/upload and the Worker service role.

drop policy if exists "Public read active coupons" on public.coupons;

drop policy if exists "Authenticated upload restaurant assets" on storage.objects;
drop policy if exists "Authenticated update restaurant assets" on storage.objects;
drop policy if exists "Authenticated delete restaurant assets" on storage.objects;

-- Keep the bucket publicly readable for menu images, but do not allow arbitrary
-- authenticated users to write/delete assets directly through Supabase Storage.
