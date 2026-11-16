import type { KVNamespaceLike } from '../../src/server/edgeStore.ts';
export type { KVNamespaceLike };

interface RateRecord {
  count: number;
  resetAt: number;
}

const memoryRateMap = new Map<string, RateRecord>();
const memoryLockMap = new Map<string, number>();

export function clearRateLimitMemory(): void {
  memoryRateMap.clear();
  memoryLockMap.clear();
}

export function getClientIp(headers: Headers | Record<string, string | string[] | undefined>): string {
  const readHeader = (name: string): string | undefined => {
    if (headers instanceof Headers) {
      return headers.get(name) ?? undefined;
    }
    const val = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(val) ? val[0] : val;
  };

  const cfIp = readHeader('cf-connecting-ip');
  if (cfIp && cfIp.trim()) return cfIp.trim();

  const realIp = readHeader('x-real-ip');
  if (realIp && realIp.trim()) return realIp.trim();

  const forwarded = readHeader('x-forwarded-for');
  if (forwarded && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  return 'unknown';
}

async function readCounter(
  kv: KVNamespaceLike | undefined,
  key: string,
  now: number,
  windowMs: number
): Promise<RateRecord> {
  if (kv) {
    try {
      const raw = (await kv.get(key, 'json')) as RateRecord | null;
      if (raw && typeof raw.count === 'number' && typeof raw.resetAt === 'number' && raw.resetAt > now) {
        return raw;
      }
    } catch {
      // Fallback to memory map
    }
  }
  const existing = memoryRateMap.get(key);
  if (existing && existing.resetAt > now) {
    return existing;
  }
  return { count: 0, resetAt: now + windowMs };
}

async function writeCounter(
  kv: KVNamespaceLike | undefined,
  key: string,
  record: RateRecord
): Promise<void> {
  memoryRateMap.set(key, record);
  if (kv) {
    await kv.put(key, JSON.stringify(record)).catch(() => {});
  }
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

export async function checkFixedWindowRateLimit(params: {
  kv?: KVNamespaceLike;
  prefix: string;
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const { kv, prefix, key, limit, windowSeconds } = params;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const storeKey = `rl:${prefix}:${key}`;
  const current = await readCounter(kv, storeKey, now, windowMs);

  if (current.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return {
      allowed: false,
      count: current.count,
      limit,
      retryAfterSeconds,
    };
  }

  const next: RateRecord = {
    count: current.count + 1,
    resetAt: current.resetAt > now ? current.resetAt : now + windowMs,
  };
  await writeCounter(kv, storeKey, next);

  return {
    allowed: true,
    count: next.count,
    limit,
    retryAfterSeconds: 0,
  };
}

export function rateLimitResponse(retryAfterSeconds: number, message: string): Response {
  return Response.json(
    {
      error: message,
      retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, retryAfterSeconds)),
      },
    }
  );
}

const LOGIN_WINDOW_SECONDS = 60;
const LOGIN_MAX_PER_MIN = 5;
const LOCKOUT_SECONDS = 15 * 60;

async function getLockUntil(kv: KVNamespaceLike | undefined, lockKey: string): Promise<number> {
  const now = Date.now();
  if (kv) {
    try {
      const raw = (await kv.get(lockKey, 'json')) as { lockedUntil?: number } | null;
      if (raw?.lockedUntil && raw.lockedUntil > now) return raw.lockedUntil;
    } catch {
      // Fallback
    }
  }
  const mem = memoryLockMap.get(lockKey) ?? 0;
  return mem > now ? mem : 0;
}

async function setLockUntil(
  kv: KVNamespaceLike | undefined,
  lockKey: string,
  lockedUntil: number
): Promise<void> {
  memoryLockMap.set(lockKey, lockedUntil);
  if (kv) {
    await kv.put(lockKey, JSON.stringify({ lockedUntil })).catch(() => {});
  }
}

export async function checkLoginRateAndLockout(params: {
  kv?: KVNamespaceLike;
  ip: string;
  email?: string;
}): Promise<{ allowed: boolean; locked: boolean; retryAfterSeconds: number }> {
  const { kv, ip, email } = params;
  const now = Date.now();
  const ipLockKey = `lock:login:ip:${ip}`;
  const ipLockedUntil = await getLockUntil(kv, ipLockKey);
  if (ipLockedUntil > now) {
    return {
      allowed: false,
      locked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((ipLockedUntil - now) / 1000)),
    };
  }

  if (email) {
    const emailLockKey = `lock:login:acct:${email.toLowerCase()}:${ip}`;
    const emailLockedUntil = await getLockUntil(kv, emailLockKey);
    if (emailLockedUntil > now) {
      return {
        allowed: false,
        locked: true,
        retryAfterSeconds: Math.max(1, Math.ceil((emailLockedUntil - now) / 1000)),
      };
    }
  }

  const rate = await checkFixedWindowRateLimit({
    kv,
    prefix: 'login',
    key: ip,
    limit: LOGIN_MAX_PER_MIN,
    windowSeconds: LOGIN_WINDOW_SECONDS,
  });

  if (!rate.allowed) {
    const lockUntil = now + LOCKOUT_SECONDS * 1000;
    await setLockUntil(kv, ipLockKey, lockUntil);
    return {
      allowed: false,
      locked: true,
      retryAfterSeconds: LOCKOUT_SECONDS,
    };
  }

  return { allowed: true, locked: false, retryAfterSeconds: 0 };
}

export async function recordLoginFailure(params: {
  kv?: KVNamespaceLike;
  ip: string;
  email?: string;
}): Promise<{ lockedNow: boolean; retryAfterSeconds: number }> {
  const { kv, ip, email } = params;
  const now = Date.now();
  const failRate = await checkFixedWindowRateLimit({
    kv,
    prefix: 'login_fail',
    key: ip,
    limit: LOGIN_MAX_PER_MIN,
    windowSeconds: LOCKOUT_SECONDS,
  });
  if (!failRate.allowed || failRate.count >= LOGIN_MAX_PER_MIN) {
    const lockUntil = now + LOCKOUT_SECONDS * 1000;
    await setLockUntil(kv, `lock:login:ip:${ip}`, lockUntil);
    if (email) {
      await setLockUntil(kv, `lock:login:acct:${email.toLowerCase()}:${ip}`, lockUntil);
    }
    return { lockedNow: true, retryAfterSeconds: LOCKOUT_SECONDS };
  }
  return { lockedNow: false, retryAfterSeconds: 0 };
}

export async function clearLoginFailures(params: {
  kv?: KVNamespaceLike;
  ip: string;
  email?: string;
}): Promise<void> {
  const { kv, ip, email } = params;
  const keys = [
    `lock:login:ip:${ip}`,
    `rl:login:${ip}`,
    `rl:login_fail:${ip}`,
    ...(email ? [`lock:login:acct:${email.toLowerCase()}:${ip}`] : []),
  ];
  for (const k of keys) {
    memoryLockMap.delete(k);
    memoryRateMap.delete(k);
    if (kv) {
      await kv.put(k, JSON.stringify({ count: 0, resetAt: 0, lockedUntil: 0 })).catch(() => {});
    }
  }
}

export async function verifyTurnstileOrCaptcha(params: {
  captchaToken?: string;
  turnstileSecretKey?: string;
  ip: string;
}): Promise<boolean> {
  const token = (params.captchaToken || '').trim();
  if (!token || token.length < 6) return false;

  if (params.turnstileSecretKey) {
    try {
      const form = new URLSearchParams();
      form.set('secret', params.turnstileSecretKey);
      form.set('response', token);
      if (params.ip && params.ip !== 'unknown') {
        form.set('remoteip', params.ip);
      }
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { success?: boolean };
      return Boolean(data.success);
    } catch {
      return false;
    }
  }

  // Fallback human-challenge verification when Turnstile secret is not configured in local dev:
  // Accepts human_verified_<timestamp> or turnstile-compatible token >= 12 chars
  return /^human_verified_\d{10,}$/.test(token) || token.length >= 20;
}

export async function checkChatRateAndCaptcha(params: {
  kv?: KVNamespaceLike;
  ip: string;
  captchaToken?: string;
  turnstileSecretKey?: string;
}): Promise<
  | { allowed: true; count: number }
  | { allowed: false; response: Response }
> {
  const { kv, ip, captchaToken, turnstileSecretKey } = params;
  const rate = await checkFixedWindowRateLimit({
    kv,
    prefix: 'chat',
    key: ip,
    limit: 20,
    windowSeconds: 60,
  });

  if (!rate.allowed) {
    return {
      allowed: false,
      response: rateLimitResponse(
        rate.retryAfterSeconds,
        'تم إرسال رسائل كثيرة في وقت قصير. يُرجى الانتظار دقيقة ثم المحاولة مرة أخرى.'
      ),
    };
  }

  if (rate.count > 5) {
    const captchaValid = await verifyTurnstileOrCaptcha({
      captchaToken,
      turnstileSecretKey,
      ip,
    });
    if (!captchaValid) {
      return {
        allowed: false,
        response: Response.json(
          {
            error: 'يُرجى إتمام التحقق الأمني قبل إرسال المزيد من الرسائل.',
            captchaRequired: true,
          },
          { status: 403 }
        ),
      };
    }
  }

  return { allowed: true, count: rate.count };
}

export async function checkTrackRateLimit(params: {
  kv?: KVNamespaceLike;
  ip: string;
}): Promise<RateLimitResult> {
  return checkFixedWindowRateLimit({
    kv: params.kv,
    prefix: 'track',
    key: params.ip,
    limit: 30,
    windowSeconds: 60,
  });
}

export async function checkCouponRateLimit(params: {
  kv?: KVNamespaceLike;
  ip: string;
}): Promise<RateLimitResult> {
  return checkFixedWindowRateLimit({
    kv: params.kv,
    prefix: 'coupon',
    key: params.ip,
    limit: 20,
    windowSeconds: 60,
  });
}
