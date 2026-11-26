import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { t } from '../i18n/en.ts';

/**
 * What the card router hands every card it shows: whether the card is the live one on the board
 * (it may take focus and keys) and what sits around any decision (a rejected action, a resume
 * notice at the top; the latest battle, demo panel and AI notes at the bottom).
 */
export interface CardFrame {
  /** False in the dev gallery, where many cards share one page: no focus moves, no key is taken. */
  readonly live: boolean;
  readonly notices?: ReactNode;
  readonly trailing?: ReactNode;
}

const CardFrameContext = createContext<CardFrame>({ live: false });

export const CardFrameProvider = CardFrameContext.Provider;

/** Whether this card is the live one on the board (it may take focus); a gallery card is not. */
export const useCardLive = (): boolean => useContext(CardFrameContext).live;

/** Focusable controls inside `root`, in tab order, skipping folded or disabled ones. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.closest('[hidden]'));
}

/** Controls that answer Enter themselves; a checkbox or radio does not, so Enter there is the card's. */
const ENTER_OWNERS =
  'button, a[href], input:not([type="checkbox"]):not([type="radio"]), select, textarea, summary, [role="button"], [contenteditable="true"]';

/**
 * Enter presses the card's primary action (`data-primary`), unless the key belongs to whatever has
 * focus (a button, a link, a field) or to an open dialog. A greyed-out primary does nothing, and
 * neither does one marked `data-no-enter`: an action that risks coins (accepting a PvP battle,
 * challenging a Gym, spec §4.4) is never pressed by a key a player taps to move a rival's turn along.
 */
function usePrimaryKey(card: RefObject<HTMLElement | null>, live: boolean) {
  useEffect(() => {
    if (!live) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (document.querySelector('dialog[open]')) return;
      if (event.target instanceof Element && event.target.closest(ENTER_OWNERS)) return;
      const primary = card.current?.querySelector<HTMLButtonElement>(
        '[data-primary]:not([data-no-enter]):not(:disabled)',
      );
      if (!primary) return;
      event.preventDefault();
      primary.click();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [card, live]);
}

/**
 * A protected decision (spec §3.1, §4.3, §4.7): focus moves into the card and stays there until the
 * decision is answered. Tab wraps inside the card, and focus that lands outside it (a click on a
 * seat row, a dialog closing onto its opener) comes back; an open dialog (How to play, the Game
 * record) keeps its own focus. Nothing dismisses the card but a legal choice. Once it is answered
 * the card is gone, and focus that fell to the page goes to the card that replaced it.
 */
function useProtectedFocus(card: RefObject<HTMLElement | null>, protect: boolean) {
  useEffect(() => {
    const root = card.current;
    if (!protect || !root) return;
    const into = () =>
      (
        root.querySelector<HTMLElement>('[data-primary]:not(:disabled)') ??
        focusables(root)[0] ??
        root
      ).focus();
    if (!root.contains(document.activeElement)) into();
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || root.contains(target)) return;
      if (target.closest('dialog[open]')) return;
      into();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      queueMicrotask(() => {
        if (root.isConnected) return;
        const active = document.activeElement;
        if (active && active !== document.body) return;
        document.querySelector<HTMLElement>('.decision-card')?.focus();
      });
    };
  }, [card, protect]);
}

/**
 * A preview that opens inside a long card (an item, an Ability, a challenge, a reward) is brought
 * into view when it appears, its Confirm last, so the Confirm is never left below the card's fold.
 */
export function useInView<T extends HTMLElement>(key: unknown): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const preview = ref.current;
    if (key === undefined || key === null || !preview) return;
    preview.scrollIntoView?.({ block: 'nearest' });
    preview.querySelector('[data-primary]')?.scrollIntoView?.({ block: 'nearest' });
  }, [key]);
  return ref;
}

export interface DecisionCardProps {
  /** Which decision this is, for styling and tests (`data-card`). */
  kind: string;
  heading: ReactNode;
  /** One line under the heading: what to do now. */
  lead?: ReactNode;
  /** Announce the lead as an alert (a failed rival turn) instead of a status. */
  alert?: boolean;
  /** A picture beside the heading, such as the wild Pokémon. */
  art?: ReactNode;
  /** A strip between the heading and the body, such as what passing Start gave. */
  banner?: ReactNode;
  /** What the decision needs; scrolls inside the card when it is long. */
  children?: ReactNode;
  /** The primary action and its alternative: always in view, never scrolled away. */
  actions?: ReactNode;
  /** Encounter and Sell: focus moves in and stays until a legal choice is made. */
  protect?: boolean;
}

/**
 * The one decision slot under the seat rows (spec §3, Board screen; issue #256): a heading, one
 * line, the body that scrolls in place, and a footer with the primary action and its skip or keep
 * alternative that never scrolls out of view. Enter presses the primary action.
 */
export function DecisionCard({
  kind,
  heading,
  lead,
  alert = false,
  art,
  banner,
  children,
  actions,
  protect = false,
}: DecisionCardProps) {
  const { live, notices, trailing } = useContext(CardFrameContext);
  const card = useRef<HTMLElement>(null);
  const headingId = useId();
  usePrimaryKey(card, live);
  useProtectedFocus(card, live && protect);
  return (
    <section
      ref={card}
      className="decision-card panel"
      data-card={kind}
      data-protected={protect ? 'true' : undefined}
      aria-labelledby={headingId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (!live || !protect || event.key !== 'Tab') return;
        const items = focusables(event.currentTarget);
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <header className="decision-head">
        {art !== undefined && <div className="decision-art">{art}</div>}
        <div className="decision-titles">
          <h2 id={headingId}>{heading}</h2>
          {lead !== undefined && (
            <p className="decision-lead" role={alert ? 'alert' : 'status'}>
              {lead}
            </p>
          )}
        </div>
      </header>
      {banner}
      <div className="decision-body">
        {notices}
        {children}
        {trailing}
      </div>
      {actions && (
        <div className="decision-actions" role="group" aria-label={t('card.actions')}>
          {actions}
        </div>
      )}
    </section>
  );
}

/**
 * Greyed-out options folded into one line ("2 items can't be used now") that opens in place to
 * each option and the engine's exact reason (spec §3.1: an unusable button says why).
 */
export function Folded({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="folded" data-open={open ? 'true' : undefined}>
      <button
        type="button"
        className="folded-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
      >
        <span>{label}</span>
        <svg className="folded-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M6 3.5l4.5 4.5L6 12.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="folded-body" id={bodyId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/** The fold's line for `count` greyed-out options of one kind. */
export function foldLabel(
  count: number,
  kind: 'items' | 'offers' | 'abilities' | 'challenges' | 'options' | 'deals',
): string {
  return count === 1 ? t(`fold.${kind}One`) : t(`fold.${kind}Many`, { count });
}
