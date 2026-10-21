import type { ModeId } from '../game/setup.ts';
import { MODES } from '../game/store.ts';
import type { MessageKey } from '../i18n/th.ts';
import { t } from '../i18n/th.ts';
import { Button } from '../ui/Button.tsx';
import { Screen } from '../ui/Screen.tsx';
import { TicketButton } from '../ui/Ticket.tsx';
import { SetupProgress } from './SetupProgress.tsx';

// Only a closed mode has a reason; GAME_PRESETS marks Standard closed until the playtest (§1).
const MODE_TEXT: Record<ModeId, { name: MessageKey; hint: MessageKey; closed?: MessageKey }> = {
  quick: { name: 'mode.quick', hint: 'mode.quickHint' },
  standard: { name: 'mode.standard', hint: 'mode.standardHint', closed: 'mode.standardClosed' },
};

interface ModeScreenProps {
  onChoose: (mode: ModeId) => void;
  onBack: () => void;
}

/** Quick or Standard (spec §1, §4.1): the engine's presets say which are open. */
export function ModeScreen({ onChoose, onBack }: ModeScreenProps) {
  const modes = Object.keys(MODES) as ModeId[];
  return (
    <Screen
      before={<SetupProgress step="mode" />}
      heading={t('mode.heading')}
      body={t('mode.body')}
      actions={
        <Button variant="secondary" onClick={onBack}>
          {t('nav.back')}
        </Button>
      }
    >
      <ul className="grid gap-4 sm:grid-cols-2">
        {modes.map((mode) => (
          <li key={mode}>
            <TicketButton
              title={t(MODE_TEXT[mode].name)}
              description={t(MODE_TEXT[mode].hint)}
              stub={
                <>
                  <span className="serial text-5xl">{MODES[mode].lapTarget}</span>
                  <span className="mt-2 text-sm font-bold">{t('mode.lapsUnit')}</span>
                </>
              }
              disabledReason={MODES[mode].enabled ? undefined : t(MODE_TEXT[mode].closed!)}
              onClick={() => onChoose(mode)}
            />
          </li>
        ))}
      </ul>
    </Screen>
  );
}
