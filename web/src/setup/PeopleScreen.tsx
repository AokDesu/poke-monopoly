import { useId, useState } from 'react';
import { seatLabel } from '../board/labels.ts';
import { MAX_NAME_LENGTH } from '../game/people.ts';
import {
  MAX_SEATS,
  MIN_SEATS,
  newTableAi,
  seatCounts,
  seatsProblem,
  tableClassHolder,
  type ClassOption,
  type ModeId,
  type OpponentChoice,
  type TableSeatDraft,
} from '../game/setup.ts';
import { MODES } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { className } from '../i18n/names.ts';
import { Button } from '../ui/Button.tsx';
import { DisabledReason } from '../ui/DisabledReason.tsx';
import { Screen } from '../ui/Screen.tsx';
import { RivalEditor } from './RivalEditor.tsx';
import { SetupProgress } from './SetupProgress.tsx';

interface PeopleScreenProps {
  mode: ModeId;
  classes: readonly ClassOption[];
  seats: readonly TableSeatDraft[];
  onChange: (seats: readonly TableSeatDraft[]) => void;
  onNext: () => void;
  onBack: () => void;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-panel-tint px-3 py-0.5 text-sm font-bold shadow-[inset_0_0_0_2px_var(--color-line)]">
      {children}
    </span>
  );
}

/** The defaults of a seat just switched to a person: a name that is free, no class yet. */
const newPerson = (index: number): TableSeatDraft => ({
  kind: 'person',
  name: t('people.defaultName', { n: index + 1 }),
});

/**
 * Setup with several people (spec §3, local multiplayer): one row per seat, two to four seats,
 * each a Person or an AI. A person has a name here and picks a class at the next step; an AI keeps
 * its class, personality and difficulty as chips, with Change to set it. Seat n is seat n on the
 * board. The footer counts people and AIs and says who can be talked to.
 */
export function PeopleScreen({
  mode,
  classes,
  seats,
  onChange,
  onNext,
  onBack,
}: PeopleScreenProps) {
  const reasonId = useId();
  const [editing, setEditing] = useState<number | null>(null);
  const { people, ais } = seatCounts(seats);
  const problem = seatsProblem(seats);
  const blocked = !problem
    ? undefined
    : problem.kind === 'people'
      ? t('people.needPeople')
      : problem.why === 'empty'
        ? t('people.nameEmpty', { n: problem.seat })
        : problem.why === 'long'
          ? t('people.nameLong', { n: problem.seat, max: MAX_NAME_LENGTH })
          : t('people.nameTaken', { n: problem.seat });

  const replace = (index: number, seat: TableSeatDraft) =>
    onChange(seats.map((entry, at) => (at === index ? seat : entry)));
  const switchTo = (index: number, kind: 'person' | 'ai') => {
    if (seats[index]?.kind === kind) return;
    setEditing(null);
    if (kind === 'person') return replace(index, newPerson(index));
    const choice = newTableAi(
      classes,
      seats.filter((_, at) => at !== index),
    );
    if (choice) replace(index, { kind: 'ai', choice });
  };
  const addSeat = () => {
    const choice = newTableAi(classes, seats);
    if (choice) onChange([...seats, { kind: 'ai', choice }]);
  };
  const noFreeClass = newTableAi(classes, seats) === undefined;
  const full = seats.length >= MAX_SEATS;
  const holderLabel = (classId: string, at: number) => {
    const holder = tableClassHolder(seats, classId, at);
    return holder === undefined ? undefined : seatLabel(holder, undefined);
  };
  const countText = (
    n: number,
    one: 'people.countPerson' | 'people.countAi',
    many: 'people.countPeople' | 'people.countAis',
  ) => t(n === 1 ? one : many, { n });

  return (
    <Screen
      before={<SetupProgress flow="people" step="seats" />}
      heading={t('people.heading')}
      body={t('people.body')}
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
            {t('people.next')}
          </Button>
          {blocked && (
            <span className="basis-full text-end">
              <DisabledReason id={reasonId}>{blocked}</DisabledReason>
            </span>
          )}
        </>
      }
    >
      <ol aria-label={t('people.seats')} className="grid max-w-3xl gap-4">
        {seats.map((seat, index) => {
          const kindName = `seat-${index}-kind`;
          const aiBlocked = seat.kind === 'person' && noFreeClass;
          return (
            <li key={index} className="panel p-4 sm:p-5" data-seat-row={index}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <span className="seat-disc" data-seat={index} aria-hidden="true">
                  {index}
                </span>
                <fieldset className="flex items-center gap-2">
                  <legend className="sr-only">{t('people.kind', { n: index })}</legend>
                  {(['person', 'ai'] as const).map((kind) => (
                    <label
                      key={kind}
                      className={`cursor-pointer rounded-full px-4 py-1.5 font-display font-semibold has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ink has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-60 ${
                        seat.kind === kind
                          ? 'bg-reward shadow-[0_3px_0_var(--color-reward-lip)]'
                          : 'bg-panel-tint shadow-[inset_0_0_0_2px_var(--color-line)]'
                      }`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name={kindName}
                        value={kind}
                        checked={seat.kind === kind}
                        disabled={kind === 'ai' && aiBlocked}
                        onChange={() => switchTo(index, kind)}
                      />
                      {t(kind === 'person' ? 'people.person' : 'people.ai')}
                    </label>
                  ))}
                </fieldset>
                {seats.length > MIN_SEATS && (
                  <Button
                    variant="secondary"
                    className="ms-auto"
                    aria-label={t('people.removeSeat', { n: index })}
                    onClick={() => {
                      setEditing(null);
                      onChange(seats.filter((_, at) => at !== index));
                    }}
                  >
                    {t('people.removeSeat', { n: index })}
                  </Button>
                )}
              </div>
              {aiBlocked && <DisabledReason>{t('people.noFreeClass')}</DisabledReason>}
              {seat.kind === 'person' ? (
                <div className="mt-3">
                  <label
                    className="block text-sm font-bold text-ink-soft"
                    htmlFor={`seat-${index}-name`}
                  >
                    {t('people.name', { n: index })}
                  </label>
                  <input
                    id={`seat-${index}-name`}
                    type="text"
                    autoComplete="off"
                    maxLength={40}
                    className="mt-1 w-full max-w-sm rounded-xl border-2 border-line bg-white px-3 py-2 text-lg font-bold text-ink outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    value={seat.name}
                    onChange={(event) => replace(index, { ...seat, name: event.target.value })}
                  />
                </div>
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg font-semibold">
                      {seatLabel(index, undefined)}
                    </span>
                    <Chip>{className(seat.choice.classId)}</Chip>
                    <Chip>{t(`personality.${seat.choice.personality}`)}</Chip>
                    <Chip>{t(`difficulty.${seat.choice.difficulty}`)}</Chip>
                    <Button
                      variant="secondary"
                      className="ms-auto"
                      aria-expanded={editing === index}
                      aria-label={t('people.changeFor', { n: index })}
                      onClick={() => setEditing(editing === index ? null : index)}
                    >
                      {editing === index ? t('people.done') : t('people.change')}
                    </Button>
                  </div>
                  {editing === index && (
                    <div className="mt-4 border-t border-line pt-2">
                      <h2 className="mt-4 text-xl">{t('people.editing', { n: index })}</h2>
                      <RivalEditor
                        name={`seat-${index}`}
                        rival={seat.choice}
                        classes={classes}
                        holderOf={(classId) => holderLabel(classId, index)}
                        classTitle={t('opponents.class')}
                        starterTitle={t('opponents.starter')}
                        onChange={(patch: Partial<OpponentChoice>) =>
                          replace(index, { kind: 'ai', choice: { ...seat.choice, ...patch } })
                        }
                      />
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-4 max-w-3xl">
        <Button
          variant="secondary"
          disabled={full || noFreeClass}
          aria-describedby={full || noFreeClass ? `${reasonId}-add` : undefined}
          onClick={addSeat}
        >
          {t('people.addSeat')}
        </Button>
        {(full || noFreeClass) && (
          <DisabledReason id={`${reasonId}-add`}>
            {t(full ? 'people.addSeatClosed' : 'people.noFreeClass')}
          </DisabledReason>
        )}
      </div>
      <p className="mt-8 font-display text-xl font-semibold" data-testid="people-footer">
        {t('people.footer', {
          people: countText(people, 'people.countPerson', 'people.countPeople'),
          ais: countText(ais, 'people.countAi', 'people.countAis'),
          mode: t(`mode.${mode}`),
          laps: MODES[mode].lapTarget,
        })}
      </p>
      <p className="mt-2 max-w-[62ch] text-pretty text-ink-soft">{t('people.rule')}</p>
    </Screen>
  );
}
