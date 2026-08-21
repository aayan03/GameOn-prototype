import dotenv from 'dotenv';
dotenv.config();

const INSECURE_DEFAULTS = [
  'change_this_to_a_long_random_string',
  'change_this_too_another_random_string',
  'insecure_dev_secret',
  'insecure_dev_refresh',
  'secret', 'jwt_secret', 'changeme',
];

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const env = {
  PORT: num(process.env.PORT, 5000),
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGO_URI: process.env.MONGO_URI || '',

  JWT_SECRET: process.env.JWT_SECRET || 'insecure_dev_secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '2h',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'insecure_dev_refresh',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '30d',

  CORS_ORIGINS: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',').map((o) => o.trim()).filter(Boolean),

  // ── Payments ──────────────────────────────────────────────────
  // With both key vars set the API takes real payments through Razorpay.
  // Leave them empty and it runs the wallet-backed simulation instead.
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  PLATFORM_COMMISSION_PERCENT: num(process.env.PLATFORM_COMMISSION_PERCENT, 10),

  TRUST_PROXY: process.env.TRUST_PROXY === 'true',
  LOG_LEVEL: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'combined' : 'dev'),
  BODY_LIMIT: process.env.BODY_LIMIT || '256kb',
};

export const isProd = () => env.NODE_ENV === 'production';

/**
 * Refuses to start a production server that is misconfigured.
 *
 * Booting with a default JWT secret means anyone who has read this repository
 * can mint a valid admin token. That is not a warning-level problem, so this
 * throws rather than logs.
 */
export function validateEnv() {
  const fatal = [];
  const warn = [];

  if (isProd()) {
    if (!env.MONGO_URI) fatal.push('MONGO_URI is required in production.');

    for (const [name, value] of [['JWT_SECRET', env.JWT_SECRET], ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET]]) {
      if (INSECURE_DEFAULTS.includes(value)) {
        fatal.push(`${name} is still the example value. Generate one: openssl rand -base64 48`);
      } else if (value.length < 32) {
        fatal.push(`${name} must be at least 32 characters (it is ${value.length}).`);
      }
    }

    if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
      fatal.push('JWT_SECRET and JWT_REFRESH_SECRET must be different values.');
    }

    if (!process.env.CORS_ORIGINS) {
      fatal.push('CORS_ORIGINS must be set explicitly in production.');
    } else if (env.CORS_ORIGINS.some((o) => o.includes('localhost'))) {
      warn.push('CORS_ORIGINS still contains localhost.');
    }

    if (!env.TRUST_PROXY) {
      warn.push('TRUST_PROXY is false. Behind a load balancer, set it to true or rate limiting sees one IP for everyone.');
    }

    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      warn.push('No Razorpay keys — running the SIMULATED wallet. Do not take real money in this mode.');
    } else if (!env.RAZORPAY_WEBHOOK_SECRET) {
      warn.push('RAZORPAY_WEBHOOK_SECRET is not set. Webhooks will be rejected, so payments captured out-of-band will not reconcile.');
    }

    if (env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) {
      warn.push('Razorpay is in TEST mode — no real money will move.');
    }
  } else {
    if (INSECURE_DEFAULTS.includes(env.JWT_SECRET)) {
      warn.push('Using a development JWT secret. Set a real one before deploying.');
    }
  }

  if (warn.length) warn.forEach((w) => console.warn(`⚠️  ${w}`));

  if (fatal.length) {
    console.error('\n❌ Refusing to start — configuration is unsafe:\n');
    fatal.forEach((f) => console.error(`   • ${f}`));
    console.error('');
    throw new Error('Invalid production configuration');
  }
}

export default env;
