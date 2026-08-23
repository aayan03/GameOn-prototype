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

/**
 * Cleans a value pasted into a hosting dashboard.
 *
 * A shell needs quotes around a connection string; a dashboard field does
 * not, and stores them as part of the value. `"mongodb+srv://..."` then fails
 * with "Invalid scheme", which points at the URL rather than at the quote
 * that is actually wrong. Trailing newlines from a copy-paste do the same.
 */
const clean = (v) => {
  if (typeof v !== 'string') return '';
  const trimmed = v.trim();
  const quoted = trimmed.length > 1
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")));
  return quoted ? trimmed.slice(1, -1).trim() : trimmed;
};

const env = {
  PORT: num(process.env.PORT, 5000),
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGO_URI: clean(process.env.MONGO_URI),

  JWT_SECRET: clean(process.env.JWT_SECRET) || 'insecure_dev_secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '2h',
  JWT_REFRESH_SECRET: clean(process.env.JWT_REFRESH_SECRET) || 'insecure_dev_refresh',
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
  // Shared secret for POST /api/cron/lifecycle. Empty = the route 404s, which
  // is the correct default: an unauthenticated endpoint that issues refunds
  // is not something to leave switched on by accident.
  CRON_SECRET: process.env.CRON_SECRET || '',
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
    if (!env.MONGO_URI) {
      fatal.push('MONGO_URI is required in production.');
    } else if (!/^mongodb(\+srv)?:\/\//.test(env.MONGO_URI)) {
      // Say what is actually wrong. Mongoose's own "Invalid scheme" message
      // sends people off checking their cluster name when the real problem is
      // a stray quote, a leading space, or the wrong value pasted entirely.
      const head = env.MONGO_URI.slice(0, 24).replace(/:[^:@/]*@/, ':****@');
      fatal.push(
        `MONGO_URI must start with "mongodb+srv://" or "mongodb://". Yours starts with "${head}…". `
        + 'Common causes: quotes around the value, a stray space, or pasting the password '
        + 'instead of the whole connection string.'
      );
    }

    for (const [name, value] of [['JWT_SECRET', env.JWT_SECRET], ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET]]) {
      if (INSECURE_DEFAULTS.includes(value)) {
        fatal.push(`${name} is still the example value. Generate one: openssl rand -base64 48`);
      } else if (value.length < 32) {
        fatal.push(`${name} must be at least 32 characters (it is ${value.length}).`);
      }
    }

    // Placeholder hostnames copied out of documentation. These resolve to
    // nothing, and the resulting `querySrv ENOTFOUND` points at DNS rather
    // than at the fact that the host was never real.
    if (/@(cluster0\.)?(xxxxx|xxxx|yyyyy|abcde|example)\./i.test(env.MONGO_URI)) {
      fatal.push(
        'MONGO_URI still has a placeholder hostname (xxxxx / abcde / example). '
        + 'Copy the real string from Atlas: Clusters → Connect → Drivers.'
      );
    }

    // A password with @ : / or # in it breaks the URL long before Mongo sees
    // it. Percent-encode it, or regenerate one without those characters.
    if (/^mongodb(\+srv)?:\/\/[^/]*<[^>]*>/.test(env.MONGO_URI)) {
      fatal.push('MONGO_URI still contains a <placeholder>. Replace <db_password> with the real password, angle brackets included.');
    }

    if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
      fatal.push('JWT_SECRET and JWT_REFRESH_SECRET must be different values.');
    }

    if (!process.env.CORS_ORIGINS) {
      fatal.push('CORS_ORIGINS must be set explicitly in production.');
    } else if (env.CORS_ORIGINS.some((o) => o.includes('localhost'))) {
      warn.push('CORS_ORIGINS still contains localhost.');
    }

    // `https://*.vercel.app` matches every app anyone has ever deployed to
    // vercel.app. Keep a real prefix in front of the star.
    for (const o of env.CORS_ORIGINS) {
      if (/^https?:\/\/\*\./.test(o)) {
        fatal.push(`CORS_ORIGINS entry "${o}" wildcards an entire domain. Put a prefix before the *, e.g. https://myapp-*.vercel.app`);
      }
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
