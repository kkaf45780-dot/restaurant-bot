/**
 * Web-Crypto & Edge-compatible security module (zero Node built-ins).
 * Handles IP SHA-256 hashing, sliding-window rate limits, daily quotas,
 * single-use Turnstile + HMAC challenge verification, and HMAC order tracking tokens.
 */

import type { ChatChallengeResponse } from '../types/restaurant.ts';

export interface KVStoreLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

const encoder = new TextEncoder();
const memoryWindowMap = new Map<string, number[]>();
const memoryCounterMap = new Map<string, { value: number; expiresAt: number }>();
const memoryUsedTokens = new Map<string, number>();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array | null {
  try {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

const ARABIC_DIGITS: Record<string, string> = {
  '\u0660': '0',
  '\u0661': '1',
  '\u0662': '2',
  '\u0663': '3',
  '\u0664': '4',
  '\u0665': '5',
  '\u0666': '6',
  '\u0667': '7',
  '\u0668': '8',
  '\u0669': '9',
  '\u06F0': '0',
  '\u06F1': '1',
  '\u06F2': '2',
  '\u06F3': '3',
  '\u06F4': '4',
  '\u06F5': '5',
  '\u06F6': '6',
  '\u06F7': '7',
  '\u06F8': '8',
  '\u06F9': '9',
};

function normalizeNumericAnswer(val: string): string {
  return val
    .trim()
    .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => ARABIC_DIGITS[ch] ?? ch)
    .replace(/\s+/g, '');
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signHmac(data: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return toBase64Url(new Uint8Array(sig));
}

export async function hashIpForLog(ip: string): Promise<string> {
  const hex = await sha256Hex(`ip_log:${ip || 'unknown'}`);
  return hex.slice(0, 16);
}

export function extractClientIpFromHeaders(headers: { get(name: string): string | null }, fallbackIp?: string): string {
  const cfIp = headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;
  const xff = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (xff) return xff;
  return fallbackIp || '127.0.0.1';
}

export function isForbiddenBypassToken(token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const t = token.trim();
  return /^human_verified_/i.test(t) || t === 'verified' || t === 'bypass';
}

function pruneMemoryUsedTokens(): void {
  const now = Date.now();
  if (memoryUsedTokens.size > 5000) {
    for (const [k, exp] of memoryUsedTokens.entries()) {
      if (now > exp) memoryUsedTokens.delete(k);
    }
  }
}

async function isReplayTokenUsed(replayKey: string, kv?: KVStoreLike): Promise<boolean> {
  const now = Date.now();
  const memExp = memoryUsedTokens.get(replayKey);
  if (memExp && now < memExp) return true;
  if (kv) {
    try {
      const raw = await kv.get(`replay:${replayKey}`);
      if (raw) {
        const exp = Number(raw);
        if (!Number.isNaN(exp) && now < exp) {
          memoryUsedTokens.set(replayKey, exp);
          return true;
        }
      }
    } catch {
      // Ignore KV read errors
    }
  }
  return false;
}

async function markReplayTokenUsed(
  replayKey: string,
  ttlSeconds: number,
  kv?: KVStoreLike
): Promise<void> {
  pruneMemoryUsedTokens();
  const exp = Date.now() + ttlSeconds * 1000;
  memoryUsedTokens.set(replayKey, exp);
  if (kv) {
    try {
      await kv.put(`replay:${replayKey}`, String(exp), {
        expirationTtl: Math.max(60, ttlSeconds),
      });
    } catch {
      // Ignore KV write errors
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export async function checkSlidingRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number,
  kv?: KVStoreLike
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const cutoff = now - windowMs;

  let timestamps = memoryWindowMap.get(key);
  if (!timestamps && kv) {
    try {
      const raw = await kv.get(`rl:${key}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) timestamps = parsed.filter((n) => typeof n === 'number');
      }
    } catch {
      // Ignore
    }
  }
  timestamps = (timestamps ?? []).filter((t) => t > cutoff);

  if (timestamps.length >= maxRequests) {
    const oldest = timestamps[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    memoryWindowMap.set(key, timestamps);
    return {
      allowed: false,
      retryAfterSeconds,
      remaining: 0,
    };
  }

  timestamps.push(now);
  memoryWindowMap.set(key, timestamps);

  // Prune large map periodically
  if (memoryWindowMap.size > 4000) {
    for (const [k, arr] of memoryWindowMap.entries()) {
      const fresh = arr.filter((t) => t > cutoff);
      if (fresh.length === 0) memoryWindowMap.delete(k);
    }
  }

  if (kv) {
    try {
      await kv.put(`rl:${key}`, JSON.stringify(timestamps), {
        expirationTtl: Math.max(60, windowSeconds + 30),
      });
    } catch {
      // Ignore
    }
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, maxRequests - timestamps.length),
  };
}

export async function incrementDailyCounter(
  key: string,
  maxDaily: number,
  kv?: KVStoreLike
): Promise<{ allowed: boolean; count: number; usageRatio: number }> {
  const dayKey = new Date().toISOString().slice(0, 10);
  const fullKey = `daily:${dayKey}:${key}`;
  const now = Date.now();
  const ttlSeconds = 26 * 3600;

  let current = memoryCounterMap.get(fullKey);
  if ((!current || now > current.expiresAt) && kv) {
    try {
      const raw = await kv.get(fullKey);
      if (raw) {
        const val = Number(raw);
        if (!Number.isNaN(val)) {
          current = { value: val, expiresAt: now + ttlSeconds * 1000 };
        }
      }
    } catch {
      // Ignore
    }
  }

  const prevCount = current && now <= current.expiresAt ? current.value : 0;
  if (prevCount >= maxDaily) {
    return {
      allowed: false,
      count: prevCount,
      usageRatio: 1,
    };
  }

  const nextCount = prevCount + 1;
  memoryCounterMap.set(fullKey, { value: nextCount, expiresAt: now + ttlSeconds * 1000 });

  if (kv) {
    try {
      await kv.put(fullKey, String(nextCount), { expirationTtl: ttlSeconds });
    } catch {
      // Ignore
    }
  }

  return {
    allowed: true,
    count: nextCount,
    usageRatio: maxDaily > 0 ? nextCount / maxDaily : 0,
  };
}

export async function getSessionUnverifiedTurns(
  sessionId: string,
  kv?: KVStoreLike
): Promise<number> {
  const fullKey = `sess_turns:${sessionId}`;
  const now = Date.now();
  let mem = memoryCounterMap.get(fullKey);
  if ((!mem || now > mem.expiresAt) && kv) {
    try {
      const raw = await kv.get(fullKey);
      if (raw) {
        const val = Number(raw);
        if (!Number.isNaN(val)) {
          mem = { value: val, expiresAt: now + 24 * 3600 * 1000 };
          memoryCounterMap.set(fullKey, mem);
        }
      }
    } catch {
      // Ignore
    }
  }
  return mem && now <= mem.expiresAt ? mem.value : 0;
}

export async function setSessionUnverifiedTurns(
  sessionId: string,
  turns: number,
  kv?: KVStoreLike
): Promise<void> {
  const fullKey = `sess_turns:${sessionId}`;
  const ttlSeconds = 24 * 3600;
  memoryCounterMap.set(fullKey, { value: turns, expiresAt: Date.now() + ttlSeconds * 1000 });
  if (kv) {
    try {
      await kv.put(fullKey, String(turns), { expirationTtl: ttlSeconds });
    } catch {
      // Ignore
    }
  }
}

export async function issueHumanChallenge(params: {
  secret: string;
  sessionId: string;
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
}): Promise<ChatChallengeResponse> {
  const { secret, sessionId, turnstileSiteKey, turnstileSecretKey } = params;
  const nonceBytes = new Uint8Array(12);
  crypto.getRandomValues(nonceBytes);
  const nonce = toBase64Url(nonceBytes);

  const a = 2 + (nonceBytes[0] % 8);
  const b = 1 + (nonceBytes[1] % 9);
  const answer = String(a + b);
  const exp = Date.now() + 5 * 60 * 1000; // <= 5 minutes

  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ n: nonce, s: sessionId, a: answer, exp }))
  );
  const sig = await signHmac(payload, secret);
  const challengeToken = `${payload}.${sig}`;

  const useTurnstile = Boolean(
    turnstileSiteKey && turnstileSiteKey.trim() && turnstileSecretKey && turnstileSecretKey.trim()
  );

  return {
    mode: useTurnstile ? 'turnstile' : 'hmac',
    ...(useTurnstile ? { siteKey: turnstileSiteKey!.trim() } : {}),
    challengeToken,
    question: `للتأكيد أنك لست روبوت: ما ناتج ${a} + ${b} ؟`,
    expiresAt: new Date(exp).toISOString(),
  };
}

export async function verifyHumanChallenge(params: {
  secret: string;
  sessionId: string;
  verification?: { mode?: string; token?: string; answer?: string } | null;
  turnstileSecretKey?: string;
  remoteIp?: string;
  kv?: KVStoreLike;
}): Promise<{ ok: boolean; error?: string }> {
  const { secret, sessionId, verification, turnstileSecretKey, remoteIp, kv } = params;
  const token = verification?.token?.trim() || '';

  if (!token || isForbiddenBypassToken(token)) {
    return {
      ok: false,
      error: 'رمز التحقق غير صالح أو مرفوض. برجاء إكمال التحقق البشري الفعلي.',
    };
  }

  if (verification?.mode === 'turnstile') {
    if (!turnstileSecretKey || !turnstileSecretKey.trim()) {
      return {
        ok: false,
        error: 'خدمة Turnstile غير مفعلة على الخادم.',
      };
    }

    const tokenHash = await sha256Hex(`ts:${token}`);
    if (await isReplayTokenUsed(tokenHash, kv)) {
      return {
        ok: false,
        error: 'تم استخدام رمز التحقق من قبل. برجاء تحديث التحقق.',
      };
    }

    try {
      const formBody = new URLSearchParams({
        secret: turnstileSecretKey.trim(),
        response: token,
      });
      if (remoteIp) formBody.set('remoteip', remoteIp);

      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
      });
      const data = (await res.json()) as { success?: boolean };
      if (!res.ok || !data.success) {
        return {
          ok: false,
          error: 'فشل التحقق من Turnstile. برجاء المحاولة مرة أخرى.',
        };
      }
      await markReplayTokenUsed(tokenHash, 600, kv);
      return { ok: true };
    } catch {
      return {
        ok: false,
        error: 'تعذر الاتصال بخدمة التحقق من Turnstile.',
      };
    }
  }

  // HMAC Math/Logic Challenge verification
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, error: 'صيغة رمز التحدي غير صالحة.' };
  }

  const [payloadB64, sigB64] = parts;
  const expectedSig = await signHmac(payloadB64, secret);
  if (!constantTimeEqual(sigB64, expectedSig)) {
    return { ok: false, error: 'توقيع رمز التحقق غير صالح.' };
  }

  const rawBytes = fromBase64Url(payloadB64);
  if (!rawBytes) {
    return { ok: false, error: 'بيانات رمز التحقق تالفة.' };
  }

  let parsed: { n?: string; s?: string; a?: string; exp?: number };
  try {
    parsed = JSON.parse(new TextDecoder().decode(rawBytes));
  } catch {
    return { ok: false, error: 'بيانات رمز التحقق غير صالحة.' };
  }

  if (!parsed.n || !parsed.s || !parsed.a || typeof parsed.exp !== 'number') {
    return { ok: false, error: 'بيانات رمز التحقق ناقصة.' };
  }

  if (Date.now() > parsed.exp) {
    return { ok: false, error: 'انتهت صلاحية التحدي. برجاء طلب تحدٍ جديد.' };
  }

  if (parsed.s !== sessionId) {
    return { ok: false, error: 'رمز التحدي لا يطابق هذه الجلسة.' };
  }

  const replayKey = `hmac:${parsed.n}`;
  if (await isReplayTokenUsed(replayKey, kv)) {
    return { ok: false, error: 'تم استخدام هذا التحدي من قبل. برجاء طلب تحدٍ جديد.' };
  }

  const providedAnswer = normalizeNumericAnswer(verification?.answer || '');
  if (!providedAnswer || providedAnswer !== parsed.a) {
    return { ok: false, error: 'إجابة التحقق غير صحيحة. حاول مرة أخرى.' };
  }

  // Single-use: burn nonce immediately on success
  await markReplayTokenUsed(replayKey, 600, kv);
  return { ok: true };
}

export async function signOrderToken(
  secret: string,
  restaurantId: string,
  orderNumber: string
): Promise<string> {
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const payload = toBase64Url(
    encoder.encode(
      JSON.stringify({
        r: restaurantId,
        o: orderNumber.trim().replace(/^#/, ''),
        exp,
      })
    )
  );
  const sig = await signHmac(`ord:${payload}`, secret);
  return `${payload}.${sig}`;
}

export async function verifyOrderToken(
  secret: string,
  token: string,
  restaurantId: string,
  orderNumber: string
): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  const expectedSig = await signHmac(`ord:${payloadB64}`, secret);
  if (!constantTimeEqual(sigB64, expectedSig)) return false;

  const rawBytes = fromBase64Url(payloadB64);
  if (!rawBytes) return false;

  try {
    const parsed = JSON.parse(new TextDecoder().decode(rawBytes)) as {
      r?: string;
      o?: string;
      exp?: number;
    };
    if (!parsed.r || !parsed.o || typeof parsed.exp !== 'number') return false;
    if (Date.now() > parsed.exp) return false;
    const cleanNum = orderNumber.trim().replace(/^#/, '');
    return parsed.r === restaurantId && parsed.o === cleanNum;
  } catch {
    return false;
  }
}
