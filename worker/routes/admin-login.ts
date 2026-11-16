import { ROLE_PERMISSIONS } from '../../src/lib/permissions.ts';
import type { Employee, EmployeeRole } from '../../src/types/restaurant.ts';
import {
  COMPROMISED_DEFAULT_PASSWORDS,
  getEffectiveSessionSecret,
  signAdminJwt,
  verifyPasswordAgainstHash,
  type AuthEnvLike,
} from '../auth.ts';
import {
  checkLoginRateAndLockout,
  clearLoginFailures,
  rateLimitResponse,
  recordLoginFailure,
  type KVNamespaceLike,
} from '../middleware/rate-limit.ts';

export interface AdminLoginDependencies {
  kv?: KVNamespaceLike;
  env: AuthEnvLike;
  email: string;
  password: string;
  ip: string;
  lookupEmployee: (email: string) => Promise<Employee | null>;
  verifyOwnerPassword: (password: string) => Promise<boolean>;
  isOwnerPasswordOverridden: () => Promise<boolean>;
  onAuditLog?: (actorEmail: string, details: string) => Promise<void>;
}

const GENERIC_AUTH_ERROR = 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';

export async function handleAdminLogin(deps: AdminLoginDependencies): Promise<Response> {
  const {
    kv,
    env,
    email,
    password,
    ip,
    lookupEmployee,
    verifyOwnerPassword,
    isOwnerPasswordOverridden,
    onAuditLog,
  } = deps;

  const cleanEmail = email.trim().toLowerCase();
  const cleanPass = String(password || '');

  const rate = await checkLoginRateAndLockout({
    kv,
    ip,
    email: cleanEmail || undefined,
  });

  if (!rate.allowed) {
    return rateLimitResponse(
      rate.retryAfterSeconds,
      'تم تجاوز الحد المسموح لمحاولات تسجيل الدخول. يُرجى المحاولة بعد 15 دقيقة.'
    );
  }

  if (!cleanEmail || !cleanPass) {
    await recordLoginFailure({ kv, ip, email: cleanEmail || undefined });
    return Response.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
  }

  // Always reject compromised/default passwords immediately
  if (COMPROMISED_DEFAULT_PASSWORDS.has(cleanPass)) {
    await recordLoginFailure({ kv, ip, email: cleanEmail });
    return Response.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
  }

  const secret = getEffectiveSessionSecret(env);
  if (!secret) {
    console.error('[Security] ADMIN_SESSION_SECRET missing or shorter than 16 chars.');
    return Response.json(
      { error: 'خدمة تسجيل الدخول غير مهيأة أمنياً. تواصل مع مسؤول النظام.' },
      { status: 503 }
    );
  }

  const configuredOwnerEmail = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (configuredOwnerEmail && cleanEmail === configuredOwnerEmail) {
    const ownerValid = await verifyOwnerPassword(cleanPass);
    if (ownerValid) {
      const overridden = await isOwnerPasswordOverridden();
      const mustChangePassword = !overridden;
      const role: EmployeeRole = 'owner';
      const token = await signAdminJwt({
        secret,
        email: configuredOwnerEmail,
        role,
        mustChangePassword,
      });
      await clearLoginFailures({ kv, ip, email: configuredOwnerEmail });
      if (onAuditLog) {
        await onAuditLog(configuredOwnerEmail, 'تسجيل دخول مدير النظام').catch(() => {});
      }
      return Response.json({
        token,
        email: configuredOwnerEmail,
        role,
        mustChangePassword,
        permissions: ROLE_PERMISSIONS[role],
      });
    }
  }

  const employee = await lookupEmployee(cleanEmail);
  if (employee && employee.isActive) {
    let employeeValid = false;
    if (employee.passwordHash) {
      employeeValid = await verifyPasswordAgainstHash(cleanPass, employee.passwordHash);
    } else if (configuredOwnerEmail && cleanEmail !== configuredOwnerEmail) {
      // Employee without individual passwordHash cannot log in with shared defaults
      employeeValid = false;
    }

    if (employeeValid) {
      const mustChangePassword = Boolean(employee.mustChangePassword);
      const token = await signAdminJwt({
        secret,
        email: employee.email.toLowerCase(),
        role: employee.role,
        mustChangePassword,
      });
      await clearLoginFailures({ kv, ip, email: employee.email });
      if (onAuditLog) {
        await onAuditLog(employee.email, `تسجيل دخول (${employee.role})`).catch(() => {});
      }
      return Response.json({
        token,
        email: employee.email,
        role: employee.role,
        mustChangePassword,
        permissions: ROLE_PERMISSIONS[employee.role],
      });
    }
  }

  const failStatus = await recordLoginFailure({ kv, ip, email: cleanEmail });
  if (failStatus.lockedNow) {
    return rateLimitResponse(
      failStatus.retryAfterSeconds,
      'تم حظر محاولات الدخول مؤقتاً بسبب تكرار الخطأ. حاول بعد 15 دقيقة.'
    );
  }

  return Response.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
}
