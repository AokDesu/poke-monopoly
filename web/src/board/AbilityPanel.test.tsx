import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import {
  actionVisibleTo,
  applyAction,
  createGame,
  createGameLog,
  legalActions,
  observe,
  pendingDecision,
  type Action,
  type GameState,
  type LegalActions,
  type PokemonInstance,
} from '../../../engine/index.ts';
import { content, engineContent } from '../game/content.ts';
import { configForSetup, createGameStore, type GameSession } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { openFolds } from '../test/folds.ts';
import { AbilityPanel } from './AbilityPanel.tsx';
import { BoardScreen } from './BoardScreen.tsx';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const member = (speciesId: string, instanceId = `t:${speciesId}`): PokemonInstance => ({
  instanceId,
  speciesId,
  origin: 'caught',
  evolutionStage: 0,
  tired: false,
  abilityReady: true,
});

/** The human (seat 0) is active in Strategy with the given team; two AI rivals sit at seats 1 and 2. */
function strategy(team: readonly PokemonInstance[], seed = 3): GameState {
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
          {
            classId: 'researcher',
            starterSpeciesId: 'porygon',
            personality: 'greedy',
            difficulty: 'normal',
          },
        ],
      },
      seed,
    ),
    engineContent,
  );
  state.phase = { kind: 'strategy' };
  state.activeSeatIndex = 0;
  state.globalTurnNo = 7;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) player.ownTurnNo = 2;
  state.players[0]!.team = [...team];
  return state;
}

function open(state: GameState, log = createGameLog(state)) {
  vi.useFakeTimers();
  const store = createGameStore();
  store.restore({ state, log }, [
    { seatIndex: 1, personality: 'greedy', difficulty: 'normal' },
    { seatIndex: 2, personality: 'greedy', difficulty: 'normal' },
  ]);
  render(<BoardScreen store={store} />);
  return store;
}

const disabledReason = (name: string) => {
  // Greyed-out Abilities fold into one line; the player opens it to read why.
  openFolds();
  const button = screen.getByRole('button', { name });
  expect(button.hasAttribute('disabled')).toBe(true);
  return document.getElementById(button.getAttribute('aria-describedby')!)!.textContent;
};

test('Quick Flight previews its effect and costs, then confirming commits exactly that action and the move uses the fixed steps instead of a die (§4.5, C.1, C.3)', () => {
  const state = strategy([member('pidgey')]);
  const store = open(state);
  const before = store.getSession();
  fireEvent.click(screen.getByRole('button', { name: 'Quick Flight' }));
  const preview = screen.getByLabelText(t('ability.preview'));
  expect(preview.textContent).toContain('move exactly 3 spaces instead of rolling');
  expect(preview.textContent).toContain(t('ability.cost'));
  expect(preview.textContent).not.toContain(t('ability.costTactical'));
  expect(preview.textContent).not.toContain(t('ability.hostile'));
  // Previewing consumes nothing.
  expect(store.getSession()).toBe(before);
  fireEvent.click(
    screen.getByRole('button', { name: t('ability.confirm', { ability: 'Quick Flight' }) }),
  );
  const { state: after, log } = store.getSession()!;
  expect(log.actions).toHaveLength(1);
  expect(log.actions[0]!.action).toMatchObject({
    kind: 'activate_ability',
    payload: { instanceId: 't:pidgey' },
  });
  expect(after.players[0]!.team[0]!.abilityReady).toBe(false);
  expect(after.turnBudgets.pokemonAbility).toBe(0);
  // The Ability row now carries the engine's Lap reason, and the move draws no die.
  expect(disabledReason('Quick Flight')).toBe(
    legalActions(after, 0).disabled.find((action) => action.kind === 'activate_ability')!
      .reasonText,
  );
  const start = after.players[0]!.routeProgress;
  expect(store.choose('skip')).toHaveProperty('accepted');
  while (store.advance({ human: true }));
  const moved = store.getSession()!;
  expect(moved.state.players[0]!.routeProgress - start).toBe(3);
  const draws = moved.log.actions
    .slice(1)
    .flatMap((record) => record.events)
    .filter((event) => event.kind === 'random_result' && event.purpose.startsWith('move:'));
  expect(draws).toEqual([]);
});

test('a disabled Ability shows its engine reason as visible text, never a ready-looking button (§3.1)', () => {
  const team = [
    member('charmander'), // Blaze: a B Ability, not usable in Strategy
    { ...member('squirtle'), abilityReady: false }, // Shell Guard: used this Lap
    member('rattata'), // Scavenge: ready in Strategy
  ];
  const state = strategy(team);
  const store = open(state);
  const reasons = legalActions(state, 0).disabled.filter(
    (action) => action.kind === 'activate_ability',
  );
  const reasonOf = (instanceId: string) =>
    reasons.find((action) => action.payload.instanceId === instanceId)!;
  expect(disabledReason('Blaze')).toBe(reasonOf('t:charmander').reasonText);
  expect(reasonOf('t:charmander').reasonCode).toBe('ABILITY_WRONG_TIMING');
  expect(disabledReason('Shell Guard')).toBe(reasonOf('t:squirtle').reasonText);
  expect(reasonOf('t:squirtle').reasonCode).toBe('ABILITY_USED_THIS_LAP');
  expect(screen.getByRole('button', { name: 'Scavenge' })).toHaveProperty('disabled', false);
  const before = store.getSession();
  fireEvent.click(screen.getByRole('button', { name: 'Blaze' }));
  expect(screen.queryByLabelText(t('ability.preview'))).toBeNull();
  expect(store.getSession()).toBe(before);
});

test('the Lap use of one Pokémon and the turn allowance of the player read as different reasons, and evolution keeps a spent cooldown (§4.5, D10)', () => {
  const state = strategy([{ ...member('bulbasaur'), abilityReady: false }, member('charmander')]);
  state.players[0]!.abilityUsedGlobalTurnNo = 7;
  state.turnBudgets.pokemonAbility = 0;
  open(state);
  const lap = disabledReason('Vine Pull');
  const turn = disabledReason('Blaze');
  expect(lap).not.toBe(turn);
  expect(lap).toContain('Lap');
  expect(turn).toContain('this turn');

  // The same Pokémon after it evolves is still spent.
  const evolved = structuredClone(state);
  evolved.players[0]!.team[0]!.speciesId = 'ivysaur';
  evolved.players[0]!.team[0]!.evolutionStage = 1;
  document.body.innerHTML = '';
  open(evolved);
  expect(disabledReason('Vine Pull')).toBe(lap);
});

test('String Shot lists each opponent, greys out one that is already slowed with the engine reason, and commits only the chosen target (D8, D10)', () => {
  const state = strategy([member('caterpie')]);
  state.players[1]!.pendingSlows = ['repel'];
  const store = open(state);
  fireEvent.click(screen.getByRole('button', { name: 'String Shot' }));
  const targets = within(screen.getByRole('group', { name: t('ability.targets') }));
  const slowed = targets.getAllByRole('button')[0]!;
  expect(slowed.hasAttribute('disabled')).toBe(true);
  expect(document.getElementById(slowed.getAttribute('aria-describedby')!)!.textContent).toBe(
    'Target is already slowed',
  );
  // Nothing is previewed until a legal target is chosen, and a disabled target does nothing.
  fireEvent.click(slowed);
  expect(screen.queryByLabelText(t('ability.preview'))).toBeNull();
  const second = targets.getAllByRole('button')[1]!;
  fireEvent.click(second);
  const preview = screen.getByLabelText(t('ability.preview'));
  expect(preview.textContent).toContain(
    t('ability.previewTarget', { target: second.textContent! }),
  );
  expect(preview.textContent).toContain(t('ability.hostile'));
  fireEvent.click(screen.getByRole('button', { name: t('ability.cancel') }));
  expect(store.getSession()!.log.actions).toHaveLength(0);
  expect(screen.queryByLabelText(t('ability.preview'))).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'String Shot' }));
  fireEvent.click(
    within(screen.getByRole('group', { name: t('ability.targets') })).getAllByRole('button')[1]!,
  );
  fireEvent.click(
    screen.getByRole('button', { name: t('ability.confirm', { ability: 'String Shot' }) }),
  );
  const { state: after, log } = store.getSession()!;
  expect(log.actions).toHaveLength(1);
  expect(log.actions[0]!.action).toMatchObject({
    kind: 'activate_ability',
    payload: { instanceId: 't:caterpie', targetSeatIndex: 2 },
  });
  expect(after.players[2]!.pendingSlows).toEqual(['string_shot']);
  expect(after.players[1]!.pendingSlows).toEqual(['repel']);
});

test('a selection made for one offered action list is dropped, with a notice, when the list changes; nothing is submitted (§8)', () => {
  const state = strategy([member('pidgey')]);
  const onChoose = vi.fn();
  const view = (actions: LegalActions) => (
    <AbilityPanel observation={observe(state, 0)} legalActions={actions} onChoose={onChoose} />
  );
  const first = legalActions(state, 0);
  const { rerender } = render(view(first));
  fireEvent.click(screen.getByRole('button', { name: 'Quick Flight' }));
  expect(screen.getByLabelText(t('ability.preview'))).toBeTruthy();
  rerender(view(structuredClone(first)));
  expect(screen.queryByLabelText(t('ability.preview'))).toBeNull();
  expect(screen.getByRole('alert').textContent).toBe(t('ability.stale'));
  expect(onChoose).not.toHaveBeenCalled();
});

/** An AI rival (seat 1) challenges the human (seat 0), who accepts: seat 0's defender window is open. */
function defending(team: readonly PokemonInstance[]): GameSession {
  let state = strategy(team);
  state.activeSeatIndex = 1;
  state.players[1]!.team = [{ ...member('rattata', 'rival:1'), abilityReady: false }];
  const log = createGameLog(state);
  const act = (kind: Action['kind'], payload: unknown) => {
    const result = applyAction(state, {
      actorId: pendingDecision(state)!.actorId,
      kind,
      payload,
      actionSeq: state.stateRevision + 1,
      stateRevisionBefore: state.stateRevision,
    } as Action);
    if ('rejected' in result) throw new Error(result.reason);
    state = result.state;
    log.actions.push(result.record);
  };
  act('declare_pvp', { targetSeatIndex: 0 });
  act('respond_pvp', { accept: true });
  return { state, log };
}

test('a human targeted by Pickpocket can use Snorlax’s Block during the rival’s Strategy', () => {
  const state = strategy([member('snorlax')]);
  state.activeSeatIndex = 1;
  state.players[1]!.items = [
    { instanceId: 'pickpocket:1', itemId: 'pickpocket', name: 'Pickpocket', visibility: 'secret' },
  ];
  const log = createGameLog(state);
  const result = applyAction(state, {
    actorId: state.players[1]!.actorId,
    kind: 'use_item',
    actionSeq: 1,
    stateRevisionBefore: 0,
    payload: { itemInstanceId: 'pickpocket:1', targetSeatIndex: 0 },
  });
  if ('rejected' in result) throw new Error(result.reason);
  log.actions.push(result.record);
  const store = open(result.state, log);
  expect(screen.getByText(t('turn.pickpocketReaction'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Block' }));
  fireEvent.click(screen.getByRole('button', { name: t('ability.confirm', { ability: 'Block' }) }));
  expect(store.getSession()!.state.players[0]!.coins).toBe(state.players[0]!.coins);
  expect(store.getSession()!.state.pendingPickpocket).toBeUndefined();
});

test('a human defender reaches the Ability window outside their own turn, sees what is blocked and why, reacts, and the battle goes on without a blank screen (C.3, D4)', () => {
  const { state, log: initial } = defending([
    member('chansey'),
    { ...member('pikachu'), tired: true },
    member('porygon'),
  ]);
  expect(state.phase).toMatchObject({ kind: 'pvp', battle: { step: 'defender_window' } });
  expect(pendingDecision(state)!.seatIndex).toBe(0);
  const store = open(state, initial);
  expect(screen.getByRole('heading', { name: t('battle.heading.window') })).toBeTruthy();
  // Calculate cannot be used in this window: it stays listed, disabled, with the engine's reason,
  // in the folded line of options that cannot be used now.
  openFolds();
  const blocked = screen.getByRole('button', { name: /Calculate/ });
  expect(blocked.hasAttribute('disabled')).toBe(true);
  expect(blocked.closest('li')!.textContent).toContain('Calculate');
  const reason = legalActions(state, 0).disabled.find(
    (action) => action.kind === 'activate_ability' && action.payload.instanceId === 't:porygon',
  )!.reasonText;
  expect(blocked.closest('li')!.textContent).toContain(reason);
  const heal = screen.getAllByRole('button', { name: /Heal Pulse/ });
  expect(heal).toHaveLength(1);
  expect(heal[0]!.textContent).toMatch(/Pikachu/);
  fireEvent.click(heal[0]!);
  const { state: after, log } = store.getSession()!;
  expect(log.actions.at(-1)!.action).toMatchObject({
    kind: 'activate_ability',
    payload: { instanceId: 't:chansey', targetPokemonInstanceId: 't:pikachu' },
  });
  expect(after.players[0]!.team.map((pokemon) => pokemon.tired)).toEqual([false, false, false]);
  // The window closed for the human; the board still shows a turn panel for the engine's next step.
  expect(screen.getByLabelText(t('turn.actions'))).toBeTruthy();
});

test('a reload at the defender window restores the same decision from the saved game (§3.1, §6.9)', () => {
  const { state, log } = defending([member('chansey'), { ...member('pikachu'), tired: true }]);
  const store = open(state, log);
  const saved = store.getSession()!;
  document.body.innerHTML = '';
  const reloaded = createGameStore();
  reloaded.restore(structuredClone(saved), [
    { seatIndex: 1, personality: 'greedy', difficulty: 'normal' },
    { seatIndex: 2, personality: 'greedy', difficulty: 'normal' },
  ]);
  render(<BoardScreen store={reloaded} />);
  expect(screen.getByRole('heading', { name: t('battle.heading.window') })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Heal Pulse/ }).hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('button', { name: t('choice.noAbility') })).toBeTruthy();
  // Choosing none in the window spends nothing and lets the battle go on.
  fireEvent.click(screen.getByRole('button', { name: t('choice.noAbility') }));
  expect(reloaded.getSession()!.state.players[0]!.team[0]!.abilityReady).toBe(true);
  expect(reloaded.getSession()!.state.players[0]!.abilityUsedGlobalTurnNo).not.toBe(7);
});

test('a defender who already used an Ability this turn is offered no window, so no second reaction (§4.5)', () => {
  const state = strategy([member('chansey'), { ...member('pikachu'), tired: true }]);
  state.activeSeatIndex = 1;
  state.players[0]!.abilityUsedGlobalTurnNo = 7;
  state.players[1]!.team = [{ ...member('rattata', 'rival:1'), abilityReady: false }];
  const accepted = [
    { seat: 1, kind: 'declare_pvp', payload: { targetSeatIndex: 0 } },
    { seat: 0, kind: 'respond_pvp', payload: { accept: true } },
  ].reduce((current, step) => {
    const result = applyAction(current, {
      actorId: current.players[step.seat]!.actorId,
      kind: step.kind,
      payload: step.payload,
      actionSeq: current.stateRevision + 1,
      stateRevisionBefore: current.stateRevision,
    });
    if ('rejected' in result) throw new Error(result.reason);
    return result.state;
  }, state);
  expect(accepted.phase.kind).toBe('pvp');
  expect(accepted.phase.kind === 'pvp' && accepted.phase.battle.step).not.toMatch(/_window$/);
  expect(
    legalActions(accepted, 0).enabled.some((action) => action.kind === 'activate_ability'),
  ).toBe(false);
});

test('Track shows the peeked Event card to its owner alone: another seat’s panel, observation and feed never carry it (§4.1, C.1)', () => {
  const state = strategy([member('growlithe')]);
  state.content.species.find((entry) => entry.id === 'growlithe')!.ability!.effect = 'track';
  state.eventDeck = { drawPile: ['e4', 'e2'], discardPile: [] };
  const result = applyAction(state, {
    actorId: state.players[0]!.actorId,
    kind: 'activate_ability',
    payload: { instanceId: 't:growlithe' },
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
  });
  if ('rejected' in result) throw new Error(result.reason);
  const peeked = result.state;
  const text = content.events.find((card) => card.id === 'e4')!.text;

  const owner = render(
    <AbilityPanel
      observation={observe(peeked, 0)}
      legalActions={legalActions(peeked, 0)}
      onChoose={vi.fn()}
    />,
  );
  expect(owner.container.querySelector('.ability-peek')!.textContent).toBe(
    t('ability.peek', { text }),
  );
  owner.unmount();

  // A rival's observation and seat-visible record carry neither the card id nor its text.
  const rivalSees = JSON.stringify([
    observe(peeked, 1),
    actionVisibleTo(state, result.record, 1, 0),
  ]);
  expect(rivalSees).not.toContain('e4');
  expect(rivalSees).not.toContain(text);
  const panel = render(
    <AbilityPanel
      observation={observe(peeked, 1)}
      legalActions={legalActions(peeked, 1)}
      onChoose={vi.fn()}
    />,
  );
  expect(panel.container.querySelector('.ability-peek')).toBeNull();
});

test('Start credit makes every Ability ready again; the Sell card and the field log say so (§4.5, §4.7)', () => {
  const state = strategy([{ ...member('bulbasaur'), abilityReady: false }]);
  state.phase = { kind: 'move' };
  state.players[0]!.routeProgress = 22;
  state.turnEffects = { fixedMove: 3 };
  const store = open(state);
  act(() => {
    while (store.advance({ human: true })) {
      if (store.getSession()!.state.phase.kind === 'sell') break;
    }
  });
  expect(store.getSession()!.state.players[0]!.team[0]!.abilityReady).toBe(true);
  expect(document.querySelector('.start-banner')!.textContent).toContain(t('sell.start.abilities'));
  fireEvent.click(screen.getByRole('button', { name: t('record.open') }));
  expect(
    within(screen.getByRole('dialog', { name: t('record.heading') })).getAllByText(
      t('board.event.abilitiesReset', { name: t('seat.you') }),
    ).length,
  ).toBeGreaterThan(0);
});

test('in the catch window Adaptability boosts catch rolls from the Encounter dialog, and the Ball odds shown follow the engine (§4.3, C.3 catch order)', () => {
  const state = strategy([member('eevee')]);
  state.phase = { kind: 'encounter', pokemon: { speciesId: 'dratini' } };
  state.players[0]!.balls = { poke: 2, great: 0, ultra: 0 };
  const store = open(state);
  const percents = () =>
    screen.getAllByRole('button', { name: new RegExp(`^${t('board.ball.poke')} · \\d+%`) });
  const before = percents()[0]!.textContent;
  const card = document.querySelector<HTMLElement>('[data-card="encounter"]')!;
  fireEvent.click(within(card).getByRole('button', { name: 'Adaptability' }));
  fireEvent.click(screen.getByRole('button', { name: t('ability.scope.catch') }));
  expect(screen.getByLabelText(t('ability.preview')).textContent).toContain(
    t('ability.previewScope', { scope: t('ability.scope.catch') }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: t('ability.confirm', { ability: 'Adaptability' }) }),
  );
  const { state: after, log } = store.getSession()!;
  expect(log.actions.map((record) => record.action)).toMatchObject([
    { kind: 'activate_ability', payload: { instanceId: 't:eevee', scope: 'catch' } },
  ]);
  expect(after.phase.kind).toBe('encounter');
  expect(percents()[0]!.textContent).not.toBe(before);
  expect(percents()[0]!.textContent).toContain(`${store.getView()!.catchOdds[0]!.percent}%`);
  // The window is spent: the Ability now reads as used this turn, and the Ball choice is still open.
  expect(disabledReason('Adaptability')).toContain('Lap');
});
