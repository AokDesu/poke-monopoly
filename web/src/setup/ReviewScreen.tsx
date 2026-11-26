import { seatLabel } from '../board/labels.ts';
import type { GameSetup, TableSetup, WatchSetup } from '../game/setup.ts';
import { MODES } from '../game/store.ts';
import { className, speciesName } from '../i18n/names.ts';
import { t } from '../i18n/en.ts';
import { Button } from '../ui/Button.tsx';
import { DieIcon } from '../ui/icons.tsx';
import { Screen } from '../ui/Screen.tsx';
import { SpeciesArt } from '../ui/SpeciesArt.tsx';
import { SetupProgress } from './SetupProgress.tsx';

interface ReviewScreenProps {
  /** A watched game has `ais` and no human seat; a table of people has `seats` (spec §3). */
  setup: GameSetup | WatchSetup | TableSetup;
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
 * The whole setup before the first roll (spec §3): mode, then every seat in seat order. Starting
 * creates the game through the engine and makes the first-player roll in the same click: the
 * human's own, or in a watched game every AI's.
 */
export function ReviewScreen({ setup, failed, onRoll, onBack }: ReviewScreenProps) {
  const watch = 'ais' in setup;
  const table = 'seats' in setup;
  const seats = table
    ? setup.seats.map((seat, index) => ({
        label: seat.kind === 'person' ? seat.name : seatLabel(index, undefined),
        choice: seat.choice,
        opponent: seat.kind === 'ai' ? seat.choice : undefined,
        person: seat.kind === 'person',
      }))
    : watch
      ? setup.ais.map((opponent, index) => ({
          label: seatLabel(index, undefined),
          choice: opponent,
          opponent,
          person: false,
        }))
      : [
          { label: t('seat.you'), choice: setup.human, opponent: undefined, person: false },
          ...setup.opponents.map((opponent, index) => ({
            label: seatLabel(index + 1, 0),
            choice: opponent,
            opponent,
            person: false,
          })),
        ];
  return (
    <Screen
      before={
        table ? (
          <SetupProgress flow="people" step="review" />
        ) : watch ? (
          <SetupProgress flow="watch" step="review" />
        ) : (
          <SetupProgress step="review" />
        )
      }
      heading={t(table ? 'peopleReview.heading' : watch ? 'watchReview.heading' : 'review.heading')}
      body={t(table ? 'peopleReview.body' : watch ? 'watchReview.body' : 'review.body')}
      actions={
        <>
          <Button variant="secondary" onClick={onBack}>
            {t('nav.back')}
          </Button>
          <Button variant="primary" className="ms-auto" onClick={onRoll}>
            <DieIcon className="size-6" />
            {t(table ? 'peopleReview.roll' : watch ? 'watchReview.start' : 'review.roll')}
          </Button>
        </>
      }
    >
      {failed && (
        <p role="alert" className="panel mb-6 p-5 font-bold text-action">
          {t(watch ? 'watchReview.startFailed' : 'review.startFailed')}
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
      {watch && (
        <>
          <h2 className="mt-10 text-2xl">{t('watchReview.settings')}</h2>
          <p className="mt-4 flex flex-wrap gap-2">
            <Chip>
              {t('watchReview.talk')}:{' '}
              {t(setup.settings.talk ? 'watchReview.on' : 'watchReview.off')}
            </Chip>
            <Chip>
              {t('watchReview.pace')}: {t(`pace.${setup.settings.pace}`)}
            </Chip>
          </p>
        </>
      )}
      <h2 className="mt-10 text-2xl">{t(watch ? 'watchReview.seats' : 'review.seats')}</h2>
      <ol className="mt-4 grid gap-6 lg:grid-cols-2">
        {seats.map(({ label, choice, opponent, person }) => (
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
              {person && (
                <span className="mt-1 flex flex-wrap gap-2">
                  <Chip>{t('peopleReview.person')}</Chip>
                </span>
              )}
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
