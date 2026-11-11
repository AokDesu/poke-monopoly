import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, expect, test, vi } from 'vitest';
import {
  createGameConfig,
  createGameLog,
  createRng,
  effectiveForm,
  fixtureSchema,
  nextEvolutionForms,
  observe,
  saleQuote,
  stateHash,
} from '../../../engine/index.ts';
import sellFixture from '../../../engine/fixtures/sell-phase-three-pokemon.json';
import { engineContent } from '../game/content.ts';
import { createGameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { Board } from './Board.tsx';
import { BoardScreen } from './BoardScreen.tsx';
import { SellPanel } from './SellPanel.tsx';
import { tagLabel } from './labels.ts';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

function scenario() {
  const state = fixtureSchema.parse(sellFixture).state;
  state.config = createGameConfig({ seats: state.config.seats, seed: 3, lapTarget: 3 });
  state.content = structuredClone(engineContent);
  state.rng = createRng(3);
  return state;
}

test('public team cards show engine current forms, inherited abilities and every authored next branch', () => {
  const state = scenario();
  const member = state.players[0]!.team[0]!;
  state.players[0]!.team = ['caterpie', 'ivysaur', 'eevee', 'magikarp'].map((speciesId) => ({
    ...member,
    instanceId: `team-${speciesId}`,
    speciesId,
    origin: 'caught',
    evolutionStage: speciesId === 'ivysaur' ? 1 : 0,
  }));
  render(<Board observation={observe(state, 0)} />);
  for (const pokemon of state.players[0]!.team) {
    const form = effectiveForm(engineContent, pokemon.speciesId);
    const card = screen.getByTestId(pokemon.instanceId);
    expect(within(card).getByText(form.name)).toBeTruthy();
    expect(within(card).getByLabelText(t('board.battle')).textContent).toBe(String(form.battle));
    for (const tag of form.tags) expect(within(card).getByText(tagLabel(tag))).toBeTruthy();
    const disclosure = card.querySelector('details')!;
    expect(disclosure).not.toBeNull();
    disclosure.open = true;
    expect(within(disclosure).getByText(form.ability!.name)).toBeTruthy();
    expect(within(disclosure).getByText(form.ability!.text)).toBeTruthy();
    const next = nextEvolutionForms(engineContent, pokemon.speciesId);
    const choices = within(disclosure).getByRole('list');
    expect(
      within(choices)
        .getAllByRole('listitem')
        .map((entry) => entry.textContent),
    ).toEqual(next.map((id) => effectiveForm(engineContent, id).name));
    for (const id of next) expect(within(choices).queryByText(id, { exact: true })).toBeNull();
  }
});

test('final forms and duplicate UIDs keep independent Tired and Rescue markers across reordering', () => {
  const state = scenario();
  const first = state.players[0]!.team[0]!;
  first.speciesId = 'venusaur';
  first.evolutionStage = 2;
  first.origin = 'rescue_starter';
  first.tired = true;
  first.abilityReady = false;
  const second = {
    ...first,
    instanceId: 'other-venusaur',
    origin: 'caught' as const,
    tired: false,
    abilityReady: true,
  };
  state.players[0]!.team = [first, second];
  const { rerender } = render(<Board observation={observe(state, 0)} />);
  for (const pokemon of [first, second]) {
    const card = screen.getByTestId(pokemon.instanceId);
    fireEvent.click(card.querySelector('summary')!);
    expect(within(card).getByText(t('team.instance', { id: pokemon.instanceId }))).toBeTruthy();
    expect(within(card).getByText(t('team.finalForm'))).toBeTruthy();
    expect(card.querySelector('details')!.open).toBe(true);
  }
  const rescue = screen.getByTestId(first.instanceId);
  expect(within(rescue).getByText(t('board.rescue'))).toBeTruthy();
  expect(within(rescue).getByText(t('board.tired'))).toBeTruthy();
  expect(within(rescue).getByText(t('team.tiredReason'))).toBeTruthy();
  expect(within(rescue).getByText(t('team.rescueRestriction'))).toBeTruthy();
  const caught = screen.getByTestId(second.instanceId);
  expect(within(caught).queryByText(t('board.rescue'))).toBeNull();
  expect(within(caught).queryByText(t('board.tired'))).toBeNull();
  expect(within(caught).queryByText(t('team.tiredReason'))).toBeNull();
  state.players[0]!.team.reverse();
  rerender(<Board observation={observe(state, 0)} />);
  expect(screen.getByTestId(first.instanceId).querySelector('details')!.open).toBe(true);
  expect(within(screen.getByTestId(first.instanceId)).getByText(t('board.tired'))).toBeTruthy();
  expect(within(screen.getByTestId(second.instanceId)).queryByText(t('board.tired'))).toBeNull();
});

test('Sell inspection keeps engine quotes for evolved, Tired and Rescue members without selecting them', () => {
  const state = scenario();
  state.players[0]!.classId = 'researcher';
  const team = state.players[0]!.team;
  team[0]!.speciesId = 'ivysaur';
  team[0]!.evolutionStage = 1;
  team[0]!.tired = true;
  team[1]!.speciesId = 'venusaur';
  team[1]!.evolutionStage = 2;
  team[1]!.origin = 'rescue_starter';
  team[1]!.tired = true;
  const onSell = vi.fn();
  render(
    <SellPanel
      observation={observe(state, 0)}
      quoteSale={(ids) => saleQuote(state, 0, ids)}
      onSell={onSell}
    />,
  );
  for (const pokemon of team) {
    const form = effectiveForm(engineContent, pokemon.speciesId);
    const card = screen.getByTestId(`sale-${pokemon.instanceId}`);
    expect(within(card).getByText(form.name)).toBeTruthy();
    expect(within(card).getByLabelText(t('board.battle')).textContent).toBe(String(form.battle));
    const row = saleQuote(state, 0, [pokemon.instanceId]).rows[0]!;
    expect(
      within(card).getByText(t(row.classBonus === 0 ? 'sell.price' : 'sell.priceBonus', row)),
    ).toBeTruthy();
    fireEvent.click(card.querySelector('summary')!);
    expect(within(card).getByRole('checkbox').matches(':checked')).toBe(false);
    if (pokemon.tired) expect(within(card).getByText(t('team.tiredReason'))).toBeTruthy();
    if (pokemon.origin === 'rescue_starter') {
      expect(row.basePrice).toBe(0);
      expect(row.classBonus).toBe(0);
      expect(within(card).getByText(t('team.rescueRestriction'))).toBeTruthy();
    }
  }
  expect(onSell).not.toHaveBeenCalled();
  const firstCheckbox = screen.getAllByRole('checkbox')[0]!;
  fireEvent.click(firstCheckbox);
  const quote = saleQuote(state, 0, [team[0]!.instanceId]);
  expect(screen.getByLabelText(t('sell.total')).textContent).toBe(
    t('sell.coins', { amount: quote.total }),
  );
  const card = screen.getByTestId(`sale-${team[0]!.instanceId}`);
  fireEvent.click(card.querySelector('summary')!);
  expect(firstCheckbox.matches(':checked')).toBe(true);
  expect(screen.getByLabelText(t('sell.total')).textContent).toBe(
    t('sell.coins', { amount: quote.total }),
  );
});

test('expanded own and opponent public teams expose no opponent pouch, secret items or private results', () => {
  const state = scenario();
  state.players[1]!.team[0]!.speciesId = 'ivysaur';
  state.players[1]!.team[0]!.evolutionStage = 1;
  state.players[1]!.items.push({
    instanceId: 'SENTINEL-SECRET-UID',
    itemId: 'SENTINEL-SECRET-ID',
    name: 'SENTINEL-SECRET-NAME',
    visibility: 'secret',
  });
  state.players[1]!.privateResults.push({ kind: 'peek', eventId: 'SENTINEL-PRIVATE-RESULT' });
  state.players[1]!.balls = { poke: 937, great: 941, ultra: 947 };
  const { container } = render(<Board observation={observe(state, 0)} />);
  for (const summary of container.querySelectorAll('summary')) fireEvent.click(summary);
  const rival = screen.getByTestId('player-1');
  expect(within(rival).getByText('Ivysaur')).toBeTruthy();
  expect(
    within(rival).getByText(effectiveForm(engineContent, 'ivysaur').ability!.text),
  ).toBeTruthy();
  expect(container.innerHTML).not.toMatch(/SENTINEL|937|941|947/);
  expect(within(rival).queryByLabelText(t('board.balls'))).toBeNull();
  expect(within(rival).queryByLabelText(t('board.items'))).toBeNull();
});

test('opening and closing board and Sell details changes no accepted action, revision, cooldown or status', () => {
  vi.useFakeTimers();
  try {
    const state = scenario();
    state.players[0]!.team[0]!.tired = true;
    state.players[0]!.team[0]!.tiredExpiresOwnTurnNo = state.players[0]!.ownTurnNo + 1;
    state.players[0]!.team[0]!.abilityReady = false;
    const store = createGameStore();
    store.restore({ state, log: createGameLog(state) });
    const before = structuredClone(store.getSession());
    const hash = stateHash(state);
    const view = render(<BoardScreen store={store} />);
    const disclosures = view.container.querySelectorAll('details');
    expect(disclosures.length).toBe(
      state.players.flatMap((player) => player.team).length + state.players[0]!.team.length,
    );
    for (const details of disclosures) {
      fireEvent.click(details.querySelector('summary')!);
      expect(details.open).toBe(true);
      fireEvent.click(details.querySelector('summary')!);
      expect(details.open).toBe(false);
    }
    expect(store.getSession()).toEqual(before);
    expect(stateHash(store.getSession()!.state)).toBe(hash);
    view.unmount();
  } finally {
    vi.useRealTimers();
  }
});
