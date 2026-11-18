import type { Personality } from '../../content/personality-schema.ts';
import { toEngineContent } from '../../content/schema.ts';
import {
  createGame,
  createGameConfig,
  type GameState,
  type PokemonInstance,
} from '../../engine/index.ts';
import { CONTENT } from '../../ai/questions/content.ts';

/**
 * The four contrasts the personalities are meant to separate on (issue #233, spec §8): a hostile
 * item against skipping, forcing a PvP battle against not, selling against keeping, and the Ball
 * thrown (or releasing) at a wild Pokémon.
 */
export const CONTRAST_KINDS = ['hostile-item', 'pvp', 'sell-keep', 'ball-choice'] as const;
export type ContrastKind = (typeof CONTRAST_KINDS)[number];

/** Acceptable answers: action IDs (Strategy, Encounter) or each Pokémon's Noul answers (Sell). */
export type Acceptable =
  readonly string[] | Readonly<Record<string, readonly ('true' | 'false')[]>>;

/**
 * One recorded decision for the offline eval (spec §8, §10 C2): an engine state where seat 0, the
 * AI, faces Strategy, Encounter or Sell. The orchestrator builds the Jev request from it, so a
 * change to question wording changes the request and the fixture must be recorded again.
 */
export interface EvalScenario {
  id: string;
  description: string;
  personality: Personality;
  /** Engine state with seat 0 active. */
  build(): { state: GameState };
  /**
   * Acceptable answers chosen by a teammate: engine action IDs for Strategy and Encounter, and for
   * Sell each Pokémon instance ID's acceptable Noul answers (`true` sells it).
   */
  acceptable: Acceptable;
  /**
   * Why these answers are acceptable for this personality, citing the weights in
   * `content/personalities/<id>.json` (spec §5.5). Required for the personality scenarios
   * (issue #233); the 20 original Greedy scenarios predate it.
   */
  reason?: string;
  /** The contrast this scenario belongs to, and the table state it shares across personalities. */
  contrast?: { kind: ContrastKind; group: string; greedyTwin?: string };
}

export const content = toEngineContent(CONTENT);
/** A live current-version Quick 2 Laps game with seat 0 (the AI) active; other seats are human. */
export function game(classIds: readonly string[], seed: number): GameState {
  const state = createGame(
    createGameConfig({
      seats: classIds.map((classId, seatIndex) => ({
        classId,
        // The Main Character picks a Starter; Charmander is the eval's fixed pick.
        ...(classId === 'main-character' && { starterSpeciesId: 'charmander' }),
        actorId: `P${seatIndex + 1}`,
        seatIndex,
        controller: seatIndex === 0 ? 'ai' : 'human',
      })),
      seed,
      lapTarget: 2,
    }),
    content,
  );
  state.globalTurnNo = classIds.length * 2 + 1;
  state.players.forEach((player) => (player.ownTurnNo = player.seatIndex === 0 ? 3 : 2));
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  return state;
}

export function give(state: GameState, itemIds: readonly string[]): void {
  const player = state.players[0]!;
  for (const itemId of itemIds) {
    player.items.push({
      instanceId: `bought:0:${player.items.length}`,
      itemId,
      name: CONTENT.items.find((item) => item.id === itemId)!.name,
      visibility: 'secret',
    });
  }
}

export interface Table {
  classIds?: readonly string[];
  seed: number;
  /** Coins per seat, in seat order. */
  coins: readonly number[];
  /** Squares each seat has travelled; 24 squares make one Lap. */
  progress?: readonly number[];
}

export function table({ classIds = ['main-character', 'rival'], seed, coins, progress }: Table) {
  const state = game(classIds, seed);
  state.players.forEach((player, seat) => {
    player.coins = coins[seat]!;
    player.routeProgress = progress?.[seat] ?? 30;
    player.creditedLap = Math.floor(player.routeProgress / 24);
  });
  return state;
}

export function strategy(setup: Table & { items: readonly string[] }): GameState {
  const state = table(setup);
  state.phase = { kind: 'strategy' };
  give(state, setup.items);
  return state;
}

export function encounter(
  speciesId: string,
  balls: GameState['players'][number]['balls'],
  setup: Partial<Table> = {},
): GameState {
  const state = table({ seed: 21, coins: [12, 14], ...setup });
  state.phase = { kind: 'encounter', pokemon: { speciesId } };
  state.players[0]!.balls = balls;
  return state;
}

export const caught = (n: number, speciesId: string, extra: Partial<PokemonInstance> = {}) => ({
  instanceId: `caught:0:${n}`,
  speciesId,
  origin: 'caught' as const,
  evolutionStage: 0,
  tired: false,
  abilityReady: true,
  tradeable: true,
  ...extra,
});

export function sell(team: readonly PokemonInstance[], setup: Partial<Table> = {}): GameState {
  const state = table({ seed: 31, coins: [10, 12], progress: [24, 20], ...setup });
  state.phase = { kind: 'sell', destinationPosition: 2 };
  // Keep the Original Starter in front, as every seat starts with one.
  state.players[0]!.team = [state.players[0]!.team[0]!, ...team];
  return state;
}

/** The seat-0 starter's instance ID in a fresh game, for Sell acceptable sets. */
export const starter = (state: GameState) => state.players[0]!.team[0]!.instanceId;

export const withFinalTableRound = (state: GameState): GameState => {
  state.finalTableRound = { triggerSeatIndex: 1, targetOwnTurnNo: state.players[0]!.ownTurnNo };
  return state;
};
