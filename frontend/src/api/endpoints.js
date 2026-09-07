import api from './client.js';

export const authApi = {
  register: (payload) => api.post('/auth/register', payload, { auth: false }),
  login:    (payload) => api.post('/auth/login', payload, { auth: false }),
  /**
   * Registration no longer returns a session — it emails a link, and the
   * account is created when that link is opened.
   */
  verifyEmail: (token) => api.post('/auth/verify-email', { token }, { auth: false }),
  resendVerification: (email) => api.post('/auth/resend-verification', { email }, { auth: false }),
  me:       () => api.get('/auth/me'),
  updateMe: (payload) => api.patch('/auth/me', payload),
  changePassword: (payload) => api.post('/auth/change-password', payload),
  /**
   * Ends the session on the SERVER too.
   *
   * `auth: false` and the token in the body, because logging out is exactly
   * the moment the access token is most likely to have expired — and a logout
   * that 401s and gives up leaves the refresh token alive for another month.
   * `retry: false` so a 401 cannot bounce this through the refresh path it is
   * trying to shut down.
   */
  logout: (refreshToken) => api.post('/auth/logout', { refreshToken }, { auth: false, retry: false }),
  logoutEverywhere: () => api.post('/auth/logout-all'),
  // Both unauthenticated: the whole point is that the user cannot log in.
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }, { auth: false }),
  resetPassword: (payload) => api.post('/auth/reset-password', payload, { auth: false }),
};

/**
 * Sports events — marathons, tournaments, morning parties. Separate from
 * venues and bookings because an event is a gathering with a capacity, not a
 * court for an hour.
 */
export const eventApi = {
  list:       (filters) => api.get('/events', filters),
  get:        (idOrSlug) => api.get(`/events/${idOrSlug}`),
  cities:     () => api.get('/events/meta/cities'),
  register:   (id, payload) => api.post(`/events/${id}/register`, payload || {}),
  unregister: (id) => api.del(`/events/${id}/register`),
  // Organiser
  create:     (payload) => api.post('/events', payload),
  update:     (id, payload) => api.patch(`/events/${id}`, payload),
  cancel:     (id, reason) => api.del(`/events/${id}`, { body: { reason } }),
  attendees:  (id) => api.get(`/events/${id}/attendees`),
  // Admin
  queue:      () => api.get('/events/admin/queue'),
  moderate:   (id, payload) => api.patch(`/events/${id}/moderate`, payload),
};

/**
 * Game parlours — snooker halls, arcades, bowling alleys.
 *
 * A LOCATOR. There is deliberately no `book` here: a parlour is a directory
 * entry, not inventory. The call to action is a phone number and directions.
 */
export const parlorApi = {
  list:     (filters) => api.get('/parlors', filters),
  map:      (filters) => api.get('/parlors/map', filters),
  get:      (idOrSlug) => api.get(`/parlors/${idOrSlug}`),
  cities:   () => api.get('/parlors/meta/cities'),
  mine:     () => api.get('/parlors/mine/list'),
  create:   (payload) => api.post('/parlors', payload),
  update:   (id, payload) => api.patch(`/parlors/${id}`, payload),
  remove:   (id) => api.del(`/parlors/${id}`),
  moderate: (id, payload) => api.patch(`/parlors/${id}/moderate`, payload),
};

export const venueApi = {
  list:      (filters) => api.get('/venues', filters),
  map:       (filters) => api.get('/venues/map', filters),
  get:       (idOrSlug) => api.get(`/venues/${idOrSlug}`),
  cities:    () => api.get('/venues/meta/cities'),
  mine:      () => api.get('/venues/owner/mine'),
  create:    (payload) => api.post('/venues', payload),
  update:    (id, payload) => api.patch(`/venues/${id}`, payload),
  toggleFav: (id) => api.post(`/venues/${id}/favorite`),
};

export const bookingApi = {
  availability: (venueId, params) => api.get(`/venues/${venueId}/availability`, params, { auth: false }),
  quote:        (payload) => api.post('/bookings/quote', payload),
  create:       (payload) => api.post('/bookings', payload),
  mine:         () => api.get('/bookings'),
  get:          (groupRef) => api.get(`/bookings/${groupRef}`),
  cancel:       (groupRef, reason) => api.patch(`/bookings/${groupRef}/cancel`, { reason }),
  decide:       (groupRef, decision) => api.patch(`/bookings/${groupRef}/decision`, { decision }),
  ownerRequests:() => api.get('/bookings/owner/requests'),
  settleCash:   (groupRef) => api.patch(`/bookings/${groupRef}/settle`),
  wallet:       () => api.get('/bookings/wallet'),
  topUp:        (amount) => api.post('/bookings/wallet/topup', { amount }),
  promos:       () => api.get('/bookings/promos'),
};

export const teamupApi = {
  // These routes use optionalAuth: readable signed out, but personalised when
  // signed in. Sending `auth: false` meant no Authorization header ever went
  // out, so the server saw an anonymous viewer — a host could not see the
  // join requests on their own game, and "you have already asked to join"
  // never rendered for anyone.
  list:     (filters) => api.get('/teamup', filters),
  get:      (id) => api.get(`/teamup/${id}`),
  create:   (payload) => api.post('/teamup', payload),
  cancel:   (id) => api.del(`/teamup/${id}`),
  join:     (id, payload) => api.post(`/teamup/${id}/join`, payload),
  withdraw: (id) => api.del(`/teamup/${id}/join`),
  decide:   (id, requestId, decision) => api.patch(`/teamup/${id}/requests/${requestId}`, { decision }),
  settle:   (id) => api.post(`/teamup/${id}/settle`),
};

export const teamApi = {
  mine:     () => api.get('/teams/mine'),
  get:      (id) => api.get(`/teams/${id}`),
  create:   (payload) => api.post('/teams', payload),
  update:   (id, payload) => api.patch(`/teams/${id}`, payload),
  remove:   (id) => api.del(`/teams/${id}`),
  invite:   (id, payload) => api.post(`/teams/${id}/invite`, payload),
  joinByCode: (code) => api.post('/teams/join', { code }),
  removeMember: (id, userId) => api.del(`/teams/${id}/members/${userId}`),
  transferCaptain: (id, userId) => api.patch(`/teams/${id}/captain`, { userId }),
};

export const loyaltyApi = {
  summary: () => api.get('/loyalty'),
  tiers:   () => api.get('/loyalty/tiers', undefined, { auth: false }),
  redeem:  (points) => api.post('/loyalty/redeem', { points }),
};

export const ownerApi = {
  overview:    (params) => api.get('/owner/overview', params),
  peakHours:   (params) => api.get('/owner/peak-hours', params),
  customers:   (params) => api.get('/owner/customers', params),
  payouts:     () => api.get('/owner/payouts'),
  calendar:    (params) => api.get('/owner/calendar', params),
  addBlackout: (payload) => api.post('/owner/blackouts', payload),
  removeBlackout: (venueId, id) => api.del(`/owner/blackouts/${venueId}/${id}`),
  updateSettings: (venueId, payload) => api.patch(`/owner/venues/${venueId}/settings`, payload),
  promos:      () => api.get('/owner/promos'),
  createPromo: (payload) => api.post('/owner/promos', payload),
  updatePromo: (id, payload) => api.patch(`/owner/promos/${id}`, payload),
  deletePromo: (id) => api.del(`/owner/promos/${id}`),
};

export const adminApi = {
  stats:      () => api.get('/admin/stats'),
  venues:     (params) => api.get('/admin/venues', params),
  moderate:   (id, decision, note) => api.patch(`/admin/venues/${id}/moderate`, { decision, note }),
  users:      (params) => api.get('/admin/users', params),
  verifyUser: (id, verified) => api.patch(`/admin/users/${id}/verify`, { verified }),
  setStatus:  (id, isActive) => api.patch(`/admin/users/${id}/status`, { isActive }),
  ledger:     () => api.get('/admin/ledger'),
  runPayouts: () => api.post('/admin/payouts/run'),
  markPaid:   (id, reference) => api.patch(`/admin/payouts/${id}`, { reference }),
};

export const paymentApi = {
  config: () => api.get('/payments/config', undefined, { auth: false }),
  order:  (groupRef) => api.post('/payments/order', { groupRef }),
  verify: (payload) => api.post('/payments/verify', payload),
};

export const notificationApi = {
  list:           (params) => api.get('/notifications', params),
  unreadCount:    () => api.get('/notifications/unread-count'),
  markRead:       (ids) => api.patch('/notifications/read', ids ? { ids } : {}),
  remove:         (id) => api.del(`/notifications/${id}`),
  // Public by definition, and needed before the browser can subscribe.
  vapidKey:       () => api.get('/notifications/vapid-key', undefined, { auth: false }),
  addPushToken:   (token, platform) => api.post('/notifications/push-token', { token, platform }),
  removePushToken:(token) => api.del('/notifications/push-token', { body: { token } }),
};

export const reviewApi = {
  forVenue: (venueId) => api.get(`/reviews/venue/${venueId}`, undefined, { auth: false }),
  mine:     (venueId) => api.get(`/reviews/mine/${venueId}`),
  create:   (payload) => api.post('/reviews', payload),
  reply:    (id, text) => api.post(`/reviews/${id}/reply`, { text }),
  remove:   (id) => api.del(`/reviews/${id}`),
};

export const configApi = {
  get: () => api.get('/config', undefined, { auth: false }),
  health: () => api.get('/health', undefined, { auth: false }),
};

/**
 * One box, four collections. Public — everything it can return is already
 * public, and a search that demands a login is a search nobody uses.
 */
export const searchApi = {
  all: (params) => api.get('/search', params, { auth: false }),
};
