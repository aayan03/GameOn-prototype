/**
 * Terms, Privacy, Refunds and Contact.
 *
 * These are not decoration. Razorpay's Indian onboarding will not activate a
 * live account without all four reachable on the merchant's own domain, and
 * they are also what a user is entitled to read before handing over money.
 *
 * One file, four routes, because they share a layout and cross-reference each
 * other constantly.
 *
 * The content below is written to describe what this application ACTUALLY
 * does — the cancellation windows come from the venue's own policy, refunds
 * go back to the original payment method, the platform fee is what
 * booking.service.js charges. Read it against your own operation before
 * publishing, and have a lawyer look at it if real money is involved. It is a
 * solid starting point, not legal advice.
 */

import { Link } from 'react-router-dom';
import { business, businessIncomplete, PLATFORM_FEE_PERCENT } from '../config/business.js';

function Placeholder({ value }) {
  const missing = String(value).startsWith('FILL IN');
  if (!missing) return <>{value}</>;
  return (
    <mark style={{ background: '#FFE8A3', color: '#5B4300', padding: '1px 6px', borderRadius: 4 }}>
      {value}
    </mark>
  );
}

function Shell({ title, updated = true, children }) {
  return (
    <div className="container section" style={{ maxWidth: 820 }}>
      {businessIncomplete && (
        <div className="alert alert-warn" style={{ marginBottom: 20 }}>
          <span>
            <strong>Not ready to publish.</strong> Some business details are still
            placeholders — see <code>src/config/business.js</code>. Razorpay checks
            these pages against your merchant account during onboarding.
          </span>
        </div>
      )}

      <h1 style={{ marginBottom: 6 }}>{title}</h1>
      {updated && (
        <p className="text-faint" style={{ marginBottom: 26 }}>
          Last updated: <Placeholder value={business.policiesUpdated} />
        </p>
      )}

      <div className="legal-body stack gap-16">{children}</div>

      <div className="footer-bottom" style={{ marginTop: 34 }}>
        <span>
          <Link to="/terms" className="footer-link">Terms</Link>{' · '}
          <Link to="/privacy" className="footer-link">Privacy</Link>{' · '}
          <Link to="/refunds" className="footer-link">Refunds</Link>{' · '}
          <Link to="/contact" className="footer-link">Contact</Link>
        </span>
      </div>
    </div>
  );
}

const Who = () => (
  <>
    <Placeholder value={business.legalName} />
    {business.tradingName ? ` (“${business.tradingName}”)` : ''}
  </>
);

/* ── Terms ───────────────────────────────────────────────────── */

export function Terms() {
  return (
    <Shell title="Terms of Service">
      <p>
        These terms govern your use of <Who />, a platform that lists sports
        venues and lets you book slots at them. By creating an account or making
        a booking you agree to them.
      </p>

      <h3>What we are</h3>
      <p>
        We are a booking platform, not a venue operator. The pitch, court or turf
        you book is owned and run by an independent venue. We pass your booking
        to them and collect payment; they provide the facility. Disputes about
        the condition of a venue, its staff or its equipment are between you and
        that venue, though we will help where we can.
      </p>

      <h3>Your account</h3>
      <ul>
        <li>You must be 13 or older to hold an account, and 18 or older to pay for one.</li>
        <li>Keep your password to yourself. Bookings made from your account are treated as yours.</li>
        <li>One person, one account. Accounts created to abuse promotional codes may be closed.</li>
        <li>You can close your account at any time from your profile, or by emailing us.</li>
      </ul>

      <h3>Bookings</h3>
      <p>
        Some venues confirm instantly. Others review each request and confirm it
        themselves — for those, your slot is held but not guaranteed until the
        venue accepts. If a venue does not respond in time, the request expires
        automatically and anything you paid is refunded in full.
      </p>

      <h3>Prices and our fee</h3>
      <p>
        Slot prices are set by the venue. We add a platform fee of{' '}
        {PLATFORM_FEE_PERCENT}% of the booking value, shown separately before you
        pay, and reduced or waived at higher loyalty tiers. The total you see at
        checkout is the total you are charged.
      </p>

      <h3>Cancellations</h3>
      <p>
        Each venue publishes its own cancellation window, shown on its page and
        again before you confirm a cancellation. See our{' '}
        <Link to="/refunds">refund policy</Link> for how the money comes back.
      </p>

      <h3>Loyalty points and wallet credit</h3>
      <p>
        Points are a promotional benefit with no cash value. They can be
        redeemed for credit usable on this platform only, and are reversed if the
        booking that earned them is cancelled. Wallet credit is not legal tender,
        cannot be transferred between accounts except through a TeamUp cost
        split, and is not withdrawable to a bank account.
      </p>

      <h3>Acceptable use</h3>
      <ul>
        <li>Do not book slots you do not intend to use, or resell them.</li>
        <li>Do not post reviews for venues you have not played at. We only accept reviews tied to a settled booking.</li>
        <li>Do not use TeamUp to solicit money for games that will not happen.</li>
        <li>Do not attempt to access other users&rsquo; accounts, bookings or data.</li>
      </ul>

      <h3>Suspension</h3>
      <p>
        We may suspend or close an account that breaks these terms. Where money
        is involved we will refund anything owed to you before closing it.
      </p>

      <h3>Liability</h3>
      <p>
        Sport carries risk of injury. You take part at your own risk and are
        responsible for your own fitness to play and for any equipment you use.
        We are not liable for injury, loss or damage occurring at a venue. Our
        liability for anything arising from your use of this platform is limited
        to the amount you paid us for the booking in question.
      </p>

      <h3>Changes</h3>
      <p>
        We may update these terms. Material changes will be notified in the app.
        Continuing to use the platform after a change means you accept it.
      </p>

      <h3>Governing law</h3>
      <p>
        These terms are governed by the laws of India, and the courts at{' '}
        <Placeholder value={business.address} /> have jurisdiction.
      </p>

      <h3>Contact</h3>
      <p>
        <Who />, <Placeholder value={business.address} />.{' '}
        <Placeholder value={business.supportEmail} />
        {business.gstin ? <> · GSTIN {business.gstin}</> : null}
      </p>
    </Shell>
  );
}

/* ── Privacy ─────────────────────────────────────────────────── */

export function Privacy() {
  return (
    <Shell title="Privacy Policy">
      <p>
        This describes what <Who /> collects, why, and what we do with it.
      </p>

      <h3>What we collect</h3>
      <ul>
        <li><strong>Account details</strong> — your name, email address and, if you give it, your phone number and city.</li>
        <li><strong>Profile details</strong> — the sports you play, skill level, position and bio. All optional, and visible to other players on TeamUp.</li>
        <li><strong>Booking history</strong> — which venues you booked, when, and what you paid.</li>
        <li><strong>Payment records</strong> — the amount, the method and the gateway&rsquo;s transaction reference. <strong>We never see or store your card number, UPI PIN or bank credentials.</strong> Those go directly to our payment gateway.</li>
        <li><strong>Location</strong> — only if you allow it, and only to sort venues by distance. We store your last known coordinates to avoid asking every time. You can decline and use the city filter instead.</li>
        <li><strong>Device tokens</strong> — if you enable notifications, so we can send booking reminders.</li>
      </ul>

      <h3>What we do with it</h3>
      <p>
        We use it to run the service: taking bookings, telling venues who is
        arriving, processing payments and refunds, sending booking confirmations
        and reminders, and preventing fraud and abuse. We do not sell your data,
        and we do not use it for advertising.
      </p>

      <h3>Who else sees it</h3>
      <ul>
        <li><strong>The venue you book</strong> sees your name, phone number and booking details, so they can let you in and contact you if something changes.</li>
        <li><strong>Other players</strong> see only what your public profile shows — name, avatar, city, sports, skill level and reliability score. Never your email, phone or booking history.</li>
        <li><strong>Our payment gateway</strong> processes your payment under its own privacy policy.</li>
        <li><strong>Our email provider</strong> delivers transactional messages such as password resets.</li>
        <li><strong>Law enforcement</strong>, where we are legally required to disclose.</li>
      </ul>

      <h3>How long we keep it</h3>
      <p>
        Booking and payment records are kept for as long as tax and accounting
        rules require. Notifications are deleted automatically after 60 days.
        Everything else is kept until you delete your account.
      </p>

      <h3>Security</h3>
      <p>
        Passwords are stored only as bcrypt hashes — we cannot read them, and a
        password reset link is the only way back into an account. Password reset
        tokens are stored hashed and expire in 30 minutes. All traffic is
        encrypted in transit.
      </p>

      <h3>Your choices</h3>
      <ul>
        <li>Edit or remove your profile details at any time from your profile page.</li>
        <li>Turn off location access in your browser or phone settings.</li>
        <li>Turn off notifications from your profile, or in your browser settings.</li>
        <li>Ask us for a copy of your data, or ask us to delete your account, by emailing <Placeholder value={business.supportEmail} />. We will respond within 30 days.</li>
      </ul>

      <h3>Cookies and local storage</h3>
      <p>
        We store your session token in your browser so you stay signed in, and
        cache some pages so the app works on a poor connection. We do not use
        third-party advertising or tracking cookies.
      </p>

      <h3>Children</h3>
      <p>
        The service is not intended for children under 13, and we do not
        knowingly collect their data. If you believe a child has an account,
        email us and we will remove it.
      </p>

      <h3>Contact</h3>
      <p>
        Questions about this policy: <Placeholder value={business.supportEmail} />,
        or write to <Who /> at <Placeholder value={business.address} />.
      </p>
    </Shell>
  );
}

/* ── Refunds ─────────────────────────────────────────────────── */

export function Refunds() {
  return (
    <Shell title="Cancellation & Refund Policy">
      <p>
        Each venue sets its own cancellation window. The exact figures for the
        venue you are booking are shown on its page, and again on the
        cancellation screen before you confirm — so you always see what you will
        get back before you commit to anything.
      </p>

      <h3>The usual windows</h3>
      <p>Most venues on the platform use:</p>
      <ul>
        <li><strong>More than 24 hours before your slot</strong> — full refund.</li>
        <li><strong>Between 6 and 24 hours before</strong> — 50% refund.</li>
        <li><strong>Less than 6 hours before</strong> — no refund, because the slot is unlikely to be re-sold.</li>
      </ul>
      <p>
        Individual venues may set longer or shorter windows. Whatever is shown on
        the venue&rsquo;s own page is what applies to your booking.
      </p>

      <h3>Where the money goes</h3>
      <ul>
        <li><strong>Paid by card, UPI or netbanking</strong> — refunded to that same card or account, through our payment gateway. Banks typically take 5–7 working days to show it.</li>
        <li><strong>Paid from your GameOn wallet</strong> — returned to your wallet immediately.</li>
        <li><strong>Paid at the venue in cash</strong> — the venue holds that money, so any refund is arranged directly with them. We will still cancel the booking and free the slot.</li>
      </ul>

      <h3>When you get a full refund regardless</h3>
      <ul>
        <li>The venue declines your booking request.</li>
        <li>The venue does not respond in time and the request expires.</li>
        <li>The venue cancels on you.</li>
      </ul>
      <p>No cancellation charge applies in any of these cases.</p>

      <h3>Loyalty points</h3>
      <p>
        Points earned on a cancelled booking are reversed. If you had already
        redeemed them for wallet credit, the value of the unrecoverable points is
        deducted from your refund — otherwise redeeming and then cancelling would
        turn a booking into free credit.
      </p>

      <h3>Something went wrong</h3>
      <p>
        If a venue was closed, unusable or not as described, email{' '}
        <Placeholder value={business.supportEmail} /> within 48 hours of your slot
        with your booking reference. We will look into it with the venue and
        refund you where it is warranted, regardless of the window above.
      </p>

      <h3>How long refunds take</h3>
      <p>
        We issue the refund the moment the cancellation goes through. Wallet
        refunds are instant. Card, UPI and netbanking refunds are issued
        immediately on our side and then depend on your bank — usually 5–7
        working days. If it has been longer, email us with your booking reference
        and we will chase it.
      </p>
    </Shell>
  );
}

/* ── Contact ─────────────────────────────────────────────────── */

export function Contact() {
  return (
    <Shell title="Contact Us" updated={false}>
      <p>
        We answer support email within one working day. For anything about a
        specific booking, include the booking reference — it is on the booking
        page and in your confirmation email.
      </p>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Support</h3>
        <p style={{ margin: '4px 0' }}>
          <strong>Email:</strong> <Placeholder value={business.supportEmail} />
        </p>
        <p style={{ margin: '4px 0' }}>
          <strong>Phone:</strong> <Placeholder value={business.supportPhone} />
        </p>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Registered office</h3>
        <p style={{ margin: '4px 0' }}><Who /></p>
        <p style={{ margin: '4px 0' }}><Placeholder value={business.address} /></p>
        {business.gstin && <p style={{ margin: '4px 0' }}><strong>GSTIN:</strong> {business.gstin}</p>}
      </div>

      <h3>Listing your venue</h3>
      <p>
        If you run a turf, court or sports facility and want it on the platform,{' '}
        <Link to="/register?role=owner">create an owner account</Link> and submit
        it — or email us and we will set it up with you.
      </p>

      <h3>Reporting a problem</h3>
      <p>
        To report a security issue, a listing that should not be here, or a user
        behaving badly, email <Placeholder value={business.supportEmail} /> with
        the details. Security reports are read first.
      </p>
    </Shell>
  );
}
