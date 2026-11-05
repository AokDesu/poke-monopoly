import type { GameStore, SeatView } from './store.ts';

export interface RollAttempt {
  /** The seats the engine asked to roll in this attempt: everyone first, then only tied seats. */
  readonly contenders: readonly number[];
  readonly rolls: readonly { readonly seatIndex: number; readonly value: number }[];
}

export interface FirstPlayerRoll {
  readonly attempts: readonly RollAttempt[];
  /** The seat that starts, once the engine has decided it. */
  readonly firstSeat?: number;
  /** True while the engine waits for the human seat's roll. */
  readonly humanToRoll: boolean;
}

/**
 * Reads the first-player roll (spec §3) from the human seat's view: every die result in the
 * seat's feed grouped by the attempt the engine was running. Applies no rule of its own.
 */
export function firstPlayerRoll(view: SeatView): FirstPlayerRoll {
  const attempts: { contenders: readonly number[]; rolls: RollAttempt['rolls'][number][] }[] = [];
  for (const { before, record } of view.feed) {
    const { action } = record;
    if (before.phase.kind !== 'first_player_roll' || action.kind !== 'dice_result') continue;
    const value = action.payload.value;
    if (value === undefined) continue;
    if (before.phase.rolls.length === 0) {
      attempts.push({ contenders: before.phase.contenders, rolls: [] });
    }
    attempts.at(-1)?.rolls.push({ seatIndex: before.activeSeatIndex, value });
  }
  const { phase, activeSeatIndex } = view.observation.public;
  if (phase.kind === 'first_player_roll') {
    if (phase.rolls.length === 0) attempts.push({ contenders: phase.contenders, rolls: [] });
    return {
      attempts,
      humanToRoll: view.legalActions.enabled.some((choice) => choice.kind === 'roll'),
    };
  }
  return { attempts, firstSeat: activeSeatIndex, humanToRoll: false };
}

/**
 * Apply every sole roll and engine result, including tied re-rolls, automatically (§3.1).
 * Stop once the engine picks the first player: the first turn belongs to the board.
 */
export function rollForFirstPlayer(store: GameStore): void {
  while (
    store.getView()?.observation.public.phase.kind === 'first_player_roll' &&
    store.advance({ human: true })
  );
}
