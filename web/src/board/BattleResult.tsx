import type { SeatView } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { battleEventMessages } from './battleMessages.ts';
import { eventMessage } from './EventLog.tsx';
import { turnMessages } from './turnMessages.ts';

/** Coin moves that belong to a battle; other transfers (income, sales) never appear here. */
const BATTLE_COINS = ['pvp_reward', 'gym_reward', 'gym_loss'];

/**
 * What has happened in the latest PvP or Gym battle of this turn, from the accepted seat-visible
 * records alone (§6.1): the challenge, the answer, both dice, the result, any badge, and the
 * reward with the amount that actually moved. Empty when no battle began this turn.
 */
export function battleResultRows(view: SeatView): { key: string; text: string }[] {
  const { observation, feed } = view;
  const opened = feed.findLastIndex(({ record }) =>
    record.events.some(
      (event) => event.kind === 'phase_changed' && (event.to === 'pvp' || event.to === 'gym'),
    ),
  );
  if (opened < 0) return [];
  // The outcome stays beside the board until this seat's own next turn begins: the game moves on
  // by itself, and the player must still be able to read what the battle did.
  const { globalTurnNo, activeSeatIndex } = observation.public;
  if (activeSeatIndex === view.seatIndex && globalTurnNo > feed[opened]!.before.globalTurnNo) {
    return [];
  }
  return feed
    .slice(opened)
    .flatMap((entry) => [
      ...turnMessages(entry, view.seatIndex).filter(({ key }) => key.startsWith('battle.gym')),
      ...entry.record.events.flatMap((event) =>
        (event.kind === 'coin_transfer' && BATTLE_COINS.includes(event.reason)) ||
        event.kind === 'hostile_item_used'
          ? eventMessage(event, observation, entry.before)
          : battleEventMessages(event, observation, entry.before),
      ),
    ]);
}

/** The latest battle's outcome, kept on screen beside the next decision (§4.4, Appendix C). */
export function BattleResult({ view }: { view: SeatView }) {
  const rows = battleResultRows(view);
  if (rows.length === 0) return null;
  return (
    <section className="battle-result" aria-label={t('battle.result')}>
      <h3>{t('battle.result')}</h3>
      <ol>
        {rows.map((row, index) => (
          <li key={index} data-message-key={row.key}>
            {row.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
