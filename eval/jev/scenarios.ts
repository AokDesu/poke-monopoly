import type { Personality } from '../../content/personality-schema.ts';
import { toEngineContent } from '../../content/schema.ts';
import {
  createGame,
  createGameConfig,
  legalActions,
  observe,
  oddsForAllBalls,
  saleQuote,
  type GameState,
  type PokemonInstance,
} from '../../engine/index.ts';
import { PERSONALITIES } from '../../ai/fallback/index.ts';
import type { DecideRequest } from '../../ai/orchestrator.ts';
import { CONTENT } from '../../ai/questions/content.ts';
import { createPolicyRng } from '../../sim/policy.ts';

/**
 * One recorded decision for the offline eval (spec §8, §10 C2): an engine state where seat 0, the
 * AI, faces Strategy, Encounter or Sell. The orchestrator builds the Jev request from it, so a
 * change to question wording changes the request and the fixture must be recorded again.
 */
export interface EvalScenario {
  id: string;
  description: string;
  personality: Personality;
  /** Engine state with seat 0 active; `keepValue` holds the Sell keep values the engine lacks. */
  build(): { state: GameState; keepValue?: Readonly<Record<string, number>> };
  /**
   * Acceptable answers chosen by a teammate: engine action IDs for Strategy and Encounter, and for
   * Sell each Pokémon instance ID's acceptable Noul answers (`true` sells it).
   */
  acceptable: readonly string[] | Readonly<Record<string, readonly ('true' | 'false')[]>>;
}

const content = toEngineContent(CONTENT);
const greedy = PERSONALITIES.greedy;

/** A live current-version Quick 2 Laps game with seat 0 (the AI) active; other seats are human. */
function game(classIds: readonly string[], seed: number): GameState {
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

function give(state: GameState, itemIds: readonly string[]): void {
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

interface Table {
  classIds?: readonly string[];
  seed: number;
  /** Coins per seat, in seat order. */
  coins: readonly number[];
  /** Squares each seat has travelled; 24 squares make one Lap. */
  progress?: readonly number[];
}

function table({ classIds = ['main-character', 'rival'], seed, coins, progress }: Table) {
  const state = game(classIds, seed);
  state.players.forEach((player, seat) => {
    player.coins = coins[seat]!;
    player.routeProgress = progress?.[seat] ?? 30;
    player.creditedLap = Math.floor(player.routeProgress / 24);
  });
  return state;
}

function strategy(setup: Table & { items: readonly string[] }): GameState {
  const state = table(setup);
  state.phase = { kind: 'strategy' };
  give(state, setup.items);
  return state;
}

function encounter(
  speciesId: string,
  balls: GameState['players'][number]['balls'],
  setup: Partial<Table> = {},
): GameState {
  const state = table({ seed: 21, coins: [12, 14], ...setup });
  state.phase = { kind: 'encounter', pokemon: { speciesId } };
  state.players[0]!.balls = balls;
  return state;
}

const caught = (n: number, speciesId: string, extra: Partial<PokemonInstance> = {}) => ({
  instanceId: `caught:0:${n}`,
  speciesId,
  origin: 'caught' as const,
  evolutionStage: 0,
  tired: false,
  abilityReady: true,
  tradeable: true,
  ...extra,
});

function sell(team: readonly PokemonInstance[], setup: Partial<Table> = {}): GameState {
  const state = table({ seed: 31, coins: [10, 12], progress: [24, 20], ...setup });
  state.phase = { kind: 'sell', destinationPosition: 2 };
  // Keep the Original Starter in front, as every seat starts with one.
  state.players[0]!.team = [state.players[0]!.team[0]!, ...team];
  return state;
}

/** The seat-0 starter's instance ID in a fresh game, for Sell acceptable sets. */
const starter = (state: GameState) => state.players[0]!.team[0]!.instanceId;

const withFinalTableRound = (state: GameState): GameState => {
  state.finalTableRound = { triggerSeatIndex: 1, targetOwnTurnNo: state.players[0]!.ownTurnNo };
  return state;
};

const sellScenario = (
  id: string,
  description: string,
  build: () => { state: GameState; keepValue: Record<string, number> },
  acceptable: (state: GameState) => Record<string, ('true' | 'false')[]>,
): EvalScenario => ({
  id,
  description,
  personality: greedy,
  build,
  acceptable: acceptable(build().state),
});

/** Spec §10 C2: 8 Strategy, 6 Encounter and 6 Sell scenarios, all Greedy (the one personality). */
export const SCENARIOS: readonly EvalScenario[] = [
  {
    id: 'strategy-pickpocket-rich-rival',
    description: 'Holds Pickpocket; the only opponent is far ahead in coins.',
    personality: greedy,
    build: () => ({ state: strategy({ seed: 1, coins: [6, 30], items: ['pickpocket'] }) }),
    acceptable: ['use-item:bought:0:0:seat-1'],
  },
  {
    id: 'strategy-pickpocket-richer-target',
    description:
      'Holds Pickpocket at a 3-seat table: one opponent is rich, the other nearly broke.',
    personality: greedy,
    build: () => ({
      state: strategy({
        classIds: ['main-character', 'rival', 'nurse-joy'],
        seed: 2,
        coins: [10, 28, 2],
        items: ['pickpocket'],
      }),
    }),
    acceptable: ['use-item:bought:0:0:seat-1'],
  },
  {
    id: 'strategy-pickpocket-final-round',
    description:
      'Final Table Round: holds Pickpocket and trails the coin leader, who wins on coins.',
    personality: greedy,
    build: () => ({
      state: withFinalTableRound(
        strategy({ seed: 3, coins: [18, 21], progress: [46, 48], items: ['pickpocket'] }),
      ),
    }),
    acceptable: ['use-item:bought:0:0:seat-1'],
  },
  {
    id: 'strategy-repel-leader-near-start',
    description: 'Holds Repel; the coin leader is a few squares from Start income and selling.',
    personality: greedy,
    build: () => ({
      state: strategy({ seed: 4, coins: [8, 24], progress: [30, 44], items: ['repel'] }),
    }),
    acceptable: ['use-item:bought:0:0:seat-1', 'skip'],
  },
  {
    id: 'strategy-lucky-egg-only',
    description: 'Holds only a Lucky Egg; whether it meets a wild Pokémon this turn is unknown.',
    personality: greedy,
    build: () => ({ state: strategy({ seed: 5, coins: [12, 12], items: ['lucky-egg'] }) }),
    acceptable: ['use-item:bought:0:0', 'skip'],
  },
  {
    id: 'strategy-mixed-items-two-rivals',
    description: 'Holds Pickpocket, Repel and Lucky Egg at a 3-seat table with one rich opponent.',
    personality: greedy,
    build: () => ({
      state: strategy({
        classIds: ['main-character', 'rival', 'researcher'],
        seed: 6,
        coins: [9, 26, 7],
        items: ['pickpocket', 'repel', 'lucky-egg'],
      }),
    }),
    acceptable: ['use-item:bought:0:0:seat-1'],
  },
  {
    id: 'strategy-far-ahead-pickpocket-poor',
    description: 'Far ahead in coins; holds Pickpocket and the only opponent has 2 coins.',
    personality: greedy,
    build: () => ({ state: strategy({ seed: 7, coins: [34, 2], items: ['pickpocket'] }) }),
    acceptable: ['use-item:bought:0:0:seat-1', 'skip'],
  },
  {
    id: 'strategy-four-seats-pickpocket-repel',
    description: 'Holds Pickpocket and Repel at a 4-seat table; one opponent leads in coins.',
    personality: greedy,
    build: () => ({
      state: strategy({
        classIds: ['main-character', 'rival', 'nurse-joy', 'researcher'],
        seed: 8,
        coins: [11, 9, 25, 13],
        items: ['pickpocket', 'repel'],
      }),
    }),
    acceptable: ['use-item:bought:0:0:seat-2'],
  },
  {
    id: 'encounter-common-many-poke-balls',
    description: 'A common Caterpie; holds many Poké Balls with a high catch chance.',
    personality: greedy,
    build: () => ({ state: encounter('caterpie', { poke: 5, great: 0, ultra: 0 }) }),
    acceptable: ['catch:poke'],
  },
  {
    id: 'encounter-rare-snorlax-ultra',
    description: 'A rare Snorlax; holds a few Poké Balls and one Ultra Ball.',
    personality: greedy,
    build: () => ({ state: encounter('snorlax', { poke: 3, great: 0, ultra: 1 }) }),
    acceptable: ['catch:ultra'],
  },
  {
    id: 'encounter-magikarp-only-ultra',
    description: 'A common Magikarp; the only Ball held is one Ultra Ball.',
    personality: greedy,
    build: () => ({ state: encounter('magikarp', { poke: 0, great: 0, ultra: 1 }) }),
    acceptable: ['release'],
  },
  {
    id: 'encounter-rare-dratini-poke-only',
    description: 'A rare Dratini; holds only Poké Balls, many of them.',
    personality: greedy,
    build: () => ({ state: encounter('dratini', { poke: 4, great: 0, ultra: 0 }) }),
    acceptable: ['catch:poke'],
  },
  {
    id: 'encounter-pidgey-poke-or-great',
    description: 'A common Pidgey; holds one Poké Ball and a few Great Balls.',
    personality: greedy,
    build: () => ({ state: encounter('pidgey', { poke: 1, great: 2, ultra: 0 }) }),
    acceptable: ['catch:poke', 'catch:great'],
  },
  {
    id: 'encounter-scyther-great',
    description: 'An uncommon Scyther; holds a few Poké Balls and one Great Ball.',
    personality: greedy,
    build: () => ({ state: encounter('scyther', { poke: 2, great: 1, ultra: 0 }) }),
    acceptable: ['catch:great'],
  },
  sellScenario(
    'sell-last-phase-final-round',
    'Final Table Round: the last Sell Phase, with a caught Pidgey and Psyduck.',
    () => {
      const state = withFinalTableRound(sell([caught(1, 'pidgey'), caught(2, 'psyduck')]));
      return { state, keepValue: { [starter(state)]: 0, 'caught:0:1': 0, 'caught:0:2': 0 } };
    },
    (state) => ({ [starter(state)]: ['true'], 'caught:0:1': ['true'], 'caught:0:2': ['true'] }),
  ),
  sellScenario(
    'sell-snorlax-high-sale-low-keep',
    'Lap 2 of 2: a caught Snorlax sells high now and is worth little to keep.',
    () => {
      const state = sell([caught(1, 'snorlax')]);
      return { state, keepValue: { [starter(state)]: 8, 'caught:0:1': 3 } };
    },
    (state) => ({ [starter(state)]: ['false'], 'caught:0:1': ['true'] }),
  ),
  sellScenario(
    'sell-magikarp-low-sale-high-keep',
    'Lap 2 of 2: a caught Magikarp sells low now but is worth a lot to keep.',
    () => {
      const state = sell([caught(1, 'magikarp')]);
      return { state, keepValue: { [starter(state)]: 8, 'caught:0:1': 14 } };
    },
    (state) => ({ [starter(state)]: ['false'], 'caught:0:1': ['false'] }),
  ),
  sellScenario(
    'sell-researcher-class-bonus',
    'A Researcher (class bonus once per Lap) with a caught Growlithe and Rattata.',
    () => {
      const state = sell([caught(1, 'growlithe'), caught(2, 'rattata')], {
        classIds: ['researcher', 'rival'],
      });
      return {
        state,
        keepValue: { [starter(state)]: 8, 'caught:0:1': 6, 'caught:0:2': 2 },
      };
    },
    (state) => ({
      [starter(state)]: ['false'],
      'caught:0:1': ['true', 'false'],
      'caught:0:2': ['true'],
    }),
  ),
  sellScenario(
    'sell-tired-eevee',
    'A tired caught Eevee sells for less now; keeping it lets it recover.',
    () => {
      const state = sell([caught(1, 'eevee', { tired: true })]);
      return { state, keepValue: { [starter(state)]: 8, 'caught:0:1': 11 } };
    },
    (state) => ({ [starter(state)]: ['false'], 'caught:0:1': ['true', 'false'] }),
  ),
  sellScenario(
    'sell-gyarados-early-lap',
    'A caught Gyarados sells high now; its keep value is medium.',
    () => {
      const state = sell([caught(1, 'gyarados')], { progress: [24, 10] });
      return { state, keepValue: { [starter(state)]: 8, 'caught:0:1': 10 } };
    },
    (state) => ({ [starter(state)]: ['false'], 'caught:0:1': ['true'] }),
  ),
];

/**
 * The orchestrator's input for a scenario, with every number from the engine (§5.2): catch odds
 * from `oddsForAllBalls`, sale prices and class bonuses from `saleQuote`. Keep values have no
 * engine source yet, so the scenario supplies them as engine inputs.
 */
export function decideRequest(scenario: EvalScenario): {
  state: GameState;
  request: DecideRequest;
} {
  const { state, keepValue = {} } = scenario.build();
  const legal = legalActions(state, 0);
  const request: DecideRequest = {
    turnKey: scenario.id,
    observation: observe(state, 0),
    legalActions: legal,
    facts: {},
    difficulty: 'normal',
    personality: scenario.personality,
    rng: createPolicyRng(scenario.id),
  };
  if (state.phase.kind === 'encounter') {
    const odds = oddsForAllBalls(state, 0);
    request.facts = {
      encounter: { odds },
      policy: {
        catchChance: Object.fromEntries(odds.map((entry) => [entry.ballType, entry.probability])),
        catchSuccessFaces: Object.fromEntries(
          odds.map((entry) => [entry.ballType, entry.successFaces]),
        ),
      },
    };
  }
  if (state.phase.kind === 'sell') {
    const ids = legal.enabled.flatMap((action) =>
      action.kind === 'sell' ? action.payload.pokemonInstanceIds : [],
    );
    const together = saleQuote(state, 0, ids).rows;
    request.facts = {
      sell: {
        pokemon: ids.map((instanceId, index) => {
          const alone = saleQuote(state, 0, [instanceId]).rows[0]!;
          const value = keepValue[instanceId];
          if (value === undefined)
            throw new RangeError(`${scenario.id}: no keep value for ${instanceId}`);
          return {
            instanceId,
            salePrice: alone.basePrice,
            classBonusAlone: alone.classBonus,
            classBonusTogether: together[index]!.classBonus,
            keepValue: value,
          };
        }),
      },
      policy: {
        saleValue: Object.fromEntries(
          together.map((row) => [row.instanceId, row.basePrice + row.classBonus]),
        ),
      },
    };
  }
  return { state, request };
}
