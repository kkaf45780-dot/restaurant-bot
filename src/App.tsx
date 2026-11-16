/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component, Suspense, lazy, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { UpdatePrompt } from './components/UpdatePrompt.tsx';
import type { CustomerRoute } from './components/customer/CustomerNavbar.tsx';
import { CustomerPage } from './pages/CustomerPage.tsx';

const AdminPage = lazy(() =>
  import('./pages/AdminPage.tsx').then((m) => ({ default: m.AdminPage }))
);

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="min-h-screen bg-[#F7F3E9] dark:bg-[#0B120F] flex items-center justify-center p-6"
        >
          <div className="bg-white dark:bg-[#14201B] rounded-2xl border border-red-200 dark:border-red-800 p-8 text-center max-w-md w-full space-y-4 shadow-sm">
            <h1 className="text-lg font-extrabold text-[#104B34] dark:text-[#ECF3EF]">
              حدث خطأ غير متوقع
            </h1>
            <p className="text-sm text-[#5C6B63] dark:text-[#A3B8AE]">
              نعتذر عن هذا العطل المؤقت. يمكنك إعادة المحاولة أو تحديث الصفحة للعودة إلى التطبيق.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false })}
                className="min-h-[44px] px-5 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-sm font-bold cursor-pointer"
              >
                إعادة المحاولة
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-[44px] px-5 rounded-xl border border-[#176B45]/25 text-[#104B34] dark:text-[#ECF3EF] text-sm font-bold hover:bg-[#F7F3E9] dark:hover:bg-[#192822] cursor-pointer"
              >
                تحديث الصفحة
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  customerRoute: CustomerRoute;
  trackOrder?: string;
  trackToken?: string;
} {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  if (path.startsWith('/admin')) {
    return { isAdmin: true, customerRoute: 'home' };
  }
  if (path.startsWith('/menu')) {
    return { isAdmin: false, customerRoute: 'menu' };
  }
  if (path.startsWith('/chat')) {
    return { isAdmin: false, customerRoute: 'chat' };
  }
  if (path.startsWith('/checkout')) {
    return { isAdmin: false, customerRoute: 'checkout' };
  }
  if (path.startsWith('/track')) {
    return {
      isAdmin: false,
      customerRoute: 'track',
      trackOrder: params.get('order') || undefined,
      trackToken: params.get('token') || undefined,
    };
  }
  if (path.startsWith('/orders')) {
    return { isAdmin: false, customerRoute: 'orders' };
  }
  if (path.startsWith('/favorites')) {
    return { isAdmin: false, customerRoute: 'favorites' };
  }
  if (path.startsWith('/about')) {
    return { isAdmin: false, customerRoute: 'about' };
  }
  if (path.startsWith('/privacy')) {
    return { isAdmin: false, customerRoute: 'privacy' };
  }
  if (path.startsWith('/terms')) {
    return { isAdmin: false, customerRoute: 'terms' };
  }
  return { isAdmin: false, customerRoute: 'home' };
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

  const navigateCustomerRoute = (
    route: CustomerRoute,
    trackOrder?: string,
    trackToken?: string
  ) => {
    const base = ROUTE_TO_PATH[route];
    let nextUrl = base;
    if (route === 'track' && trackOrder) {
      const qs = new URLSearchParams({ order: trackOrder });
      if (trackToken) qs.set('token', trackToken);
      nextUrl = `${base}?${qs.toString()}`;
    }
    if (window.location.pathname + window.location.search !== nextUrl) {
      window.history.pushState({}, '', nextUrl);
    }
    setLoc({ isAdmin: false, customerRoute: route, trackOrder, trackToken });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateAdmin = () => {
    if (window.location.pathname !== '/admin') {
      window.history.pushState({}, '', '/admin');
    }
    setLoc({ isAdmin: true, customerRoute: 'home' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <ErrorBoundary>
      {loc.isAdmin ? (
        <Suspense fallback={<AdminLoadingFallback />}>
          <AdminPage onNavigateCustomer={() => navigateCustomerRoute('home')} />
        </Suspense>
      ) : (
        <CustomerPage
          route={loc.customerRoute}
          initialTrackOrderNumber={loc.trackOrder}
          initialTrackOrderToken={loc.trackToken}
          onNavigateRoute={navigateCustomerRoute}
          onNavigateAdmin={navigateAdmin}
        />
      )}
      <UpdatePrompt />
    </ErrorBoundary>
  );
}
