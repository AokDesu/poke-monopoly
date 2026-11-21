import type { GameState } from './contract/schema.ts';

/**
 * The accepted-record count visible to spectators (§4.1, §4.8, §6.3). Private chats, promise
 * records and passed Pickpocket reactions must leave no gaps in instance, battle, roll or attack IDs.
 */
export function publicRevision(state: GameState): number {
  return (
    state.stateRevision -
    (state.chatsSent ?? 0) -
    (state.promiseRecords ?? 0) -
    (state.pickpocketPassRecords ?? 0)
  );
}
