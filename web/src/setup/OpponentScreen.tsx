import { useId, useState } from 'react';
import { seatLabel } from '../board/labels.ts';
import {
  classConflicts,
  classHolder,
  DIFFICULTIES,
  MAX_RIVALS,
  maxRivals,
  PERSONALITIES,
  withRivalCount,
  type ClassOption,
  type OpponentChoice,
  type SeatChoice,
} from '../game/setup.ts';
import { className, classPassive } from '../i18n/names.ts';
import { t } from '../i18n/en.ts';
import { Button } from '../ui/Button.tsx';
import { ChoiceRadio } from '../ui/Choice.tsx';
import { DisabledReason } from '../ui/DisabledReason.tsx';
import { Screen } from '../ui/Screen.tsx';
import { SpeciesArt } from '../ui/SpeciesArt.tsx';
import { SetupProgress } from './SetupProgress.tsx';
import { StarterFacts } from './StarterFacts.tsx';
import { StarterPicker } from './StarterPicker.tsx';

interface OpponentScreenProps {
  classes: readonly ClassOption[];
  human: SeatChoice;
  /** The rivals set up so far; empty only when no open class is left for one. */
  rivals: readonly OpponentChoice[];
  onChange: (rivals: readonly OpponentChoice[]) => void;
  onNext: () => void;
  onBack: () => void;
}

function Section({
  title,
  small = false,
  children,
}: {
  title: string;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="mt-10 first:mt-0">
      <legend className={`font-display font-semibold ${small ? 'text-xl' : 'text-2xl'}`}>
        {title}
      </legend>
      <div className="mt-4">{children}</div>
    </fieldset>
  );
}

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
  onNext,
  onBack,
}: OpponentScreenProps) {
  const reasonId = useId();
  // A rival that repeats a class after Back is the one to open on.
  const [editing, setEditing] = useState(() => classConflicts(human, rivals)[0] ?? 0);
  const playable = classes.filter((option) => option.playable);
  const most = maxRivals(classes);
  const at = Math.min(editing, rivals.length - 1);
  const rival = rivals[at];
  const rivalClass = playable.find((option) => option.id === rival?.classId);
  const conflicts = classConflicts(human, rivals);
  const blocked =
    rivals.length === 0
      ? t('opponents.noFreeClass')
      : conflicts[0] !== undefined
        ? t('opponents.fixClass', { rival: seatLabel(conflicts[0] + 1, 0) })
        : undefined;
  const update = (patch: Partial<OpponentChoice>) =>
    onChange(rivals.map((entry, index) => (index === at ? { ...entry, ...patch } : entry)));

  return (
    <Screen
      before={<SetupProgress step="opponents" />}
      heading={t('opponents.heading')}
      body={t('opponents.body')}
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
            {t('opponents.next')}
          </Button>
          {blocked && (
            <span className="basis-full text-end">
              <DisabledReason id={reasonId}>{blocked}</DisabledReason>
            </span>
          )}
        </>
      }
    >
      <Section title={t('opponents.count')}>
        <ul className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: MAX_RIVALS }, (_, index) => index + 1).map((count) => (
            <li key={count}>
              <ChoiceRadio
                name="rival-count"
                value={String(count)}
                checked={rivals.length === count}
                title={
                  count === 1 ? t('opponents.countOne') : t('opponents.countMany', { n: count })
                }
                description={t('opponents.players', { n: count + 1 })}
                disabledReason={
                  count > most
                    ? t('opponents.countClosed', { open: playable.length, max: most })
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
      </Section>

      {rival && (
        <div key={at} className="mt-12">
          {rivals.length > 1 && (
            <fieldset className="mb-8">
              <legend className="font-display text-xl font-semibold">
                {t('opponents.editing')}
              </legend>
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
                    <span className="text-lg">{seatLabel(index + 1, 0)}</span>
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
          <h2 className="text-2xl">{seatLabel(at + 1, 0)}</h2>

          <div className="mt-6">
            <Section title={t('opponents.class')} small>
              <ul className="grid gap-6 lg:grid-cols-2">
                {playable.map((option) => {
                  const holder = classHolder(human, rivals, option.id, at);
                  return (
                    <li key={option.id}>
                      <ChoiceRadio
                        name={`rival-${at}-class`}
                        value={option.id}
                        checked={rival.classId === option.id}
                        art={
                          <SpeciesArt
                            speciesIds={option.starterSpeciesIds}
                            spin={rival.classId === option.id}
                          />
                        }
                        title={className(option.id)}
                        description={classPassive(option.id)}
                        disabledReason={
                          holder === undefined
                            ? undefined
                            : t('opponents.classTaken', {
                                holder:
                                  holder === 'human' ? t('seat.you') : seatLabel(holder + 1, 0),
                              })
                        }
                        onSelect={() =>
                          update({
                            classId: option.id,
                            starterSpeciesId: option.starterSpeciesIds[0]!,
                          })
                        }
                      />
                    </li>
                  );
                })}
              </ul>
              {rivalClass && rivalClass.starterSpeciesIds.length > 1 && (
                <StarterPicker
                  name={`rival-${at}-starter`}
                  legend={t('opponents.starter')}
                  speciesIds={rivalClass.starterSpeciesIds}
                  chosen={rival.starterSpeciesId}
                  onChoose={(starterSpeciesId) => update({ starterSpeciesId })}
                />
              )}
              {rivalClass && <StarterFacts speciesId={rival.starterSpeciesId} rival />}
            </Section>

            <Section title={t('opponents.personality')} small>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {PERSONALITIES.map((entry) => (
                  <li key={entry.id}>
                    <ChoiceRadio
                      name={`rival-${at}-personality`}
                      value={entry.id}
                      checked={rival.personality === entry.id}
                      title={t(`personality.${entry.id}`)}
                      disabledReason={entry.enabled ? undefined : t('opponents.personalityClosed')}
                      onSelect={() => update({ personality: entry.id })}
                    />
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={t('opponents.difficulty')} small>
              <p className="-mt-2 mb-4 text-ink-soft">{t('opponents.difficultyHint')}</p>
              <ul className="grid gap-4 sm:grid-cols-2">
                {DIFFICULTIES.map((difficulty) => (
                  <li key={difficulty}>
                    <ChoiceRadio
                      name={`rival-${at}-difficulty`}
                      value={difficulty}
                      checked={rival.difficulty === difficulty}
                      title={t(`difficulty.${difficulty}`)}
                      description={t(`difficulty.${difficulty}Hint`)}
                      onSelect={() => update({ difficulty })}
                    />
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </div>
      )}
    </Screen>
  );
}
