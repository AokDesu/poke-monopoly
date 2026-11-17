import { phaseLabel, seatLabel } from './board/labels.ts';
import { classOptions } from './game/content.ts';
import { PERSONALITIES } from './game/setup.ts';
import type { SavedRival, SaveSummary } from './game/save.ts';
import { className } from './i18n/names.ts';
import { t } from './i18n/en.ts';
import { Button } from './ui/Button.tsx';
import { Screen } from './ui/Screen.tsx';

/** What the saved game is waiting for, in the catalog's words. */
export function pendingLine(summary: SaveSummary): string {
  if (summary.waiting === 'finished') return t('save.pendingFinished');
  if (summary.humanSeat === undefined) return t('save.pendingWatched', { turn: summary.turn });
  if (summary.waiting === 'engine_result') return t('save.pendingRoll');
  const name =
    summary.seatIndex === summary.humanSeat
      ? t('seat.you')
      : t('board.rivalLabel', { seat: summary.seatIndex });
  return t('save.pendingDecision', { name, phase: phaseLabel(summary.phase) });
}

/**
 * One saved rival as the save kept it. Nothing is swapped quietly: a class or personality this
 * build does not open stays as saved and says so, and settings the save lacks play as Greedy on
 * Normal and say so.
 */
function rivalLine({ seatIndex, classId, settings }: SavedRival): string {
  const name = seatLabel(seatIndex, undefined);
  const rivalClass = className(classId);
  const notes = [
    classOptions.find((option) => option.id === classId)?.playable
      ? ''
      : t('save.classClosed', { class: rivalClass }),
    settings && !PERSONALITIES.find((entry) => entry.id === settings.personality)?.enabled
      ? t('save.personalityClosed', { personality: t(`personality.${settings.personality}`) })
      : '',
  ];
  const row = settings
    ? t('save.rivalRow', {
        name,
        class: rivalClass,
        personality: t(`personality.${settings.personality}`),
        difficulty: t(`difficulty.${settings.difficulty}`),
      })
    : t('save.rivalSettingsMissing', { name, class: rivalClass });
  return [row, ...notes].filter(Boolean).join(' ');
}

export type SavePromptProps =
  | {
      kind: 'continue';
      pending: string;
      /** The AI seats of the saved game, with what the save kept for each. */
      rivals?: readonly SavedRival[];
      onContinue: () => void;
      onNewGame: () => void;
    }
  | { kind: 'mismatch'; message: string; onNewGame: () => void }
  | { kind: 'unreadable'; onNewGame: () => void };

export function SavePrompt(props: SavePromptProps) {
  const title = (
    <p className="title-3d mb-5 text-5xl leading-tight sm:text-6xl">{t('app.title')}</p>
  );
  const newGame = (
    <Button variant="secondary" onClick={props.onNewGame}>
      {t('save.newGame')}
    </Button>
  );
  if (props.kind === 'mismatch') {
    return (
      <Screen
        before={title}
        heading={t('save.mismatchHeading')}
        body={t('save.mismatchNext')}
        actions={newGame}
      >
        <p role="alert" className="panel max-w-xl p-5 text-pretty">
          {props.message}
        </p>
      </Screen>
    );
  }
  if (props.kind === 'unreadable') {
    return (
      <Screen
        before={title}
        heading={t('save.mismatchHeading')}
        body={t('save.unreadable')}
        actions={newGame}
      />
    );
  }
  return (
    <Screen before={title} heading={t('save.continueHeading')} body={t('save.continueBody')}>
      <div className="grid max-w-md gap-4">
        <p role="status" className="panel p-5 font-bold text-pretty">
          {props.pending}
        </p>
        {props.rivals && props.rivals.length > 0 && (
          <section aria-labelledby="saved-rivals" className="panel p-5">
            <h2 id="saved-rivals" className="text-xl">
              {t('save.rivals')}
            </h2>
            <ul className="mt-3 grid gap-2 text-pretty">
              {props.rivals.map((rival) => (
                <li key={rival.seatIndex}>{rivalLine(rival)}</li>
              ))}
            </ul>
          </section>
        )}
        <Button variant="primary" className="w-full !min-h-16 !text-2xl" onClick={props.onContinue}>
          {t('save.continue')}
        </Button>
        <Button variant="secondary" className="w-full" onClick={props.onNewGame}>
          {t('save.newGame')}
        </Button>
      </div>
    </Screen>
  );
}
