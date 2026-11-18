# RESTAURANT BOT — COMPREHENSIVE PRE-COMMERCIAL QA, SECURITY, DATABASE & DEVOPS AUDIT REPORT

**Project:** Restaurant Bot (`موظف المطعم — مشويات الحارة`)  
**Repository Reference:** `https://github.com/kkaf45780-dot/restaurant-bot` *(note: sandbox workspace `/app/applet` contains no `.git` metadata)*  
**Production Reference (Untouched — Zero Tests Run Against Prod):** `https://restaurant-bot.kkaf45780.workers.dev`  
**Audit Date:** 2026-11-18  
**Audit Scope:** Full-Stack Code Review, Automated Unit / Integration / Concurrency / Browser E2E Testing, OWASP & API Penetration Audit, Database / RLS / Storage Review, Performance & Bundle Analysis, RTL / Responsive / Accessibility Audit, Safe Minimal Remediation, and Commercial Release Readiness Gate.

---

## Executive Verdict

> **FINAL DECISION: `NOT READY FOR COMMERCIAL RELEASE`**

While the core application architecture is notably mature in several security-critical areas (server-side authoritative pricing in integer piasters, HMAC-SHA256 order tracking tokens, PBKDF2/bcrypt password hashing with token revocation and rotation timestamps, PostgREST filter sanitization, Turnstile + HMAC single-use chat verification, and atomic concurrency/stock protections), **commercial release to paying restaurant customers is blocked** by:
1. **Multi-tenant & deployment configuration hygiene**: hardcoded single-tenant/developer identifiers in `wrangler.jsonc`, `.env.example`, `render.yaml`, `index.html`, `public/robots.txt`, `public/sitemap.xml`, fallback owner email `admin@hara-grill.eg`, and legacy `Admin@1234` documentation in `README.md:55`.
2. **CI/CD build variable gap**: `.github/workflows/deploy-cloudflare.yml` executes `npm run build` without injecting `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, which—now that the unsafe hardcoded fallback in `src/lib/supabase.ts` has been removed—requires configuring those build-time variables in CI/GitHub repo settings before deploying Supabase Realtime/Auth to Cloudflare.
3. **`supabase/schema.sql` schema drift**: fresh installations executing `supabase/schema.sql` alone (without sequentially running `001`–`009` migrations) miss critical hardening from migrations `005`–`009` (`private` schema helpers, `anon` privilege revocations, storage admin policy tightening, unique idempotency index, and stock-claim RPC `REVOKE EXECUTE`).
4. **Environment-blocked live verifications (`NOT EXECUTED`)**: live Supabase RLS/Auth/Storage/Backup-Restore, live Cloudflare Workers KV/Secrets/Turnstile verification, `k6` staging load tests, non-Chromium browsers (Safari/WebKit, Firefox, Edge), and Git feature-branch/PR creation could not be executed in this isolated sandbox.
5. **Uncompressed static media payload**: bundled dish/hero JPEGs total ~9.1 MB in `dist/assets/*.jpg`, impacting mobile LCP on cellular connections.

---

## Section A — System Inventory & Architecture

| Layer | Technology & Entrypoints | Key Capabilities & Observations |
|---|---|---|
| **Frontend SPA** | React `19.3.1`, TypeScript (`tsc` `7.0.2`), Vite `8.3.8`, Tailwind CSS `4.3.5`, `lucide-react`, `motion`, `qrcode`, `vite-plugin-pwa` (`2.0.0`) | Full Arabic (`lang="ar"`, `dir="rtl"`) customer storefront (`/`, `/menu`, `/chat`, `/checkout`, `/track`, `/orders`, `/favorites`, `/about`, `/privacy`, `/terms`) + lazy-loaded RBAC admin portal (`/admin`). |
| **Edge Runtime** | Cloudflare Workers (`src/worker.ts`, `wrangler.jsonc`, `worker/auth.ts`, `worker/middleware/*`, `worker/routes/*`, `src/server/edgeStore.ts`) | Web-Crypto/HMAC & `bcryptjs` auth, Cloudflare KV rate-limiting & state (`RATE_LIMIT_KV`, `RESTAURANT_DB`), `ASSETS` binding with SPA route allowlist (`isKnownSpaRoute`), `REQUIRE_SUPABASE=true` fail-closed guard. |
| **Node.js / Express Runtime** | Express `4.22.3` + `tsx` (`server.ts`, `src/server/store.ts`, `render.yaml`) | Local persistent JSON store (`.data/db.json` + `.data/uploads/`) or Supabase backend via `SUPABASE_SERVICE_ROLE_KEY`; dual dev (Vite middleware) and prod (`dist/`) server. |
| **Database & Cloud Services** | `@supabase/supabase-js` `2.119.0` (PostgreSQL, Supabase Auth, Supabase Storage `restaurant-assets`, Realtime) | 13 core tables + `supabase/migrations/001`–`009` (`private` schema helpers, idempotency unique index, atomic coupon/stock RPCs). |
| **AI Receptionist** | `@google/genai` `3.3.0` (`src/server/geminiCore.ts`, `src/server/geminiReceptionist.ts`, `src/server/aiTools.ts`) | Egyptian-Arabic conversational ordering using server-side authoritative catalog state + typed `OrderDraft` `ToolCall` mutations (`add_item`, `set_size`, `set_quantity`, `add_extra`, `remove_extra`, `set_customer`, `apply_coupon`, etc.). |
| **Automated Test Suites** | Vitest `5.1.0`, `tsx`, Playwright `1.65.1` (Chromium headless shell) | `tests/unit-comprehensive.test.ts`, `tests/worker.test.ts`, `tests/security.test.ts`, `tests/e2e.test.ts`, `tests/integration-concurrency.test.ts`, `tests/e2e/{chat,comprehensive}.spec.ts`, `tests/load/k6-staging.js`. |

---

## Section B — QA Functional Matrix

| Area / Flow | Verification Method | Result | Notes |
|---|---|---|---|
| Pricing & Totals Engine (`src/lib/pricing.ts`) | Vitest (`unit-comprehensive`) + `e2e.test.ts` | **PASS** | Integer piaster arithmetic prevents float drift (`0.1 * 3 = 0.3`); rejects `NaN`/negative/zero/`>500` quantities; aggregates split-line variants for stock check; deduplicates extras; ignores forged `lineKey`. |
| Working Hours & Manual Status (`src/lib/hours.ts`) | Vitest + `e2e.test.ts` | **PASS** | Handles normal hours, overnight post-midnight shifts, holiday schedule exceptions, `force_open`, and `force_closed`. |
| Coupons (`POST /api/coupons/validate`) | Vitest + `e2e.test.ts` + Playwright | **PASS** | Enforces active status, date range, min order amount, category/item scopes, `>100%` percentage guard, and atomic `usage_limit` increment/decrement. |
| Customer Journey (Menu → Modal → Cart → Coupon → Pickup Checkout → Confirmation → `/track?order=&token=` Reload → Favorites) | Playwright (`comprehensive.spec.ts`) | **PASS** | Fixed 3 drifted E2E selectors (`إضافة إلى السلة`, `تم تطبيق الكود HARA10`, clicking `تتبع حالة الطلب الآن` on confirmation view) and verified full reload persistence with 0 JS errors / 0 5xx. |
| AI Receptionist Tool Execution (`aiTools.ts`) | `e2e.test.ts` | **PASS** | Mutates `OrderDraft` cleanly (`set_size`, `set_quantity`, `add_extra`, `remove_extra`, `set_customer`, `apply_coupon`) without duplicating lines. |
| Live Gemini LLM API Response | Sandbox (no `GEMINI_API_KEY`) | **NOT EXECUTED** | Gemini key not configured in sandbox; server gracefully falls back (`usedFallback: true`) without crashing. |
| AI Chat Privacy Controls (24h TTL + PII Scrubbing + Opt-out Switch) | Vitest + `e2e.test.ts` + Playwright (`chat.spec.ts`) | **PASS** | Fixed missing `role="switch"` / `aria-checked` / `aria-label` in `AIChatView.tsx` and unified cleanup of legacy `chat_<id>` + `moazzaf_chat_history_v2_<id>`. |
| Admin Login, Invalid Password Alert, Menu Item CRUD Live Sync, Row Delete & Logout | Playwright (`comprehensive.spec.ts`) | **PASS** | Fixed Playwright form-open (`إضافة منتج جديد`), submit (`حفظ المنتج`), and row-scoped delete locator; added explicit `aria-label` per item row in `MenuManager.tsx`. |
| Role-Based Access Control (`owner`, `manager`, `cashier`, `kitchen`) | Vitest + `e2e.test.ts` | **PASS** | Enforces overview data minimization and route write isolation across roles. |
| Concurrency & Idempotency (`POST /api/orders`, `PATCH /api/admin/orders/:id/status`) | `integration-concurrency.test.ts` | **PASS** | 5/5 concurrent `Promise.all` scenarios passed: duplicate idempotency key deduplication, `usageLimit=1` coupon race, double-accept stock deduction guard, `stock=1` competition. |
| Soft 404 Protection (`GET /unknown-pentest-route-404`) | `chat.spec.ts` + `curl` | **PASS** | Fixed `server.ts` (dev + prod) to return real HTTP `404` with `public/404.html` and `X-Robots-Tag: noindex, nofollow`. |

---

## Section C — Code Quality & Confirmed Bugs Found

1. **[FIXED — HIGH] Duplicate Chat Storage Modules & Opt-Out/TTL Divergence (`src/lib/chatStorage.ts` vs `src/lib/chat-storage.ts`, `tests/e2e/chat.spec.ts`)**
   - `CustomerPage.tsx` uses `chatStorage.ts` (`moazzaf_chat_history_v2_*`) while `chat-storage.ts` (`chat_*`, `chat_no_save_*`) existed alongside it, causing `chat.spec.ts` to inspect `chat_rest_*` only.
   - **Action**: Updated `src/lib/chatStorage.ts` to unconditionally clear/block `chat_rest_*` keys alongside `moazzaf_chat_history_v2_*`, and updated `tests/e2e/chat.spec.ts` to verify both key spaces. (Recommended post-audit cleanup: consolidate `chat-storage.ts` imports in unit tests into one canonical module.)
2. **[FIXED — HIGH] Hardcoded Developer Supabase Fallback in Browser Client (`src/lib/supabase.ts`)**
   - `src/lib/supabase.ts:4–5` hardcoded `https://xzrhqkaippwoqakjnxaj.supabase.co` and `sb_publishable_tDNRf_-iCZvDtmYypg9TdQ_f_3OgLtM`. In unconfigured/local/commercial builds without `VITE_SUPABASE_*`, the browser attempted unauthorized WebSocket connections (`400 Bad Request` / `HTTP Authentication failed`) to the author's Supabase project and enabled Supabase Auth login against an external tenant.
   - **Action**: Removed hardcoded defaults; `supabase` now initializes strictly from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. **[FIXED — MEDIUM] Express `server.ts` Soft 404 in Both Dev and Prod**
   - `server.ts` returned HTTP `200` with `index.html` for all unknown paths (failing `tests/e2e/chat.spec.ts:55` and harming SEO), unlike `src/worker.ts` which already enforced `isKnownSpaRoute` / `isStaticAssetPath`.
   - **Action**: Added unknown-route & missing-static-asset `404` handling to `server.ts` serving `public/404.html` / `dist/404.html` with `X-Robots-Tag: noindex, nofollow` while preserving Vite dev paths (`/@*`, `/src/*`, `/node_modules/*`, `/uploads/*`).
4. **[FIXED — MEDIUM] Unlocked Concurrent Local DB Writes (`src/server/store.ts`)**
   - 19 local mutation functions (`updateRestaurant`, `upsertCategory`, `deleteCategory`, `upsertMenuItem`, `reorderMenuItems`, `deleteMenuItem`, `upsertDeliveryZone`, `deleteDeliveryZone`, `upsertBranch`, `deleteBranch`, `upsertCoupon`, `deleteCoupon`, `updateOrderPaymentStatus`, `rateOrderByToken`, `upsertEmployee`, `deleteEmployee`, `appendActivityLog`, `markNotificationsRead`, `appendAiLog`) called `readLocalDb()` → `writeLocalDb()` without `withLocalDbLock(...)`, creating a lost-update race condition under concurrent local requests.
   - **Action**: Wrapped all 19 local mutations in `withLocalDbLock(...)`.
5. **[FIXED — MEDIUM] Missing Switch Semantics on Mobile/Desktop Chat Opt-Out (`src/components/customer/AIChatView.tsx`)**
   - Button used `aria-pressed` instead of `role="switch"` / `aria-checked`, lacked `aria-label="عدم حفظ المحادثة"`, and hid label text below `sm`.
   - **Action**: Added `role="switch"`, `aria-checked={chatOptOut}`, and `aria-label="عدم حفظ المحادثة"`.
6. **[FIXED — LOW/MEDIUM] Playwright E2E Test Drift & Non-Targeted Row Deletion (`tests/e2e/comprehensive.spec.ts`, `MenuManager.tsx`)**
   - `comprehensive.spec.ts` used outdated button strings (`/أضف للسلة/`, `/تم تطبيق كود HARA10/`, skipped confirmation screen click `'تتبع حالة الطلب الآن'`, didn't click `'إضافة منتج جديد'`, and clicked `.first()` delete button which targeted categories rather than the created product row).
   - **Action**: Aligned locators with actual UI flow, scoped row deletion to `tr` containing `dishName`, filtered offline external CDN / intentional invalid-coupon `400` noise from JS errors while strictly checking same-origin request failures, and added `aria-label` per item row in `MenuManager.tsx`.
7. **[OPEN — MEDIUM] Hardcoded Single-Tenant Email Fallbacks & Docs (`admin@hara-grill.eg`, `README.md:55`)**
   - `server.ts`, `src/worker.ts`, `src/server/store.ts`, `src/server/edgeStore.ts`, `src/pages/AdminPage.tsx`, and `render.yaml` still default owner email to `admin@hara-grill.eg`, and `README.md:55` still documents the compromised `Admin@1234` password (even though runtime code rejects it).

---

## Section D — OWASP Top 10, API Security & Penetration Test Matrix

| Attack Vector / CWE | Status | Evidence & Notes |
|---|---|---|
| **CSV Formula Injection (`CWE-1236`) in `/api/admin/orders/export`** | **FIXED (HIGH)** | Both `server.ts` and `src/worker.ts` previously only escaped `"`. Added shared `src/lib/csv.ts` (`escapeCsvCell`) prefixing values matching `/^[=+\-@\t\r]/` with `'`, verified by new Vitest regression tests (`tests/security.test.ts`). |
| **Broken Access Control / IDOR (`A01:2021`)** | **PASS** | Multi-tenant `authorizeRestaurantAccess` verifies JWT/local token `restaurantId` matches target; order tracking requires signed HMAC `orderToken`; admin RBAC enforced on every endpoint; `supabase` migrations `007`–`009` revoke direct `anon`/`authenticated` access to `orders`, `employees`, `customers`, `logs`, and RPCs. |
| **Cryptographic Failures & Session Security (`A02:2021`)** | **PASS** | `bcryptjs` / Web-Crypto PBKDF2 password hashes; constant-time HMAC signature checks; compromised passwords blocked (`COMPROMISED_DEFAULT_PASSWORDS`); JWT `jti` revocation on logout + `passwordChangedAt` invalidates prior tokens; Worker production requires `ADMIN_SESSION_SECRET >= 32` chars. |
| **Express `REQUIRE_SUPABASE` Fail-Closed Parity** | **FIXED (MEDIUM)** | `src/worker.ts:446` failed closed with `503` when `REQUIRE_SUPABASE=true` lacked service credentials, whereas `server.ts` did not enforce it uniformly at middleware level. Added `/api` middleware in `server.ts` (allowing `/api/health` and `/api/config/status`) to fail closed (`503`). |
| **Injection / XSS / PostgREST Filter Injection (`A03:2021`)** | **PASS** | Static sink scan found 0 `dangerouslySetInnerHTML`, 0 `eval`, 0 `new Function`; only `AIChatView.tsx:117` clears Turnstile container via `innerHTML = ''`. PostgREST filter injection and unsafe media URLs (`javascript:`, `data:text/html`) blocked in `publicSanitizer.ts` & `uploadValidation.ts`. |
| **File Upload Validation (`CWE-434`)** | **PASS** | `/api/admin/upload` checks 5 MB cap and verifies magic bytes (`detectValidImageFromBytes`: JPG/PNG/WEBP/GIF only) ignoring client filename. |
| **Security Misconfiguration & HTTP Headers (`A05:2021`)** | **FIXED (LOW/MEDIUM)** | Added `app.disable('x-powered-by')`, `Permissions-Policy`, and `X-Robots-Tag: noindex, nofollow` on `/api/*` & `/admin*` in `server.ts` to match `worker/middleware/security.ts`. Verified via `curl -sI` on port 3000. |
| **IP Spoofing Behind Express (`X-Forwarded-For`)** | **OPEN (LOW/MEDIUM)** | `extractClientIpFromHeaders` prioritizes `CF-Connecting-IP` (safe on Cloudflare Workers, which overwrites that header), then falls back to `X-Forwarded-For`. On standalone Node/Express deployments exposed directly without a trusted proxy stripping `X-Forwarded-For`, clients could spoof `X-Forwarded-For` to rotate IP rate-limit buckets. |
| **Vulnerable & Outdated Components (`A06:2021`)** | **PASS (RUNTIME) / WARN (DEV)** | `bun audit`: **2 moderate** CVEs (`glob@11.1.0` GHSA-3g3m-2fjr-6pw4, `minimatch@10.2.6 / 5.1.9` GHSA-g3hv-75wg-m249 via `vite-plugin-pwa > workbox-build`, build-time dev dependency only); **0 high/critical** runtime CVEs. |
| **AI Prompt Injection & Bot Abuse** | **PASS** | `geminiCore.ts` detects English/Arabic prompt injection patterns, separates untrusted user text from server-authoritative state JSON, enforces `ALLOWED_AI_MODELS`, caps input turns, and `chatSecurity.ts` gates at 5 unverified turns + single-use HMAC/Turnstile challenges + sliding rate limits. |
| **Production Target Penetration Testing** | **NOT EXECUTED** | Strictly prohibited per audit rules (`restaurant-bot.kkaf45780.workers.dev` untouched). |

---

## Section E — Database, Supabase, Storage & Performance Audit

### Database & Supabase Findings
- **Strong Migration Architecture (`001`–`009`)**:
  - `006_move_rls_helpers_to_private_schema.sql`: moves `is_admin()` helper out of `public` schema into `private` with explicit `search_path`.
  - `007_revoke_direct_public_table_access.sql`: revokes all privileges from `anon`/`authenticated`/`public` on sensitive tables (`orders`, `order_items`, `customers`, `employees`, `activity_logs`, `notifications`, `ai_logs`, `inventory_movements`, `restaurant_admins`), leaving `SELECT` only on public catalog tables (`restaurants`, `branches`, `menu_categories`, `menu_items`, `delivery_zones`, `coupons`) for Realtime/storefront.
  - `008_commercial_hardening.sql`: restricts `coupons` `SELECT` column grants so `usage_limit` and `used_count` are hidden from `anon`/`authenticated`; creates composite indexes (`idx_orders_rest_status_created`, `idx_customers_rest_last_order`); enforces `private.is_admin()` on `storage.objects` (`restaurant-assets` bucket).
  - `009_concurrency_and_security_hardening.sql`: enforces unique partial index `uq_orders_rest_idempotency` on `(restaurant_id, idempotency_key)`, adds atomic `increment_coupon_usage` / `decrement_coupon_usage` / `claim_order_stock_deduction`, and revokes RPC `EXECUTE` from `public`/`anon`/`authenticated` (granting only to `service_role`).
- **[OPEN — HIGH] `supabase/schema.sql` Lagging Behind Migrations `005`–`009`**:
  - `supabase/schema.sql:337–423` still defines `public.is_restaurant_admin`, omits column-restricted `coupons` grants, omits `uq_orders_rest_idempotency` / `claim_order_stock_deduction`, and grants `storage.objects` writes to any `auth.role() = 'authenticated'` user rather than `private.is_admin()`. Fresh commercial deployments MUST run `001`–`009` migrations sequentially or synchronize `schema.sql` before release.
- **Live Supabase Verification (`NOT EXECUTED`)**: Live PostgreSQL RLS policies, Realtime auth, Storage uploads, and Backup/Restore DR drills were **NOT EXECUTED** (no live staging Supabase project/service-role credentials in sandbox).

### Performance & Bundle Analysis
- **JS Chunking (`dist/assets/*.js`)**: Route/component lazy loading works well (`AdminPage` 47 KB, `OrdersAndOverview` 52 KB, `MenuManager` 39 KB, `CheckoutView` 36 KB, `AIChatView` 31 KB, `index` entry 117 KB, `vendor-react` 536 KB raw). Note `vite.config.ts` splits React, Lucide icons, Motion, and Supabase cleanly.
- **[OPEN — MEDIUM] Heavy Uncompressed Bundled JPEG Images (~9.1 MB total)**:
  - Ten static images in `dist/assets/*.jpg` range from `699 KB` to `1.2 MB` each (`dish_shish_tarab` 1.2 MB, `hero_mixed_grill_platter` 1.1 MB, etc.). Converting to resized WebP/AVIF (<120 KB each) would cut initial visual payload by ~85%.
- **Load Testing (`k6`)**: `tests/load/k6-staging.js` exists and refuses production URLs, but execution was **NOT EXECUTED** (`k6` binary not installed and no staging URL provisioned).

---

## Section F — Responsive, RTL, Accessibility, Browser & PWA Audit

- **RTL & Viewport Overflow (`comprehensive.spec.ts`)**: Verified in Chromium headless across **6 viewports** (`1366×768`, `1440×900`, `1920×1080`, `768×1024`, `1024×768`, `375×812`) on `/`, `/menu`, `/chat`, and `/admin`: `document.documentElement.dir === 'rtl'` and `scrollWidth <= innerWidth + 1` on every route/viewport.
- **Accessibility Improvements Applied**:
  - `AIChatView.tsx`: chat opt-out toggle now exposes `role="switch"`, `aria-checked`, and `aria-label="عدم حفظ المحادثة"` at all breakpoints.
  - `MenuManager.tsx`: added per-item `aria-label="تعديل ..."` and `aria-label="حذف ..."` to match category buttons.
  - Existing skip link (`انتقل إلى المحتوى` in `CustomerPage.tsx`), `role="alert"` on login errors (`AdminLogin.tsx`), and accessible form labels verified intact.
- **PWA Compliance (`vite-plugin-pwa`)**:
  - Generated `dist/manifest.webmanifest` (`dir: "rtl"`, `lang: "ar"`, `display: "standalone"`, 192px/512px/maskable PNG icons), `dist/sw.js`, and `dist/workbox-1ff98c86.js`.
  - `runtimeCaching` uses `NetworkFirst` for `/api/restaurant` and HTML navigations, `CacheFirst` for fonts; does **not** cache `/api/orders` or `/api/admin` or `/api/chat`.
- **Cross-Browser Matrix**:
  - Chromium headless shell (`chromium_headless_shell-1247`): **EXECUTED & PASSED (5/5)**.
  - Firefox, WebKit/Safari, MS Edge, physical iOS/Android Safari/Chrome: **NOT EXECUTED** (browsers not installed in sandbox).

---

## Section G — Implemented Fixes & Exact Post-Fix Verification Results

### Files Modified / Created During Audit
1. `src/lib/csv.ts` *(new)* — Shared CWE-1236 CSV formula injection escaper (`escapeCsvCell`).
2. `server.ts` — Disabled `x-powered-by`, added `Permissions-Policy` + `X-Robots-Tag`, added `/api` `REQUIRE_SUPABASE=true` fail-closed `503` parity guard, applied `escapeCsvCell`, fixed Soft `404` for unknown routes/missing static files in both dev and prod.
3. `src/worker.ts` — Applied shared `escapeCsvCell` to `/api/admin/orders/export`.
4. `src/server/store.ts` — Wrapped all 19 previously unlocked local DB mutation functions with `withLocalDbLock(...)`.
5. `src/lib/supabase.ts` — Removed hardcoded developer Supabase project URL (`xzrhqkaippwoqakjnxaj.supabase.co`) and publishable key fallback.
6. `src/lib/chatStorage.ts` — Ensured `chat_rest_*` legacy keys are also cleared on opt-out and load.
7. `src/components/customer/AIChatView.tsx` — Added `role="switch"`, `aria-checked`, and `aria-label="عدم حفظ المحادثة"`.
8. `src/components/admin/MenuManager.tsx` — Added `aria-label` to item edit/delete buttons.
9. `tests/e2e/chat.spec.ts`, `tests/e2e/comprehensive.spec.ts`, `tests/security.test.ts` — Fixed drifted locators, scoped row delete, added CWE-1236 & route guard regression tests.

### Executed Post-Fix Verification Commands & Counts
| Check | Command | Result |
|---|---|---|
| Production Frontend Build | `npm run build` (`vite build`) | **PASSED** (`dist/` built cleanly; 0 secret leaks in `dist/assets/*.js`) |
| TypeScript Type Check | `npm run lint` (`tsc --noEmit`) | **PASSED** (0 errors) |
| Cloudflare Worker Bundle | `npx esbuild src/worker.ts --bundle --format=esm --platform=browser --main-fields=module,main --conditions=workerd,worker,browser --external:node:* --external:crypto --outfile=/tmp/worker-check.mjs` | **PASSED** (`2.0mb`, exit 0) |
| Vitest Unit & Worker Security Suites | `npx vitest run` | **PASSED** — **3 files / 22 tests passed** (`unit-comprehensive`: 9, `worker`: 4, `security`: 9) |
| API & Security E2E Suite | `npx tsx tests/e2e.test.ts` | **14 PASSED, 0 FAILED, 1 SKIPPED** *(Admin E2E skipped because env `ADMIN_PASSWORD` is unset)* |
| Concurrency & Race Integration Suite | `npx tsx tests/integration-concurrency.test.ts` | **5 PASSED, 0 FAILED** |
| Playwright Browser E2E Suite (Chromium) | `npx playwright test --reporter=list` | **5 PASSED, 0 FAILED** (`chat.spec.ts`: 2, `comprehensive.spec.ts`: 3 across 6 RTL viewports) |
| Runtime Header & 404 Probe | `curl -sI http://127.0.0.1:3000/{api/health,admin,unknown-pentest-route-404}` | **PASSED** (`HTTP 404`, `X-Robots-Tag: noindex, nofollow`, `Permissions-Policy`, no `X-Powered-By`) |
| Dependency Vulnerability Audit | `/usr/local/bin/bun audit` | **2 moderate** dev-only (`glob`, `minimatch` in `vite-plugin-pwa > workbox-build`); **0 high/critical** runtime |
| Staging Load Test (`k6`) | `k6 run tests/load/k6-staging.js` | **NOT EXECUTED** (`k6` binary missing & no staging target) |
| Live Supabase / Cloudflare Deployment Checks | Live SQL/RLS/Storage/KV/Turnstile/Backup | **NOT EXECUTED** (no staging credentials / prod untouched) |
| Non-Chromium Browsers | Firefox / Safari (WebKit) / Edge | **NOT EXECUTED** (Chromium headless shell only in sandbox) |
| Git Branch & Pull Request Creation | `git status` | **NOT EXECUTED** (`/app/applet` has no `.git` repository) |

---

## Section H — Issue Registry & 12-Point Commercial Release Readiness Checklist

### Comprehensive Issue Registry
| ID | Severity | Component / File | Finding | Status |
|---|---|---|---|---|
| SEC-01 | **High** | `server.ts`, `src/worker.ts` (`/api/admin/orders/export`) | CSV Formula Injection (`CWE-1236`) on customer name/address/phone cells | **FIXED** (`src/lib/csv.ts`) |
| SEC-02 | **High** | `src/lib/supabase.ts` | Hardcoded developer Supabase URL & publishable key causing unauthorized WebSockets & cross-tenant auth in unconfigured builds | **FIXED** |
| QA-01 | **High** | `src/lib/chatStorage.ts`, `tests/e2e/chat.spec.ts` | Divergent `localStorage` chat key prefixes (`moazzaf_chat_history_v2_` vs `chat_rest_`) | **FIXED** |
| QA-02 | **Medium** | `server.ts` | Soft `404` returning HTTP `200` on nonexistent routes in dev & prod | **FIXED** |
| CONC-01 | **Medium** | `src/server/store.ts` | 19 local DB mutation helpers wrote `.data/db.json` without `withLocalDbLock` | **FIXED** |
| SEC-03 | **Medium** | `server.ts` | Missing `REQUIRE_SUPABASE=true` fail-closed `503` API middleware & `X-Powered-By` / `Permissions-Policy` / `X-Robots-Tag` parity | **FIXED** |
| A11Y-01 | **Medium** | `src/components/customer/AIChatView.tsx`, `MenuManager.tsx` | Chat opt-out lacked `role="switch"` / `aria-checked` / `aria-label`; item action buttons lacked per-item `aria-label` | **FIXED** |
| QA-03 | **Medium** | `tests/e2e/comprehensive.spec.ts` | Broken E2E selectors & un-scoped `.first()` delete clicking category instead of test item | **FIXED** |
| DB-01 | **High (Blocker)** | `supabase/schema.sql` | Lags behind migrations `005`–`009` (older `public.is_restaurant_admin`, broader storage policy, missing `uq_orders_rest_idempotency` & RPC `REVOKE`) | **OPEN** |
| OPS-01 | **High (Blocker)** | `.github/workflows/deploy-cloudflare.yml` | Does not pass `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` during `npm run build` (now required after `SEC-02` fix for client Realtime/Auth) and omits Playwright CI step | **OPEN** |
| COM-01 | **High (Blocker)** | `wrangler.jsonc`, `.env.example`, `render.yaml`, `index.html`, `public/{robots.txt,sitemap.xml}`, `README.md`, fallback emails | Hardcoded single-tenant URLs/keys/emails (`xzrhqkaippwoqakjnxaj`, `admin@hara-grill.eg`) and stale `Admin@1234` doc in `README.md:55` | **OPEN** |
| SEC-04 | **Low/Med** | `server.ts` + `src/server/chatSecurity.ts` | Standalone Node/Express trusts raw `X-Forwarded-For` header without proxy allowlist | **OPEN** |
| PERF-01 | **Medium** | `src/assets/*.jpg` (`dist/assets/*.jpg`) | Bundled JPEG menu/hero images total ~9.1 MB uncompressed | **OPEN** |
| OPS-02 | **High (Blocker)** | Staging Environment | Live Supabase RLS/Storage/Backup-Restore, Cloudflare KV/Turnstile, `k6` load test, and cross-browser QA not yet executed against staging | **NOT EXECUTED** |

### 12-Point Commercial Release Readiness Checklist
1. [x] Core pricing, tax/delivery/coupon calculations verified mathematically & via automated tests.
2. [x] Concurrency & race protections (idempotency, atomic stock, coupon limits, local DB locking) verified passing.
3. [x] Authentication, RBAC, password hashing, token revocation & CSV export injection (`CWE-1236`) hardened & tested.
4. [x] Real HTTP `404` & security headers verified on both Cloudflare Worker & Express backends.
5. [x] RTL Arabic rendering & zero horizontal overflow verified across Desktop, Tablet, and Mobile viewports (Chromium).
6. [x] Zero hardcoded runtime secrets in built JS bundle (`dist/assets/*.js`) verified.
7. [ ] **BLOCKER:** Sync `supabase/schema.sql` with migrations `005`–`009` and verify full execution on a clean staging Supabase project.
8. [ ] **BLOCKER:** Pass `VITE_SUPABASE_URL` & `VITE_SUPABASE_ANON_KEY` in `.github/workflows/deploy-cloudflare.yml` build step and configure Playwright CI.
9. [ ] **BLOCKER:** Parameterize / strip all hardcoded single-tenant URLs, keys, `admin@hara-grill.eg` defaults, and `README.md:55` `Admin@1234` reference for multi-customer commercial packaging.
10. [ ] **BLOCKER:** Execute live staging verification (Supabase RLS/Auth/Storage/Backup-Restore drill, Cloudflare KV bindings, Turnstile live token check, `ADMIN_PASSWORD` full E2E).
11. [ ] **BLOCKER:** Execute `k6` load test (`tests/load/k6-staging.js`) against staging and inspect p95/p99 latency.
12. [ ] **RECOMMENDED:** Compress bundled JPEGs (~9.1 MB → WebP <1.2 MB), configure Express `trust proxy` when behind reverse proxies, and run WebKit/Safari & Firefox E2E.

---

**Final Determination:** **`NOT READY FOR COMMERCIAL RELEASE`** until blockers #7–#11 are resolved and verified on an isolated staging environment.
