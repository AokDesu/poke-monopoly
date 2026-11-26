import { useId, useState } from 'react';
import { seatLabel } from '../board/labels.ts';
import {
  classConflicts,
  classHolder,
  MAX_RIVALS,
  maxRivals,
  maxWatchAis,
  WATCH_MAX_AIS,
  WATCH_MIN_AIS,
  withRivalCount,
  type ClassOption,
  type OpponentChoice,
  type SeatChoice,
} from '../game/setup.ts';
import { className } from '../i18n/names.ts';
import { t } from '../i18n/en.ts';
import { Button } from '../ui/Button.tsx';
import { ChoiceRadio } from '../ui/Choice.tsx';
import { DisabledReason } from '../ui/DisabledReason.tsx';
import { DieIcon } from '../ui/icons.tsx';
import { Screen } from '../ui/Screen.tsx';
import { RivalEditor, Section } from './RivalEditor.tsx';
import { SetupProgress } from './SetupProgress.tsx';

interface OpponentScreenProps {
  classes: readonly ClassOption[];
  /** The player's own choice; absent in a watched game, where every seat is an AI (spec §3). */
  human?: SeatChoice;
  /** The AIs set up so far; empty only when no open class is left for one. */
  rivals: readonly OpponentChoice[];
  onChange: (rivals: readonly OpponentChoice[]) => void;
  /** Watch only: fills every AI at random and keeps their number. */
  onRandomAll?: () => void;
  onNext: () => void;
  onBack: () => void;
}

const RIVAL_TEXT = {
  count: 'opponents.count',
  editing: 'opponents.editing',
  class: 'opponents.class',
  starter: 'opponents.starter',
  noFreeClass: 'opponents.noFreeClass',
} as const;

const WATCH_TEXT = {
  count: 'watchSetup.count',
  editing: 'watchSetup.editing',
  class: 'watchSetup.class',
  starter: 'watchSetup.starter',
  noFreeClass: 'watchSetup.noFreeClass',
} as const;

/**
 * The AI rivals (spec §1, §3): how many (one to three), then each rival's class, Starter,
 * personality and difficulty, one rival at a time. Rival n is seat n and a choice changes only
 * that rival. Classes are unique in a game, so a class another player has is greyed with the
 * reason; one that repeats after Back changed the human's class is flagged and must be changed.
 */
export function OpponentScreen({
  classes,
  human,
  rivals,
  onChange,
  onRandomAll,
  onNext,
  onBack,
}: OpponentScreenProps) {
  const reasonId = useId();
  // Without a human the AIs hold seats 0 and up and nobody is "You" (spec §3 watch path).
  const watch = human === undefined;
  const label = (index: number) => seatLabel(index + (watch ? 0 : 1), watch ? undefined : 0);
  const text = watch ? WATCH_TEXT : RIVAL_TEXT;
  const counts = watch
    ? Array.from({ length: WATCH_MAX_AIS - WATCH_MIN_AIS + 1 }, (_, index) => index + WATCH_MIN_AIS)
    : Array.from({ length: MAX_RIVALS }, (_, index) => index + 1);
  // A rival that repeats a class after Back is the one to open on.
  const [editing, setEditing] = useState(() => classConflicts(human, rivals)[0] ?? 0);
  const playable = classes.filter((option) => option.playable);
  const most = watch ? maxWatchAis(classes) : maxRivals(classes);
  const at = Math.min(editing, rivals.length - 1);
  const rival = rivals[at];
  const conflicts = classConflicts(human, rivals);
  const blocked =
    rivals.length < (watch ? WATCH_MIN_AIS : 1)
      ? t(text.noFreeClass)
      : conflicts[0] !== undefined
        ? t('opponents.fixClass', { rival: label(conflicts[0]) })
        : undefined;
  const update = (patch: Partial<OpponentChoice>) =>
    onChange(rivals.map((entry, index) => (index === at ? { ...entry, ...patch } : entry)));

  return (
    <Screen
      before={
        watch ? <SetupProgress flow="watch" step="ais" /> : <SetupProgress step="opponents" />
      }
      heading={t(watch ? 'watchSetup.heading' : 'opponents.heading')}
      body={t(watch ? 'watchSetup.body' : 'opponents.body')}
      actions={
        <>
          <Button variant="secondary" onClick={onBack}>
            {t('nav.back')}
          </Button>
          <Button
            variant="primary"
            className="ms-auto"
            disabled={blocked !== undefined}
            aria-describedby={blocked ? reasonId : undefined}
            onClick={onNext}
          >
            {t(watch ? 'watchSetup.next' : 'opponents.next')}
          </Button>
          {blocked && (
            <span className="basis-full text-end">
              <DisabledReason id={reasonId}>{blocked}</DisabledReason>
            </span>
          )}
        </>
      }
    >
      <Section title={t(text.count)}>
        <ul className="grid gap-4 sm:grid-cols-3">
          {counts.map((count) => (
            <li key={count}>
              <ChoiceRadio
                name="rival-count"
                value={String(count)}
                checked={rivals.length === count}
                title={
                  watch
                    ? t('watchSetup.countMany', { n: count })
                    : count === 1
                      ? t('opponents.countOne')
                      : t('opponents.countMany', { n: count })
                }
                description={
                  watch
                    ? t('watchSetup.seats', { n: count })
                    : t('opponents.players', { n: count + 1 })
                }
                disabledReason={
                  count > most
                    ? t(watch ? 'watchSetup.countClosed' : 'opponents.countClosed', {
                        open: playable.length,
                        max: most,
                      })
                    : undefined
                }
                onSelect={() => {
                  const next = withRivalCount(classes, human, rivals, count);
                  if (!next) return;
                  onChange(next);
                  // A rival just added is the one to set up next.
                  if (count > rivals.length) setEditing(count - 1);
                }}
              />
            </li>
          ))}
        </ul>
        {onRandomAll && (
          <div className="mt-6">
            <Button variant="reward" onClick={onRandomAll}>
              <DieIcon className="size-6" />
              {t('watchSetup.randomAll')}
            </Button>
            <p className="mt-2 text-sm text-ink-soft">{t('watchSetup.randomAllHint')}</p>
          </div>
        )}
      </Section>

      {rival && (
        <div key={at} className="mt-12">
          {rivals.length > 1 && (
            <fieldset className="mb-8">
              <legend className="font-display text-xl font-semibold">{t(text.editing)}</legend>
              <div className="mt-4 flex flex-wrap gap-3">
                {rivals.map((entry, index) => (
                  <label
                    key={index}
                    className={`flex cursor-pointer flex-col rounded-2xl px-5 py-2 font-display transition-[box-shadow,background-color] duration-150 has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ink ${
                      index === at
                        ? 'bg-reward shadow-[0_4px_0_var(--color-reward-lip)]'
                        : 'bg-panel-tint shadow-[inset_0_0_0_2px_var(--color-line)] hover:shadow-[inset_0_0_0_2px_var(--color-reward)]'
                    }`}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      name="rival-editing"
                      value={index}
                      checked={index === at}
                      onChange={() => setEditing(index)}
                    />
                    <span className="text-lg">{label(index)}</span>
                    <span className="text-sm font-normal">{className(entry.classId)}</span>
                    {conflicts.includes(index) && (
                      <span className="text-sm font-bold underline decoration-2 underline-offset-2">
                        {t('opponents.needsClass')}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <h2 className="text-2xl">{label(at)}</h2>

          <RivalEditor
            name={`rival-${at}`}
            rival={rival}
            classes={classes}
            holderOf={(classId) => {
              const holder = classHolder(human, rivals, classId, at);
              return holder === undefined
                ? undefined
                : holder === 'human'
                  ? t('seat.you')
                  : label(holder);
            }}
            classTitle={t(text.class)}
            starterTitle={t(text.starter)}
            onChange={update}
          />
        </div>
      )}
    </Screen>
  );
}
