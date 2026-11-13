import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import {
  createGame,
  createGameLog,
  legalActions,
  observe,
  type GameState,
} from '../../../engine/index.ts';
import { engineContent } from '../game/content.ts';
import { configForSetup, createGameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { BoardScreen } from './BoardScreen.tsx';
import { StrategyPanel } from './StrategyPanel.tsx';

// Public seams: real Strategy controls -> store.choose -> engine; only Observation enters UI.
function potionState(): GameState {
  const state = createGame(
    configForSetup(
      {
        mode: 'quick',
        human: { classId: 'main-character', starterSpeciesId: 'bulbasaur' },
        opponents: [
          {
            classId: 'rival',
            starterSpeciesId: 'eevee',
            personality: 'greedy',
            difficulty: 'normal',
          },
        ],
      },
      3,
    ),
    engineContent,
  );
  state.phase = { kind: 'strategy' };
  state.activeSeatIndex = 0;
  state.turnBudgets.tacticalAction = 1;
  const owner = state.players[0]!;
  owner.team = ['first', 'second'].map((id) => ({
    ...owner.team[0]!,
    instanceId: `bulbasaur-${id}`,
    tired: true,
    tiredExpiresOwnTurnNo: owner.ownTurnNo + 1,
  }));
  owner.items = ['selected-potion', 'spare-potion'].map((instanceId) => ({
    instanceId,
    itemId: 'potion',
    name: 'Potion',
    visibility: 'secret',
  }));
  return state;
}

function start(state = potionState()) {
  vi.useFakeTimers();
  const store = createGameStore();
  store.restore({ state, log: createGameLog(state) });
  render(<BoardScreen store={store} />);
  return store;
}

function selectSecond() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Potion' })[0]!);
  const targets = screen.getByRole('group', { name: t('strategy.potion.targets') });
  fireEvent.click(within(targets).getByRole('button', { name: /bulbasaur-second/ }));
}

const confirm = () =>
  screen.getByRole('button', { name: t('strategy.confirm', { item: 'Potion' }) });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('two same-species Tired members stay distinct; separate confirmation heals only the second and spends exactly the selected Potion once', () => {
  const store = start();
  const before = store.getSession();
  fireEvent.click(screen.getAllByRole('button', { name: 'Potion' })[0]!);
  const targets = screen.getByRole('group', { name: t('strategy.potion.targets') });
  expect(within(targets).getByRole('button', { name: /Bulbasaur.*bulbasaur-first/ })).toBeTruthy();
  expect(within(targets).getByRole('button', { name: /Bulbasaur.*bulbasaur-second/ })).toBeTruthy();
  expect(screen.queryByLabelText(t('strategy.preview'))).toBeNull();
  expect(store.getSession()).toBe(before);
  fireEvent.click(within(targets).getByRole('button', { name: /bulbasaur-second/ }));
  const preview = screen.getByLabelText(t('strategy.preview'));
  expect(preview.textContent).toContain('bulbasaur-second');
  expect(preview.textContent).toContain('Tired');
  expect(preview.textContent).not.toContain('bulbasaur-first');
  expect(store.getSession()).toBe(before);
  fireEvent.click(confirm());
  const { state, log } = store.getSession()!;
  expect(state.players[0]!.team.map((pokemon) => pokemon.tired)).toEqual([true, false]);
  expect(state.players[0]!.items.map((item) => item.instanceId)).toEqual(['spare-potion']);
  expect(state.turnBudgets.tacticalAction).toBe(0);
  expect(log.actions).toHaveLength(1);
  expect(log.actions[0]!.action).toMatchObject({
    kind: 'use_item',
    payload: { itemInstanceId: 'selected-potion', targetPokemonInstanceId: 'bulbasaur-second' },
  });
});

test.each(['no-target', 'budget-used'] as const)(
  '%s shows the engine reason without an empty target panel',
  (scenario) => {
    const state = potionState();
    if (scenario === 'no-target')
      state.players[0]!.team.forEach((pokemon) => (pokemon.tired = false));
    else state.turnBudgets.tacticalAction = 0;
    const store = start(state);
    const before = store.getSession();
    const potion = screen.getAllByRole('button', { name: 'Potion' })[0]!;
    expect(potion.hasAttribute('disabled')).toBe(true);
    const reason = store
      .getView()!
      .legalActions.disabled.find((action) => action.kind === 'use_item')!;
    expect(document.getElementById(potion.getAttribute('aria-describedby')!)!.textContent).toBe(
      reason.reasonText,
    );
    fireEvent.click(potion);
    expect(screen.queryByRole('group', { name: t('strategy.potion.targets') })).toBeNull();
    expect(screen.queryByLabelText(t('strategy.preview'))).toBeNull();
    expect(store.getSession()).toBe(before);
  },
);

test('healthy own members and foreign Tired members never become invented targets', () => {
  const state = potionState();
  state.players[0]!.team[0]!.tired = false;
  state.players[1]!.team[0]!.tired = true;
  start(state);
  fireEvent.click(screen.getAllByRole('button', { name: 'Potion' })[0]!);
  const targets = screen.getByRole('group', { name: t('strategy.potion.targets') });
  expect(within(targets).queryByRole('button', { name: /bulbasaur-first/ })).toBeNull();
  expect(within(targets).queryByRole('button', { name: /Eevee/ })).toBeNull();
  expect(within(targets).getByRole('button', { name: /bulbasaur-second/ })).toBeTruthy();
});

test.each(['removed', 'disabled', 'still-legal'] as const)(
  'a %s target on a refreshed action list invalidates the old preview and requires a fresh selection',
  (change) => {
    const state = potionState();
    const onChoose = vi.fn();
    const panel = (current: GameState) => (
      <StrategyPanel
        observation={observe(current, 0)}
        legalActions={legalActions(current, 0)}
        onChoose={onChoose}
      />
    );
    const { rerender } = render(panel(state));
    selectSecond();
    expect(confirm()).toBeTruthy();
    const next = structuredClone(state);
    if (change === 'removed') next.players[0]!.team.pop();
    if (change === 'disabled') next.turnBudgets.tacticalAction = 0;
    rerender(panel(next));
    expect(screen.queryByLabelText(t('strategy.preview'))).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(t('strategy.potion.staleSelection'));
    expect(onChoose).not.toHaveBeenCalled();
  },
);

test('a changed engine-disabled target reason stays visible through the shared action control', () => {
  const state = potionState();
  const choices = legalActions(state, 0);
  const first = choices.enabled.find((action) => action.kind === 'use_item')!;
  choices.enabled = choices.enabled.filter((action) => action.id !== first.id);
  choices.disabled.push({
    ...first,
    reasonCode: 'NO_VALID_TARGET',
    reasonText: 'Target no longer has Tired',
  });
  render(
    <StrategyPanel
      observation={observe(state, 0)}
      legalActions={choices}
      onChoose={() => {
        throw new Error('Disabled target used');
      }}
    />,
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Potion' })[0]!);
  const target = screen.getByRole('button', { name: /bulbasaur-first/ });
  expect(target.hasAttribute('disabled')).toBe(true);
  expect(document.getElementById(target.getAttribute('aria-describedby')!)!.textContent).toBe(
    'Target no longer has Tired',
  );
});

test('a stale confirmation race shows rejection and refreshes choices without spending the selected Potion or healing another member', () => {
  const store = start();
  selectSecond();
  const choose = store.choose.bind(store);
  vi.spyOn(store, 'choose').mockImplementationOnce((id) => {
    choose('use-item:spare-potion:bulbasaur-second:tired');
    return choose(id);
  });
  fireEvent.click(confirm());
  expect(screen.getByRole('alert').textContent).toBe(t('turn.actionError'));
  expect(store.getSession()!.state.players[0]!.team.map((pokemon) => pokemon.tired)).toEqual([
    true,
    false,
  ]);
  expect(store.getSession()!.state.players[0]!.items.map((item) => item.instanceId)).toEqual([
    'selected-potion',
  ]);
  expect(store.getSession()!.log.actions).toHaveLength(1);
  expect(screen.queryByLabelText(t('strategy.preview'))).toBeNull();
});

test('double confirmation is rejected without consuming the spare Potion or healing the first member', () => {
  const store = start();
  selectSecond();
  const button = confirm();
  act(() => {
    button.click();
    button.click();
  });
  expect(screen.getByRole('alert').textContent).toBe(t('turn.actionError'));
  expect(store.getSession()!.log.actions).toHaveLength(1);
  expect(store.getSession()!.state.players[0]!.team.map((pokemon) => pokemon.tired)).toEqual([
    true,
    false,
  ]);
  expect(store.getSession()!.state.players[0]!.items.map((item) => item.instanceId)).toEqual([
    'spare-potion',
  ]);
});
