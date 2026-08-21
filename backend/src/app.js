import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import env, { isProd } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { mongoSanitize, preventParamPollution } from './utils/sanitize.js';
import { globalLimiter, webhookLimiter } from './middleware/rateLimit.js';

const app = express();

// Behind a proxy (Render, Railway, nginx) the client IP is in X-Forwarded-For.
// Without this every request looks like it comes from the load balancer, which
// silently turns per-IP rate limiting into one shared bucket for the world.
// It is opt-in because trusting the header when NOT behind a proxy lets a
// client spoof its own IP and dodge the limiter entirely.
if (env.TRUST_PROXY) app.set('trust proxy', 1);

app.disable('x-powered-by');

/* ── Security headers ─────────────────────────────────────────── */
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      // Venue photos and OpenStreetMap tiles come from other hosts.
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", ...env.CORS_ORIGINS],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],   // clickjacking
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: isProd() ? [] : null,
    },
  },
  hsts: isProd() ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

/* ── CORS ─────────────────────────────────────────────────────── */
app.use(cors({
  origin(origin, cb) {
    // No Origin header: curl, server-to-server, or a native Capacitor WebView.
    if (!origin) return cb(null, true);
    if (env.CORS_ORIGINS.includes(origin)) return cb(null, true);
    // Development allows anything so a phone on the LAN can reach the dev
    // server. Production never does — an allow-all CORS policy on a
    // credentialed API is a cross-site request forgery waiting to happen.
    if (!isProd()) return cb(null, true);
    return cb(new Error(`Blocked by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
}));

/* ── Payment webhook (raw body) ───────────────────────────────── */
// Mounted BEFORE express.json(). The Razorpay signature is an HMAC over the
// exact bytes that were sent; re-serialising parsed JSON changes key order
// and whitespace, and the signature would never match again.
app.post(
  '/api/payments/webhook',
  webhookLimiter,
  express.raw({ type: 'application/json', limit: '128kb' }),
  (req, res, next) => import('./controllers/payment.controller.js')
    .then((m) => m.webhook(req, res, next))
    .catch(next)
);

/* ── Body parsing (bounded) ───────────────────────────────────── */
app.use(express.json({ limit: env.BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: env.BODY_LIMIT }));

/* ── Input safety ─────────────────────────────────────────────── */
app.use(preventParamPollution);
app.use(mongoSanitize);

/* ── Logging & throttling ─────────────────────────────────────── */
if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.LOG_LEVEL, {
    skip: (req, res) => isProd() && res.statusCode < 400,   // only log problems in prod
  }));
}
app.use(globalLimiter);

app.get('/', (req, res) => res.json({
  name: 'GameOn API',
  tagline: 'Find. Book. Play.',
  version: '3.0.0',
  health: '/api/health',
}));

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
