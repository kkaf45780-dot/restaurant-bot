import type { EmployeeRole } from '../types/restaurant.ts';

export type AdminTabPermission =
  | 'overview'
  | 'orders'
  | 'menu'
  | 'delivery'
  | 'inventory'
  | 'coupons'
  | 'analytics'
  | 'employees'
  | 'settings'
  | 'ai'
  | 'system';

export const ROLE_PERMISSIONS: Record<EmployeeRole, AdminTabPermission[]> = {
  owner: [
    'overview',
    'orders',
    'menu',
    'delivery',
    'inventory',
    'coupons',
    'analytics',
    'employees',
    'settings',
    'ai',
    'system',
  ],
  manager: [
    'overview',
    'orders',
    'menu',
    'delivery',
    'inventory',
    'coupons',
    'analytics',
    'settings',
    'ai',
  ],
  cashier: ['overview', 'orders', 'coupons'],
  kitchen: ['overview', 'orders'],
};

export function hasPermission(role: EmployeeRole, perm: AdminTabPermission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}

export const ROLE_LABELS_AR: Record<EmployeeRole, string> = {
  owner: 'مالك المطعم',
  manager: 'مدير فرع',
  cashier: 'كاشير واستقبال',
  kitchen: 'فريق المطبخ',
};
