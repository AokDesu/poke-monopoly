import { expect, test } from 'vitest';
import { GAME_PRESETS } from '../../../engine/index.ts';
import { content } from '../game/content.ts';
import { en, t } from '../i18n/en.ts';
import {
  AVAILABLE_FEATURES,
  buildSteps,
  FEATURE_IDS,
  type Features,
  type HowToPlayStep,
} from './steps.ts';

const allOff = Object.fromEntries(FEATURE_IDS.map((id) => [id, false])) as unknown as Features;
const text = (steps: readonly HowToPlayStep[]) =>
  steps.flatMap((step) => [step.title, ...step.paragraphs]).join('\n');
const factsOf = (steps: readonly HowToPlayStep[], id: string) =>
  steps
    .flatMap((step) => step.visuals)
    .flatMap((visual) => (visual.kind === 'facts' ? visual.facts : []))
    .filter((fact) => fact.id === id);

test('six to eight short steps, about sixty words each (issue #221)', () => {
  const steps = buildSteps();
  expect(steps.length).toBeGreaterThanOrEqual(6);
  expect(steps.length).toBeLessThanOrEqual(8);
  for (const step of steps) {
    const words = step.paragraphs.join(' ').split(/\s+/).length;
    expect(words, step.id).toBeGreaterThanOrEqual(35);
    expect(words, step.id).toBeLessThanOrEqual(80);
  }
});

test('every feature on main is described, and each one only through its own paragraph', () => {
  const full = buildSteps(AVAILABLE_FEATURES);
  expect(Object.values(AVAILABLE_FEATURES).every(Boolean)).toBe(true);
  for (const feature of FEATURE_IDS) {
    const without = buildSteps({ ...AVAILABLE_FEATURES, [feature]: false });
    expect(text(without), `${feature} is not used by any step`).not.toBe(text(full));
    const alone = buildSteps({ ...allOff, [feature]: true });
    expect(alone.length, feature).toBeGreaterThan(0);
    // One feature on shows one step, never a step built for a screen that is not there.
    expect(alone.length, feature).toBe(1);
  }
});

test('a step whose screens are not on main is absent, not "coming soon"', () => {
  expect(buildSteps(allOff)).toEqual([]);
  for (const feature of ['social', 'battle', 'abilities', 'shop'] as const) {
    const steps = buildSteps({ ...AVAILABLE_FEATURES, [feature]: false });
    expect(text(steps)).not.toMatch(/coming soon|not yet|planned|later/i);
  }
  const noTalk = buildSteps({ ...AVAILABLE_FEATURES, social: false });
  expect(noTalk.find((step) => step.id === 'talk')).toBeUndefined();
  expect(noTalk.length).toBe(buildSteps().length - 1);
});

test('Deal Cards and promises have no screen yet, so nothing mentions them (#138, #139)', () => {
  expect(text(buildSteps())).not.toMatch(/deal|promise|trade|truce/i);
});

test('the starting kit, Start income and Laps are read from the content and the engine', () => {
  const steps = buildSteps();
  const { startingKit, startIncome, lapTargets } = content.config;
  expect(factsOf(steps, 'coins').map((fact) => fact.value)).toEqual([startingKit.coins]);
  expect(factsOf(steps, 'starters').map((fact) => fact.value)).toEqual([startingKit.starters]);
  expect(factsOf(steps, 'balls').map((fact) => fact.value)).toEqual([startingKit.pokeBalls]);
  expect(factsOf(steps, 'items').map((fact) => fact.value)).toEqual([startingKit.classItems]);
  expect(factsOf(steps, 'income').map((fact) => fact.value)).toEqual([startIncome]);
  // Only the presets setup offers; Standard stays out until the playtest opens it (§1).
  const open = Object.entries(GAME_PRESETS).filter(([, mode]) => mode.enabled);
  expect(factsOf(steps, 'quick').map((fact) => fact.value)).toEqual([lapTargets.quick]);
  expect(factsOf(steps, 'quick').map((fact) => fact.value)).toEqual([GAME_PRESETS.quick.lapTarget]);
  expect(factsOf(steps, 'standard')).toEqual([]);
  expect(open.map(([id]) => id)).toEqual(['quick']);
});

test('changing a number in the content changes what the steps show, never the text', () => {
  const numbers = {
    config: {
      startingKit: { coins: 31, starters: 2, pokeBalls: 9, classItems: 3 },
      startIncome: 8,
    },
    modes: { quick: { lapTarget: 4, enabled: true }, standard: { lapTarget: 6, enabled: true } },
  };
  const steps = buildSteps(AVAILABLE_FEATURES, numbers);
  expect(factsOf(steps, 'coins')[0]!.value).toBe(31);
  expect(factsOf(steps, 'starters')[0]!.value).toBe(2);
  expect(factsOf(steps, 'balls')[0]!.value).toBe(9);
  expect(factsOf(steps, 'items')[0]!.value).toBe(3);
  expect(factsOf(steps, 'income')[0]!.value).toBe(8);
  expect(factsOf(steps, 'quick')[0]!.value).toBe(4);
  expect(factsOf(steps, 'standard')[0]!.value).toBe(6);
  expect(text(steps)).toBe(text(buildSteps()));
});

test('no digit is typed into a walkthrough string, so no rule number can be out of date', () => {
  const keys = Object.keys(en).filter((key) => key.startsWith('howToPlay.'));
  expect(keys.length).toBeGreaterThan(20);
  for (const key of keys) expect(en[key as keyof typeof en], key).not.toMatch(/\d/);
  expect(text(buildSteps())).not.toMatch(/\d/);
});

test('button names in the text are the catalogue’s own words, and every slot is filled', () => {
  const body = text(buildSteps());
  expect(body).not.toMatch(/[{}]/);
  for (const key of [
    'encounter.release',
    'action.reason.NO_BALL',
    'sell.confirm',
    'sell.keep',
    'shop.skip',
    'action.reason.NOT_ENOUGH_COINS',
    'strategy.skip',
    'social.skip',
  ] as const) {
    expect(body, key).toContain(`“${t(key)}”`);
  }
});

test('the wild Pokémon shown are in the encounter pool, one per rarity', () => {
  const visual = buildSteps()
    .flatMap((step) => step.visuals)
    .find((entry) => entry.kind === 'pokemon');
  expect(visual).toBeDefined();
  const ids = visual!.kind === 'pokemon' ? visual!.speciesIds : [];
  expect(ids.length).toBeGreaterThan(0);
  const rarities = ids.map((id) => content.species.find((species) => species.id === id)!);
  for (const species of rarities) expect(species.inEncounterPool).toBe(true);
  expect(new Set(rarities.map((species) => species.rarity)).size).toBe(ids.length);
});
