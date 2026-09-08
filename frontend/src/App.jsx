import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import WakingBanner from './components/WakingBanner.jsx';
import Navbar from './components/Navbar.jsx';
import TabBar from './components/TabBar.jsx';
import Footer from './components/Footer.jsx';
import ScrollToTop from './components/ScrollToTop.jsx';
import AppShell from './components/AppShell.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

// Eager: the two screens a first-time visitor actually lands on. Everything
// else is split out, so the initial download is the landing page rather than
// the whole product — the owner dashboard, the admin console and Leaflet
// were all being shipped to someone who only wanted to look at a turf.
import Home from './pages/Home.jsx';
import Venues from './pages/Venues.jsx';

const VenueDetail    = lazy(() => import('./pages/VenueDetail.jsx'));
const BookSlot       = lazy(() => import('./pages/BookSlot.jsx'));
const BookingDetail  = lazy(() => import('./pages/BookingDetail.jsx'));
const MyBookings     = lazy(() => import('./pages/MyBookings.jsx'));
const Wallet         = lazy(() => import('./pages/Wallet.jsx'));
const MapView        = lazy(() => import('./pages/MapView.jsx'));
const TeamUp         = lazy(() => import('./pages/TeamUp.jsx'));
const GameDetail     = lazy(() => import('./pages/GameDetail.jsx'));
const Teams          = lazy(() => import('./pages/Teams.jsx'));
const Loyalty        = lazy(() => import('./pages/Loyalty.jsx'));
const Login          = lazy(() => import('./pages/Login.jsx'));
const Register       = lazy(() => import('./pages/Register.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword  = lazy(() => import('./pages/ResetPassword.jsx'));
const Profile        = lazy(() => import('./pages/Profile.jsx'));
const Favorites      = lazy(() => import('./pages/Favorites.jsx'));
const OwnerDashboard = lazy(() => import('./pages/OwnerDashboard.jsx'));
const OwnerRequests  = lazy(() => import('./pages/OwnerRequests.jsx'));
const OwnerCalendar  = lazy(() => import('./pages/OwnerCalendar.jsx'));
const OwnerPromos    = lazy(() => import('./pages/OwnerPromos.jsx'));
const OwnerCustomers = lazy(() => import('./pages/OwnerCustomers.jsx'));
const OwnerPayouts   = lazy(() => import('./pages/OwnerPayouts.jsx'));
const OwnerVenueNew  = lazy(() => import('./pages/OwnerVenueNew.jsx'));
const Admin          = lazy(() => import('./pages/Admin.jsx'));
const Notifications  = lazy(() => import('./pages/Notifications.jsx'));
const Playgrounds     = lazy(() => import('./pages/Playgrounds.jsx'));
const PlaygroundDetail= lazy(() => import('./pages/PlaygroundDetail.jsx'));
const PlaygroundNew   = lazy(() => import('./pages/PlaygroundNew.jsx'));
const PlaygroundsMine = lazy(() => import('./pages/PlaygroundsMine.jsx'));
const NotFound       = lazy(() => import('./pages/NotFound.jsx'));
// The other end of the signup link — this is where the account is created.
const VerifyEmail    = lazy(() => import('./pages/VerifyEmail.jsx'));
// Sports events — marathons, tournaments, morning parties.
const Events         = lazy(() => import('./pages/Events.jsx'));
const EventDetail    = lazy(() => import('./pages/EventDetail.jsx'));
const OwnerEvents    = lazy(() => import('./pages/OwnerEvents.jsx'));

/**
 * Terms, Privacy, Refunds and Contact.
 *
 * Not optional decoration: Razorpay's Indian onboarding requires all four to
 * be live on your own domain before it will activate a real merchant account,
 * and a user paying money is entitled to read them first.
 */
const Terms          = lazy(() => import('./pages/Legal.jsx').then((m) => ({ default: m.Terms })));
const Privacy        = lazy(() => import('./pages/Legal.jsx').then((m) => ({ default: m.Privacy })));
const Refunds        = lazy(() => import('./pages/Legal.jsx').then((m) => ({ default: m.Refunds })));
const Contact        = lazy(() => import('./pages/Legal.jsx').then((m) => ({ default: m.Contact })));

const OWNER = ['owner', 'admin'];

/** Shown while a route chunk is in flight. Sized to avoid a layout jump. */
function RouteFallback() {
  return (
    <div className="container section center" style={{ paddingTop: 80, minHeight: '50vh' }}>
      <div className="spinner" style={{ margin: '0 auto' }} />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ScrollToTop />
          <AppShell />
          <WakingBanner />
          <div className="app-shell">
            {/* First tab stop on every page. Without it a keyboard user crosses
                the whole nav — measured at eight stops — before reaching the
                content, on every single navigation. */}
            <a href="#main" className="skip-link">Skip to content</a>
            <Navbar />
            <main id="main" tabIndex={-1} className="app-main">
              {/* The boundary sits OUTSIDE Suspense so a chunk that fails to
                  load — a stale index after a deploy, a dropped connection —
                  renders the error card instead of hanging on the spinner. */}
              <ErrorBoundary>
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    <Route path="/" element={<Home />} />

                    {/* Discovery */}
                    <Route path="/venues" element={<Venues />} />
                    <Route path="/venues/:idOrSlug" element={<VenueDetail />} />
                    <Route path="/venues/:idOrSlug/book" element={<BookSlot />} />
                    <Route path="/map" element={<MapView />} />
                    {/* Free public grounds — browsing is open, adding is not. */}
                    <Route path="/playgrounds" element={<Playgrounds />} />
                    <Route path="/playgrounds/new" element={<ProtectedRoute><PlaygroundNew /></ProtectedRoute>} />
                    <Route path="/playgrounds/mine" element={<ProtectedRoute><PlaygroundsMine /></ProtectedRoute>} />
                    <Route path="/playgrounds/:idOrSlug" element={<PlaygroundDetail />} />
                    <Route path="/teamup" element={<TeamUp />} />
                    <Route path="/teamup/:id" element={<GameDetail />} />

                    {/* Auth */}
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />

                    {/* Player area */}
                    <Route path="/profile"   element={<ProtectedRoute><Profile /></ProtectedRoute>} />
                    <Route path="/favorites" element={<ProtectedRoute><Favorites /></ProtectedRoute>} />
                    <Route path="/bookings"  element={<ProtectedRoute><MyBookings /></ProtectedRoute>} />
                    <Route path="/bookings/:groupRef" element={<ProtectedRoute><BookingDetail /></ProtectedRoute>} />
                    <Route path="/wallet"    element={<ProtectedRoute><Wallet /></ProtectedRoute>} />
                    <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
                    <Route path="/loyalty"   element={<ProtectedRoute><Loyalty /></ProtectedRoute>} />
                    <Route path="/teams"     element={<ProtectedRoute><Teams /></ProtectedRoute>} />

                    {/* Owner area */}
                    <Route path="/owner" element={<ProtectedRoute roles={OWNER}><OwnerDashboard /></ProtectedRoute>} />
                    <Route path="/owner/requests" element={<ProtectedRoute roles={OWNER}><OwnerRequests /></ProtectedRoute>} />
                    <Route path="/owner/calendar" element={<ProtectedRoute roles={OWNER}><OwnerCalendar /></ProtectedRoute>} />
                    <Route path="/owner/promos" element={<ProtectedRoute roles={OWNER}><OwnerPromos /></ProtectedRoute>} />
                    <Route path="/owner/customers" element={<ProtectedRoute roles={OWNER}><OwnerCustomers /></ProtectedRoute>} />
                    <Route path="/owner/payouts" element={<ProtectedRoute roles={OWNER}><OwnerPayouts /></ProtectedRoute>} />
                    <Route path="/owner/venues/new" element={<ProtectedRoute roles={OWNER}><OwnerVenueNew /></ProtectedRoute>} />
                    {/* Same component as /new — it loads the venue and PATCHes it. */}
                    <Route path="/owner/venues/:id/edit" element={<ProtectedRoute roles={OWNER}><OwnerVenueNew /></ProtectedRoute>} />
                    <Route path="/owner/events" element={<ProtectedRoute roles={OWNER}><OwnerEvents /></ProtectedRoute>} />

                    {/* Admin — the role is only assignable directly in the database */}
                    <Route path="/admin" element={<ProtectedRoute roles={['admin']}><Admin /></ProtectedRoute>} />

                    {/* Events are browsable without an account, like venues. */}
                    <Route path="/events" element={<Events />} />
                    <Route path="/events/:idOrSlug" element={<EventDetail />} />

                    <Route path="/verify-email" element={<VerifyEmail />} />

                    {/* Public policy pages — no session required. */}
                    <Route path="/terms"    element={<Terms />} />
                    <Route path="/privacy"  element={<Privacy />} />
                    <Route path="/refunds"  element={<Refunds />} />
                    <Route path="/contact"  element={<Contact />} />

                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </main>
            <Footer />
            <TabBar />
          </div>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
