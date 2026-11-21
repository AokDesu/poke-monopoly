import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, test } from 'vitest';
import {
  createGameConfig,
  createRng,
  effectiveForm,
  fixtureSchema,
  legalActions,
  nextEvolutionForms,
  observe,
  oddsForAllBalls,
  saleQuote,
  type GameState,
} from '../../../engine/index.ts';
import encounterFixture from '../../../engine/fixtures/encounter-with-balls.json';
import lowCoins from '../../../engine/fixtures/shop-low-coins.json';
import { ballItemId, classOptions, content, engineContent, speciesType } from '../game/content.ts';
import { MEADOW_STARTERS } from '../game/models.ts';
import { t } from '../i18n/en.ts';
import { openFolds } from '../test/folds.ts';
import { itemName, speciesName } from '../i18n/names.ts';
import { ClassScreen } from '../setup/ClassScreen.tsx';
import { StarterFacts } from '../setup/StarterFacts.tsx';
import { TypeOrb } from '../ui/TypeOrb.tsx';
import { Board } from './Board.tsx';
import { EncounterCard } from './EncounterCard.tsx';
import { tagLabel } from './labels.ts';
import { SellPanel } from './SellPanel.tsx';
import { ShopPanel } from './ShopPanel.tsx';
import { StrategyPanel } from './StrategyPanel.tsx';

afterEach(cleanup);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

const SPECIES_IDS = content.species.map((species) => species.id);
const FORM_IDS = content.evolutions.forms.map((form) => form.id);
const ALL_IDS = [...SPECIES_IDS, ...FORM_IDS];

// Independent checklist (Appendix A), not derived from the engine: which items the engine applies.
const PLANNED_ITEMS: string[] = [];
const PARTIAL_ITEMS = ['potion'];
const ACTIVE_UTILITY = [
  'lucky-egg',
  'repel',
  'pickpocket',
  'price-shield',
  'sticky-web',
  'battle-ticket',
];

function scenario(input: unknown): GameState {
  const state = fixtureSchema.parse(input).state;
  state.config = createGameConfig({ seats: state.config.seats, seed: 3, lapTarget: 3 });
  state.content = structuredClone(engineContent);
  state.rng = createRng(3);
  return state;
}

/** The text of the `<dd>` that follows the `<dt>` with this label. */
function fact(root: HTMLElement, label: string): string {
  const term = [...root.querySelectorAll('dt')].find((entry) => entry.textContent === label);
  if (!term) throw new Error(`No "${label}" fact`);
  return term.nextElementSibling!.textContent!;
}

/** A lower-case form or species ID shown as text would be a raw ID leaking into the UI. */
function expectNoRawIds(root: HTMLElement, ids: readonly string[]) {
  for (const id of ids) {
    expect(new RegExp(`(^|[^A-Za-z-])${id}($|[^A-Za-z-])`).test(root.textContent ?? ''), id).toBe(
      false,
    );
  }
}

test('the content tables hold the 19 species and 23 forms the browser must render (Appendix A)', () => {
  expect(SPECIES_IDS).toHaveLength(19);
  expect(FORM_IDS).toHaveLength(23);
});

test('every species and form has a name, a catalog label for each tag and a type orb from its tags (§4.5)', () => {
  const css = readFileSync(join(process.cwd(), 'web', 'src', 'index.css'), 'utf8');
  const paths = new Set<string>();
  for (const id of ALL_IDS) {
    const form = effectiveForm(engineContent, id);
    expect(speciesName(id)).toBe(form.name);
    expect(form.name).not.toBe(id);
    for (const tag of form.tags)
      expect(tagLabel(tag), `${id} ${tag}`).not.toBe(t('board.tag.other'));
    // A type tag is never shown as normal: the first non-modifier tag decides the orb.
    const typeTags = form.tags.filter((tag) => tag !== 'cute');
    expect(speciesType(id), id).toBe(typeTags[0] ?? 'normal');
    expect(css, speciesType(id)).toContain(`--color-type-${speciesType(id)}:`);
    const { container } = render(<TypeOrb type={speciesType(id)} />);
    paths.add(container.querySelector('path')!.getAttribute('d')!);
  }
  // Each of the nine types has its own mark.
  expect(paths.size).toBe(9);
});

test.each(SPECIES_IDS)(
  'wild %s: encounter shows name, tags, battle, base value, DC and Ability (§4.3, §4.5)',
  (id) => {
    const state = scenario(encounterFixture);
    if (state.phase.kind !== 'encounter' || !('instanceId' in state.phase.pokemon)) {
      throw new Error('Expected an encounter fixture');
    }
    state.phase.pokemon.speciesId = id;
    const form = effectiveForm(engineContent, id);
    render(
      <EncounterCard
        observation={observe(state, 0)}
        legalActions={legalActions(state, 0)}
        catchOdds={oddsForAllBalls(state, 0)}
        onChoose={() => {}}
      />,
    );
    const dialog = screen.getByRole('region', {
      name: t('encounter.heading', { pokemon: form.name }),
    });
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe(
      t('encounter.heading', { pokemon: form.name }),
    );
    const facts = within(dialog).getByRole('region', { name: t('encounter.facts') });
    for (const tag of form.tags) expect(within(facts).getByText(tagLabel(tag))).toBeTruthy();
    expect(fact(facts, t('board.battle'))).toBe(String(form.battle));
    expect(fact(facts, t('team.baseValue'))).toBe(String(form.base));
    expect(fact(facts, t('species.catchDc'))).toBe(String(form.dc));
    expect(within(facts).getByText(form.ability!.name)).toBeTruthy();
    expect(facts.textContent).toContain(form.ability!.text);
    expectNoRawIds(dialog, ALL_IDS);
  },
);

test('team cards, details and Sell cards render every species and form from the engine lookup, with no raw IDs', () => {
  const state = scenario(encounterFixture);
  const seed = state.players[0]!.team[0]!;
  state.players[0]!.team = ALL_IDS.map((speciesId, index) => ({
    ...seed,
    instanceId: `uid-${index}`,
    speciesId,
    origin: 'caught' as const,
    evolutionStage: 0,
    tired: false,
  }));
  state.phase = { kind: 'sell', destinationPosition: 0 };
  const observation = observe(state, 0);
  const board = render(<Board observation={observation} />);
  const sell = render(
    <SellPanel
      observation={observation}
      quoteSale={(ids) => saleQuote(state, 0, ids)}
      onSell={() => {}}
    />,
  );
  const cards = [
    ...ALL_IDS.map((id, index) => ({ id, card: board.getByTestId(`uid-${index}`) })),
    ...ALL_IDS.map((id, index) => ({ id, card: sell.getByTestId(`sale-uid-${index}`) })),
  ];
  expect(cards).toHaveLength(ALL_IDS.length * 2);
  for (const { id, card } of cards) {
    const form = effectiveForm(engineContent, id);
    expect(within(card).getAllByText(form.name).length, id).toBeGreaterThan(0);
    for (const tag of form.tags) expect(within(card).getAllByText(tagLabel(tag)).length).toBe(1);
    expect(within(card).getByLabelText(t('board.battle')).textContent).toBe(String(form.battle));
    const details = card.querySelector('details')!;
    expect(fact(details, t('team.baseValue'))).toContain(String(form.base));
    expect(within(details).getByText(form.ability!.name)).toBeTruthy();
    expect(details.textContent).toContain(form.ability!.text);
    const next = nextEvolutionForms(engineContent, id);
    if (next.length === 0) {
      expect(within(details).getByText(t('team.finalForm'))).toBeTruthy();
      expect(details.querySelector('ul')).toBeNull();
    } else {
      const entries = [...details.querySelectorAll('ul > li')];
      expect(entries.map((entry) => entry.querySelector('strong')!.textContent)).toEqual(
        next.map((nextId) => effectiveForm(engineContent, nextId).name),
      );
      next.forEach((nextId, index) => {
        const nextForm = effectiveForm(engineContent, nextId);
        expect(entries[index]!.textContent).toContain(
          t('team.nextFormStats', { battle: nextForm.battle, base: nextForm.base }),
        );
        expect(entries[index]!.textContent).toContain(nextForm.ability!.name);
      });
      expect(!!within(details).queryByText(t('team.branchChoice'))).toBe(next.length > 1);
    }
    // The only text that may carry an ID is nothing: instance IDs here are neutral.
    expectNoRawIds(card, ALL_IDS);
  }
});

test('a rare final form, a branching line and a base-form Starter each show their own rows', () => {
  const eevee = nextEvolutionForms(engineContent, 'eevee');
  expect(eevee).toEqual(['vaporeon', 'jolteon', 'flareon']);
  expect(nextEvolutionForms(engineContent, 'snorlax')).toEqual([]);
  expect(content.species.find((species) => species.id === 'snorlax')!.rarity).toBe('rare');
  // Gyarados is both a Magikarp form and a rare species with its own authored values.
  expect(speciesName('gyarados')).toBe('Gyarados');
  expect(effectiveForm(engineContent, 'gyarados').battle).toBe(5);
});

/** All ten items as Shop offers: the 3 Balls, then every utility item. */
function allItemsShop(): GameState {
  const state = scenario(lowCoins);
  state.players[0]!.coins = 50;
  state.players[0]!.items = [];
  state.phase = {
    kind: 'shop',
    offers: content.items.map((item) =>
      item.kind === 'ball'
        ? {
            id: `offer-${item.ballType}`,
            itemId: item.id,
            kind: 'ball' as const,
            ballType: item.ballType,
            price: item.price,
          }
        : { id: `offer-${item.id}`, itemId: item.id, kind: 'utility' as const, price: item.price },
    ),
  };
  return state;
}

function expectItemFacts(root: HTMLElement, itemId: string, price: number, status = true) {
  const item = content.items.find((entry) => entry.id === itemId)!;
  const facts = root.querySelector<HTMLElement>(`[data-item="${itemId}"]`)!;
  expect(facts, itemId).not.toBeNull();
  expect(facts.textContent).toContain(t(`item.kind.${item.kind}`));
  expect(facts.textContent).toContain(t(price === 1 ? 'item.priceOne' : 'item.price', { price }));
  const effect =
    item.kind === 'ball'
      ? t('item.ball.effect', { bonus: item.bonus })
      : PLANNED_ITEMS.includes(itemId)
        ? t('item.effect.planned', { effect: item.effect })
        : item.effect;
  expect(facts.textContent).toContain(effect);
  const planned = PLANNED_ITEMS.includes(itemId);
  const partial = PARTIAL_ITEMS.includes(itemId);
  expect(facts.textContent!.includes(t('item.status.planned')), itemId).toBe(planned && status);
  expect(facts.textContent!.includes(t('item.status.partial')), itemId).toBe(partial);
  // An effect the engine does not apply is never worded as a plain statement of what the item does.
  if (planned && item.kind === 'utility') {
    expect(facts.textContent!.replace(effect, '')).not.toContain(item.effect);
  }
}

test('Shop shows name, kind, price and effect for all 10 items, and labels unimplemented effects (§4.6, Appendix A)', () => {
  expect(content.items).toHaveLength(10);
  const state = allItemsShop();
  const { container } = render(
    <ShopPanel
      observation={observe(state, 0)}
      legalActions={legalActions(state, 0)}
      onChoose={() => {}}
    />,
  );
  for (const item of content.items) {
    expect(
      screen.getByRole('button', {
        name: t(item.price === 1 ? 'shop.buyOne' : 'shop.buy', {
          item: item.name,
          price: item.price,
        }),
      }),
    ).toBeTruthy();
    expectItemFacts(container, item.id, item.price);
  }
  expectNoRawIds(
    container,
    content.items.map((item) => item.id),
  );
  expect([...PLANNED_ITEMS, ...PARTIAL_ITEMS, ...ACTIVE_UTILITY].sort()).toEqual(
    content.items
      .filter((item) => item.kind === 'utility')
      .map((item) => item.id)
      .sort(),
  );
});

test('Shop prices come from the engine offer, not from a second copy', () => {
  const state = allItemsShop();
  if (state.phase.kind !== 'shop') throw new Error('Expected Shop');
  state.phase.offers.find((offer) => offer.itemId === 'repel')!.price = 7;
  const { container } = render(
    <ShopPanel
      observation={observe(state, 0)}
      legalActions={legalActions(state, 0)}
      onChoose={() => {}}
    />,
  );
  expect(container.querySelector('[data-item="repel"]')!.textContent).toContain(
    t('item.price', { price: 7 }),
  );
});

test('Strategy and the inventory list every held utility item with kind, price and effect, and grey out unimplemented ones', () => {
  const state = scenario(lowCoins);
  state.phase = { kind: 'strategy' };
  state.turnBudgets.tacticalAction = 1;
  const utilities = content.items.filter((item) => item.kind === 'utility');
  state.players[0]!.items = utilities.map((item) => ({
    instanceId: `owned-${item.id}`,
    itemId: item.id,
    name: item.name,
    visibility: 'secret' as const,
  }));
  const observation = observe(state, 0);
  const strategy = render(
    <StrategyPanel
      observation={observation}
      legalActions={legalActions(state, 0)}
      onChoose={() => {
        throw new Error('A greyed-out item was used');
      }}
    />,
  );
  // Items that cannot be used now are folded into one line; open it to read them all.
  openFolds(strategy.container);
  for (const item of utilities) {
    const button = strategy.getByRole('button', { name: item.name });
    // The greyed-out reason says "not active", so the card itself does not repeat it.
    expectItemFacts(strategy.container, item.id, item.price, !PLANNED_ITEMS.includes(item.id));
    if (PLANNED_ITEMS.includes(item.id)) {
      expect(button.hasAttribute('disabled'), item.id).toBe(true);
      expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(
        t('item.status.planned'),
      );
    }
  }
  for (const id of [...ACTIVE_UTILITY, ...PARTIAL_ITEMS]) {
    // Engine choices exist for these, so the button is not the "not active" one.
    const button = strategy.getByRole('button', { name: itemName(id) });
    const reason = button.getAttribute('aria-describedby');
    if (reason) {
      expect(document.getElementById(reason)!.textContent).not.toBe(t('item.status.planned'));
    }
  }

  const board = render(<Board observation={observation} />);
  const own = board.getByTestId('player-0');
  fireEvent.click(within(own).getByRole('button'));
  const list = within(own).getByRole('list', { name: t('board.items') });
  for (const item of utilities) {
    expect(within(list).getByText(item.name)).toBeTruthy();
    expectItemFacts(list, item.id, item.price);
  }
  // Ball pouch rows carry the Ball's own price and catch bonus.
  const pouch = within(own).getByLabelText(t('board.balls'));
  for (const ball of ['poke', 'great', 'ultra'] as const) {
    const ballItem = content.items.find((item) => item.id === ballItemId(ball))!;
    expectItemFacts(pouch, ballItem.id, ballItem.price);
  }
  // Rivals show counts only: no item facts for an opponent.
  expect(board.getByTestId('player-1').querySelector('.item-facts')).toBeNull();
});

test('the Starter meadow caption names the Starters it shows, from content', () => {
  const state = scenario(lowCoins);
  render(<Board observation={observe(state, 0)} />);
  expect(
    screen.getByText(
      t('board.habitatNames', {
        names: MEADOW_STARTERS.map(({ id }) => effectiveForm(engineContent, id).name).join(', '),
      }),
    ),
  ).toBeTruthy();
});

test('every class Starter shows tags, battle, base value and Ability from the engine lookup', () => {
  const starters = [...new Set(content.classes.flatMap((entry) => entry.starterSpeciesIds))];
  expect(starters.length).toBeGreaterThanOrEqual(8);
  for (const id of starters) {
    const form = effectiveForm(engineContent, id);
    const { container } = render(<StarterFacts speciesId={id} />);
    const section = within(container).getByRole('region', {
      name: t('starter.facts', { name: form.name }),
    });
    for (const tag of form.tags) expect(within(section).getByText(tagLabel(tag))).toBeTruthy();
    expect(fact(section, t('board.battle'))).toBe(String(form.battle));
    expect(fact(section, t('team.baseValue'))).toBe(String(form.base));
    expect(within(section).getByText(form.ability!.name)).toBeTruthy();
    expectNoRawIds(section, ALL_IDS);
    cleanup();
  }
  const { container } = render(<StarterFacts speciesId="eevee" rival />);
  expect(within(container).getByRole('heading').textContent).toBe(
    t('starter.rivalFacts', { name: 'Eevee' }),
  );
});

test('the class screen shows facts for the chosen Starter and follows the picker', () => {
  const chosen = { classId: 'main-character', starterSpeciesId: 'charmander' };
  const props = { classes: classOptions, onSelect: () => {}, onNext: () => {}, onBack: () => {} };
  const view = render(<ClassScreen {...props} chosen={chosen} />);
  const form = effectiveForm(engineContent, 'charmander');
  const facts = view.getByRole('region', { name: t('starter.facts', { name: form.name }) });
  expect(fact(facts, t('team.baseValue'))).toBe(String(form.base));
  expect(within(facts).getByText(form.ability!.name)).toBeTruthy();
  view.rerender(<ClassScreen {...props} chosen={{ ...chosen, starterSpeciesId: 'squirtle' }} />);
  expect(view.getByRole('region', { name: t('starter.facts', { name: 'Squirtle' }) })).toBeTruthy();
  expect(view.queryByRole('region', { name: t('starter.facts', { name: form.name }) })).toBeNull();
});
