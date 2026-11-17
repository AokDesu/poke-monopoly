import { protectsPvpCoinLoss } from './classes.ts';
import type { AttackAttempt, EngineEvent, GameState, Player } from './contract/schema.ts';
import { publicRevision } from './revision.ts';

type ArmedShield = NonNullable<Player['armedShield']>;
type HostileSource = 'hostile_item' | 'hostile_ability';
export type CoinLossSource = 'pvp_coin_loss' | 'gym_coin_loss';

/** Arm one shield; callers check D7's one-armed-shield legality before calling. */
export function armShield(owner: Player, shield: ArmedShield): EngineEvent[] {
  if (owner.armedShield) throw new RangeError('A shield is already armed');
  owner.armedShield = { ...shield };
  return [{ kind: 'shield_armed', ownerId: owner.actorId, ...shield }];
}

/** Append one canonical directed attempt (§4.4 attack counting, §4.8 evidence). */
export function recordAttackAttempt(
  next: GameState,
  actorId: string,
  targetId: string,
  source: AttackAttempt['source'],
  attackId: string,
): AttackAttempt {
  const attempt: AttackAttempt = {
    kind: 'attack_attempt',
    attackId,
    actorId,
    targetId,
    source,
    actionSeq: next.stateRevision,
    globalTurnNo: next.globalTurnNo,
  };
  (next.attackHistory ??= []).push(attempt);
  return structuredClone(attempt);
}

/**
 * A hostile item or Ability always counts as an attack, then an armed Price Shield on the target
 * blocks the whole action and is consumed (Appendix C.4 D6). Costs stay spent (D10).
 */
export function declareHostileAction(
  next: GameState,
  actor: Player,
  target: Player,
  source: HostileSource,
): { blocked: boolean; events: EngineEvent[] } {
  const attackId = `${source === 'hostile_item' ? 'hostile' : 'ability'}:${publicRevision(next)}`;
  const events: EngineEvent[] = [
    recordAttackAttempt(next, actor.actorId, target.actorId, source, attackId),
  ];
  if (target.armedShield?.scope !== 'price') return { blocked: false, events };
  delete target.armedShield;
  events.push({
    kind: 'protection_applied',
    actorId: actor.actorId,
    targetId: target.actorId,
    actionId: attackId,
    source,
    protection: 'price',
  });
  return { blocked: true, events };
}

/** Which protection, if any, would prevent this coin loss; Nurse Joy's passive comes first (D7). */
export function coinLossProtection(
  state: GameState,
  loser: Player,
  source: CoinLossSource,
): 'nurse_joy' | ArmedShield['scope'] | undefined {
  if (source === 'pvp_coin_loss' && protectsPvpCoinLoss(state.content, loser.classId)) {
    return 'nurse_joy';
  }
  const scope = loser.armedShield?.scope;
  if (scope === 'battle_coin_loss') return scope;
  if (scope === 'price' && source === 'pvp_coin_loss') return scope;
}

/**
 * Coin-loss-only protection (C.4 case 3): the battle still happened; the loser pays 0 and the
 * winner receives 0. Only an actual loss of coins consumes a shield, and never Nurse Joy's.
 */
export function applyCoinLossProtection(
  next: GameState,
  loser: Player,
  context: { actorId: string; actionId: string; source: CoinLossSource; amount: number },
): { blocked: boolean; events: EngineEvent[] } {
  if (context.amount <= 0) return { blocked: false, events: [] };
  const protection = coinLossProtection(next, loser, context.source);
  if (!protection) return { blocked: false, events: [] };
  if (protection !== 'nurse_joy') delete loser.armedShield;
  return {
    blocked: true,
    events: [
      {
        kind: 'protection_applied',
        actorId: context.actorId,
        targetId: loser.actorId,
        actionId: context.actionId,
        source: context.source,
        protection,
      },
    ],
  };
}
