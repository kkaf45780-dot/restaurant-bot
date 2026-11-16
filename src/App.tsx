/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, lazy, useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import type { CustomerRoute } from './components/customer/CustomerNavbar.tsx';
import { CustomerPage } from './pages/CustomerPage.tsx';

const AdminPage = lazy(() =>
  import('./pages/AdminPage.tsx').then((m) => ({ default: m.AdminPage }))
);

function AdminLoadingFallback() {
  return (
    <div
      dir="rtl"
      className="min-h-screen bg-[#F7F3E9] dark:bg-[#0B120F] flex items-center justify-center p-6"
    >
      <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-[#176B45]/10 dark:border-[#2A3F35] p-8 text-center max-w-sm w-full space-y-3">
        <div className="w-10 h-10 rounded-xl bg-[#176B45]/10 text-[#176B45] flex items-center justify-center mx-auto font-bold animate-pulse">
          م
        </div>
        <p className="text-sm font-bold text-[#18221D] dark:text-[#ECF3EF]">
          جاري تحميل لوحة التحكم...
        </p>
      </div>
    </div>
  );
}

function parseLocation(): {
  isAdmin: boolean;
  isNotFound: boolean;
  customerRoute: CustomerRoute;
  trackOrderToken?: string;
} {
  const rawPath = window.location.pathname;
  const path = rawPath === '/' ? '/' : rawPath.replace(/\/+$/, '');
  const params = new URLSearchParams(window.location.search);

  if (path === '/admin' || path.startsWith('/admin/')) {
    return { isAdmin: true, isNotFound: false, customerRoute: 'home' };
  }
  if (path === '/' || path === '') {
    return { isAdmin: false, isNotFound: false, customerRoute: 'home' };
  }
  if (path === '/menu') {
    return { isAdmin: false, isNotFound: false, customerRoute: 'menu' };
  }
  if (path === '/chat') {
    return { isAdmin: false, isNotFound: false, customerRoute: 'chat' };
  }
  if (path === '/checkout') {
    return { isAdmin: false, isNotFound: false, customerRoute: 'checkout' };
  }
  if (path === '/track') {
    return {
      isAdmin: false,
      isNotFound: false,
      customerRoute: 'track',
      trackOrderToken: params.get('token') || params.get('orderToken') || undefined,
    };
  }
  if (path === '/orders') {
    return { isAdmin: false, isNotFound: false, customerRoute: 'orders' };
  }
  if (path === '/favorites') {
    return { isAdmin: false, isNotFound: false, customerRoute: 'favorites' };
  }
  if (path === '/about') {
    return { isAdmin: false, isNotFound: false, customerRoute: 'about' };
  }
  if (path === '/privacy') {
    return { isAdmin: false, isNotFound: false, customerRoute: 'privacy' };
  }
  if (path === '/terms') {
    return { isAdmin: false, isNotFound: false, customerRoute: 'terms' };
  }
  return { isAdmin: false, isNotFound: true, customerRoute: 'home' };
}

const ROUTE_TO_PATH: Record<CustomerRoute, string> = {
  home: '/',
  menu: '/menu',
  chat: '/chat',
  checkout: '/checkout',
  track: '/track',
  orders: '/orders',
  favorites: '/favorites',
  about: '/about',
  privacy: '/privacy',
  terms: '/terms',
};

export default function App() {
  const [loc, setLoc] = useState(parseLocation);

  useEffect(() => {
    const onPopState = () => setLoc(parseLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateCustomerRoute = (route: CustomerRoute, trackOrderToken?: string) => {
    const base = ROUTE_TO_PATH[route];
    const nextUrl =
      route === 'track' && trackOrderToken
        ? `${base}?token=${encodeURIComponent(trackOrderToken)}`
        : base;
    if (window.location.pathname + window.location.search !== nextUrl) {
      window.history.pushState({}, '', nextUrl);
    }
    setLoc({ isAdmin: false, isNotFound: false, customerRoute: route, trackOrderToken });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateAdmin = () => {
    if (window.location.pathname !== '/admin') {
      window.history.pushState({}, '', '/admin');
    }
    setLoc({ isAdmin: true, isNotFound: false, customerRoute: 'home' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loc.isNotFound) {
    return (
      <div
        dir="rtl"
        className="min-h-screen bg-[#F7F3E9] dark:bg-[#0B120F] text-[#18221D] dark:text-[#ECF3EF] flex items-center justify-center p-6"
      >
        <main className="max-w-md w-full bg-white dark:bg-[#14201B] border border-[#E5E0D5] dark:border-[#2A3F35] rounded-2xl p-8 text-center shadow-sm space-y-4">
          <h1 className="text-4xl font-extrabold text-[#104B34] dark:text-[#4ADE80]">404</h1>
          <p className="text-lg font-extrabold">الصفحة غير موجودة</p>
          <p className="text-sm text-[#4A5850] dark:text-[#A3B8AE]">
            الرابط الذي طلبته غير متوفر في موقع مشويات الحارة.
          </p>
          <button
            type="button"
            onClick={() => navigateCustomerRoute('home')}
            className="min-h-[44px] px-6 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-sm font-bold cursor-pointer"
          >
            العودة للرئيسية
          </button>
        </main>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {loc.isAdmin ? (
        <Suspense fallback={<AdminLoadingFallback />}>
          <AdminPage onNavigateCustomer={() => navigateCustomerRoute('home')} />
        </Suspense>
      ) : (
        <CustomerPage
          route={loc.customerRoute}
          initialTrackOrderToken={loc.trackOrderToken}
          onNavigateRoute={navigateCustomerRoute}
          onNavigateAdmin={navigateAdmin}
        />
      )}
    </ErrorBoundary>
  );
}
