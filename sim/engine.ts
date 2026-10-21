import { toEngineContent } from '../content/schema.ts';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  legalActions,
  observe,
  oddsForAllBalls,
  winner,
  type GameState,
} from '../engine/index.ts';
import { loadContent } from './content.ts';
import type { PolicyFacts } from './policy.ts';
import type { SimEngine } from './runner.ts';

const parsed = loadContent();
const content = toEngineContent(parsed);
const classIds = parsed.classes.filter((entry) => !entry.stretch).map((entry) => entry.id);

/**
 * The real engine for `npm run sim`, built from `content/*.json`. The runner rotates the core
 * classes (stretch classes stay out until after G2, spec §1); a class with several Starters
 * takes them in turn once per full class rotation, so every class and seat pairing plays every
 * Starter and a single re-run gets the same Starter.
 */
export const realEngine: SimEngine = {
  classIds,
  createGame({ seed, seats, lapTarget }) {
    const config = createGameConfig({
      seats: seats.map(({ seatIndex, actorId, classId }) => {
        const starters = parsed.classes.find((entry) => entry.id === classId)!.starterSpeciesIds;
        return {
          seatIndex,
          actorId,
          classId,
          starterSpeciesId: starters[Math.floor(seed / classIds.length) % starters.length],
          controller: 'ai' as const,
        };
      }),
      seed,
      lapTarget,
    });
    return createGame(config, content);
  },
  observe,
  legalActions,
  applyAction,
  advanceAutomatically,
  facts,
  outcome(state) {
    if (state.phase.kind !== 'finished') return { finished: false };
    const winners = winner(state).winners;
    return {
      finished: true,
      winnerSeats: state.players
        .filter((player) => winners.includes(player.actorId))
        .map((player) => player.seatIndex),
    };
  },
};

/**
 * The engine's own numbers for the deciding seat (spec §5.2): catch odds from `oddsForAllBalls`,
 * and each enabled one-Pokémon sale's payout, read from the coin transfers `applyAction` reports
 * on a detached copy (the engine exports no sale quote yet). Nothing here is shown to other seats.
 */
function facts(state: GameState, seatIndex: number): PolicyFacts {
  if (seatIndex !== state.activeSeatIndex) return {};
  if (state.phase.kind === 'encounter' && !state.phase.catchRoll) {
    return {
      catchChance: Object.fromEntries(
        oddsForAllBalls(state, seatIndex).map((odds) => [odds.ballType, odds.probability]),
      ),
    };
  }
  if (state.phase.kind !== 'sell') return {};
  const actorId = state.config.seats.find((seat) => seat.seatIndex === seatIndex)!.actorId;
  const saleValue: Record<string, number> = {};
  for (const choice of legalActions(state, seatIndex).enabled) {
    if (choice.kind !== 'sell' || choice.payload.pokemonInstanceIds.length !== 1) continue;
    const result = applyAction(state, {
      actorId,
      actionSeq: state.stateRevision + 1,
      stateRevisionBefore: state.stateRevision,
      kind: choice.kind,
      payload: choice.payload,
    });
    if ('rejected' in result) continue;
    let coins = 0;
    for (const event of result.events) {
      if (event.kind === 'coin_transfer' && event.reason === 'pokemon_sale') coins += event.amount;
    }
    saleValue[choice.payload.pokemonInstanceIds[0]!] = coins;
  }
  return { saleValue };
}
