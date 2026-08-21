import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Routers keep scroll position; native apps don't. This matches the app. */
export default function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [pathname]);
  return null;
}
