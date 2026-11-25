import {
  battlePreview,
  legalActions,
  observe,
  oddsForAllBalls,
  saleFacts,
  saleQuote,
  type GameState,
} from '../../engine/index.ts';
import { PERSONALITIES } from '../../ai/fallback/index.ts';
import type { DecideRequest } from '../../ai/orchestrator.ts';
import { createPolicyRng } from '../../sim/policy.ts';
import { battleDecisionPoint, ownBattle, wireBattleFacts } from '../../ai/battle.ts';
import { BATTLE_SCENARIOS } from './battle-scenarios.ts';
import { personalityScenarios } from './personality-scenarios.ts';
import { PROMISE_SCENARIOS } from './promise-scenarios.ts';
import {
  caught,
  encounter,
  sell,
  starter,
  strategy,
  withFinalTableRound,
  type EvalScenario,
} from './scenario-kit.ts';

export type { EvalScenario } from './scenario-kit.ts';

const greedy = PERSONALITIES.greedy;

const sellScenario = (
  id: string,
  description: string,
  build: () => { state: GameState },
  acceptable: (state: GameState) => Record<string, ('true' | 'false')[]>,
): EvalScenario => ({
  id,
  description,
  personality: greedy,
  build,
  acceptable: acceptable(build().state),
});

/** Spec §10 C2: 8 Strategy, 6 Encounter and 6 Sell scenarios, all Greedy (the one personality). */
export const GREEDY_SCENARIOS: readonly EvalScenario[] = [
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
      return { state };
    },
    (state) => ({ [starter(state)]: ['true'], 'caught:0:1': ['true'], 'caught:0:2': ['true'] }),
  ),
  sellScenario(
    'sell-snorlax-high-sale-low-keep',
    'Lap 2 of 2: a caught Snorlax sells high now and is worth a medium amount to keep.',
    () => {
      const state = sell([caught(1, 'snorlax')]);
      return { state };
    },
    (state) => ({ [starter(state)]: ['true', 'false'], 'caught:0:1': ['true'] }),
  ),
  sellScenario(
    'sell-magikarp-low-sale-high-keep',
    'Lap 2 of 2: a caught Magikarp sells low now and adds nothing to the best Battle stat.',
    () => {
      const state = sell([caught(1, 'magikarp')]);
      return { state };
    },
    (state) => ({ [starter(state)]: ['false'], 'caught:0:1': ['true', 'false'] }),
  ),
  sellScenario(
    'sell-researcher-class-bonus',
    'A Researcher (class bonus once per Lap) with a caught Growlithe and Rattata.',
    () => {
      const state = sell([caught(1, 'growlithe'), caught(2, 'rattata')], {
        classIds: ['researcher', 'rival'],
      });
      return { state };
    },
    (state) => ({
      [starter(state)]: ['true', 'false'],
      'caught:0:1': ['true', 'false'],
      'caught:0:2': ['true'],
    }),
  ),
  sellScenario(
    'sell-tired-eevee',
    'A tired caught Eevee sells for less now; keeping it lets it recover.',
    () => {
      const state = sell([caught(1, 'eevee', { tired: true })]);
      return { state };
    },
    (state) => ({ [starter(state)]: ['false'], 'caught:0:1': ['true', 'false'] }),
  ),
  sellScenario(
    'sell-gyarados-early-lap',
    'A caught Gyarados sells high now; its keep value is high (3 Battle points).',
    () => {
      const state = sell([caught(1, 'gyarados')], { progress: [24, 10] });
      return { state };
    },
    (state) => ({
      [starter(state)]: ['true', 'false'],
      'caught:0:1': ['true', 'false'],
    }),
  ),
];

/**
 * Spec §8: the 20 Greedy scenarios, then 15 each for Aggressive, Cautious and Opportunist (issue
 * #233), most on the very table state of a Greedy scenario so only the personality changes.
 */
export const SCENARIOS: readonly EvalScenario[] = [
  ...GREEDY_SCENARIOS,
  ...personalityScenarios(GREEDY_SCENARIOS),
  ...PROMISE_SCENARIOS,
  ...BATTLE_SCENARIOS,
];

/**
 * The orchestrator's input for a scenario, with every number from the engine (§5.2): catch odds
 * from `oddsForAllBalls`, sale prices and class bonuses from `saleQuote`. Keep values come from
 * `saleFacts`.
 */
export function decideRequest(scenario: EvalScenario): {
  state: GameState;
  request: DecideRequest;
} {
  const { state } = scenario.build();
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
  // A pending promise question is answered by seat 0, the AI, while the human's Social window waits.
  if (state.pendingResponse?.kind === 'promise_offer') request.decisionPoint = 'promise_response';
  // A battle decision (§4.4, §5.3) is named by the pending seat's own window or reward.
  const battlePoint = battleDecisionPoint(request.observation);
  if (battlePoint) request.decisionPoint = battlePoint;
  // The chances come from the engine's battle preview, read for the asked seat's own side.
  const preview = battlePoint === 'reward' ? null : battlePreview(state, 0);
  if (preview) {
    const own = ownBattle(request.observation, wireBattleFacts(preview));
    request.facts = {
      battle: own,
      policy: { battle: own.now, battleChoices: own.choices },
    };
  }
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
    const keepValue = Object.fromEntries(
      saleFacts(state, 0).map((row) => [row.instanceId, row.keepValue]),
    );
    request.facts = {
      sell: {
        pokemon: ids.map((instanceId, index) => {
          const alone = saleQuote(state, 0, [instanceId]).rows[0]!;
          const value = keepValue[instanceId];
          if (value === undefined)
            throw new RangeError(`${scenario.id}: no facts for ${instanceId}`);
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
