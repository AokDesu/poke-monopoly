import { ABILITY_EFFECTS } from './abilities.ts';
import { effectiveForm } from './forms.ts';
import { isHostileItem } from './items.ts';
import type { AttackAttempt, GameState, LegalAction } from './contract/schema.ts';

/**
 * Classify a supplied enabled choice using engine rules (§4.5, §4.6, §4.8).
 * This does not check legality; callers must use legalActions(...).enabled.
 * Private reporting fact: never include it in another seat's observation or AI input.
 */
export function attackTarget(
  state: GameState,
  seatIndex: number,
  choice: LegalAction,
): { targetSeatIndex: number; source: AttackAttempt['source'] } | undefined {
  if (choice.kind === 'declare_pvp') {
    return { targetSeatIndex: choice.payload.targetSeatIndex, source: 'pvp_declaration' };
  }
  const player = state.players.find((entry) => entry.seatIndex === seatIndex);
  if (choice.kind === 'use_item' && choice.payload.targetSeatIndex !== undefined) {
    const item = player?.items.find((entry) => entry.instanceId === choice.payload.itemInstanceId);
    if (item && isHostileItem(item.itemId)) {
      return { targetSeatIndex: choice.payload.targetSeatIndex, source: 'hostile_item' };
    }
  }
  if (choice.kind === 'activate_ability' && choice.payload.targetSeatIndex !== undefined) {
    const pokemon = player?.team.find((entry) => entry.instanceId === choice.payload.instanceId);
    const effect = pokemon && effectiveForm(state.content, pokemon.speciesId).ability?.effect;
    if (effect && ABILITY_EFFECTS[effect].hostile) {
      return { targetSeatIndex: choice.payload.targetSeatIndex, source: 'hostile_ability' };
    }
  }
}
