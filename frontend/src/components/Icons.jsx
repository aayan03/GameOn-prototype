/* Inline SVG icons — no icon library dependency, so the bundle stays small
   and every glyph inherits currentColor. */
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const IconHome = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></svg>
);
export const IconSearch = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const IconMap = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="m9 4-6 2.5v13L9 17l6 2.5 6-2.5V4l-6 2.5L9 4Z" /><path d="M9 4v13M15 6.5v13" /></svg>
);
export const IconUsers = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5.3a3.2 3.2 0 0 1 0 6.2M17.5 14.2A6.5 6.5 0 0 1 21.5 20" /></svg>
);
export const IconUser = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>
);
export const IconPin = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></svg>
);
export const IconStar = ({ filled, ...p }) => (
  <svg viewBox="0 0 24 24" {...base} fill={filled ? 'currentColor' : 'none'} {...p}>
    <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5Z" />
  </svg>
);
export const IconHeart = ({ filled, ...p }) => (
  <svg viewBox="0 0 24 24" {...base} fill={filled ? 'currentColor' : 'none'} {...p}>
    <path d="M12 20s-7-4.4-7-9.3A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7 3.1C19 15.6 12 20 12 20Z" />
  </svg>
);
export const IconFilter = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M4 6h16M7 12h10M10 18h4" /></svg>
);
export const IconClose = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="m6 6 12 12M18 6 6 18" /></svg>
);
export const IconCheck = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="m5 12.5 4.5 4.5L19 7" /></svg>
);
export const IconBolt = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
);
export const IconPhone = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M5 3h4l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z" /></svg>
);
export const IconCalendar = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
);
export const IconLocate = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
);
export const IconChevron = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="m9 5 7 7-7 7" /></svg>
);
export const IconLogout = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 8 6 12l4 4M6 12h10" /></svg>
);

export const IconInfo = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.6" r=".9" fill="currentColor" stroke="none" /></svg>
);
export const IconClock = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5.3l3.4 2" /></svg>
);
export const IconWallet = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1" /><rect x="3" y="7.5" width="18" height="12.5" rx="2.5" /><circle cx="16.5" cy="14" r="1.3" fill="currentColor" stroke="none" /></svg>
);
export const IconTicket = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M4 7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4V7Z" /><path d="M14 6v2M14 11v2M14 16v2" strokeDasharray="1 3" /></svg>
);
export const IconArrowLeft = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M15 19 8 12l7-7" /></svg>
);
export const IconArrowRight = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="m9 5 7 7-7 7" /><path d="M4 12h11" /></svg>
);
export const IconTrash = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></svg>
);
export const IconSparkle = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="m12 3 1.9 5.6L19.5 10l-5.6 1.4L12 17l-1.9-5.6L4.5 10l5.6-1.4L12 3Z" /></svg>
);
export const IconRefresh = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M20 11a8 8 0 1 0-.6 4" /><path d="M20 5v6h-6" /></svg>
);
export const IconShield = (p) => (
  <svg viewBox="0 0 24 24" {...base} {...p}><path d="M12 3 5 6v6c0 4.4 3 8 7 9 4-1 7-4.6 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
);
