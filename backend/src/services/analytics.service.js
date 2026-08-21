import mongoose from 'mongoose';
import { Booking, Venue, Review } from '../models/index.js';
import { BOOKING_STATUS } from '../config/constants.js';
import { toMinutes, dayOfWeek, localKey } from '../utils/time.js';

const OID = (v) => new mongoose.Types.ObjectId(String(v));

/** Bookings that represent real, collected revenue. */
const EARNING = [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.COMPLETED];

/**
 * What a booking is worth to the venue.
 *
 * `payment.amountPaid` alone under-reports: a pay-at-venue booking is
 * confirmed with amountPaid 0 because the money changes hands in person, and
 * any booking written before that field existed is also 0. Fall back to the
 * booked total in those cases so an owner's revenue chart matches reality.
 */
const REVENUE = {
  $cond: [
    { $gt: ['$payment.amountPaid', 0] },
    '$payment.amountPaid',
    { $cond: [{ $in: ['$status', EARNING] }, '$totalAmount', 0] },
  ],
};

/** Inclusive day range as Date objects, from a day count. */
export function rangeFor(days = 30) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

/**
 * Headline numbers for the owner dashboard.
 *
 * Everything is scoped to `venueIds`, which the controller derives from the
 * signed-in owner — the aggregation never trusts a venue id from the client.
 */
export async function overview(venueIds, days = 30) {
  if (!venueIds.length) {
    return {
      revenue: 0, bookings: 0, cancelled: 0, cancellationRate: 0,
      avgBookingValue: 0, uniqueCustomers: 0, repeatCustomers: 0,
      pendingRequests: 0, occupancyPercent: 0, previous: null, deltas: null,
    };
  }

  const ids = venueIds.map(OID);
  const { start, end } = rangeFor(days);

  // The equivalent window immediately before, for period-on-period deltas.
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(start.getTime() - days * 86400000);

  const summarise = async (from, to) => {
    const [row] = await Booking.aggregate([
      { $match: { venue: { $in: ids }, startsAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: null,
          revenue: { $sum: { $cond: [{ $in: ['$status', EARNING] }, REVENUE, 0] } },
          slots: { $sum: 1 },
          earningSlots: { $sum: { $cond: [{ $in: ['$status', EARNING] }, 1, 0] } },
          cancelledSlots: {
            $sum: { $cond: [{ $in: ['$status', [BOOKING_STATUS.CANCELLED, BOOKING_STATUS.REJECTED]] }, 1, 0] },
          },
          groups: { $addToSet: '$groupRef' },
          customers: { $addToSet: '$user' },
        },
      },
    ]);
    return {
      revenue: row?.revenue || 0,
      slots: row?.slots || 0,
      earningSlots: row?.earningSlots || 0,
      cancelledSlots: row?.cancelledSlots || 0,
      bookings: row?.groups?.length || 0,
      uniqueCustomers: row?.customers?.length || 0,
    };
  };

  const [current, previous] = await Promise.all([
    summarise(start, end),
    summarise(prevStart, prevEnd),
  ]);

  // Repeat customers: booked on more than one distinct day in the window.
  const repeat = await Booking.aggregate([
    {
      $match: {
        venue: { $in: ids },
        startsAt: { $gte: start, $lte: end },
        status: { $in: EARNING },
      },
    },
    { $group: { _id: { user: '$user', date: '$date' } } },
    { $group: { _id: '$_id.user', days: { $sum: 1 } } },
    { $match: { days: { $gt: 1 } } },
    { $count: 'c' },
  ]);

  const pendingRequests = await Booking.countDocuments({
    venue: { $in: ids },
    status: BOOKING_STATUS.PENDING,
    endsAt: { $gte: new Date() },
  });

  const occupancyPercent = await occupancy(venueIds, days);

  const pct = (now, before) => {
    if (!before) return now > 0 ? 100 : 0;
    return Math.round(((now - before) / before) * 100);
  };

  return {
    revenue: current.revenue,
    bookings: current.bookings,
    slots: current.slots,
    cancelled: current.cancelledSlots,
    cancellationRate: current.slots
      ? Math.round((current.cancelledSlots / current.slots) * 100)
      : 0,
    avgBookingValue: current.bookings ? Math.round(current.revenue / current.bookings) : 0,
    uniqueCustomers: current.uniqueCustomers,
    repeatCustomers: repeat?.[0]?.c || 0,
    pendingRequests,
    occupancyPercent,
    previous,
    deltas: {
      revenue: pct(current.revenue, previous.revenue),
      bookings: pct(current.bookings, previous.bookings),
      customers: pct(current.uniqueCustomers, previous.uniqueCustomers),
    },
  };
}

/**
 * Occupancy = slots sold ÷ slots that were sellable.
 *
 * Sellable capacity is derived from each venue's real operating hours and slot
 * length, per court, per day. Dividing by a flat "24 hours × courts" would
 * flatter every venue and make the number meaningless.
 */
export async function occupancy(venueIds, days = 30) {
  if (!venueIds.length) return 0;
  const { start, end } = rangeFor(days);

  const venues = await Venue.find({ _id: { $in: venueIds } })
    .select('courts operatingHours slotDurationMins')
    .lean();

  let capacity = 0;
  for (let d = 0; d < days; d++) {
    const day = new Date(start);
    day.setDate(day.getDate() + d);
    // Local key, not toISOString — see utils/time.js#localKey.
    const key = localKey(day);
    const dow = dayOfWeek(key);

    for (const v of venues) {
      const hours = v.operatingHours?.find((h) => h.day === dow);
      if (!hours || hours.isClosed) continue;
      const open = toMinutes(hours.open);
      const close = toMinutes(hours.close);
      const slotMins = v.slotDurationMins || 60;
      const perCourt = Math.max(0, Math.floor((close - open) / slotMins));
      capacity += perCourt * (v.courts?.filter((c) => c.isActive !== false).length || 0);
    }
  }

  if (!capacity) return 0;

  const sold = await Booking.countDocuments({
    venue: { $in: venueIds },
    startsAt: { $gte: start, $lte: end },
    status: { $in: EARNING },
  });

  return Math.min(100, Math.round((sold / capacity) * 100));
}

/** Daily revenue and booking counts, zero-filled so the chart has no gaps. */
export async function revenueSeries(venueIds, days = 30) {
  const { start, end } = rangeFor(days);
  const buckets = new Map();

  for (let d = 0; d < days; d++) {
    const day = new Date(start);
    day.setDate(day.getDate() + d);
    const key = localKey(day);
    buckets.set(key, { date: key, revenue: 0, bookings: 0 });
  }

  if (venueIds.length) {
    const rows = await Booking.aggregate([
      {
        $match: {
          venue: { $in: venueIds.map(OID) },
          startsAt: { $gte: start, $lte: end },
          status: { $in: EARNING },
        },
      },
      { $group: { _id: '$date', revenue: { $sum: REVENUE }, groups: { $addToSet: '$groupRef' } } },
    ]);
    for (const r of rows) {
      if (buckets.has(r._id)) {
        buckets.set(r._id, { date: r._id, revenue: r.revenue, bookings: r.groups.length });
      }
    }
  }

  return [...buckets.values()];
}

/** Revenue split by court, and by sport. */
export async function revenueBreakdown(venueIds, days = 30) {
  if (!venueIds.length) return { byCourt: [], bySport: [], byVenue: [] };
  const { start, end } = rangeFor(days);
  const match = {
    venue: { $in: venueIds.map(OID) },
    startsAt: { $gte: start, $lte: end },
    status: { $in: EARNING },
  };

  const [byCourt, bySport, byVenue] = await Promise.all([
    Booking.aggregate([
      { $match: match },
      { $group: { _id: { court: '$court', name: '$courtName' }, revenue: { $sum: REVENUE }, slots: { $sum: 1 } } },
      { $sort: { revenue: -1 } }, { $limit: 12 },
      { $project: { _id: 0, name: '$_id.name', revenue: 1, slots: 1 } },
    ]),
    Booking.aggregate([
      { $match: match },
      { $group: { _id: '$sport', revenue: { $sum: REVENUE }, slots: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
      { $project: { _id: 0, sport: '$_id', revenue: 1, slots: 1 } },
    ]),
    Booking.aggregate([
      { $match: match },
      { $group: { _id: '$venue', revenue: { $sum: REVENUE }, slots: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
      { $lookup: { from: 'venues', localField: '_id', foreignField: '_id', as: 'v' } },
      { $project: { _id: 0, venue: { $arrayElemAt: ['$v.name', 0] }, revenue: 1, slots: 1 } },
    ]),
  ]);

  return { byCourt, bySport, byVenue };
}

/** Which hours actually sell, so an owner can price peak properly. */
export async function peakHours(venueIds, days = 60) {
  if (!venueIds.length) return [];
  const { start, end } = rangeFor(days);

  const rows = await Booking.aggregate([
    {
      $match: {
        venue: { $in: venueIds.map(OID) },
        startsAt: { $gte: start, $lte: end },
        status: { $in: EARNING },
      },
    },
    {
      $group: {
        _id: { $floor: { $divide: ['$startMinutes', 60] } },
        slots: { $sum: 1 },
        revenue: { $sum: REVENUE },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const byHour = new Map(rows.map((r) => [r._id, r]));
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    slots: byHour.get(h)?.slots || 0,
    revenue: byHour.get(h)?.revenue || 0,
  }));
}

/** Customers ranked by spend, with their booking history summarised. */
export async function customers(venueIds, { limit = 50, days = 180 } = {}) {
  if (!venueIds.length) return [];
  const { start, end } = rangeFor(days);

  return Booking.aggregate([
    {
      $match: {
        venue: { $in: venueIds.map(OID) },
        startsAt: { $gte: start, $lte: end },
        status: { $in: EARNING },
      },
    },
    {
      $group: {
        _id: '$user',
        spend: { $sum: REVENUE },
        slots: { $sum: 1 },
        groups: { $addToSet: '$groupRef' },
        lastPlayed: { $max: '$startsAt' },
        sports: { $addToSet: '$sport' },
      },
    },
    { $sort: { spend: -1 } },
    { $limit: limit },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
    {
      $project: {
        _id: 0,
        userId: '$_id',
        // Only the fields an owner legitimately needs to recognise a regular.
        name: { $arrayElemAt: ['$u.name', 0] },
        avatar: { $arrayElemAt: ['$u.avatar', 0] },
        loyaltyTier: { $arrayElemAt: ['$u.loyaltyTier', 0] },
        spend: 1, slots: 1, lastPlayed: 1, sports: 1,
        bookings: { $size: '$groups' },
      },
    },
  ]);
}

/** Rating average and distribution across the owner's venues. */
export async function reviewSummary(venueIds) {
  if (!venueIds.length) return { average: 0, total: 0, distribution: [] };
  const rows = await Review.aggregate([
    { $match: { venue: { $in: venueIds.map(OID) }, isVisible: true } },
    { $group: { _id: '$rating', count: { $sum: 1 } } },
  ]);

  const total = rows.reduce((s, r) => s + r.count, 0);
  const weighted = rows.reduce((s, r) => s + r._id * r.count, 0);

  return {
    average: total ? Number((weighted / total).toFixed(2)) : 0,
    total,
    distribution: [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: rows.find((r) => r._id === star)?.count || 0,
    })),
  };
}
