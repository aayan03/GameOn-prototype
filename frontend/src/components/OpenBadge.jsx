import { clockLabel } from '../utils/format.js';

/**
 * Open / closed right now, with the next useful time attached.
 *
 * Shared by the parlour list, the detail page and the dashboard, so it lives
 * in components/ — a page that other pages import cannot be lazily loaded.
 */
/** Open / closed, with the next useful time attached. */
export default function OpenBadge({ parlor, compact = false }) {
  if (parlor.isPermanentlyClosed) {
    return <span className="open-badge shut">Permanently closed</span>;
  }
  if (parlor.openNow) {
    return (
      <span className="open-badge open">
        <span className="open-dot" aria-hidden="true" />
        Open{!compact && parlor.closesAt ? ` · till ${clockLabel(parlor.closesAt)}` : ''}
      </span>
    );
  }
  return (
    <span className="open-badge closed">
      Closed{!compact && parlor.opensAt ? ` · opens ${clockLabel(parlor.opensAt)}` : ''}
    </span>
  );
}
