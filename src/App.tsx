/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { CustomerRoute } from './components/customer/CustomerNavbar.tsx';
import { AdminPage } from './pages/AdminPage.tsx';
import { CustomerPage } from './pages/CustomerPage.tsx';

function parseLocation(): {
  isAdmin: boolean;
  customerRoute: CustomerRoute;
  trackOrder?: string;
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

  const navigateCustomerRoute = (route: CustomerRoute, trackOrder?: string) => {
    const base = ROUTE_TO_PATH[route];
    const nextUrl =
      route === 'track' && trackOrder
        ? `${base}?order=${encodeURIComponent(trackOrder)}`
        : base;
    if (window.location.pathname + window.location.search !== nextUrl) {
      window.history.pushState({}, '', nextUrl);
    }
    setLoc({ isAdmin: false, customerRoute: route, trackOrder });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateAdmin = () => {
    if (window.location.pathname !== '/admin') {
      window.history.pushState({}, '', '/admin');
    }
    setLoc({ isAdmin: true, customerRoute: 'home' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loc.isAdmin) {
    return <AdminPage onNavigateCustomer={() => navigateCustomerRoute('home')} />;
  }

  return (
    <CustomerPage
      route={loc.customerRoute}
      initialTrackOrderNumber={loc.trackOrder}
      onNavigateRoute={navigateCustomerRoute}
      onNavigateAdmin={navigateAdmin}
    />
  );
}
