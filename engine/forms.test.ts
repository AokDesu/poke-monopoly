/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import {
  createGame,
  createGameConfig,
  effectiveForm,
  evolvedForm,
  nextEvolutionForms,
  fixtureSchema,
  type PokemonInstance,
} from './index.ts';
import { finishGame } from './game-end.ts';
import { drawEncounter, WILD_EXCLUDED_SPECIES_IDS } from './catching.ts';
import { saleBasis, salePrices } from './selling.ts';
import fixture from './fixtures/start-of-game-2p.json';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const parsed = parseContent(files);
const content = toEngineContent(parsed);

function game() {
  return createGame(
    createGameConfig({
      seats: [
        {
          actorId: 'a',
          seatIndex: 0,
          classId: 'main-character',
          starterSpeciesId: 'bulbasaur',
          controller: 'human',
        },
        { actorId: 'b', seatIndex: 1, classId: 'rival', controller: 'ai' },
      ],
      seed: 1,
      lapTarget: 2,
    }),
    content,
  );
}

test('real authoring adapter preserves form IDs, branches and Ability descriptions (§4.5)', () => {
  expect(content.evolutions).toEqual(parsed.evolutions);
  expect(content.species.map((s) => s.ability)).toEqual(parsed.species.map((s) => s.ability));
  expect(content.species).toHaveLength(19);
  for (const form of parsed.evolutions.forms) {
    expect(effectiveForm(content, form.id).name).toBe(form.name);
  }
});

test('explicit Gyarados replaces Magikarp stats and Ability; fallback rounds each preceding stage', () => {
  expect(evolvedForm(content, 'magikarp', 'gyarados')).toEqual(
    content.species.find((s) => s.id === 'gyarados'),
  );
  expect(effectiveForm(content, 'gyarados').ability).not.toEqual(
    effectiveForm(content, 'magikarp').ability,
  );
  expect(effectiveForm(content, 'pidgeotto')).toMatchObject({
    id: 'pidgeotto',
    battle: 3,
    base: 8,
  });
  expect(effectiveForm(content, 'pidgeot')).toMatchObject({ id: 'pidgeot', battle: 5, base: 12 });
  expect(effectiveForm(content, 'pidgeot').ability).toEqual(
    effectiveForm(content, 'pidgey').ability,
  );
  expect(effectiveForm(content, 'pidgeot').tags).toEqual(['flying']);
});

test('Eevee choices remain explicit; unknown forms, skipped stages and wrong branches reject', () => {
  expect(nextEvolutionForms(content, 'eevee')).toEqual(['vaporeon', 'jolteon', 'flareon']);
  for (const id of nextEvolutionForms(content, 'eevee')) {
    expect(evolvedForm(content, 'eevee', id).ability).toEqual(
      effectiveForm(content, 'eevee').ability,
    );
    expect(nextEvolutionForms(content, id)).toEqual([]);
  }
  expect(nextEvolutionForms(content, 'gyarados')).toEqual([]);
  expect(() => effectiveForm(content, 'missing')).toThrow(/Unknown form/);
  expect(() => nextEvolutionForms(content, 'missing')).toThrow(/Unknown form/);
  expect(() => evolvedForm(content, 'eevee', 'gyarados')).toThrow(/Invalid evolution branch/);
  expect(() => evolvedForm(content, 'pidgey', 'pidgeot')).toThrow(/Invalid evolution branch/);
});

test('undefined fallback chains reject missing, cyclic and ambiguous ancestry', () => {
  const draft = structuredClone(content);
  draft.evolutions!.lines = [];
  expect(() => effectiveForm(draft, 'metapod')).toThrow(/missing evolution line/);
  draft.evolutions!.lines = [{ speciesId: 'metapod', stages: [{ forms: ['metapod'] }] }];
  expect(() => effectiveForm(draft, 'metapod')).toThrow(/Cyclic/);
  draft.evolutions!.lines = [
    {
      speciesId: 'eevee',
      stages: [{ forms: ['vaporeon', 'jolteon'], choice: 'player' }, { forms: ['metapod'] }],
    },
  ];
  expect(() => effectiveForm(draft, 'metapod')).toThrow(/Ambiguous previous form/);
});

test('authoring validation rejects repeated form IDs and ambiguous fallback branches', () => {
  const repeated = structuredClone(files) as typeof parsed;
  repeated.evolutions.lines[0]!.stages[0]!.forms.push('metapod');
  repeated.evolutions.lines[0]!.stages[0]!.choice = 'player';
  expect(() => parseContent(repeated)).toThrow(/repeated evolution form/);
  const ambiguous = structuredClone(files) as typeof parsed;
  ambiguous.evolutions.lines
    .find((line) => line.speciesId === 'eevee')!
    .stages.push({ forms: ['metapod'] });
  expect(() => parseContent(ambiguous)).toThrow(/ambiguous previous forms/);
});

test('effective reads detach data, preserve the snapshot and RNG, and retain exactly 15 encounter species', () => {
  const state = game();
  const before = structuredClone(state);
  for (const form of content.evolutions!.forms) effectiveForm(state.content, form.id);
  const resolved = effectiveForm(state.content, 'pidgeot');
  resolved.tags.push('changed');
  resolved.ability!.text = 'changed';
  effectiveForm(state.content, 'gyarados').tags.push('changed');
  nextEvolutionForms(state.content, 'eevee').pop();
  expect(state).toEqual(before);
  const pool = content.species
    .filter((s) => !WILD_EXCLUDED_SPECIES_IDS.includes(s.id))
    .map((s) => s.id);
  expect(pool.sort()).toEqual(
    parsed.species
      .filter((s) => s.inEncounterPool)
      .map((s) => s.id)
      .sort(),
  );
  expect(pool).toHaveLength(15);
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    drawEncounter(state);
    if (state.phase.kind !== 'encounter') throw new Error('Expected encounter');
    const id = state.phase.pokemon.speciesId;
    expect(pool).toContain(id);
    seen.add(id);
  }
  expect(seen.size).toBe(15);
});

test('Sell and final liquidation use effective Base Sale while retaining origin and Tired rules (§4.7)', () => {
  const state = game();
  const pokemon: PokemonInstance = {
    ...state.players[0]!.team[0]!,
    speciesId: 'pidgeot',
    evolutionStage: 2,
    tired: true,
  };
  state.players[0]!.team = [pokemon];
  expect(saleBasis(state.content, pokemon)).toBe(12);
  expect(salePrices(state, state.players[0]!, [pokemon])).toEqual([
    { basePrice: 10, classBonus: 0 },
  ]);
  expect(saleBasis(state.content, { ...pokemon, origin: 'rescue_starter' })).toBe(0);
  expect(saleBasis(state.content, { ...pokemon, evolutionStage: 0 })).toBe(5);
  const before = state.players[0]!.coins;
  finishGame(state);
  expect(state.players[0]!.coins - before).toBe(6);
});

test('historical fixtures omit metadata deliberately; prior executable engine stamps reject', () => {
  const historical = fixtureSchema.parse(fixture);
  expect(historical.state.content.evolutions).toBeUndefined();
  expect(effectiveForm(historical.state.content, 'bulbasaur').id).toBe('bulbasaur');
  const state = game();
  expect(() => createGame({ ...state.config, engineVersion: '0.11.0' }, content)).toThrow(
    /Unsupported setup/,
  );
});
