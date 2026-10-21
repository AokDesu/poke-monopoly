const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** A die showing five: Random All and the first-player roll. */
export function DieIcon({ className = 'size-9' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className={className} {...STROKE}>
      <rect x="4" y="4" width="24" height="24" rx="5" />
      <circle cx="11" cy="11" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="21" cy="11" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="16" cy="16" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="11" cy="21" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="21" cy="21" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Onward, step by step. */
export function ArrowIcon({ className = 'size-9' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className={className} {...STROKE}>
      <path d="M6 16h19M18 9l7 7-7 7" />
    </svg>
  );
}

/** The capture ball, as the logo mark: red top, white bottom, dark band and button. */
export function BallIcon({ className = 'size-9' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className={className}>
      <path d="M2.5 16a13.5 13.5 0 0 1 27 0Z" fill="#e8392a" />
      <path d="M2.5 16a13.5 13.5 0 0 0 27 0Z" fill="#ffffff" />
      <circle cx="16" cy="16" r="13.5" fill="none" stroke="#15264a" strokeWidth="2.5" />
      <path d="M2.5 16h27" stroke="#15264a" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="4.2" fill="#ffffff" stroke="#15264a" strokeWidth="2.5" />
    </svg>
  );
}
