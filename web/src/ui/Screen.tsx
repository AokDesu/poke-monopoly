import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

/**
 * True once the player has moved between screens. A newly shown screen then moves focus to its
 * heading so keyboard and screen-reader users land on it; the first page load leaves focus alone.
 */
export const FocusHeadingContext = createContext(false);

interface ScreenProps {
  heading: string;
  body?: string;
  /** Shown above the heading, such as the setup progress. */
  before?: ReactNode;
  children?: ReactNode;
  /** The screen's way on and way back, when the content itself does not hold them. */
  actions?: ReactNode;
}

export function Screen({ heading, body, before, children, actions }: ScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useContext(FocusHeadingContext);

  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
  }, [focusHeading]);

  return (
    <section aria-labelledby="screen-heading">
      {before}
      <h1
        id="screen-heading"
        ref={headingRef}
        tabIndex={-1}
        className="max-w-[24ch] text-3xl leading-snug font-bold tracking-[-0.01em] text-balance outline-none sm:text-4xl"
      >
        {heading}
      </h1>
      {body !== undefined && (
        <p className="mt-4 max-w-[62ch] text-lg text-pretty text-ink-soft">{body}</p>
      )}
      {children !== undefined && <div className="mt-10">{children}</div>}
      {actions !== undefined && (
        <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-line pt-6">
          {actions}
        </div>
      )}
    </section>
  );
}
