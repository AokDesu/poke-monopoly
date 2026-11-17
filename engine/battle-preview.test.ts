/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import {
  applyAction,
  battlePreview,
  challengeOdds,
  createGame,
  createGameConfig,
  gymOdds,
  legalActions,
  pendingDecision,
  pvpOdds,
  stateHash,
  type Action,
  type GameState,
} from './index.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

function game(classes: string[], starters: Record<number, string> = {}): GameState {
  const state = createGame(
    createGameConfig({
      seats: classes.map((classId, seatIndex) => ({
        actorId: `p${seatIndex + 1}`,
        seatIndex,
        classId,
        ...(starters[seatIndex] ? { starterSpeciesId: starters[seatIndex] } : {}),
        controller: 'ai' as const,
      })),
      seed: 1,
      lapTarget: 2,
    }),
    content,
  );
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 7;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) player.ownTurnNo = 3;
  return state;
}

function act(state: GameState, kind: Action['kind'], payload: unknown = {}): GameState {
  const result = applyAction(state, {
    actorId: pendingDecision(state)!.actorId,
    kind,
    payload,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
  } as Action);
  if ('rejected' in result) throw new Error(`Unexpected rejection: ${result.reason}`);
  return result.state;
}

const counts = (odds: {
  win: { outcomes: number };
  tie: { outcomes: number };
  loss: { outcomes: number };
}) => [odds.win.outcomes, odds.tie.outcomes, odds.loss.outcomes];

/** AC-1 (C.8): Charmander with Blaze against Eevee with Adaptability and Rival's defence bonus. */
function ac1(): GameState {
  const state = game(['main-character', 'rival'], { 0: 'charmander' });
  state.players[1]!.coins = 9;
  return act(state, 'declare_pvp', { targetSeatIndex: 1 });
}

test('before any window the preview is the base snapshot, and every open choice shows its terms (AC-1, §4.4)', () => {
  const asked = act(ac1(), 'respond_pvp', { accept: true });
  const before = stateHash(asked);
  // The attacker's window: Blaze adds +1 for attacker; the defender can still answer afterwards.
  const preview = battlePreview(asked, 0)!;
  expect(preview).toMatchObject({ kind: 'pvp', frozen: false });
  expect(preview.battleId).toBe('pvp:1');
  expect(preview.choices.map((choice) => choice.id)).toEqual(['ability:starter:0']);
  const blaze = preview.choices[0]!;
  if (blaze.kind !== 'pvp' || preview.kind !== 'pvp') throw new Error('Expected PvP');
  expect(blaze.snapshot.attacker.abilityBonus).toBe(preview.snapshot.attacker.abilityBonus + 1);
  expect(counts(blaze.odds)).not.toEqual(counts(preview.odds));
  // Reading a preview changes nothing.
  expect(stateHash(asked)).toBe(before);

  // The defender's window, seen by the defender: Adaptability (combat) gives the AC-1 odds.
  const defending = act(asked, 'activate_ability', { instanceId: 'starter:0' });
  const defenderView = battlePreview(defending, 1)!;
  expect(defenderView.frozen).toBe(false);
  const combat = defenderView.choices.find((choice) => choice.id === 'ability:starter:1:combat')!;
  expect(counts(combat.odds)).toEqual([10, 5, 21]);
  // The preview for a choice equals the odds the real confirmation then freezes.
  const confirmed = act(defending, 'activate_ability', {
    instanceId: 'starter:1',
    scope: 'combat',
  });
  const frozen = battlePreview(confirmed, 1)!;
  expect(frozen.frozen).toBe(true);
  expect(frozen.choices).toEqual([]);
  expect(frozen.odds).toEqual(combat.odds);
  expect(frozen.snapshot).toEqual(combat.snapshot);
  if (confirmed.phase.kind !== 'pvp' || !('snapshot' in confirmed.phase.battle)) {
    throw new Error('Expected a confirmed battle');
  }
  expect(frozen.odds).toEqual(pvpOdds(frozen.snapshot as Parameters<typeof pvpOdds>[0]));
  // Passing closes the window with the preview's own base terms.
  expect(battlePreview(act(defending, 'skip'), 1)!.odds).toEqual(defenderView.odds);
});

test("a rival's Lucky Egg bonus stays out of a preview that is not frozen, and is in the frozen snapshot (§4.1)", () => {
  const state = ac1();
  state.turnEffects = { itemBonus: 1 };
  const accepted = act(state, 'respond_pvp', { accept: true });
  const own = battlePreview(accepted, 0)!;
  const rival = battlePreview(accepted, 1)!;
  if (own.kind !== 'pvp' || rival.kind !== 'pvp') throw new Error('Expected PvP');
  expect(own.snapshot.attacker.itemBonus).toBe(1);
  expect(rival.snapshot.attacker.itemBonus).toBe(0);
  const confirmed = act(act(accepted, 'skip'), 'skip');
  const frozen = battlePreview(confirmed, 1)!;
  if (frozen.kind !== 'pvp') throw new Error('Expected PvP');
  expect(frozen.frozen).toBe(true);
  expect(frozen.snapshot.attacker.itemBonus).toBe(1);
});

test('an armed shield never changes an Intimidate preview, because its block is private (§4.1, D6)', () => {
  const state = game(['fisherman', 'bug-catcher']);
  state.players[0]!.team[0] = { ...state.players[0]!.team[0]!, speciesId: 'gyarados' };
  state.players[1]!.armedShield = { scope: 'price', visibility: 'secret' };
  const asked = act(act(state, 'declare_pvp', { targetSeatIndex: 1 }), 'respond_pvp', {
    accept: true,
  });
  const preview = battlePreview(asked, 0)!;
  const intimidate = preview.choices[0]!;
  if (intimidate.kind !== 'pvp' || preview.kind !== 'pvp') throw new Error('Expected PvP');
  expect(intimidate.snapshot.defender.debuffs).toBe(preview.snapshot.defender.debuffs + 1);
  // The real action is blocked and consumes the shield; the preview did not.
  expect(asked.players[1]!.armedShield).toBeDefined();
  const choice = legalActions(asked, 0).enabled.find((entry) => entry.id === intimidate.id)!;
  const real = act(asked, 'activate_ability', choice.payload);
  expect(real.players[1]!.armedShield).toBeUndefined();
});

test('a defender sees no choices in the attacker window, and a battle-free state has no preview', () => {
  const asked = act(ac1(), 'respond_pvp', { accept: true });
  expect(battlePreview(asked, 1)!.choices).toEqual([]);
  expect(battlePreview(game(['fisherman', 'bug-catcher']), 0)).toBeNull();
  expect(() => battlePreview(asked, 9)).toThrow(RangeError);
});

test('the voluntary response step already carries the odds of the challenge (D4 step 4)', () => {
  const preview = battlePreview(ac1(), 1)!;
  expect(preview).toMatchObject({ kind: 'pvp', frozen: false, choices: [] });
  expect(preview.odds.win.outcomes + preview.odds.tie.outcomes + preview.odds.loss.outcomes).toBe(
    36,
  );
});

/** AC-5 (C.8): a Gym at square 12 with Dragon Rush ready. */
function gymEntry(): GameState {
  const state = game(['main-character', 'fisherman'], { 0: 'bulbasaur' });
  state.players[0]!.team.push({
    instanceId: 'caught:0:1',
    speciesId: 'dratini',
    origin: 'caught',
    evolutionStage: 0,
    tired: false,
    abilityReady: true,
  });
  state.players[0]!.team[0]!.abilityReady = false;
  state.phase = { kind: 'resolve' };
  state.players[0]!.routeProgress = 12;
  return act(state, 'skip');
}

test('a Gym preview shows the DC odds at entry, Dragon Rush in its window and no rival tie (AC-5, D5, D14)', () => {
  const entry = gymEntry();
  const base = battlePreview(entry, 0)!;
  if (base.kind !== 'gym') throw new Error('Expected a Gym');
  expect(base).toMatchObject({ frozen: false, choices: [] });
  expect(base.snapshot.dc).toBe(7);
  expect(base.odds.tie.outcomes).toBe(0);
  const window = act(entry, 'challenge_gym');
  const preview = battlePreview(window, 0)!;
  const rush = preview.choices[0]!;
  expect(rush.id).toBe('ability:caught:0:1');
  expect(rush.odds.win.outcomes).toBe(5);
  const confirmed = act(window, 'activate_ability', { instanceId: 'caught:0:1' });
  const frozen = battlePreview(confirmed, 0)!;
  expect(frozen.frozen).toBe(true);
  expect(frozen.odds).toEqual(rush.odds);
  if (frozen.kind !== 'gym') throw new Error('Expected a Gym');
  expect(frozen.odds).toEqual(gymOdds(frozen.snapshot));
});

test('a Gym entry without a battle-ready Pokémon has no preview', () => {
  const state = gymEntry();
  for (const member of state.players[0]!.team) member.tired = true;
  expect(battlePreview(state, 0)).toBeNull();
});

test('a challenge preview from Strategy equals the response-step terms of the declared battle (§4.4)', () => {
  const strategy = game(['main-character', 'rival'], { 0: 'charmander' });
  const before = stateHash(strategy);
  const odds = challengeOdds(strategy, 0, 1)!;
  expect(stateHash(strategy)).toBe(before);
  const declared = battlePreview(act(strategy, 'declare_pvp', { targetSeatIndex: 1 }), 0)!;
  expect(declared.snapshot).toEqual(odds.snapshot);
  expect(declared.odds).toEqual(odds.odds);
  // A Tired team cannot be challenged and has no odds.
  for (const member of strategy.players[1]!.team) member.tired = true;
  expect(challengeOdds(strategy, 0, 1)).toBeNull();
  expect(() => challengeOdds(strategy, 0, 9)).toThrow(RangeError);
});
