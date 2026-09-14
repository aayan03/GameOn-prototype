import { IconClose } from './Icons.jsx';

/**
 * "Clear filters", identical on every page you can search.
 *
 * Only Find venues had one, and it lived inside the Filters drawer — out of
 * sight on a phone until you opened it — and it only appeared for some
 * filters: search text, Near me and sort order never counted. Events offered
 * one only after a search came back empty, and Free grounds and TeamUp had
 * none, so getting back to an unfiltered list meant undoing each filter by
 * hand.
 *
 * The page decides whether anything is active and what clearing resets; this
 * only keeps the control the same everywhere.
 */
export default function ClearFilters({ onClear }) {
  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onClear}>
        <IconClose style={{ width: 14, height: 14 }} /> Clear filters
      </button>
    </div>
  );
}
