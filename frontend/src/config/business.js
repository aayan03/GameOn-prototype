/**
 * The legal identity behind this deployment.
 *
 * Every value here appears verbatim on the Terms, Privacy, Refund and Contact
 * pages — and Razorpay checks those pages against the entity on your merchant
 * account during onboarding. A mismatch is the usual reason an activation
 * request comes back.
 *
 * FILL THESE IN BEFORE YOU GO LIVE. They are deliberately obvious
 * placeholders rather than plausible-looking defaults: a policy page that
 * quietly names the wrong company is worse than one that visibly needs
 * finishing, because nobody notices the first kind.
 *
 * Everything can also come from the environment, so a fork can be deployed
 * without editing source. Vite inlines VITE_* at build time.
 */

const env = import.meta.env;

export const business = {
  /** Registered trading name, exactly as it appears on your GST/PAN. */
  legalName: env.VITE_LEGAL_NAME || 'FILL IN — your registered business name',
  /** The brand users see. Safe to differ from legalName. */
  tradingName: env.VITE_TRADING_NAME || 'GameOn',
  /** Full registered address, including PIN code. */
  address: env.VITE_BUSINESS_ADDRESS || 'FILL IN — registered address, including PIN code',
  /** A monitored inbox. Razorpay will email it during onboarding. */
  supportEmail: env.VITE_SUPPORT_EMAIL || 'FILL IN — support@yourdomain.com',
  /** A reachable phone number. Required for the Contact page. */
  supportPhone: env.VITE_SUPPORT_PHONE || 'FILL IN — +91 XXXXX XXXXX',
  /** Optional, but expected once you are registered. */
  gstin: env.VITE_GSTIN || '',
  /** Shown on Terms and Privacy so users can see how current they are. */
  policiesUpdated: env.VITE_POLICIES_UPDATED || 'FILL IN — e.g. 5 September 2026',
};

/** True while any required field is still a placeholder. */
export const businessIncomplete = Object.entries(business)
  .filter(([key]) => key !== 'gstin')
  .some(([, value]) => String(value).startsWith('FILL IN'));

/** The platform's own cut, quoted on the Terms and Pricing sections. */
export const PLATFORM_FEE_PERCENT = Number(env.VITE_PLATFORM_FEE_PERCENT || 3);
