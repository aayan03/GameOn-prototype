import ComingSoon from './ComingSoon.jsx';

export default function Bookings() {
  return (
    <ComingSoon
      phase={2}
      icon="🎟️"
      title="My bookings"
      tagline="A movie-ticket style slot grid: pick your date, see which hours are taken, and lock the one you want."
      features={[
        'Visual slot grid — booked, available and peak-priced hours at a glance',
        'Real-time availability, so two people can never take the same slot',
        'Instant confirmation at automated venues; assisted requests at the rest',
        'Cancel with a refund calculated from the venue policy',
        'Wallet credits returned immediately on cancellation',
        'Booking history with digital receipts and a QR code for entry',
      ]}
      cta={{ to: '/venues', label: 'Find a venue' }}
    />
  );
}
