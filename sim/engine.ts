import { toEngineContent } from '../content/schema.ts';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  legalActions,
  observe,
  winner,
} from '../engine/index.ts';
import { loadContent } from './content.ts';
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
