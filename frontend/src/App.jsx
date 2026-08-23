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

import Home from './pages/Home.jsx';
import Venues from './pages/Venues.jsx';
import VenueDetail from './pages/VenueDetail.jsx';
import BookSlot from './pages/BookSlot.jsx';
import BookingDetail from './pages/BookingDetail.jsx';
import MyBookings from './pages/MyBookings.jsx';
import Wallet from './pages/Wallet.jsx';
import MapView from './pages/MapView.jsx';
import TeamUp from './pages/TeamUp.jsx';
import GameDetail from './pages/GameDetail.jsx';
import Teams from './pages/Teams.jsx';
import Loyalty from './pages/Loyalty.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Profile from './pages/Profile.jsx';
import Favorites from './pages/Favorites.jsx';
import OwnerDashboard from './pages/OwnerDashboard.jsx';
import OwnerRequests from './pages/OwnerRequests.jsx';
import OwnerCalendar from './pages/OwnerCalendar.jsx';
import OwnerPromos from './pages/OwnerPromos.jsx';
import OwnerCustomers from './pages/OwnerCustomers.jsx';
import OwnerPayouts from './pages/OwnerPayouts.jsx';
import Admin from './pages/Admin.jsx';
import Notifications from './pages/Notifications.jsx';
import NotFound from './pages/NotFound.jsx';

const OWNER = ['owner', 'admin'];

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ScrollToTop />
          <AppShell />
          <WakingBanner />
          <div className="app-shell">
            <Navbar />
            <main className="app-main">
              <ErrorBoundary>
                <Routes>
                  <Route path="/" element={<Home />} />

                  {/* Discovery */}
                  <Route path="/venues" element={<Venues />} />
                  <Route path="/venues/:idOrSlug" element={<VenueDetail />} />
                  <Route path="/venues/:idOrSlug/book" element={<BookSlot />} />
                  <Route path="/map" element={<MapView />} />
                  <Route path="/teamup" element={<TeamUp />} />
                  <Route path="/teamup/:id" element={<GameDetail />} />

                  {/* Auth */}
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />

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
                  <Route path="/owner/venues/new" element={<ProtectedRoute roles={OWNER}><OwnerDashboard /></ProtectedRoute>} />

                  {/* Admin — the role is only assignable directly in the database */}
                  <Route path="/admin" element={<ProtectedRoute roles={['admin']}><Admin /></ProtectedRoute>} />

                  <Route path="*" element={<NotFound />} />
                </Routes>
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
