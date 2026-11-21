import type { GameState } from './contract/schema.ts';

/**
 * The accepted-record count visible to spectators and seats (§4.1, §4.8, §6.3), for every engine ID a seat may see
 * (instance, battle, roll and attack IDs). Private chats, promise records, Deal Card records and passed Pickpocket
 * reactions must leave no gaps in them, or a seat outside the pair could tell that one happened. A leaf module, so
 * rules modules can use it without an import cycle.
 */
export function publicRevision(state: GameState): number {
  return (
    state.stateRevision -
    (state.chatsSent ?? 0) -
    (state.promiseRecords ?? 0) -
    (state.dealRecords ?? 0) -
    (state.pickpocketPassRecords ?? 0)
  );
}
