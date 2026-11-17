import type { GameState } from './contract/schema.ts';

/**
 * The accepted-record count without chats and promise records, for every engine ID a seat may see (§4.8, §6.3):
 * instance, battle, roll and attack IDs. A chat or promise record must not shift them, or a seat outside it could
 * tell that it happened. A leaf module, so rules modules can use it without an import cycle.
 */
export function publicRevision(state: GameState): number {
  return state.stateRevision - (state.chatsSent ?? 0) - (state.promiseRecords ?? 0);
}
