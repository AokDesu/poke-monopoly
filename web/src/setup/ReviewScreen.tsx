import type { GameSetup } from '../game/setup.ts';
import { MODES } from '../game/store.ts';
import { className, speciesName } from '../i18n/names.ts';
import { t } from '../i18n/en.ts';
import { Button } from '../ui/Button.tsx';
import { DieIcon } from '../ui/icons.tsx';
import { Screen } from '../ui/Screen.tsx';
import { SpeciesArt } from '../ui/SpeciesArt.tsx';
import { SetupProgress } from './SetupProgress.tsx';

interface ReviewScreenProps {
  setup: GameSetup;
  /** Set when the engine refused to create a game from this setup. */
  failed: boolean;
  onRoll: () => void;
  onBack: () => void;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-panel-tint px-3 py-0.5 text-sm font-bold shadow-[inset_0_0_0_2px_var(--color-line)]">
      {children}
    </span>
  );
}

/**
 * The whole setup before the roll (spec §3): mode, then every seat in seat order. Rolling creates
 * the game through the engine and makes the human's first-player roll in the same click.
 */
export function ReviewScreen({ setup, failed, onRoll, onBack }: ReviewScreenProps) {
  const seats = [
    { label: t('seat.you'), choice: setup.human, opponent: undefined },
    ...setup.opponents.map((opponent) => ({ label: t('seat.ai'), choice: opponent, opponent })),
  ];
  return (
    <Screen
      before={<SetupProgress step="review" />}
      heading={t('review.heading')}
      body={t('review.body')}
      actions={
        <>
          <Button variant="secondary" onClick={onBack}>
            {t('nav.back')}
          </Button>
          <Button variant="primary" className="ms-auto" onClick={onRoll}>
            <DieIcon className="size-6" />
            {t('review.roll')}
          </Button>
        </>
      }
    >
      {failed && (
        <p role="alert" className="panel mb-6 p-5 font-bold text-action">
          {t('review.startFailed')}
        </p>
      )}
      <div className="panel flex items-center gap-4 p-5">
        <span className="medal size-16">
          <span className="text-3xl">{MODES[setup.mode].lapTarget}</span>
          <span className="-mt-2 text-xs">{t('mode.lapsUnit')}</span>
        </span>
        <span>
          <span className="block text-sm font-bold text-ink-soft">{t('review.mode')}</span>
          <span className="font-display text-2xl font-semibold">{t(`mode.${setup.mode}`)}</span>
        </span>
      </div>
      <h2 className="mt-10 text-2xl">{t('review.seats')}</h2>
      <ol className="mt-4 grid gap-6 lg:grid-cols-2">
        {seats.map(({ label, choice, opponent }) => (
          <li key={label + choice.classId} className="panel flex flex-wrap items-center gap-4 p-5">
            <SpeciesArt speciesIds={[choice.starterSpeciesId]} />
            <span className="flex min-w-[12rem] flex-1 flex-col gap-1">
              <span className="text-sm font-bold text-ink-soft">{label}</span>
              <span className="font-display text-2xl font-semibold">
                {className(choice.classId)}
              </span>
              <span>
                {t('class.starter')}: {speciesName(choice.starterSpeciesId)}
              </span>
              {opponent && (
                <span className="mt-1 flex flex-wrap gap-2">
                  <Chip>
                    {t('opponents.personality')}: {t(`personality.${opponent.personality}`)}
                  </Chip>
                  <Chip>
                    {t('opponents.difficulty')}: {t(`difficulty.${opponent.difficulty}`)}
                  </Chip>
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </Screen>
  );
}
