import { expect, test } from 'vitest';
import type { GameState, LegalAction } from '../engine/index.ts';
import { realEngine } from './engine.ts';
import type { Policy } from './policy.ts';
import { formatSummary } from './report.ts';
import { DEFAULT_OPTIONS, runSim, type SimEngine } from './runner.ts';

const classes = ['bug-catcher', 'fisherman', 'researcher'];

/** Real engine commands from a small, controlled scenario, measured through runSim's summary. */
async function scenario(
  setup: (state: GameState) => void,
  policy: Policy,
  maxSteps: number,
  games = 1,
) {
  const engine: SimEngine = {
    ...realEngine,
    classIds: classes,
    createGame(options) {
      const state = realEngine.createGame(options);
      state.phase = { kind: 'strategy' };
      state.globalTurnNo = 1;
      state.players[0]!.ownTurnNo = 1;
      state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
      setup(state);
      return state;
    },
  };
  return runSim(
    engine,
    { ...DEFAULT_OPTIONS, games, seed: 0, seats: 3, maxSteps, policy: 'scenario' },
    { scenario: () => policy },
  );
}

function hostileItems(state: GameState, visibility: 'secret' | 'public' = 'secret') {
  state.players[0]!.items = [
    { instanceId: 'repel', itemId: 'repel', name: 'Repel', visibility },
    { instanceId: 'pickpocket', itemId: 'pickpocket', name: 'Pickpocket', visibility },
  ];
}

test('hostile items count once per legal seat-turn despite multiple targets and repeated decisions (§8)', async () => {
  const { summary } = await scenario(
    hostileItems,
    {
      personality: { id: 'careful' },
      decide(_observation, legal) {
        const ability = legal.enabled.find((choice) => choice.kind === 'activate_ability');
        return (ability ?? legal.enabled.find((choice) => choice.kind === 'use_item')!).id;
      },
    },
    2,
  );
  expect(summary.hostility).toEqual({
    hostileUsed: 1,
    legalHostileOpportunity: 1,
    usedPerOpportunity: 1,
    byPersonalityLap: [
      {
        personalityId: 'careful',
        lap: 0,
        hostileUsed: 1,
        legalHostileOpportunity: 1,
        usedPerOpportunity: 1,
      },
    ],
  });
});

/** Offers one promise, accepts it, attacks `target` with `attack` whenever enabled, and otherwise moves on. */
function attackerPolicy(attack: (choice: LegalAction) => boolean): Policy {
  let offered = false;
  return {
    decide(_observation, legal) {
      const offer = legal.enabled.find((choice) => choice.id === 'offer-promise:seat-1:offer');
      if (offer && !offered) {
        offered = true;
        return offer.id;
      }
      return (
        legal.enabled.find((choice) => choice.id === 'respond:accept') ??
        legal.enabled.find(attack) ??
        legal.enabled.find((choice) => choice.kind === 'skip') ??
        legal.enabled.find((choice) => choice.kind === 'release') ??
        legal.enabled.find(
          (choice) => choice.kind === 'sell' && choice.payload.pokemonInstanceIds.length === 0,
        ) ??
        legal.enabled.find((choice) => choice.kind === 'skip_shop') ??
        legal.enabled[0]!
      ).id;
    },
  };
}

test('promise accounting uses actual attack evidence, including shield-blocked items (§4.8, §8)', async () => {
  const { summary } = await scenario(
    (state) => {
      hostileItems(state);
      state.config.socialWindow = true;
      state.config.seats[0]!.controller = 'human';
      state.phase = { kind: 'social' };
      state.turnBudgets.socialInteraction = 1;
      state.players[1]!.armedShield = { scope: 'price', visibility: 'secret' };
    },
    attackerPolicy((choice) => choice.kind === 'use_item' && choice.payload.targetSeatIndex === 1),
    200,
  );
  expect(summary.promises).toEqual({
    offered: 1,
    accepted: 1,
    rejected: 0,
    broken: 1,
    kept: 0,
    keptWithOpportunity: 0,
    keptWithoutOpportunity: 0,
    closedByGameEnd: 0,
    breachOpportunity: 1,
    pending: 0,
  });
});

function promisePolicy(answer: 'accept' | 'reject' = 'accept'): Policy {
  let offered = false;
  return {
    decide(_observation, legal) {
      const offer = legal.enabled.find((choice) => choice.id === 'offer-promise:seat-1:offer');
      if (offer && !offered) {
        offered = true;
        return offer.id;
      }
      return (
        legal.enabled.find((choice) => choice.id === `respond:${answer}`) ??
        legal.enabled.find((choice) => choice.kind === 'skip') ??
        legal.enabled.find((choice) => choice.kind === 'release') ??
        legal.enabled.find(
          (choice) => choice.kind === 'sell' && choice.payload.pokemonInstanceIds.length === 0,
        ) ??
        legal.enabled.find((choice) => choice.kind === 'skip_shop') ??
        legal.enabled[0]!
      ).id;
    },
  };
}

function socialScenario(state: GameState) {
  state.config.socialWindow = true;
  state.config.seats[0]!.controller = 'human';
  state.phase = { kind: 'social' };
  state.turnBudgets.socialInteraction = 1;
  state.finalTableRound = { triggerSeatIndex: 0, targetOwnTurnNo: 2 };
}

for (const opportunity of [false, true]) {
  test(`kept promise closes on the promiser's next own-turn end (opportunity=${opportunity})`, async () => {
    const { summary, failures } = await scenario(
      (state) => {
        socialScenario(state);
        // No battle-ready teams or Abilities: only the optional held items can breach it.
        for (const player of state.players) {
          player.team = [];
          player.items = [];
        }
        if (opportunity) hostileItems(state, 'public');
      },
      promisePolicy(),
      200,
    );
    expect(failures).toEqual([]);
    expect(summary.promises).toMatchObject({
      offered: 1,
      accepted: 1,
      broken: 0,
      kept: 1,
      keptWithOpportunity: opportunity ? 1 : 0,
      keptWithoutOpportunity: opportunity ? 0 : 1,
      breachOpportunity: opportunity ? 1 : 0,
      closedByGameEnd: 0,
      pending: 0,
    });
  });
}

test('early game end closes a promise separately from kept or broken (§8)', async () => {
  const { summary, failures } = await scenario(
    (state) => {
      socialScenario(state);
      state.finalTableRound = null;
      state.config.lapTarget = 1;
      state.players[0]!.routeProgress = 23;
    },
    promisePolicy(),
    200,
  );
  expect(failures).toEqual([]);
  expect(summary.promises).toMatchObject({
    accepted: 1,
    broken: 0,
    kept: 0,
    closedByGameEnd: 1,
    pending: 0,
  });
});

test('an aborted game leaves accepted promises pending rather than declaring them kept', async () => {
  const { summary } = await scenario(socialScenario, promisePolicy(), 3);
  expect(summary.aborted).toBe(1);
  expect(summary.promises).toMatchObject({
    offered: 1,
    accepted: 1,
    kept: 0,
    broken: 0,
    closedByGameEnd: 0,
    pending: 1,
  });
});

test('rejected promises are counted without opening an obligation', async () => {
  const { summary } = await scenario(socialScenario, promisePolicy('reject'), 3);
  expect(summary.promises).toMatchObject({ offered: 1, accepted: 0, rejected: 1, pending: 0 });
});

test('a skipped hostile opportunity is reported with zero use and no invented personality', async () => {
  const { summary } = await scenario(
    hostileItems,
    { decide: (_observation, legal) => legal.enabled.find((choice) => choice.kind === 'skip')!.id },
    1,
  );
  expect(summary.hostility).toEqual({
    hostileUsed: 0,
    legalHostileOpportunity: 1,
    usedPerOpportunity: 0,
    byPersonalityLap: [
      {
        personalityId: 'unassigned',
        lap: 0,
        hostileUsed: 0,
        legalHostileOpportunity: 1,
        usedPerOpportunity: 0,
      },
    ],
  });
});

test('disabled hostile items produce no opportunity and a null rate', async () => {
  const { summary } = await scenario(
    (state) => {
      hostileItems(state);
      state.turnBudgets.tacticalAction = 0;
    },
    { decide: (_observation, legal) => legal.enabled.find((choice) => choice.kind === 'skip')!.id },
    1,
  );
  expect(summary.hostility).toEqual({
    hostileUsed: 0,
    legalHostileOpportunity: 0,
    usedPerOpportunity: null,
    byPersonalityLap: [],
  });
});

test('the readable summary shows hostile evidence and every promise outcome', async () => {
  const { summary } = await scenario(socialScenario, promisePolicy(), 3);
  const report = formatSummary(summary).join('\n');
  expect(report).toContain('Hostile items');
  expect(report).toContain('0 / 0 (n/a)');
  expect(report).toContain('1 offered, 1 accepted, 0 rejected');
  expect(report).toContain('0 kept with opportunity, 0 kept without opportunity');
  expect(report).toContain('0 broken, 0 closed by game end, 1 pending');
  expect(report).toContain('1 with breach opportunity');
});

for (const kind of ['activate_ability', 'declare_pvp'] as const) {
  test(`a ${kind} against the recipient breaks a promise, without counting as a hostile item`, async () => {
    const { summary } = await scenario(
      socialScenario,
      attackerPolicy((choice) => choice.kind === kind && choice.payload.targetSeatIndex === 1),
      200,
    );
    expect(summary.promises).toMatchObject({
      accepted: 1,
      broken: 1,
      pending: 0,
    });
    expect(summary.hostility.hostileUsed).toBe(0);
  });
}

test('attacking another seat leaves the accepted promise pending', async () => {
  const { summary } = await scenario(
    socialScenario,
    {
      decide(_observation, legal) {
        return (
          legal.enabled.find((choice) => choice.id === 'offer-promise:seat-1:offer') ??
          legal.enabled.find((choice) => choice.id === 'respond:accept') ??
          legal.enabled.find(
            (choice) => choice.kind === 'activate_ability' && choice.payload.targetSeatIndex === 2,
          ) ??
          legal.enabled.find((choice) => choice.kind === 'skip') ??
          legal.enabled[0]!
        ).id;
      },
    },
    4,
  );
  expect(summary.promises).toMatchObject({
    accepted: 1,
    broken: 0,
    breachOpportunity: 1,
    pending: 1,
  });
});

test('a legal attack against a third seat is not a breach opportunity against the recipient', async () => {
  const { summary, failures } = await scenario(
    (state) => {
      socialScenario(state);
      for (const player of state.players) {
        player.team = [];
        player.items = [];
      }
      hostileItems(state);
      state.players[0]!.items = state.players[0]!.items.filter(
        (item) => item.itemId === 'pickpocket',
      );
      state.players[1]!.coins = 0;
    },
    promisePolicy(),
    200,
  );
  expect(failures).toEqual([]);
  expect(summary.hostility.legalHostileOpportunity).toBeGreaterThan(0);
  expect(summary.promises).toMatchObject({
    accepted: 1,
    keptWithoutOpportunity: 1,
    breachOpportunity: 0,
    pending: 0,
  });
});

test('a promise expiring on the final acting seat is kept, not closed by game end', async () => {
  const keeper = promisePolicy();
  const { summary, failures } = await scenario(
    (state) => {
      socialScenario(state);
      state.finalTableRound!.targetOwnTurnNo = 1;
      for (const player of state.players) {
        player.team = [];
        player.items = [];
      }
    },
    {
      decide(observation, legal, rng, facts) {
        const ask = legal.enabled.find((choice) => choice.id === 'offer-promise:seat-2:ask');
        return ask?.id ?? keeper.decide(observation, legal, rng, facts);
      },
    },
    200,
  );
  expect(failures).toEqual([]);
  expect(summary.promises).toMatchObject({
    accepted: 1,
    kept: 1,
    keptWithoutOpportunity: 1,
    closedByGameEnd: 0,
    pending: 0,
  });
});

test('opportunities reset per game and remain separated by credited Lap', async () => {
  const { summary } = await scenario(
    (state) => {
      hostileItems(state);
      state.players[0]!.creditedLap = Number(state.config.seed);
    },
    { decide: (_observation, legal) => legal.enabled.find((choice) => choice.kind === 'skip')!.id },
    1,
    3,
  );
  expect(summary.hostility.legalHostileOpportunity).toBe(3);
  expect(
    summary.hostility.byPersonalityLap.map((row) => [row.lap, row.legalHostileOpportunity]),
  ).toEqual([
    [0, 1],
    [1, 1],
    [2, 1],
  ]);
});

test('real social games conserve promise accounting and preserve the existing social fields', async () => {
  let hostileUsed = 0;
  const { summary, failures } = await runSim(
    realEngine,
    { ...DEFAULT_OPTIONS, games: 6, seed: 0, seats: 3, social: true, policy: 'fallback' },
    undefined,
    undefined,
    (game) => {
      hostileUsed += game.records
        .flatMap((record) => record.events)
        .filter(
          (event) => event.kind === 'attack_attempt' && event.source === 'hostile_item',
        ).length;
    },
  );
  expect(failures).toEqual([]);
  expect(summary.hostility.hostileUsed).toBe(hostileUsed);
  expect(summary.hostility.byPersonalityLap.some((row) => row.personalityId === 'greedy')).toBe(
    true,
  );
  const p = summary.promises;
  expect(p.offered).toBeGreaterThan(0);
  expect(p.accepted + p.rejected).toBe(p.offered);
  expect(p.broken + p.kept + p.closedByGameEnd + p.pending).toBe(p.accepted);
  expect(p.keptWithOpportunity + p.keptWithoutOpportunity).toBe(p.kept);
  expect(p.pending).toBe(0);
  expect(summary.social).toEqual({
    promiseOffers: p.offered,
    promisesAccepted: p.accepted,
    promisesRejected: p.rejected,
  });
}, 15_000);
