import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import {
  createGame,
  createGameConfig,
  createGameLog,
  createRng,
  d6,
  legalActions,
  observe,
  type GameState,
  type PokemonInstance,
} from '../../../engine/index.ts';
import { engineContent } from '../game/content.ts';
import { createGameStore, type GameStore } from '../game/store.ts';
import { STATIC_PLAYBACK } from '../gallery/scenes.ts';
import { t } from '../i18n/en.ts';
import { AbilityPanel } from './AbilityPanel.tsx';
import { battleResultRows } from './BattleResult.tsx';
import { StrategyPanel } from './StrategyPanel.tsx';
import { TurnPanel } from './TurnPanel.tsx';
import { turnMessages } from './turnMessages.ts';

afterEach(() => vi.unstubAllGlobals());

const member = (speciesId: string, instanceId: string): PokemonInstance => ({
  instanceId,
  speciesId,
  origin: 'caught',
  evolutionStage: 0,
  tired: false,
  abilityReady: true,
});

/** Seat 0 is the human ('p0') with Porygon; seat 1 is an AI. Seed and turn budgets are fixed. */
function game(phase: GameState['phase']): GameState {
  const state = createGame(
    createGameConfig({
      seats: ['main-character', 'researcher'].map((classId, seatIndex) => ({
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
  state.phase = phase;
  state.globalTurnNo = 7;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) player.ownTurnNo = 3;
  state.players[0]!.team[0]!.speciesId = 'porygon';
  state.players[0]!.team[0]!.abilityReady = true;
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
  const store = createGameStore();
  store.restore({ state, log: createGameLog(state) });
  render(<Harness store={store} />);
  return store;
}

const stateOf = (store: GameStore) => store.getSession()!.state;
const advance = (store: GameStore) => act(() => void store.advance({ human: true }));
const keys = (store: GameStore) =>
  store.getView()!.feed.flatMap((entry) => turnMessages(entry, 0).map(({ key }) => key));
const die = () => document.querySelector('.reroll-die');

/** Seat 0 holds the Calculate window open after a rigged catch die; `face` is that die. */
function catchWindow(face: number, reroll?: number) {
  const state = game({ kind: 'encounter', pokemon: { speciesId: 'dratini' } });
  const store = show(reroll === undefined ? rig(state, face) : rig(state, face, reroll));
  const ball = legalActions(stateOf(store), 0).enabled.find((action) => action.kind === 'catch')!;
  act(() => store.choose(ball.id));
  advance(store);
  return store;
}

// ------------------------------------------------------------- 1. the die in a reroll window

test('a move reroll window shows the die and the square keeping it lands on (§3.1, §4.2, C.6)', () => {
  const state = game({ kind: 'move', awaitingResult: true });
  state.players[0]!.routeProgress = 3;
  const store = show(rig(state, 4));
  advance(store);
  expect(stateOf(store).phase).toMatchObject({ kind: 'move', rolled: 4 });
  expect(die()!.textContent).toBe(t('reroll.move', { die: 4, square: 7 }));
  expect(screen.getByRole('button', { name: t('choice.keepDie') })).toBeTruthy();
});

test('a slowed move window says the die and the steps it becomes (§4.6)', () => {
  const state = game({ kind: 'move', awaitingResult: true });
  state.players[0]!.routeProgress = 3;
  state.players[0]!.pendingSlows = ['repel'];
  const store = show(rig(state, 5));
  advance(store);
  expect(die()!.textContent).toBe(t('reroll.moveSlowed', { die: 5, steps: 3, square: 6 }));
});

test('a catch reroll window shows the die and the total against the DC, hit or miss (§4.3)', () => {
  for (const face of [1, 6]) {
    const store = catchWindow(face);
    const phase = stateOf(store).phase;
    if (phase.kind !== 'encounter' || !phase.catchRoll) throw new Error('Expected a catch window');
    const { catchDC, classBonus, ballBonus, abilityBonus, itemBonus } = phase.catchRoll;
    const total = face + classBonus + ballBonus + abilityBonus + itemBonus;
    expect(die()!.textContent).toBe(
      t(total >= catchDC ? 'reroll.catchHit' : 'reroll.catchMiss', {
        die: face,
        total,
        dc: catchDC,
      }),
    );
    document.body.innerHTML = '';
  }
});

test('no die line appears outside a move or catch reroll window', () => {
  show(game({ kind: 'move', awaitingResult: true }));
  expect(die()).toBeNull();
});

// ------------------------------------------------------- 2. a catch is announced once it is final

test('a reroll that turns a miss into a catch never announces an escape (§4.3, C.6)', () => {
  const store = catchWindow(1, 6);
  // Face 1 misses for this ball; the window is still open, so nothing is final yet.
  expect(die()!.textContent).toBe(t('reroll.catchMiss', { die: 1, total: 2, dc: 5 }));
  expect(keys(store)).not.toContain('encounter.escaped');
  expect(keys(store)).not.toContain('encounter.caught');
  const reroll = legalActions(stateOf(store), 0).enabled.find(
    (action) => action.kind === 'activate_ability',
  )!;
  act(() => store.choose(reroll.id));
  advance(store);
  expect(stateOf(store).players[0]!.team).toHaveLength(2);
  expect(keys(store)).toContain('encounter.caught');
  expect(keys(store)).not.toContain('encounter.escaped');
  expect(document.querySelector('.catch-result')!.getAttribute('data-message-key')).toBe(
    'encounter.caught',
  );
});

test('keeping a missed die announces the escape then, and keeping a hit announces the catch', () => {
  const missed = catchWindow(1);
  expect(keys(missed)).not.toContain('encounter.escaped');
  act(() => missed.choose('keep-die'));
  expect(keys(missed).filter((key) => key.startsWith('encounter.'))).toEqual(['encounter.escaped']);
  document.body.innerHTML = '';
  const hit = catchWindow(6);
  act(() => hit.choose('keep-die'));
  expect(keys(hit).filter((key) => key.startsWith('encounter.'))).toEqual(['encounter.caught']);
});

// ------------------------------------------------------------------------ 3. "This battle"

test("a rival's item use after the battle is not part of 'This battle' (§4.4, §6.1)", () => {
  const state = game({ kind: 'resolve' });
  state.players[0]!.team[0]!.speciesId = 'charmander';
  state.players[0]!.routeProgress = 6; // the Gym square
  state.players[0]!.team[0]!.abilityReady = false;
  state.players[1]!.items = [
    { instanceId: 'rival-repel', itemId: 'repel', name: 'Repel', visibility: 'secret' },
  ];
  const store = show(rig(state, 6));
  act(() => store.choose('skip'));
  act(() =>
    store.choose(
      legalActions(stateOf(store), 0).enabled.find((a) => a.kind === 'challenge_gym')!.id,
    ),
  );
  act(() => {
    while (stateOf(store).phase.kind === 'gym' && store.advance({ human: true }));
  });
  const reward = legalActions(stateOf(store), 0).enabled.find(
    (action) => action.kind === 'choose_reward',
  )!;
  act(() => store.choose(reward.id));
  const during = battleResultRows(store.getView()!).map((row) => row.key);
  expect(during).toContain('board.event.gymResolved');
  // The turn passes to the rival, who reaches Strategy and uses Repel on the human.
  act(() => {
    for (
      let step = 0;
      step < 10 &&
      !(stateOf(store).activeSeatIndex === 1 && stateOf(store).phase.kind === 'strategy');
      step++
    ) {
      store.advance({ human: true });
    }
  });
  const repel = legalActions(stateOf(store), 1).enabled.find(
    (action) => action.kind === 'use_item' && action.payload.targetSeatIndex === 0,
  )!;
  act(
    () => void store.submit({ actorId: 'p1', kind: repel.kind, payload: repel.payload } as never),
  );
  const feed = store.getView()!.feed;
  expect(
    feed.some(({ record }) => record.events.some((event) => event.kind === 'hostile_item_used')),
  ).toBe(true);
  // The human sees the Repel in the log, but 'This battle' keeps only the battle's own records.
  expect(battleResultRows(store.getView()!).map((row) => row.key)).toEqual(during);
  expect(screen.queryByText(/Repel/, { selector: '.battle-result *' })).toBeNull();
});

// ------------------------------------------------------------ 4. no internal id, no build note

const INTERNAL = /starter:\d|caught:\d|\bt:|owned-|instance|\bbuild\b|not tracked yet/i;

function strategyState() {
  const state = game({ kind: 'strategy' });
  state.players[0]!.team = [
    { ...member('porygon', 'starter:0'), origin: 'original_starter' },
    member('caterpie', 'caught:0:80'),
    member('caterpie', 'caught:0:90'),
  ];
  state.players[0]!.items = ['potion', 'repel'].map((itemId) => ({
    instanceId: `owned-${itemId}`,
    itemId,
    name: itemId,
    visibility: 'secret',
  }));
  state.players[0]!.team[1]!.tired = true;
  return state;
}

test('the Ability panel names Pokémon, never a Team ID (§3.1)', () => {
  const state = strategyState();
  const { container } = render(
    <AbilityPanel
      observation={observe(state, 0)}
      legalActions={legalActions(state, 0)}
      onChoose={() => {}}
    />,
  );
  expect(container.textContent).toContain('Porygon');
  expect(container.textContent).not.toMatch(INTERNAL);
});

test('the Strategy panel says nothing of a build and lists Potion targets by name (§3.1)', () => {
  const state = strategyState();
  const { container } = render(
    <StrategyPanel
      observation={observe(state, 0)}
      legalActions={legalActions(state, 0)}
      challenges={[]}
      onChoose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Potion/ }));
  expect(container.textContent).toContain(t('strategy.potion.targets'));
  // Two Caterpie stay apart by number, and neither shows its id.
  expect(screen.getByRole('button', { name: 'Caterpie #1' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Caterpie #1' }));
  expect(container.textContent).toContain(t('strategy.potion.target', { pokemon: 'Caterpie #1' }));
  expect(container.textContent).not.toMatch(INTERNAL);
});
