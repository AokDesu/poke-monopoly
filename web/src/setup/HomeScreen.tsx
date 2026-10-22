import { useContext, useEffect, useId, useRef } from 'react';
import { t } from '../i18n/en.ts';
import { Board3D, type BoardSpace } from '../ui/Board3D.tsx';
import { Button } from '../ui/Button.tsx';
import { DisabledReason } from '../ui/DisabledReason.tsx';
import { DieIcon } from '../ui/icons.tsx';
import { FocusHeadingContext } from '../ui/Screen.tsx';

interface HomeScreenProps {
  board: readonly BoardSpace[];
  /** False when content has too few playable classes for every seat to have its own. */
  canStart: boolean;
  onNewGame: () => void;
  onRandomAll: () => void;
}

export function HomeScreen({ board, canStart, onNewGame, onRandomAll }: HomeScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useContext(FocusHeadingContext);
  const reasonId = useId();
  const describedBy = canStart ? undefined : reasonId;

  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
  }, [focusHeading]);

  return (
    <section
      aria-labelledby="screen-heading"
      className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12"
    >
      <div className="lg:order-2">
        <Board3D board={board} />
      </div>
      <div className="lg:order-1">
        <p className="title-3d text-5xl leading-tight sm:text-6xl">{t('app.title')}</p>
        <h1
          id="screen-heading"
          ref={headingRef}
          tabIndex={-1}
          className="mt-5 text-2xl leading-snug text-balance outline-none sm:text-3xl"
        >
          {t('home.heading')}
        </h1>
        <p className="mt-3 max-w-[52ch] text-lg text-pretty text-ink-soft">{t('home.body')}</p>
        <div className="mt-8 grid max-w-md gap-5">
          <div>
            <Button
              variant="primary"
              className="w-full !min-h-16 !text-2xl"
              disabled={!canStart}
              aria-describedby={describedBy}
              onClick={onNewGame}
            >
              {t('home.newGame')}
            </Button>
            <p className="mt-2 ps-2 text-sm text-ink-soft">{t('home.newGameHint')}</p>
          </div>
          <div>
            <Button
              variant="reward"
              className="w-full"
              disabled={!canStart}
              aria-describedby={describedBy}
              onClick={onRandomAll}
            >
              <DieIcon className="size-6" />
              {t('home.randomAll')}
            </Button>
            <p className="mt-2 ps-2 text-sm text-ink-soft">{t('home.randomAllHint')}</p>
          </div>
          {!canStart && <DisabledReason id={reasonId}>{t('home.notEnoughClasses')}</DisabledReason>}
        </div>
      </div>
    </section>
  );
}
