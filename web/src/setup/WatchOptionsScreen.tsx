import { TURN_SPEEDS, type TurnSpeed, type WatchSettings } from '../game/setup.ts';
import { t, type MessageKey } from '../i18n/en.ts';
import { Button } from '../ui/Button.tsx';
import { ChoiceRadio } from '../ui/Choice.tsx';
import { Screen } from '../ui/Screen.tsx';
import { SetupProgress } from './SetupProgress.tsx';

const SPEED_HINT: Record<TurnSpeed, MessageKey> = {
  normal: 'watchOptions.normalHint',
  fast: 'watchOptions.fastHint',
  instant: 'watchOptions.instantHint',
};

interface WatchOptionsScreenProps {
  settings: WatchSettings;
  onChange: (settings: WatchSettings) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * The settings of a watched game that belong to no AI (spec §3): whether the AIs talk at the
 * table, and the speed the game starts at. Both are saved with the game.
 */
export function WatchOptionsScreen({
  settings,
  onChange,
  onNext,
  onBack,
}: WatchOptionsScreenProps) {
  return (
    <Screen
      before={<SetupProgress flow="watch" step="options" />}
      heading={t('watchOptions.heading')}
      body={t('watchOptions.body')}
      actions={
        <>
          <Button variant="secondary" onClick={onBack}>
            {t('nav.back')}
          </Button>
          <Button variant="primary" className="ms-auto" onClick={onNext}>
            {t('watchOptions.next')}
          </Button>
        </>
      }
    >
      <fieldset>
        <legend className="font-display text-2xl font-semibold">{t('watchOptions.talk')}</legend>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {([true, false] as const).map((talk) => (
            <li key={String(talk)}>
              <ChoiceRadio
                name="watch-talk"
                value={String(talk)}
                checked={settings.talk === talk}
                title={t(talk ? 'watchOptions.talkOn' : 'watchOptions.talkOff')}
                description={t(talk ? 'watchOptions.talkOnHint' : 'watchOptions.talkOffHint')}
                onSelect={() => onChange({ ...settings, talk })}
              />
            </li>
          ))}
        </ul>
      </fieldset>
      <fieldset className="mt-10">
        <legend className="font-display text-2xl font-semibold">{t('watchOptions.speed')}</legend>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          {TURN_SPEEDS.map((speed) => (
            <li key={speed}>
              <ChoiceRadio
                name="watch-speed"
                value={speed}
                checked={settings.speed === speed}
                title={t(`ai.speed.${speed}`)}
                description={t(SPEED_HINT[speed])}
                onSelect={() => onChange({ ...settings, speed })}
              />
            </li>
          ))}
        </ul>
      </fieldset>
    </Screen>
  );
}
