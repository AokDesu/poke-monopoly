import { seatLabel } from '../board/labels.ts';
import {
  OPEN_RIVAL_CHOICES,
  presetProblem,
  type OpenRivalChoices,
  SETUP_PRESETS,
  type PresetProblem,
  type SetupPreset,
} from '../game/presets.ts';
import type { ClassOption, ModeId } from '../game/setup.ts';
import { t } from '../i18n/en.ts';
import { className, difficultyName, personalityName, speciesName } from '../i18n/names.ts';
import { Button } from '../ui/Button.tsx';
import { ChoiceButton } from '../ui/Choice.tsx';
import { Screen } from '../ui/Screen.tsx';

interface PresetScreenProps {
  classes: readonly ClassOption[];
  openModes: readonly ModeId[];
  /** The personalities and difficulties that are open; defaults to what setup offers. */
  choices?: OpenRivalChoices;
  /** Fills every seat and goes to the review; only called for a preset that is legal today. */
  onApply: (preset: SetupPreset) => void;
  onBack: () => void;
}

/** A Starter's name, or its id when content no longer has it: the screen must explain, not throw. */
function starterName(id: string): string {
  try {
    return speciesName(id);
  } catch {
    return id;
  }
}

/** Plain words for why a preset is off, ending with what the player can do instead. */
function problemText(problem: PresetProblem): string {
  const why = (() => {
    switch (problem.kind) {
      case 'mode':
        return problem.mode
          ? t('presets.problem.mode', { mode: t(`mode.${problem.mode}`) })
          : t('presets.problem.noMode');
      case 'class':
        return t('presets.problem.class', { class: className(problem.classId) });
      case 'starter':
        return t('presets.problem.starter', {
          class: className(problem.classId),
          starter: starterName(problem.starterSpeciesId),
        });
      case 'duplicate':
        return t('presets.problem.duplicate', { class: className(problem.classId) });
      case 'personality':
        return t('presets.problem.personality', {
          personality: personalityName(problem.personality),
        });
      case 'noPersonality':
        return t('presets.problem.noPersonality');
      case 'difficulty':
        return t('presets.problem.difficulty', { difficulty: difficultyName(problem.difficulty) });
      case 'seats':
        return t('presets.problem.seats', {
          rivals: t(problem.needed === 1 ? 'opponents.countOne' : 'opponents.countMany', {
            n: problem.needed,
          }),
          open: [
            t('presets.openNone'),
            t('presets.openOne'),
            t('presets.openMany', { n: problem.open }),
          ][Math.min(problem.open, 2)]!,
        });
    }
  })();
  return `${why} ${t('presets.problem.byHand')}`;
}

function PresetSeats({ preset }: { preset: SetupPreset }) {
  if (preset.kind === 'random') return null;
  const rows = [
    { label: t('seat.you'), text: className(preset.human.classId) },
    ...preset.rivals.map((rival, index) => ({
      label: seatLabel(index + 1, 0),
      text: [
        className(rival.classId),
        personalityName(rival.personality),
        difficultyName(rival.difficulty),
      ].join(' · '),
    })),
  ];
  return (
    <span className="mt-1 flex flex-col gap-0.5 text-sm">
      {rows.map((row) => (
        <span key={row.label}>
          <span className="font-bold">{row.label}:</span> {row.text}
        </span>
      ))}
    </span>
  );
}

/**
 * Presets for a quick start (spec §3): each one fills every seat, then the review screen shows the
 * exact choices and Back reaches the per-seat editor. A preset that is not legal today stays here,
 * greyed with the reason; it is never swapped for another arrangement.
 */
export function PresetScreen({
  classes,
  openModes,
  choices = OPEN_RIVAL_CHOICES,
  onApply,
  onBack,
}: PresetScreenProps) {
  return (
    <Screen
      heading={t('presets.heading')}
      body={t('presets.body')}
      actions={
        <Button variant="secondary" onClick={onBack}>
          {t('nav.back')}
        </Button>
      }
    >
      <ul className="grid gap-6 lg:grid-cols-2">
        {SETUP_PRESETS.map((preset) => {
          const problem = presetProblem(preset, classes, openModes, choices);
          const rivals = preset.kind === 'fixed' ? preset.rivals.length : preset.rivalCount;
          return (
            <li key={preset.id}>
              <ChoiceButton
                art={
                  <span aria-hidden="true" className="medal size-20 sm:size-24">
                    <span className="text-4xl sm:text-5xl">{rivals}</span>
                    <span className="-mt-3 text-sm">{t('presets.rivalsUnit')}</span>
                  </span>
                }
                title={t(`preset.${preset.id}.name`)}
                description={
                  <>
                    {t(`preset.${preset.id}.hint`)}
                    <PresetSeats preset={preset} />
                  </>
                }
                disabledReason={problem ? problemText(problem) : undefined}
                onClick={() => onApply(preset)}
              />
            </li>
          );
        })}
      </ul>
    </Screen>
  );
}
