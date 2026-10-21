import type { ReactNode } from 'react';

/** Why a control is greyed out (spec §3.1): always visible text, never only a tooltip. */
export function DisabledReason({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-ink-soft">
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="mt-[0.3em] size-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2.75" y="7" width="10.5" height="7.25" rx="1.5" />
        <path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" />
      </svg>
      <span>{children}</span>
    </span>
  );
}
