import { expect, test } from 'vitest';
import { FallbackPolicy, PERSONALITIES } from '../ai/fallback/index.ts';
import { toEngineContent } from '../content/schema.ts';
import {
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  createGameLog,
  decisionPoint,
  eventsVisibleTo,
  legalActions,
  observe,
  pendingDecision,
  replay,
  socialTargets,
  stateHash,
  winner,
  type Action,
  type GameState,
  type LegalAction,
} from '../engine/index.ts';
import { loadContent } from './content.ts';
import { realEngine } from './engine.ts';
import { createPolicyRng } from './policy.ts';

const content = toEngineContent(loadContent());
const AI_CLASSES = ['nurse-joy', 'researcher', 'main-character'];
const NEW_POINTS = ['pvp_response', 'ability_window', 'reroll', 'reward', 'gym_entry'];
const FAILURES = ['timeout', 'error', 'invalid', 'stale'] as const;
/** Injected failures by decision point over all seat counts; checked by the last test. */
const injected = new Map<string, number>();

function setup(aiSeats: number, seed: number): GameState {
  return createGame(
    createGameConfig({
      seats: ['rival', ...AI_CLASSES.slice(0, aiSeats)].map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        ...(classId === 'main-character' ? { starterSpeciesId: 'charmander' } : {}),
        controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
      })),
      seed,
      lapTarget: 3,
    }),
    content,
  );
}

function command(state: GameState, actorId: string, choice: LegalAction): Action {
  return {
    actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind: choice.kind,
    payload: choice.payload,
  } as Action;
}

/** The scripted human engages every new rule: Abilities, PvP, Gyms, acceptance and evolution. */
function humanChoice(state: GameState, enabled: LegalAction[]): LegalAction {
  const sale = enabled.find(
    (choice) => choice.kind === 'sell' && !choice.payload.pokemonInstanceIds.length,
  );
  if (sale) return sale;
  const order: ((choice: LegalAction) => boolean)[] = [
    (choice) => choice.kind === 'activate_ability',
    (choice) => choice.kind === 'declare_pvp',
    (choice) => choice.kind === 'respond_pvp' && choice.payload.accept,
    (choice) => choice.kind === 'challenge_gym',
    (choice) => choice.kind === 'choose_reward' && choice.payload.kind === 'evolve',
    (choice) => choice.kind === 'choose_reward',
    (choice) => choice.kind === 'catch',
  ];
  for (const wanted of order) {
    const found = enabled.find(wanted);
    if (found) return found;
  }
  return (
    enabled.find((choice) => choice.kind === 'skip' || choice.kind === 'skip_shop') ?? enabled[0]!
  );
}

test.each([1, 2, 3])(
  'one human and %i AI seats finish despite failed AI answers at every new decision point (§5.6, §6.4, §8)',
  async (aiSeats) => {
    let state = setup(aiSeats, 40 + aiSeats);
    const log = createGameLog(state);
    const fallback = new FallbackPolicy(PERSONALITIES.greedy);
    const rngs = state.players.map((player) => createPolicyRng(`mixed:${player.seatIndex}`));
    let failure = 0;
    const socialSeen = new Set<string>();
    const apply = (action: Action) => {
      const result = applyAction(state, action);
      if ('rejected' in result) throw new Error(`Rejected ${action.kind}: ${result.reason}`);
      expect(checkInvariants(state, action, result)).toEqual([]);
      log.actions.push(result.record);
      state = result.state;
      return result;
    };
    for (let step = 0; step < 8000 && state.phase.kind !== 'finished'; step++) {
      const social = state.phase.kind === 'social';
      // §4.2: only a human seat opens the social window; AI seats never talk to each other.
      if (social) socialSeen.add(`${state.activeSeatIndex}:${socialTargets(state).length}`);
      const automatic = advanceAutomatically(state);
      if (automatic.records.length) {
        // Leaving Social spends no tactical action.
        if (social) expect(automatic.state.turnBudgets).toEqual(state.turnBudgets);
        log.actions.push(...automatic.records);
        state = automatic.state;
        continue;
      }
      const owner = pendingDecision(state)!;
      const enabled = legalActions(state, owner.seatIndex).enabled;
      if (owner.seatIndex === 0) {
        apply(command(state, owner.actorId, humanChoice(state, enabled)));
        continue;
      }
      const point = decisionPoint(state)!;
      if (NEW_POINTS.includes(point)) {
        // A failed AI answer (timeout, error, invalid or stale) never changes the game (§5.6).
        const mode = FAILURES[failure++ % FAILURES.length]!;
        injected.set(point, (injected.get(point) ?? 0) + 1);
        const hash = stateHash(state);
        if (mode === 'stale') {
          const stale = { ...command(state, owner.actorId, enabled[0]!), stateRevisionBefore: 0 };
          expect(applyAction(state, stale)).toMatchObject({ rejected: true });
        } else if (mode === 'invalid') {
          const invalid = { ...command(state, owner.actorId, enabled[0]!), kind: 'declare_pvp' };
          expect(applyAction(state, { ...invalid, payload: { targetSeatIndex: 9 } })).toMatchObject(
            {
              rejected: true,
            },
          );
        }
        expect(stateHash(state)).toBe(hash);
      }
      // The legal-action fallback answers from the engine's own options.
      const picked = await fallback.decide(
        observe(state, owner.seatIndex),
        legalActions(state, owner.seatIndex),
        rngs[owner.seatIndex]!,
        realEngine.facts?.(state, owner.seatIndex),
      );
      const choice =
        typeof picked === 'string'
          ? enabled.find((entry) => entry.id === picked)!
          : ({
              id: 'batch',
              kind: 'sell',
              payload: { pokemonInstanceIds: [...picked.sellUids] },
            } as LegalAction);
      expect(choice).toBeDefined();
      apply(command(state, owner.actorId, choice));
    }
    expect(state.phase.kind).toBe('finished');
    // Responses never granted an extra own turn: the Final Table Round ends with equal turns.
    const round = state.finalTableRound!;
    expect(state.players.every((player) => player.ownTurnNo === round.targetOwnTurnNo)).toBe(true);
    const result = winner(state);
    const best = Math.max(...state.players.map((player) => player.coins));
    expect(
      result.winners.every((id) => state.players.find((p) => p.actorId === id)!.coins === best),
    ).toBe(true);
    expect([...socialSeen].filter((entry) => entry.startsWith('0:'))).toEqual([`0:${aiSeats}`]);
    expect(
      [...socialSeen]
        .filter((entry) => !entry.startsWith('0:'))
        .every((entry) => entry.endsWith(':0')),
    ).toBe(true);
    expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(state);
  },
  120_000,
);

test('across 2–4 seats, failures were injected at every new AI decision point', () => {
  expect([...injected.keys()].sort()).toEqual([...NEW_POINTS].sort());
});

test('four seats keep directed attack evidence for every ordered pair; PvP declarations are public, hostile items private (§4.4, §4.8, #37)', () => {
  let state = setup(3, 7);
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 1;
  for (const player of state.players) player.ownTurnNo = 1;
  const apply = (action: Action) => {
    const result = applyAction(state, action);
    if ('rejected' in result) throw new Error(`Rejected ${action.kind}: ${result.reason}`);
    expect(checkInvariants(state, action, result)).toEqual([]);
    const before = state;
    state = result.state;
    return { before, events: result.events };
  };
  for (const attacker of state.players.map((player) => player.seatIndex)) {
    for (const target of state.players.map((player) => player.seatIndex)) {
      if (attacker === target) continue;
      state.activeSeatIndex = attacker;
      state.phase = { kind: 'strategy' };
      state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
      const actorId = `p${attacker}`;
      const declared = apply(
        command(state, actorId, {
          id: 'pvp',
          kind: 'declare_pvp',
          payload: { targetSeatIndex: target },
        }),
      );
      apply(
        command(state, `p${target}`, { id: 'no', kind: 'respond_pvp', payload: { accept: false } }),
      );
      state.turnBudgets.tacticalAction = 1;
      const repel = `repel:${attacker}:${target}`;
      state.players[attacker]!.items = [
        { instanceId: repel, itemId: 'repel', name: 'Repel', visibility: 'secret' },
      ];
      delete state.players[target]!.pendingSlows;
      const hostile = apply(
        command(state, actorId, {
          id: 'repel',
          kind: 'use_item',
          payload: { itemInstanceId: repel, targetSeatIndex: target },
        }),
      );
      const watcher = [0, 1, 2, 3].find((seat) => seat !== attacker && seat !== target)!;
      const kinds = (seat: number, step: typeof hostile) =>
        eventsVisibleTo(step.before, step.events, seat).map((event) => event.kind);
      expect(kinds(watcher, declared)).toContain('attack_attempt');
      expect(kinds(watcher, hostile)).not.toContain('attack_attempt');
      expect(kinds(target, hostile)).toContain('attack_attempt');
    }
  }
  const pairs = new Set(
    (state.attackHistory ?? []).map(
      (entry) => `${entry.actorId}>${entry.targetId}:${entry.source}`,
    ),
  );
  expect(pairs.size).toBe(24); // 12 ordered pairs × (declined PvP + hostile item)
});
