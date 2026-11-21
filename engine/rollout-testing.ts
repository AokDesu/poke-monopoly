import { parseContent, toEngineContent } from '../content/schema.ts';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createRng,
  int,
  legalActions,
  observe,
  pendingDecision,
  type Action,
  type Content,
  type GameState,
} from './index.ts';

/** Test support for belief and rollout tests: real content and real, randomly played games. */
export function realContent(): Content {
  return toEngineContent(
    parseContent(
      Object.fromEntries(
        Object.entries(
          import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
        ).map(([path, json]) => [path.split('/').pop()!.replace('.json', ''), json]),
      ),
    ),
  );
}

const CLASSES = ['main-character', 'rival', 'fisherman', 'nurse-joy'];

export function newGame(seed: number, seats = 2, lapTarget = 2): GameState {
  const content = realContent();
  const config = createGameConfig({
    seats: CLASSES.slice(0, seats).map((classId, seatIndex) => ({
      actorId: `player-${seatIndex}`,
      seatIndex,
      classId,
      starterSpeciesId: content.classes.find((entry) => entry.id === classId)!
        .starterSpeciesIds[0]!,
      controller: 'ai' as const,
    })),
    seed,
    lapTarget,
  });
  return createGame(config, content);
}

/** The next state of a random legal play: engine steps first, otherwise a seeded enabled choice. */
export function randomStep(state: GameState, pick: (n: number) => number): GameState {
  const automatic = advanceAutomatically(state);
  if (automatic.records.length > 0) return automatic.state;
  const decision = pendingDecision(state);
  if (!decision) return state;
  const enabled = legalActions(state, decision.seatIndex).enabled;
  const choice = enabled[pick(enabled.length)]!;
  const revision = observe(state, decision.seatIndex).public.stateRevision;
  const result = applyAction(state, {
    actorId: decision.actorId,
    actionSeq: revision + 1,
    stateRevisionBefore: revision,
    kind: choice.kind,
    payload: choice.payload,
  } as Action);
  return 'rejected' in result ? state : result.state;
}

/** Every `every`-th real decision state of one random game, up to `limit` states. */
export function decisionStates(seed: number, { seats = 2, every = 7, limit = 12 } = {}) {
  let state = newGame(seed, seats);
  let rng = createRng(`play:${seed}`);
  const pick = (n: number) => {
    const draw = int(rng, n, 'test');
    rng = draw.rng;
    return draw.value;
  };
  const found: GameState[] = [];
  for (let step = 0; step < 4000 && found.length < limit; step++) {
    if (state.phase.kind === 'finished') break;
    const decision = pendingDecision(state);
    if (
      decision &&
      step % every === 0 &&
      legalActions(state, decision.seatIndex).enabled.length > 1
    ) {
      found.push(structuredClone(state));
    }
    state = randomStep(state, pick);
  }
  return found;
}
