import type { ClassOption, SeatChoice } from '../game/setup.ts';
import { className, classPassive, itemName, speciesName } from '../i18n/names.ts';
import { t } from '../i18n/th.ts';
import { Button } from '../ui/Button.tsx';
import { Screen } from '../ui/Screen.tsx';
import { TicketButton } from '../ui/Ticket.tsx';
import { SetupProgress } from './SetupProgress.tsx';

interface ClassScreenProps {
  classes: readonly ClassOption[];
  chosen?: SeatChoice;
  onChoose: (choice: SeatChoice) => void;
  onBack: () => void;
}

/**
 * The human's class and Starter in one click (spec §3, §4.1). Playable classes come from content,
 * so the Main Character and later classes appear here as soon as the engine implements them.
 */
export function ClassScreen({ classes, chosen, onChoose, onBack }: ClassScreenProps) {
  const playable = classes.filter((option) => option.playable);
  const closed = classes.filter((option) => !option.playable);
  return (
    <Screen
      before={<SetupProgress step="class" />}
      heading={t('class.heading')}
      body={t('class.body')}
      actions={
        <Button variant="secondary" onClick={onBack}>
          {t('nav.back')}
        </Button>
      }
    >
      <ul className="grid gap-4 lg:grid-cols-2">
        {playable.map((option) => {
          const selected = chosen?.classId === option.id;
          return (
            <li key={option.id}>
              <div
                className="ticket h-full"
                data-tone={selected ? 'selected' : 'plain'}
                data-narrow="stack"
              >
                <div className="ticket-body">
                  <h2 className="text-xl leading-snug font-bold">{className(option.id)}</h2>
                  <dl className="mt-1 grid gap-2 text-base">
                    <div>
                      <dt className="text-sm text-ink-soft">{t('class.passive')}</dt>
                      <dd className="text-pretty">{classPassive(option.id)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink-soft">{t('class.item')}</dt>
                      <dd>{itemName(option.classItemId)}</dd>
                    </div>
                  </dl>
                </div>
                <div className="ticket-stub !items-stretch !justify-start gap-2">
                  <p className="text-sm font-bold max-sm:basis-full">{t('class.starter')}</p>
                  {option.starterSpeciesIds.map((speciesId) => {
                    const pressed = selected && chosen?.starterSpeciesId === speciesId;
                    return (
                      <button
                        key={speciesId}
                        type="button"
                        aria-pressed={pressed}
                        className={`min-h-11 rounded-lg px-3 text-start font-bold whitespace-nowrap transition-colors duration-150 ${
                          pressed
                            ? 'bg-on-accent text-accent'
                            : selected
                              ? 'border border-on-accent-soft text-on-accent hover:bg-accent-strong'
                              : 'border border-line-strong bg-card text-ink hover:border-accent hover:bg-surface'
                        }`}
                        onClick={() =>
                          onChoose({ classId: option.id, starterSpeciesId: speciesId })
                        }
                      >
                        {speciesName(speciesId)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {closed.length > 0 && (
        <>
          <h2 className="mt-12 text-lg font-bold">{t('class.closedHeading')}</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {closed.map((option) => (
              <li key={option.id}>
                <TicketButton
                  title={className(option.id)}
                  disabledReason={t('class.comingLater')}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </Screen>
  );
}
