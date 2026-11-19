import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { tagLabel } from '../board/labels.ts';
import { speciesType } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import { speciesName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { Button } from '../ui/Button.tsx';
import { SpeciesArt } from '../ui/SpeciesArt.tsx';
import { TypeOrb } from '../ui/TypeOrb.tsx';
import { buildSteps, type HowToPlayStep, type Visual } from './steps.ts';
import './how-to-play.css';

interface HowToPlayControls {
  readonly open: boolean;
  /** Opens the walkthrough; `opener` is the control that gets focus back on Close. */
  show(opener: Element | null): void;
}

const HowToPlayContext = createContext<HowToPlayControls | null>(null);

/**
 * Holds whether the walkthrough is open. It opens only when a player presses an opener, never by
 * itself, and it changes nothing about a game: it keeps no game state of its own.
 */
export function HowToPlayProvider({
  children,
  gameWaits,
}: {
  children: ReactNode;
  /** True on the board, where the game holds its next step until the walkthrough closes. */
  gameWaits: boolean;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const show = useCallback((from: Element | null) => {
    opener.current = from instanceof HTMLElement ? from : null;
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    const from = opener.current;
    opener.current = null;
    // After the dialog is gone, so the focus does not land on a control the modal still hides.
    queueMicrotask(() => {
      if (from?.isConnected) from.focus();
    });
  }, []);
  const controls = useMemo(() => ({ open, show }), [open, show]);
  return (
    <HowToPlayContext value={controls}>
      {children}
      {open && <HowToPlay onClose={close} gameWaits={gameWaits} />}
    </HowToPlayContext>
  );
}

/** True while the walkthrough is open, so a game can hold its next automatic step. */
export function useHowToPlayOpen(): boolean {
  return useContext(HowToPlayContext)?.open ?? false;
}

/** The opener. Without a provider (the dev gallery, a fixture) there is nothing to open. */
export function HowToPlayButton({ className = '' }: { className?: string }) {
  const controls = useContext(HowToPlayContext);
  if (!controls) return null;
  return (
    <Button
      variant="secondary"
      className={`guide-open ${className}`}
      onClick={(event) => controls.show(event.currentTarget)}
    >
      {t('howToPlay.open')}
    </Button>
  );
}

function VisualView({ visual }: { visual: Visual }) {
  switch (visual.kind) {
    case 'facts':
      return (
        <ul className="guide-facts" aria-label={visual.name}>
          {visual.facts.map((fact) => (
            <li key={fact.id} data-fact={fact.id}>
              <strong>{fact.value}</strong>
              <span>{fact.label}</span>
            </li>
          ))}
        </ul>
      );
    case 'pokemon':
      return (
        <ul className="guide-pokemon" aria-label={visual.name}>
          {visual.speciesIds.map((id) => (
            <li key={id}>
              <TypeOrb type={speciesType(id)} className="size-11 shrink-0" />
              <span>
                <strong>{speciesName(id)}</strong>
                <small>{tagLabel(speciesType(id))}</small>
              </span>
            </li>
          ))}
        </ul>
      );
    case 'starters':
      return (
        <div className="guide-starters">
          <SpeciesArt speciesIds={visual.speciesIds} />
        </div>
      );
  }
}

function StepNav({
  index,
  last,
  onStep,
  onClose,
}: {
  index: number;
  last: number;
  onStep: (to: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="guide-nav">
      {index === 0 ? (
        <ActionButton
          enabled={false}
          reasonText={t('howToPlay.firstStep')}
          variant="secondary"
          data-guide="back"
        >
          {t('nav.back')}
        </ActionButton>
      ) : (
        <ActionButton
          enabled
          variant="secondary"
          data-guide="back"
          onClick={() => onStep(index - 1)}
        >
          {t('nav.back')}
        </ActionButton>
      )}
      {index >= last ? (
        <ActionButton enabled={false} reasonText={t('howToPlay.lastStep')} data-guide="next">
          {t('nav.next')}
        </ActionButton>
      ) : (
        <ActionButton enabled data-guide="next" onClick={() => onStep(index + 1)}>
          {t('nav.next')}
        </ActionButton>
      )}
      <Button variant="secondary" className="guide-close" data-guide="close" onClick={onClose}>
        {t('howToPlay.close')}
      </Button>
    </div>
  );
}

export interface HowToPlayProps {
  onClose: () => void;
  /** Says the game holds its next step while this is open; only true on the board. */
  gameWaits?: boolean;
  /** Dev gallery only: show the walkthrough in the page flow instead of as a modal. */
  inline?: boolean;
  /** Dev gallery only: the steps to show instead of the ones built from the game's content. */
  steps?: readonly HowToPlayStep[];
  /** Dev gallery only: the step the walkthrough opens on. */
  initialStep?: number;
}

/**
 * A short walkthrough of a turn and of how a game ends (spec §3). A native modal dialog: focus
 * stays inside, Escape closes it, and the opener gets focus back.
 */
export function HowToPlay({
  onClose,
  gameWaits = false,
  inline = false,
  steps: given,
  initialStep = 0,
}: HowToPlayProps) {
  const [steps] = useState<readonly HowToPlayStep[]>(() => given ?? buildSteps());
  const [index, setIndex] = useState(initialStep);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const last = steps.length - 1;
  const step = steps[index];

  useEffect(() => {
    if (inline) return;
    const element = dialog.current!;
    element.showModal();
    heading.current?.focus();
    return () => element.close();
  }, [inline]);

  // A button that has just become unavailable cannot keep focus: pass it to the one that goes on.
  const shownIndex = useRef(index);
  useEffect(() => {
    if (shownIndex.current === index) return;
    shownIndex.current = index;
    const root = dialog.current ?? heading.current?.closest('section');
    const active = document.activeElement;
    const kept =
      active instanceof HTMLElement &&
      root?.contains(active) &&
      !('disabled' in active && active.disabled);
    if (!kept)
      root
        ?.querySelector<HTMLElement>(`[data-guide="${index >= last ? 'close' : 'next'}"]`)
        ?.focus();
  }, [index, last]);

  const body = (
    <>
      <header className="guide-head">
        <h2 id={headingId} ref={heading} tabIndex={-1}>
          {t('howToPlay.heading')}
        </h2>
        {step && (
          <p className="guide-progress">
            {t('howToPlay.progress', { current: index + 1, total: steps.length })}
          </p>
        )}
      </header>
      {step && (
        <ol className="guide-bar" aria-hidden="true">
          {steps.map((entry, position) => (
            <li
              key={entry.id}
              data-state={position < index ? 'done' : position === index ? 'now' : 'next'}
            />
          ))}
        </ol>
      )}
      <div className="guide-step" aria-live="polite">
        {step ? (
          <div key={step.id} className="guide-step-body" data-step={step.id}>
            <h3>{step.title}</h3>
            {step.paragraphs.map((text) => (
              <p key={text}>{text}</p>
            ))}
            {step.visuals.length > 0 && (
              <div className="guide-visuals">
                {step.visuals.map((visual, position) => (
                  <VisualView key={position} visual={visual} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <p>{t('howToPlay.empty')}</p>
        )}
      </div>
      <StepNav index={index} last={last} onStep={setIndex} onClose={onClose} />
      {gameWaits && <p className="guide-wait">{t('howToPlay.gameWaits')}</p>}
    </>
  );

  return inline ? (
    <section className="guide panel" aria-labelledby={headingId}>
      {body}
    </section>
  ) : (
    <dialog
      ref={dialog}
      className="guide panel"
      aria-labelledby={headingId}
      // Escape asks to cancel. Not `close`: the effect's own cleanup closes the dialog too, and
      // under StrictMode that late event would shut the walkthrough straight after it opened.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {body}
    </dialog>
  );
}
