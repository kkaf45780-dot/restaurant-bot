export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

export const KNOWN_SPA_ROUTES = new Set<string>([
  '/',
  '/menu',
  '/chat',
  '/checkout',
  '/track',
  '/orders',
  '/favorites',
  '/about',
  '/privacy',
  '/terms',
  '/admin',
]);

export function isKnownSpaRoute(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return KNOWN_SPA_ROUTES.has(normalized);
}

export function isStaticAssetPath(pathname: string): boolean {
  if (pathname.startsWith('/assets/') || pathname.startsWith('/uploads/')) return true;
  return /\.(js|mjs|css|png|jpg|jpeg|webp|svg|ico|woff|woff2|json|webmanifest|txt|xml|map)$/i.test(
    pathname
  );
}

export function resolveAllowedCorsOrigin(
  requestOrigin: string | null,
  requestUrlOrigin: string,
  allowedOriginsEnv?: string
): string | null {
  if (!requestOrigin) return null;
  if (requestOrigin === requestUrlOrigin) {
    return requestOrigin;
  }
  const extraOrigins = (allowedOriginsEnv || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (extraOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return null;
}

export function handleCorsPreflight(
  request: Request,
  allowedOriginsEnv?: string
): Response | null {
  if (request.method.toUpperCase() !== 'OPTIONS') return null;
  const origin = request.headers.get('origin');
  const urlOrigin = new URL(request.url).origin;
  const allowedOrigin = resolveAllowedCorsOrigin(origin, urlOrigin, allowedOriginsEnv);

  if (origin && !allowedOrigin) {
    return applySecurityHeaders(
      Response.json({ error: 'Origin not allowed' }, { status: 403 }),
      request,
      allowedOriginsEnv
    );
  }

  const headers = new Headers(SECURITY_HEADERS);
  if (allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Captcha-Token');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return new Response(null, { status: 204, headers });
}

export function applySecurityHeaders(
  response: Response,
  request?: Request,
  allowedOriginsEnv?: string
): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }

  if (request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) {
      headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
    if (url.pathname.startsWith('/api/admin/') || url.pathname === '/api/orders/track') {
      headers.set('Cache-Control', 'no-store');
    }
    const origin = request.headers.get('origin');
    const allowedOrigin = resolveAllowedCorsOrigin(origin, url.origin, allowedOriginsEnv);
    if (allowedOrigin) {
      headers.set('Access-Control-Allow-Origin', allowedOrigin);
      headers.set('Vary', 'Origin');
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function safeErrorResponse(
  status: number,
  publicMessage: string,
  internalErr?: unknown
): Response {
  if (internalErr) {
    const safeMsg =
      internalErr instanceof Error ? internalErr.message : 'Unexpected internal error';
    console.error(`[SecuritySafeError status=${status}]`, safeMsg);
  }
  return Response.json({ error: publicMessage }, { status });
}
