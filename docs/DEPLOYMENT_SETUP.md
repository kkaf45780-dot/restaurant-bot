# Deployment setup (Cloudflare Workers + Supabase)

## 1. Supabase project
Project: Al-Harra Grills
Project ref: `xzrhqkaippwoqakjnxaj`
URL: `https://xzrhqkaippwoqakjnxaj.supabase.co`

The database migrations are applied. Do not insert demo menu or order data into production.

## 2. Cloudflare Worker secrets
In Cloudflare Dashboard, open **Workers & Pages → restaurant-bot → Settings → Variables and Secrets**. Add these as **Secret** values (never commit them):

- `SUPABASE_SERVICE_ROLE_KEY`: Supabase server-only secret/service-role key. Use a secret API key or legacy service_role key that bypasses RLS. Do not use a publishable/anon key here.
- `ADMIN_SESSION_SECRET`: a randomly generated secret with at least 32 characters (prefer 64+ random characters).
- `ADMIN_EMAIL`: the owner's login email.
- `ADMIN_PASSWORD`: a strong unique password for the owner login.
- `GEMINI_API_KEY`: optional, needed for AI receptionist features.

`REQUIRE_SUPABASE=true` is set in Wrangler config. The production Worker should not silently use local seeded data when the Supabase backend is unavailable.

Public Supabase configuration is in `wrangler.jsonc`:
- `SUPABASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_ANON_KEY`

Only publishable/anon keys are safe for browser use.

## 3. GitHub Actions deployment
To deploy from GitHub Actions, open repository **Settings → Secrets and variables → Actions** and add:

Repository secrets:
- `CLOUDFLARE_API_TOKEN` — token with permission to deploy Workers for this account.
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID.

Repository variable:
- `CLOUDFLARE_DEPLOY_ENABLED` = `true` to deploy automatically after pushes to main.

Until the variable is enabled, pushes run validation only. Manual workflow dispatch deploys only after the Cloudflare secrets are set.

Workflow: `.github/workflows/deploy-cloudflare.yml`

## 4. First admin login
The Worker local-admin fallback is configured using `ADMIN_EMAIL` and `ADMIN_PASSWORD` secrets. It signs a short-lived token using `ADMIN_SESSION_SECRET`. Keep these secrets private and change the password after first access.

Supabase Auth users can also sign in, but the Worker checks that they are an authorized restaurant administrator. A new Auth user must be linked to the restaurant in `restaurant_admins` before using Supabase Auth sign-in.

## 5. Final smoke tests
After secrets are configured and deployment completes:
1. Open the storefront and verify menu/branches load from Supabase.
2. Test an order with a clearly marked test customer, then verify it appears in Supabase.
3. Test tracking by order number and order token.
4. Log in to the admin dashboard and verify permissions.
5. Verify image upload to the `restaurant-assets` Storage bucket.
6. Delete the test order/customer only if you explicitly want test data removed.

Never use the production menu for testing with invented pricing.
