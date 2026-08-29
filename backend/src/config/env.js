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

  // ── Email ─────────────────────────────────────────────────────
  // SMTP, because every provider speaks it. Without these, password reset
  // cannot deliver — validateEnv() treats that as fatal in production.
  SMTP_HOST: clean(process.env.SMTP_HOST),
  SMTP_PORT: num(process.env.SMTP_PORT, 587),
  SMTP_USER: clean(process.env.SMTP_USER),
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || '',
  SMTP_FROM: clean(process.env.SMTP_FROM) || 'GameOn <no-reply@gameon.app>',

  // Where the frontend lives, for links inside emails. Defaults to the first
  // CORS origin, which is almost always right and saves one more variable to
  // forget.
  APP_URL: clean(process.env.APP_URL),

  // ── Web Push ──────────────────────────────────────────────────
  // Generate a pair once:  npx web-push generate-vapid-keys
  // Without them the app collects no push subscriptions at all, rather than
  // collecting them and silently never delivering.
  VAPID_PUBLIC_KEY: clean(process.env.VAPID_PUBLIC_KEY),
  VAPID_PRIVATE_KEY: clean(process.env.VAPID_PRIVATE_KEY),
  VAPID_SUBJECT: clean(process.env.VAPID_SUBJECT) || 'mailto:support@gameon.app',

  // ── Observability ─────────────────────────────────────────────
  SENTRY_DSN: clean(process.env.SENTRY_DSN),
  SERVICE_NAME: clean(process.env.SERVICE_NAME) || 'gameon-api',
  RELEASE: clean(process.env.RELEASE),
  // Application log level, separate from LOG_LEVEL which is morgan's HTTP format.
  LOG_LEVEL_APP: clean(process.env.LOG_LEVEL_APP) || '',

  // ── Wallet ────────────────────────────────────────────────────
  // The simulated top-up mints spendable balance with nothing behind it. In
  // production that is a money printer unless a real gateway is configured,
  // so it is off by default and must be turned on deliberately.
  ALLOW_SIMULATED_TOPUP: process.env.ALLOW_SIMULATED_TOPUP === 'true',
  // Shared secret for POST /api/cron/lifecycle. Empty = the route 404s, which
  // is the correct default: an unauthenticated endpoint that issues refunds
  // is not something to leave switched on by accident.
  CRON_SECRET: clean(process.env.CRON_SECRET),
  LOG_LEVEL: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'combined' : 'dev'),
  BODY_LIMIT: process.env.BODY_LIMIT || '256kb',
};

/**
 * The public URL of the frontend, for links inside emails.
 *
 * Falls back to the first non-wildcard CORS origin, which is the site itself
 * in every normal deployment. Deliberately NOT derived from the request's
 * Origin or Host header: a reset link built from an attacker-supplied header
 * is a working account-takeover.
 */
export function appUrl() {
  if (env.APP_URL) return env.APP_URL.replace(/\/$/, '');
  const origin = env.CORS_ORIGINS.find((o) => !o.includes('*') && /^https?:\/\//.test(o));
  return (origin || 'http://localhost:5173').replace(/\/$/, '');
}

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

    // Instruction text pasted where a value belongs. Angle brackets, spaces
    // and backticks never appear in a generated secret, and a placeholder
    // that "works" is worse than one that fails — it looks configured.
    for (const [name, value] of [
      ['JWT_SECRET', env.JWT_SECRET],
      ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
      ['CRON_SECRET', env.CRON_SECRET],
    ]) {
      if (value && /[<>`]|\s|openssl|paste|your[-_ ]/i.test(value)) {
        fatal.push(`${name} looks like placeholder text, not a value. Generate one: openssl rand -hex 32`);
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

    // Email is not optional in production: without it a user who forgets
    // their password is locked out of their account permanently, because the
    // reset link is the only way back in.
    if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
      fatal.push(
        'SMTP_HOST, SMTP_USER and SMTP_PASSWORD are required in production. '
        + 'Without them password-reset emails cannot be delivered and a locked-out user '
        + 'has no way back into their account.'
      );
    }

    // The reset link has to point somewhere. Guessing it from the Origin
    // header would let anyone who can reach the API mint a reset link
    // pointing at a site they control.
    if (!env.APP_URL && !env.CORS_ORIGINS.some((o) => !o.includes('*'))) {
      fatal.push('APP_URL must be set in production — it is the base of the links inside password-reset emails.');
    }

    // The simulated top-up creates spendable balance out of nothing. Allowing
    // it in production alongside real bookings means anyone can grant
    // themselves unlimited credit.
    if (env.ALLOW_SIMULATED_TOPUP) {
      if (env.RAZORPAY_KEY_ID) {
        fatal.push('ALLOW_SIMULATED_TOPUP cannot be enabled while a real payment gateway is configured — it would let anyone mint balance next to real money.');
      } else {
        warn.push('ALLOW_SIMULATED_TOPUP is on. Wallet balance can be created from nothing. Use this for a demo deployment only.');
      }
    }

    // Half a VAPID pair is worse than none: the client subscribes, the
    // subscription is stored, and nothing can ever be signed to deliver to it.
    if (Boolean(env.VAPID_PUBLIC_KEY) !== Boolean(env.VAPID_PRIVATE_KEY)) {
      fatal.push('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together, or both left empty. Generate a pair: npx web-push generate-vapid-keys');
    }

    if (!env.SENTRY_DSN) {
      warn.push('SENTRY_DSN is not set — unexpected errors will only appear in logs.');
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
