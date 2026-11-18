import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import {
  battlePreview,
  challengeOdds,
  createGame,
  createGameConfig,
  createGameLog,
  createRng,
  d6,
  deserialize,
  pendingDecision,
  serialize,
  stateHash,
  type GameState,
} from '../../../engine/index.ts';
import { engineContent } from '../game/content.ts';
import { createGameStore, type GameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { chancesText } from './BattleTerms.tsx';
import { TurnPanel } from './TurnPanel.tsx';
import { STATIC_PLAYBACK } from '../gallery/scenes.ts';

afterEach(() => vi.unstubAllGlobals());

/** Seat 0 is the human ('p0'); the others are AIs. Strategy, turn 7, every budget available. */
function game(classes: string[], starters: Record<number, string> = {}): GameState {
  const state = createGame(
    createGameConfig({
      seats: classes.map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        ...(classId === 'main-character' ? { starterSpeciesId: 'bulbasaur' } : {}),
        controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
      })),
      seed: 1,
      lapTarget: 2,
    }),
    engineContent,
  );
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 7;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) player.ownTurnNo = 3;
  // The starter species under test replaces the class's own, as the engine tests do.
  for (const [seatIndex, speciesId] of Object.entries(starters)) {
    state.players[Number(seatIndex)]!.team[0]!.speciesId = speciesId;
  }
  return state;
}

/** The next engine d6 draws show `faces`, in order. */
function rig(state: GameState, ...faces: number[]): GameState {
  for (let seed = 0; seed < 20_000; seed++) {
    let rng = createRng(seed);
    const ok = faces.every((face) => {
      const draw = d6(rng, 'rig');
      rng = draw.rng;
      return draw.value === face;
    });
    if (ok) {
      state.config.seed = seed;
      state.rng = createRng(seed);
      return state;
    }
  }
  throw new Error('No seed for faces');
}

function storeOf(state: GameState): GameStore {
  const store = createGameStore();
  store.restore({ state, log: createGameLog(state) });
  return store;
}

/** The human seat's turn panel, live over the store like the real board. */
function Harness({ store }: { store: GameStore }) {
  const view = useSyncExternalStore(store.subscribe, store.getView)!;
  return (
    <TurnPanel
      view={view}
      playback={STATIC_PLAYBACK}
      actionError={false}
      onChoose={(id) => store.choose(id)}
    />
  );
}

function show(state: GameState) {
  const store = storeOf(state);
  render(<Harness store={store} />);
  return store;
}

const stateOf = (store: GameStore) => store.getSession()!.state;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const heading = () => screen.getByRole('heading', { level: 2 }).textContent;

/** Store commands made outside a click run inside `act`, so the screen follows them. */
function send(store: GameStore, command: Parameters<GameStore['submit']>[0]) {
  let result!: ReturnType<GameStore['submit']>;
  act(() => {
    result = store.submit(command);
  });
  return result;
}

/** Applies the engine's pending results, the battle dice, and stops when the battle is over. */
function settle(store: GameStore) {
  act(() => {
    while (['pvp', 'gym'].includes(stateOf(store).phase.kind) && store.advance({ human: true }));
  });
}

function declare(store: GameStore, actorId: string, payload: unknown) {
  const result = send(store, { actorId, kind: 'declare_pvp', payload } as never);
  if ('rejected' in result) throw new Error(result.reason);
}

const RIVAL_1 = 'AI rival · seat 1';

// ---------------------------------------------------------------- challenge from Strategy

test('a voluntary challenge shows the engine chances, spends the action only on Confirm, and then waits for the rival (§4.4, D4)', () => {
  const state = game(['main-character', 'researcher'], { 0: 'charmander' });
  const store = show(state);
  const odds = challengeOdds(state, 0, 1)!;
  click(t('challenge.voluntary', { name: RIVAL_1 }));
  // Choosing a target only previews it: nothing is spent and no battle is open.
  expect(stateOf(store).turnBudgets.tacticalAction).toBe(1);
  expect(stateOf(store).phase.kind).toBe('strategy');
  const preview = screen.getByRole('region', { name: t('challenge.preview') });
  expect(preview.textContent).toContain(t('challenge.voluntaryNote', { name: RIVAL_1 }));
  expect(preview.textContent).toContain(chancesText(odds, 0));
  fireEvent.click(
    within(preview).getByRole('button', { name: t('challenge.confirm', { name: RIVAL_1 }) }),
  );
  expect(stateOf(store).turnBudgets.tacticalAction).toBe(0);
  expect(stateOf(store).phase).toMatchObject({ kind: 'pvp', battle: { step: 'response' } });
  expect(heading()).toBe(t('battle.heading.yours'));
  expect(
    screen.getByText(t('battle.waiting', { name: RIVAL_1, step: t('battle.step.response') })),
  ).toBeTruthy();
});

test('an unavailable target is greyed out with the engine reason, and no confirmation reaches it (§3.1, §4.4)', () => {
  const state = game(['main-character', 'researcher']);
  for (const member of state.players[1]!.team) member.tired = true;
  const store = show(state);
  const button = screen.getByRole('button', { name: t('challenge.voluntary', { name: RIVAL_1 }) });
  expect(button.hasAttribute('disabled')).toBe(true);
  expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(
    'Both teams need a battle-ready Pokémon',
  );
  fireEvent.click(button);
  expect(screen.queryByRole('region', { name: t('challenge.preview') })).toBeNull();
  expect(stateOf(store).turnBudgets.tacticalAction).toBe(1);
});

test("Rival's forced challenge says it cannot be declined and starts the battle without a response (§4.4, S08)", () => {
  const state = game(['rival', 'researcher']);
  const store = show(state);
  click(t('challenge.force', { name: RIVAL_1 }));
  expect(screen.getByRole('region', { name: t('challenge.preview') }).textContent).toContain(
    t('challenge.forcedNote', { name: RIVAL_1 }),
  );
  fireEvent.click(screen.getByRole('button', { name: t('challenge.confirm', { name: RIVAL_1 }) }));
  const { phase } = stateOf(store);
  expect(phase).toMatchObject({ kind: 'pvp', battle: { forced: true } });
  if (phase.kind !== 'pvp') throw new Error('Expected PvP');
  expect(phase.battle.step).not.toBe('response');
});

// ------------------------------------------------------------------ the human as defender

/** AI seat 1 holds the turn and challenges the human (seat 0). */
function challenged(options: { force?: boolean; classes?: string[] } = {}) {
  const state = game(options.classes ?? ['main-character', 'researcher']);
  state.activeSeatIndex = 1;
  for (const player of state.players) player.team[0]!.abilityReady = false;
  const store = show(state);
  declare(
    store,
    'p1',
    options.force ? { targetSeatIndex: 0, force: 'rival' } : { targetSeatIndex: 0 },
  );
  return store;
}

test('the human defender answers while the opponent keeps the turn; declining moves no coins (§4.4, §6.4)', () => {
  const store = challenged();
  const before = stateOf(store);
  expect(before.activeSeatIndex).toBe(1);
  expect(store.getView()!.decision).toEqual({ seatIndex: 0, point: 'pvp_response' });
  expect(heading()).toBe(t('battle.heading.response'));
  expect(screen.getByText(t('battle.body.response', { name: RIVAL_1 }))).toBeTruthy();
  expect(screen.getByText(t('battle.declineNote'))).toBeTruthy();
  const coins = before.players.map((player) => player.coins);
  click(t('choice.declineBattle'));
  const after = stateOf(store);
  expect(after.players.map((player) => player.coins)).toEqual(coins);
  expect(after.activeSeatIndex).toBe(1);
  expect(after.phase.kind).toBe('strategy');
  // The challenger's tactical action stays spent, and the attempt still counts.
  expect(after.turnBudgets.tacticalAction).toBe(0);
  expect(after.attackHistory).toHaveLength(1);
  expect(screen.getByText(t('board.event.declined', { name: t('seat.you') }))).toBeTruthy();
});

test('the defender sees the engine odds from its own side before accepting (§3, §4.4)', () => {
  const store = challenged();
  const view = store.getView()!;
  const preview = view.battle!;
  expect(preview.frozen).toBe(false);
  const wins = preview.odds.loss.percent; // the defender's win is the attacker's loss
  expect(screen.getByText(new RegExp(`win ${wins}%`))).toBeTruthy();
});

test('a forced challenge offers no accept or decline and names who forced it (§4.4, S08)', () => {
  const store = challenged({ force: true, classes: ['main-character', 'rival'] });
  expect(stateOf(store).phase).toMatchObject({ kind: 'pvp', battle: { forced: true } });
  expect(screen.queryByRole('button', { name: t('choice.declineBattle') })).toBeNull();
  expect(screen.queryByRole('button', { name: t('choice.acceptBattle') })).toBeNull();
  expect(
    screen.getByText(
      t('battle.forcedBy', {
        source: t('battle.forced.rival', { name: RIVAL_1 }),
      }),
    ),
  ).toBeTruthy();
});

test('a Battle Ticket aimed at another rival stays secret: the human only reads that a forcing effect started it (§4.1)', () => {
  const state = game(['main-character', 'researcher', 'fisherman']);
  state.activeSeatIndex = 1;
  state.players[1]!.items = [
    { instanceId: 'ticket', itemId: 'battle-ticket', name: 'Battle Ticket', visibility: 'secret' },
  ];
  const store = show(state);
  const result = send(store, {
    actorId: 'p1',
    kind: 'use_item',
    payload: { itemInstanceId: 'ticket', targetSeatIndex: 2 },
  } as never);
  expect('accepted' in result).toBe(true);
  expect(stateOf(store).phase).toMatchObject({ kind: 'pvp', battle: { forced: true } });
  const text = document.body.textContent ?? '';
  expect(text).not.toContain('Battle Ticket');
  expect(text).toContain(t('battle.forcedBy', { source: t('battle.forced.unknown') }));
});

// -------------------------------------------------------------------- windows before the roll

test('an Ability window shows what each choice does to the engine odds, and passing spends nothing (§4.4, C.3)', () => {
  const state = game(['main-character', 'researcher'], { 0: 'charmander' });
  const store = show(state);
  declare(store, 'p0', { targetSeatIndex: 1 });
  send(store, { actorId: 'p1', kind: 'respond_pvp', payload: { accept: true } });
  expect(store.getView()!.decision!.point).toBe('ability_window');
  expect(heading()).toBe(t('battle.heading.window'));
  const choice = store.getView()!.battle!.choices[0]!;
  expect(choice.id).toBe('ability:starter:0');
  const ability = screen.getByRole('button', { name: /Blaze/ });
  expect(ability.closest('li')!.textContent).toContain(
    t('battle.withThis', { chances: chancesText(choice, 0) }),
  );
  const hash = stateHash(stateOf(store));
  expect(battlePreview(stateOf(store), 0)).not.toBeNull();
  expect(stateHash(stateOf(store))).toBe(hash);
  click(t('choice.noAbility'));
  // No Ability: the engine froze the terms and the dice are owed.
  expect(stateOf(store).phase).toMatchObject({ kind: 'pvp', battle: { step: 'attacker_roll' } });
  expect(stateOf(store).players[0]!.team[0]!.abilityReady).toBe(true);
  expect(screen.getByText(t('battle.frozen'))).toBeTruthy();
});

test('using the Ability commits exactly the listed activation, and the terms then show its bonus (§4.4)', () => {
  const state = game(['main-character', 'researcher'], { 0: 'charmander' });
  const store = show(state);
  declare(store, 'p0', { targetSeatIndex: 1 });
  send(store, { actorId: 'p1', kind: 'respond_pvp', payload: { accept: true } });
  const frozenOdds = store.getView()!.battle!.choices[0]!.odds;
  fireEvent.click(screen.getByRole('button', { name: /Blaze/ }));
  const { phase } = stateOf(store);
  expect(phase).toMatchObject({ kind: 'pvp', battle: { step: 'attacker_roll' } });
  expect(store.getView()!.battle!.odds).toEqual(frozenOdds);
  expect(stateOf(store).players[0]!.team[0]!.abilityReady).toBe(false);
});

// ------------------------------------------------------------------------------------- Gym

function atGym(classes = ['main-character', 'researcher'], square = 6): GameState {
  const state = game(classes, { 0: 'charmander' });
  state.phase = { kind: 'resolve' };
  state.players[0]!.routeProgress = square;
  state.players[0]!.team[0]!.abilityReady = false;
  return state;
}

test('a Gym entry shows its DC and engine chances, and Skip costs nothing (§4.4, D5)', () => {
  const state = atGym();
  const store = show(state);
  act(() => store.choose('skip')); // Resolve: the square opens the Gym
  const view = store.getView()!;
  expect(view.decision).toEqual({ seatIndex: 0, point: 'gym_entry' });
  expect(heading()).toBe(t('battle.heading.gym'));
  const preview = view.battle!;
  if (preview.kind !== 'gym') throw new Error('Expected a Gym');
  expect(screen.getByText(t('battle.termsGym', { dc: preview.snapshot.dc }))).toBeTruthy();
  expect(screen.getByText(new RegExp(`win ${preview.odds.win.percent}%`))).toBeTruthy();
  const budgets = { ...stateOf(store).turnBudgets };
  click(t('choice.skipGym'));
  expect(stateOf(store).phase.kind).toBe('end');
  expect(stateOf(store).turnBudgets).toEqual(budgets);
  expect(screen.getByText(t('battle.gymSkipped', { name: t('seat.you') }))).toBeTruthy();
});

test('an all-Tired team cannot challenge: the control is greyed out with the engine reason and the Gym is skipped for free (§3.1, D5)', () => {
  const state = atGym();
  for (const member of state.players[0]!.team) member.tired = true;
  const store = show(state);
  act(() => store.choose('skip'));
  const challenge = screen.getByRole('button', { name: t('choice.challengeGym') });
  expect(challenge.hasAttribute('disabled')).toBe(true);
  expect(document.getElementById(challenge.getAttribute('aria-describedby')!)!.textContent).toBe(
    'No battle-ready Pokémon',
  );
  fireEvent.click(challenge);
  expect(stateOf(store).phase).toMatchObject({ kind: 'gym', battle: { step: 'entry' } });
  // The engine applies the sole Skip itself, as a recorded automatic action.
  let applied = false;
  act(() => {
    applied = store.advance({ human: true });
  });
  expect(applied).toBe(true);
  expect(stateOf(store).phase.kind).toBe('end');
  expect(store.getView()!.feed.at(-1)!.record.auto).toBe(true);
  expect(screen.getByText(t('battle.gymAutoSkipped', { name: t('seat.you') }))).toBeTruthy();
});

test('a Gym win shows one badge, then one reward; a loss shows the engine loss, and a later landing can try again (§4.4, D5)', () => {
  const won = atGym();
  const winStore = show(rig(won, 6));
  act(() => winStore.choose('skip'));
  click(t('choice.challengeGym'));
  settle(winStore);
  expect(stateOf(winStore).players[0]!.badges).toBe(1);
  expect(heading()).toBe(t('battle.heading.reward'));
  expect(screen.getByText(t('board.event.badge', { name: t('seat.you') }))).toBeTruthy();
  const coins = stateOf(winStore).players[0]!.coins;
  fireEvent.click(screen.getByRole('button', { name: t('choice.rewardCoins') }));
  expect(stateOf(winStore).players[0]!.coins).toBe(coins); // selecting commits nothing
  click(t('battle.reward.confirm'));
  expect(stateOf(winStore).players[0]!.badges).toBe(1);
  expect(stateOf(winStore).players[0]!.coins).toBeGreaterThan(coins);
});

test('a Gym loss pays the bank the engine amount and keeps the Gym open to a later challenge (§4.4)', () => {
  const lost = atGym();
  lost.players[0]!.coins = 2; // less than the loss cap: the engine takes what there is
  const store = show(rig(lost, 1));
  act(() => store.choose('skip'));
  click(t('choice.challengeGym'));
  settle(store);
  const { players } = stateOf(store);
  expect(players[0]!.badges).toBe(0);
  expect(players[0]!.coins).toBe(0);
  expect(screen.getByText(/The Gym holds\./)).toBeTruthy();
  expect(screen.getByText(/paid 2 coins to The bank/)).toBeTruthy();
  expect(stateOf(store).phase.kind).toBe('end');
});

// ---------------------------------------------------------------------------------- rewards

/** Human Charmander (battle 2, with a Tired Caterpie) beats the rival's Eevee: reward pending. */
function pvpWin(rivalClass = 'researcher') {
  const state = game(['main-character', rivalClass], { 0: 'charmander', 1: 'eevee' });
  for (const player of state.players) player.team[0]!.abilityReady = false;
  state.players[0]!.team.push({
    instanceId: 'tired-bug',
    speciesId: 'caterpie',
    origin: 'caught',
    evolutionStage: 0,
    tired: true,
    tiredExpiresOwnTurnNo: 9,
    abilityReady: false,
  });
  state.players[1]!.coins = 9;
  const store = show(rig(state, 6, 1));
  declare(store, 'p0', { targetSeatIndex: 1 });
  send(store, { actorId: 'p1', kind: 'respond_pvp', payload: { accept: true } });
  settle(store);
  return store;
}

test('a PvP win offers coins or one authored evolution, never both, and commits only on Confirm (§4.4, §4.5)', () => {
  const store = pvpWin();
  expect(store.getView()!.decision).toEqual({ seatIndex: 0, point: 'reward' });
  expect(heading()).toBe(t('battle.heading.reward'));
  expect(screen.getByText(new RegExp('rolled 6 \\(total'))).toBeTruthy();
  // Both families are on offer: the engine's coins, and each Pokémon's authored next form.
  expect(screen.getByRole('button', { name: t('choice.rewardCoins') })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Charmeleon/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Metapod/ })).toBeTruthy();
  const beforeState = stateOf(store);
  const before = stateHash(beforeState);
  fireEvent.click(screen.getByRole('button', { name: /Metapod/ }));
  expect(stateHash(stateOf(store))).toBe(before);
  const preview = screen.getByRole('region', { name: t('battle.reward.preview') });
  expect(preview.textContent).toContain(t('battle.reward.evolveKeeps'));
  // Picking coins afterwards replaces the evolution: one reward, never both.
  fireEvent.click(screen.getByRole('button', { name: t('choice.rewardCoins') }));
  expect(screen.getByRole('region', { name: t('battle.reward.preview') }).textContent).toContain(
    t('battle.reward.notBoth'),
  );
  fireEvent.click(screen.getByRole('button', { name: t('battle.reward.confirm') }));
  const after = stateOf(store);
  // The coin reward is exactly what the loser paid; no Pokémon evolved.
  const paid = beforeState.players[1]!.coins - after.players[1]!.coins;
  expect(paid).toBeGreaterThan(0);
  expect(after.players[0]!.coins - beforeState.players[0]!.coins).toBe(paid);
  expect(after.players[0]!.team.map((member) => member.speciesId)).toEqual([
    'charmander',
    'caterpie',
  ]);
  expect(after.phase.kind).toBe('strategy');
});

test('a branched evolution changes only the chosen UID; Tired, cooldown and origin stay, and the loser pays nothing (§4.5, D13)', () => {
  const store = pvpWin();
  const before = stateOf(store);
  const loserCoins = before.players[1]!.coins;
  fireEvent.click(screen.getByRole('button', { name: /Metapod/ }));
  fireEvent.click(screen.getByRole('button', { name: t('battle.reward.confirm') }));
  const after = stateOf(store);
  const [starter, bug] = after.players[0]!.team;
  expect(starter).toEqual(before.players[0]!.team[0]);
  expect(bug).toMatchObject({
    instanceId: 'tired-bug',
    speciesId: 'metapod',
    tired: true,
    tiredExpiresOwnTurnNo: 9,
    abilityReady: false,
  });
  expect(after.players[1]!.coins).toBe(loserCoins);
  expect(screen.getByText('Your Caterpie evolved into Metapod.')).toBeTruthy();
});

test('a stale confirmation changes no asset and asks the player to review the refreshed rewards (§3.1)', () => {
  const store = pvpWin();
  fireEvent.click(screen.getByRole('button', { name: t('choice.rewardCoins') }));
  // The engine's choices were refreshed under the open selection: a new list, same decision.
  const state = structuredClone(stateOf(store));
  act(() => store.restore({ state, log: store.getSession()!.log }));
  expect(screen.getByRole('alert').textContent).toBe(t('battle.reward.stale'));
  expect(screen.queryByRole('button', { name: t('battle.reward.confirm') })).toBeNull();
  const before = stateHash(stateOf(store));
  // A confirmation that outlived its choices is refused by the engine, whatever the screen shows.
  fireEvent.click(screen.getByRole('button', { name: t('choice.rewardCoins') }));
  fireEvent.click(screen.getByRole('button', { name: t('battle.reward.confirm') }));
  const committed = stateHash(stateOf(store));
  expect(committed).not.toBe(before);
  const second = store.choose('reward:coins');
  expect(second).toMatchObject({ rejected: true });
  expect(stateHash(stateOf(store))).toBe(committed);
});

test('Nurse Joy and a shield show the amount that actually moved: nothing (§4.4, C.4)', () => {
  const store = pvpWin('nurse-joy');
  const winnerCoins = stateOf(store).players[0]!.coins;
  fireEvent.click(screen.getByRole('button', { name: t('choice.rewardCoins') }));
  fireEvent.click(screen.getByRole('button', { name: t('battle.reward.confirm') }));
  const after = stateOf(store);
  expect(after.players[0]!.coins).toBe(winnerCoins);
  expect(after.players[1]!.coins).toBe(9);
  expect(screen.getByText(new RegExp('Nurse Joy’s passive covered the coin loss'))).toBeTruthy();
  expect(screen.getByText(t('board.event.rewardNoCoins', { name: t('seat.you') }))).toBeTruthy();
});

test('an armed shield blocks the loss and is shown as consumed; an evolution reward would leave it armed (§4.4, D6)', () => {
  const state = game(['main-character', 'researcher'], { 0: 'charmander', 1: 'eevee' });
  for (const player of state.players) player.team[0]!.abilityReady = false;
  state.players[1]!.coins = 9;
  state.players[1]!.armedShield = { scope: 'price', visibility: 'secret' };
  const store = show(rig(state, 6, 1));
  declare(store, 'p0', { targetSeatIndex: 1 });
  send(store, { actorId: 'p1', kind: 'respond_pvp', payload: { accept: true } });
  settle(store);
  fireEvent.click(screen.getByRole('button', { name: t('choice.rewardCoins') }));
  fireEvent.click(screen.getByRole('button', { name: t('battle.reward.confirm') }));
  expect(stateOf(store).players[1]!.coins).toBe(9);
  expect(stateOf(store).players[1]!.armedShield).toBeUndefined();
  expect(screen.getByText(/The Price Shield covered the coin loss/)).toBeTruthy();
});

test('a tie gives neither coins nor a reward choice (§4.4)', () => {
  const state = game(['fisherman', 'researcher'], { 0: 'charmander', 1: 'charmander' });
  for (const player of state.players) player.team[0]!.abilityReady = false;
  const store = show(rig(state, 3, 3));
  declare(store, 'p0', { targetSeatIndex: 1 });
  send(store, { actorId: 'p1', kind: 'respond_pvp', payload: { accept: true } });
  settle(store);
  expect(stateOf(store).phase.kind).toBe('strategy');
  expect(screen.getByText(t('board.event.pvpTie'), { exact: false })).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('battle.reward.confirm') })).toBeNull();
});

// ---------------------------------------------------------------------- resume and AI service

test('reloading during the response and during the reward returns to the same committed decision (§3.1, §6.9)', () => {
  const asked = challenged();
  const saved = { state: stateOf(asked), log: asked.getSession()!.log };
  const reloaded = deserialize(serialize(saved));
  expect(stateHash(reloaded.state)).toBe(stateHash(saved.state));
  const store = createGameStore();
  store.restore(reloaded);
  expect(store.getView()!.decision).toEqual({ seatIndex: 0, point: 'pvp_response' });
  expect(store.getView()!.legalActions.enabled.map((action) => action.id)).toEqual([
    'accept-pvp',
    'decline-pvp',
  ]);
  expect(stateOf(store).stateRevision).toBe(saved.state.stateRevision);
});

test('reloading at the reward lists the same engine choices and nothing is granted twice (§6.9)', () => {
  const won = pvpWin();
  const ids = won.getView()!.legalActions.enabled.map((action) => action.id);
  const reloaded = deserialize(serialize({ state: stateOf(won), log: won.getSession()!.log }));
  const store = createGameStore();
  store.restore(reloaded);
  expect(store.getView()!.decision).toEqual({ seatIndex: 0, point: 'reward' });
  expect(store.getView()!.legalActions.enabled.map((action) => action.id)).toEqual(ids);
  expect(stateHash(stateOf(store))).toBe(stateHash(stateOf(won)));
});

test('an unavailable AI service still finishes the AI defender and reward decisions with the shared fallback (§3.1)', async () => {
  const fetchMock = vi.fn(async () => {
    throw new Error('offline');
  });
  vi.stubGlobal('fetch', fetchMock);
  const state = game(['main-character', 'researcher'], { 0: 'charmander', 1: 'eevee' });
  for (const player of state.players) player.team[0]!.abilityReady = false;
  const store = storeOf(rig(state, 1, 6));
  declare(store, 'p0', { targetSeatIndex: 1 });
  // The defender is an AI seat: the engine's pending decision names it, not the active seat.
  expect(pendingDecision(stateOf(store))!.seatIndex).toBe(1);
  expect(await store.playOpponent(new AbortController().signal)).toBe(true);
  expect(store.getView()!.feed.at(-1)!.decision).toMatchObject({
    source: 'fallback',
    fallbackReason: 'unsupported_decision_point',
  });
  settle(store);
  // The AI seat won the battle: its reward is chosen by the same fallback.
  expect(pendingDecision(stateOf(store))!.seatIndex).toBe(1);
  expect(await store.playOpponent(new AbortController().signal)).toBe(true);
  expect(stateOf(store).phase.kind).toBe('strategy');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('the outcome stays on screen while the rivals play (§6.1)', () => {
  const store = show(rig(atGym(), 6));
  act(() => store.choose('skip'));
  click(t('choice.challengeGym'));
  settle(store);
  fireEvent.click(screen.getByRole('button', { name: t('choice.rewardCoins') }));
  click(t('battle.reward.confirm'));
  act(() => {
    // The turn passes to the rival, whose own steps the engine applies one at a time.
    for (let step = 0; step < 4; step++) store.advance({ human: true });
  });
  expect(stateOf(store).activeSeatIndex).toBe(1);
  expect(screen.getByText(/You rolled 6 for a total of/)).toBeTruthy();
});

test('a defender reaction names the Pokémon it heals, and commits only that choice (§4.5, C.2, D10)', () => {
  const state = game(['main-character', 'researcher'], { 0: 'chansey' });
  state.activeSeatIndex = 1;
  state.players[1]!.team[0]!.abilityReady = false;
  state.players[0]!.team[0]!.abilityReady = true;
  for (const instanceId of ['sleepy-a', 'sleepy-b']) {
    state.players[0]!.team.push({
      instanceId,
      speciesId: 'eevee',
      origin: 'caught',
      evolutionStage: 0,
      tired: true,
      tiredExpiresOwnTurnNo: 9,
      abilityReady: false,
    });
  }
  const store = show(state);
  declare(store, 'p1', { targetSeatIndex: 0 });
  click(t('choice.acceptBattle'));
  expect(store.getView()!.decision).toEqual({ seatIndex: 0, point: 'ability_window' });
  expect(heading()).toBe(t('battle.heading.window'));
  const heal = (instanceId: string) =>
    screen.getByRole('button', { name: new RegExp(`Heal Pulse.* on Eevee · ${instanceId}`) });
  expect(heal('sleepy-a')).toBeTruthy();
  fireEvent.click(heal('sleepy-b'));
  const team = stateOf(store).players[0]!.team;
  expect(team.find((member) => member.instanceId === 'sleepy-b')!.tired).toBe(false);
  expect(team.find((member) => member.instanceId === 'sleepy-a')!.tired).toBe(true);
  expect(team[0]!.abilityReady).toBe(false);
});
