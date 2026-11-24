import { positionOf } from './contract/position.ts';
import type {
  BallPouch,
  Content,
  GameState,
  ItemInstance,
  Observation,
  Player,
} from './contract/schema.ts';
import { legalActions } from './contract/stubs.ts';
import { createRng, int, shuffle, type RngState } from './rng.ts';
import { EVENT_IDS } from './events.ts';
import { createGameConfig } from './versions.ts';

/**
 * Priors for what an observation cannot show (spec §5.6 Hard). These are rollout assumptions, not
 * game rules; they are the only numbers the sampler invents.
 */
export const BELIEF_CONFIG = Object.freeze({
  /** Poké Balls every seat starts with (§4.1); a sample never gives an opponent more than this plus a class Ball. */
  startingPokeBalls: 5,
  /** Share of an opponent's own turns assumed to have spent one Ball (about the sim's attempts per turn). */
  ballSpentPerTurn: 0.3,
});

type Rng = { rng: RngState };

function below(box: Rng, n: number, purpose: string): number {
  const draw = int(box.rng, n, purpose);
  box.rng = draw.rng;
  return draw.value;
}

/**
 * An opponent's Balls, from known information only: the starting kit, minus one Ball for each of its
 * past turns with probability `ballSpentPerTurn`. Great and Ultra Balls are held only when the
 * seat's class item is one (§4.1); purchases and catches are not observable and are not guessed.
 */
function sampleBalls(box: Rng, content: Content, shown: Observation['public']['players'][number]) {
  const kit = content.items.find(
    (item) => item.id === content.classes.find((entry) => entry.id === shown.classId)?.classItemId,
  );
  const balls: BallPouch = { poke: BELIEF_CONFIG.startingPokeBalls, great: 0, ultra: 0 };
  if (kit?.kind === 'ball') balls[kit.ballType]++;
  const scale = 1000;
  const chance = Math.round(BELIEF_CONFIG.ballSpentPerTurn * scale);
  let spent = 0;
  for (let turn = 0; turn < shown.ownTurnNo; turn++) {
    if (below(box, scale, 'belief:ball') < chance) spent++;
  }
  balls.poke = Math.max(0, balls.poke - spent);
  return balls;
}

/** The secret items an opponent holds but the table has not seen: uniform over utility items. */
function sampleSecretItems(
  box: Rng,
  content: Content,
  seatIndex: number,
  count: number,
): ItemInstance[] {
  const pool = content.items.filter((item) => item.kind === 'utility');
  return Array.from({ length: count }, (_, index) => {
    const item = pool[below(box, pool.length, 'belief:item')]!;
    return {
      instanceId: `belief-item:${seatIndex}:${index}`,
      itemId: item.id,
      name: item.name,
      visibility: 'secret' as const,
    };
  });
}

/**
 * What the deciding seat knows about itself that its observation does not carry, found by
 * `matchOwnState`: the turn budgets it has left and whether its Rival force is spent this Lap.
 */
export type OwnHints = {
  budgets?: Partial<GameState['turnBudgets']>;
  forcePvpUsed?: boolean;
};

/**
 * Spec §5.6 Hard, §8: one possible table consistent with `observation`. Everything the seat can see
 * is copied; everything it cannot (the game seed and RNG, the Event deck order, opponents' Balls and
 * secret items, other seats' private results) is drawn from `seed` and from the observation's own
 * information. The function takes an observation, never a `GameState`, so it cannot read the real
 * deck or seed. Content is the game's public data.
 *
 * Mid-turn budgets and effects, other seats' pending slows and shields, promises and trust between
 * other seats are not observable and start fresh; a seat's own budgets are chosen by the caller
 * through `hints` so the sample offers the same legal actions the seat has.
 */
export function sampleBelief(
  observation: Observation,
  content: Content,
  seed: number | string,
  hints: OwnHints = {},
): GameState {
  const budgets = hints.budgets ?? {};
  const { public: table, own } = observation;
  const box: Rng = { rng: createRng(`belief:${seed}`) };
  const squares = table.board.length;
  const social = own.chats !== undefined;
  const config = createGameConfig({
    seats: table.players.map((player) => ({
      actorId: player.actorId,
      seatIndex: player.seatIndex,
      classId: player.classId,
      controller: 'ai' as const,
    })),
    seed: `belief:${seed}`,
    lapTarget: table.lapTarget,
    ...(social && { socialWindow: true }),
  });
  const players: Player[] = table.players.map((shown) => {
    const mine = shown.seatIndex === own.seatIndex;
    const secret = shown.itemCount - shown.knownItems.length;
    return {
      actorId: shown.actorId,
      seatIndex: shown.seatIndex,
      classId: shown.classId,
      coins: shown.coins,
      // Start income is paid once per credited Lap, so progress is rebuilt from it and the square.
      routeProgress: shown.creditedLap * squares + positionOf(shown.position),
      creditedLap: shown.creditedLap,
      highestRewardedMilestone: shown.creditedLap,
      ownTurnNo: shown.ownTurnNo,
      team: structuredClone(shown.team),
      balls: mine ? { ...own.balls } : sampleBalls(box, content, shown),
      items: mine
        ? structuredClone(own.items)
        : [
            ...structuredClone(shown.knownItems),
            ...sampleSecretItems(box, content, shown.seatIndex, Math.max(0, secret)),
          ],
      ...(shown.armedShield && { armedShield: shown.armedShield }),
      ...(mine && own.armedShield && { armedShield: own.armedShield }),
      ...(mine && hints.forcePvpUsed && { forcePvpUsedLap: shown.creditedLap }),
      badges: shown.badges,
      abilityUsedGlobalTurnNo: shown.abilityReady ? null : table.globalTurnNo,
      privateResults: mine ? structuredClone(own.privateResults) : [],
    };
  });
  const deck = shuffle(
    box.rng,
    (content.events ?? EVENT_IDS.map((id) => ({ id }))).map((event) => event.id),
    'belief:events',
  );
  box.rng = deck.rng;
  return {
    config,
    content,
    stateRevision: table.stateRevision,
    globalTurnNo: table.globalTurnNo,
    activeSeatIndex: table.activeSeatIndex,
    players,
    phase: structuredClone(table.phase),
    turnBudgets: {
      tacticalAction: budgets.tacticalAction ?? 1,
      catchAttempt: budgets.catchAttempt ?? 1,
      pokemonAbility: budgets.pokemonAbility ?? 1,
      ...(social && { socialInteraction: budgets.socialInteraction ?? 1 }),
    },
    ...(own.pendingResponse && { pendingResponse: structuredClone(own.pendingResponse) }),
    finalTableRound: table.finalTableRound ? { ...table.finalTableRound } : null,
    rng: box.rng,
    eventDeck: { drawPile: deck.value, discardPile: [] },
    // The global `actionSeq` is not observable (it counts hidden chats, §4.8); order stands in for it.
    ...(table.attackHistory && {
      attackHistory: table.attackHistory.map((attempt, index) => ({
        ...attempt,
        actionSeq: index + 1,
      })),
    }),
    ...(table.lastEvent && { lastEvent: structuredClone(table.lastEvent) }),
    ...(own.lastEventReward && { lastEventReward: structuredClone(own.lastEventReward) }),
  };
}

/**
 * The own-state hints under which a sampled world offers exactly the legal actions the seat has
 * now, or `undefined` when none does. A seat's spent budgets (an item or Ability already used this
 * turn) and a used Rival force are not in its observation, but its own legal action list shows them.
 */
export function matchOwnState(
  observation: Observation,
  content: Content,
  enabledIds: readonly string[],
): OwnHints | undefined {
  const wanted = [...enabledIds].sort().join('\n');
  const social = observation.own.chats !== undefined;
  const flags = [1, 0] as const;
  for (const forcePvpUsed of [false, true]) {
    for (const tacticalAction of flags) {
      for (const catchAttempt of flags) {
        for (const pokemonAbility of flags) {
          for (const socialInteraction of social ? flags : [1 as const]) {
            const hints: OwnHints = {
              budgets: { tacticalAction, catchAttempt, pokemonAbility, socialInteraction },
              forcePvpUsed,
            };
            try {
              const probe = sampleBelief(observation, content, 'hints', hints);
              const ids = legalActions(probe, observation.own.seatIndex).enabled.map(
                (action) => action.id,
              );
              if (ids.sort().join('\n') === wanted) return hints;
            } catch {
              // A candidate the engine cannot evaluate is simply not a match.
            }
          }
        }
      }
    }
  }
  return undefined;
}
