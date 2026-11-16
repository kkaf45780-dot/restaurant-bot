import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import type { EmployeeRole } from '../src/types/restaurant.ts';

const VALID_ROLES: EmployeeRole[] = ['owner', 'manager', 'cashier', 'kitchen'];

export const COMPROMISED_DEFAULT_PASSWORDS = new Set([
  'Admin@1234',
  'admin@1234',
  'admin123',
  'password',
  '12345678',
]);

export interface AdminJwtPayload {
  sub: string;
  email: string;
  role: EmployeeRole;
  mustChangePassword: boolean;
  iat: number;
  exp: number;
  jti: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signAdminJwt(params: {
  secret: string;
  email: string;
  role: EmployeeRole;
  mustChangePassword: boolean;
  ttlSeconds?: number;
}): Promise<string> {
  const { secret, email, role, mustChangePassword, ttlSeconds = 60 * 60 * 12 } = params;
  if (!secret || secret.length < 16) {
    throw new Error('ADMIN_SESSION_SECRET must be configured with at least 16 characters.');
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const header = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  );
  const payloadObj: AdminJwtPayload = {
    sub: email.toLowerCase(),
    email: email.toLowerCase(),
    role,
    mustChangePassword,
    iat: nowSec,
    exp: nowSec + ttlSeconds,
    jti: crypto.randomUUID(),
  };
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(payloadObj)));
  const signingInput = `${header}.${payload}`;
  const key = await importHmacKey(secret);
  const sigBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(sigBuf))}`;
}

export async function verifyAdminJwt(
  secret: string,
  token: string
): Promise<AdminJwtPayload | null> {
  if (!secret || !token || token.startsWith('local.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;

  try {
    const header = JSON.parse(
      new TextDecoder().decode(fromBase64Url(headerB64))
    ) as { alg?: string; typ?: string };
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return null;
    }

    const key = await importHmacKey(secret);
    const sigBytes = fromBase64Url(sigB64);
    const validSig = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
    if (!validSig) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payloadB64))
    ) as Partial<AdminJwtPayload>;

    const nowSec = Math.floor(Date.now() / 1000);
    if (
      typeof payload.email !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= nowSec
    ) {
      return null;
    }

    const role: EmployeeRole =
      payload.role && VALID_ROLES.includes(payload.role) ? payload.role : 'cashier';

    return {
      sub: String(payload.sub || payload.email),
      email: payload.email.toLowerCase(),
      role,
      mustChangePassword: Boolean(payload.mustChangePassword),
      iat: Number(payload.iat || 0),
      exp: payload.exp,
      jti: String(payload.jti || ''),
    };
  } catch {
    return null;
  }
}

export async function hashPasswordBcrypt(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPasswordAgainstHash(
  candidate: string,
  storedHash: string
): Promise<boolean> {
  if (!candidate || !storedHash) return false;
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
    return bcrypt.compare(candidate, storedHash);
  }
  if (storedHash.startsWith('pbkdf2$')) {
    const [, salt, expectedHex] = storedHash.split('$');
    if (!salt || !expectedHex) return false;
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(candidate),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const derived = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: enc.encode(salt),
        iterations: 10000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );
    const computedHex = Array.from(new Uint8Array(derived), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('');
    return constantTimeEqual(computedHex, expectedHex);
  }
  return false;
}

export function isStrongAdminPassword(password: string): boolean {
  if (COMPROMISED_DEFAULT_PASSWORDS.has(password)) return false;
  return (
    password.length >= 10 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password)
  );
}

export interface AuthEnvLike {
  ADMIN_EMAIL?: string;
  ADMIN_INITIAL_PASSWORD?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_SESSION_SECRET?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export function getEffectiveSessionSecret(env: AuthEnvLike): string | null {
  const s = env.ADMIN_SESSION_SECRET?.trim();
  if (s && s.length >= 16) return s;
  return null;
}

export async function authenticateBearerRequest(params: {
  requestHeaders: Headers | Record<string, string | string[] | undefined>;
  env: AuthEnvLike;
  resolveRole: (email: string) => Promise<{ role: EmployeeRole; mustChangePassword: boolean } | null>;
  allowPendingPasswordChange?: boolean;
}): Promise<
  | { ok: true; email: string; role: EmployeeRole; mustChangePassword: boolean }
  | { ok: false; response: Response }
> {
  const { requestHeaders, env, resolveRole, allowPendingPasswordChange = false } = params;
  const rawAuth =
    requestHeaders instanceof Headers
      ? requestHeaders.get('authorization') || ''
      : String(requestHeaders.authorization || requestHeaders.Authorization || '');

  const token = rawAuth.startsWith('Bearer ') ? rawAuth.slice(7).trim() : '';
  if (!token) {
    return {
      ok: false,
      response: Response.json(
        { error: 'غير مصرح لك بالوصول. يُرجى تسجيل الدخول كمدير أولاً.' },
        { status: 401 }
      ),
    };
  }

  // Reject legacy unsigned/custom prefix tokens immediately
  if (token.startsWith('local.')) {
    return {
      ok: false,
      response: Response.json(
        { error: 'انتهت صلاحية الجلسة، يُرجى تسجيل الدخول مجدداً.' },
        { status: 401 }
      ),
    };
  }

  const secret = getEffectiveSessionSecret(env);
  if (secret) {
    const jwtPayload = await verifyAdminJwt(secret, token);
    if (jwtPayload) {
      if (jwtPayload.mustChangePassword && !allowPendingPasswordChange) {
        return {
          ok: false,
          response: Response.json(
            {
              error: 'يجب تغيير كلمة المرور الأولية قبل استخدام لوحة التحكم.',
              mustChangePassword: true,
            },
            { status: 403 }
          ),
        };
      }
      return {
        ok: true,
        email: jwtPayload.email,
        role: jwtPayload.role,
        mustChangePassword: jwtPayload.mustChangePassword,
      };
    }
  }

  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      const sb = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await sb.auth.getUser(token);
      if (!error && data.user?.email) {
        const resolved = await resolveRole(data.user.email);
        if (!resolved) {
          return {
            ok: false,
            response: Response.json(
              { error: 'الحساب غير مصرح له بإدارة هذا المطعم.' },
              { status: 403 }
            ),
          };
        }
        return {
          ok: true,
          email: data.user.email.toLowerCase(),
          role: resolved.role,
          mustChangePassword: resolved.mustChangePassword,
        };
      }
    } catch {
      // Fall through to 401
    }
  }

  return {
    ok: false,
    response: Response.json(
      { error: 'انتهت جلسة المدير أو بيانات الدخول غير صالحة.' },
      { status: 401 }
    ),
  };
}
