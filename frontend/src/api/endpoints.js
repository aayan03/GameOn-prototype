import api from './client.js';

export const authApi = {
  register: (payload) => api.post('/auth/register', payload, { auth: false }),
  login:    (payload) => api.post('/auth/login', payload, { auth: false }),
  me:       () => api.get('/auth/me'),
  updateMe: (payload) => api.patch('/auth/me', payload),
  changePassword: (payload) => api.post('/auth/change-password', payload),
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
