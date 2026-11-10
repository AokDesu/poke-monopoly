/// <reference types="vite/client" />
import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, test } from 'vitest';
import {
  createGame,
  createGameConfig,
  fixtureSchema,
  legalActions,
  observe,
  type Content,
  type Player,
} from '../engine/index.ts';
import { classBonus } from '../engine/classes.ts';
import { CONTENT_VERSION } from './index.ts';
import { parseContent, toEngineContent, type ContentFiles, type ParsedContent } from './schema.ts';

// The seven files, keyed by file name: the shape `parseContent` takes.
const files = Object.fromEntries(
  Object.entries(import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' })).map(
    ([path, json]) => [path.slice(2, -'.json'.length), json],
  ),
) as ContentFiles;
const content = parseContent(files);

// Appendix A is the source of truth: the tests read the spec tables and compare, so no number is
// transcribed a second time.
const spec = readFileSync(new URL('../docs/SPEC-v1.0-PokeMonopoly.md', import.meta.url), 'utf8');
const appendix = spec.slice(spec.indexOf('## Appendix A'), spec.indexOf('## Appendix B'));

function specRows(header: string) {
  const lines = appendix.split('\n');
  const rows: string[][] = [];
  for (
    let i = lines.findIndex((line) => line.startsWith(header)) + 2;
    lines[i]?.startsWith('|');
    i++
  ) {
    rows.push(
      lines[i]!.split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}

function specBullets(afterHeading: string, text = appendix) {
  const lines = text.split('\n');
  const bullets: string[] = [];
  for (let i = lines.indexOf(afterHeading) + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith('- ')) bullets.push(lines[i]!.slice(2));
    else if (bullets.length > 0) break;
  }
  return bullets;
}

const TIMING_LETTER = {
  OWN_STRATEGY: 'S',
  CHALLENGE_DECLARE: 'C',
  BEFORE_OWN_ROLL: 'B',
  AFTER_OWN_ROLL: 'A',
  REACTION: 'R',
};
const speciesName = (id: string) => content.species.find((entry) => entry.id === id)?.name ?? id;
const itemName = (id: string) => content.items.find((entry) => entry.id === id)!.name;

test('content exposes a version stamp and parseContent returns it', () => {
  expect(CONTENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  expect(content.contentVersion).toBe(CONTENT_VERSION);
});

describe('Appendix A baseline, copied exactly (spec §4.1, §4.5, §4.6)', () => {
  test('the board matches the layout square by square', () => {
    const layout = appendix.slice(
      appendix.indexOf('```text'),
      appendix.indexOf('```', appendix.indexOf('```text') + 7),
    );
    const expected = [...layout.matchAll(/(\d+) (Start|Wild|Event|Shop|Gym)/g)].map(
      ([, position, name]) => `${position} ${name}`,
    );
    expect(content.board.map((square) => `${square.position} ${square.name}`)).toEqual(expected);
    const count = (kind: string) => content.board.filter((square) => square.kind === kind).length;
    expect([count('start'), count('wild'), count('event'), count('shop'), count('gym')]).toEqual([
      1, 11, 5, 4, 3,
    ]);
    expect(content.board.filter((s) => s.kind === 'gym').map((s) => s.position)).toEqual([
      6, 12, 18,
    ]);
  });

  test('all 19 species carry the table values and the 15-species encounter pool', () => {
    const table = specRows('| Species |');
    expect(table).toHaveLength(19);
    expect(
      content.species.map((s) => [
        s.name,
        s.tags.join(','),
        s.rarity,
        String(s.dc),
        String(s.battle),
        String(s.base),
        `${s.ability.name}: ${s.ability.text} (${TIMING_LETTER[s.ability.timing]})`,
      ]),
    ).toEqual(table);
    const pool = content.species.filter((s) => s.inEncounterPool).map((s) => s.name);
    expect(pool).toHaveLength(15);
    expect(content.species.map((s) => s.name).filter((name) => !pool.includes(name))).toEqual([
      'Bulbasaur',
      'Charmander',
      'Squirtle',
      'Porygon',
    ]);
  });

  test('evolution lines match, every species exists and Eevee is the player’s choice', () => {
    const formName = (id: string) =>
      content.evolutions.forms.find((form) => form.id === id)?.name ?? speciesName(id);
    const lines = content.evolutions.lines.map((line) => {
      const chain = [
        speciesName(line.speciesId),
        ...line.stages.map((stage) => stage.forms.map(formName).join('/')),
      ].join('→');
      return line.stages.some((stage) => stage.choice === 'player')
        ? `${chain} (player's choice)`
        : chain;
    });
    expect(lines).toEqual(specBullets('**Evolution**'));
    expect(content.evolutions.lines.find((line) => line.speciesId === 'eevee')?.stages).toEqual([
      { forms: ['vaporeon', 'jolteon', 'flareon'], choice: 'player' },
    ]);
    // Magikarp's next form is a defined species; the other forms are declared in evolutions.forms.
    expect(
      content.evolutions.lines.find((line) => line.speciesId === 'magikarp')?.stages[0]?.forms,
    ).toEqual(['gyarados']);
  });

  test('3 Balls with bonuses 0, 1, 2 and 7 utility items with the table prices', () => {
    const table = specRows('| Item |');
    expect(content.items.map((item) => [item.name, String(item.price)])).toEqual(
      table.map(([name, price]) => [name, price]),
    );
    const balls = content.items.flatMap((item) => (item.kind === 'ball' ? [item] : []));
    expect(balls.map((ball) => [ball.ballType, ball.bonus])).toEqual([
      ['poke', 0],
      ['great', 1],
      ['ultra', 2],
    ]);
    for (const item of content.items) {
      const effect = table.find(([name]) => name === item.name)![2]!;
      if (item.kind === 'ball') expect(effect).toContain(`+${item.bonus}`);
      else expect(item.effect).toBe(effect);
    }
    expect(content.items.filter((item) => item.kind === 'utility')).toHaveLength(7);
  });

  test('6 core classes and 2 stretch classes with their starters, passives and items', () => {
    const table = specRows('| Class |');
    expect(
      content.classes.map((entry) => [
        entry.stretch ? `${entry.name} *(stretch)*` : entry.name,
        entry.starterSpeciesIds.length > 1
          ? `Choose ${entry.starterSpeciesIds.map(speciesName).join(' / ')}`
          : speciesName(entry.starterSpeciesIds[0]!),
        entry.passiveText,
        itemName(entry.classItemId),
      ]),
    ).toEqual(table);
    expect(content.classes.filter((entry) => entry.stretch).map((entry) => entry.id)).toEqual([
      'team-rocket',
      'collector',
    ]);
  });

  test('events e1 to e6 carry the §4.6 text', () => {
    const section = spec.slice(spec.indexOf('**Events**'), spec.indexOf('**Deck and randomness**'));
    expect(content.events.map((event) => `${event.id}: ${event.text}.`)).toEqual(
      specBullets('**Events**', section),
    );
  });

  test('config holds the starting kit, Start income, Lap targets and rarity weights', () => {
    expect(content.config).toEqual({
      startingKit: { coins: 20, starters: 1, pokeBalls: 5, classItems: 1 },
      startIncome: 5,
      lapTargets: { quick: 2, standard: 3 },
      rarityWeights: { common: 50, uncommon: 33, rare: 17 },
    });
  });
});

describe('parseContent rejects broken files with a readable message', () => {
  const row = (value: unknown) => value as Record<string, unknown>;
  // One broken file per rule: [what is wrong, how to break a copy, message, "→ at" path].
  const cases: [string, (draft: ContentFiles) => void, string, string][] = [
    [
      'a missing species field',
      (d) => delete row(d.species[1]).dc,
      'expected number, received undefined',
      'species[1].dc',
    ],
    [
      'a misspelt rarity',
      (d) => (row(d.species[0]).rarity = 'epic'),
      'expected one of',
      'species[0].rarity',
    ],
    [
      'a field the schema does not know',
      (d) => (row(d.items[0]).sparkle = 1),
      'Unrecognized key: "sparkle"',
      'items[0]',
    ],
    ['a missing file', (d) => delete row(d).events, 'expected array, received undefined', 'events'],
    [
      'a duplicate species id',
      (d) => (d.species[1]!.id = d.species[0]!.id),
      'duplicate species id "caterpie"',
      'species[1].id',
    ],
    [
      'a board with one Wild too few',
      (d) => (d.board[1]!.kind = 'shop'),
      'board needs 11 wild squares, found 10',
      'board',
    ],
    [
      'a Gym off squares 6/12/18',
      (d) => {
        d.board[6]!.kind = 'wild';
        d.board[7]!.kind = 'gym';
      },
      'square 6 must be gym',
      'board[6].kind',
    ],
    [
      'squares out of order',
      (d) => d.board.reverse(),
      'list squares in order from 0',
      'board[0].position',
    ],
    [
      'an unknown species as an evolution base',
      (d) => (d.evolutions.lines[0]!.speciesId = 'missingno'),
      'unknown species "missingno"',
      'evolutions.lines[0].speciesId',
    ],
    [
      'an unknown species inside an evolution stage',
      (d) => (d.evolutions.lines[0]!.stages[1]!.forms = ['butterfre']),
      'unknown species "butterfre"',
      'evolutions.lines[0].stages[1].forms[0]',
    ],
    [
      'two lines for one species',
      (d) => d.evolutions.lines.push(d.evolutions.lines[0]!),
      'second line for "caterpie"',
      'evolutions.lines[14].speciesId',
    ],
    [
      'an evolution form that is already a species',
      (d) => d.evolutions.forms.push({ id: 'eevee', name: 'Eevee' }),
      '"eevee" is already a species',
      'evolutions.forms[23].id',
    ],
    [
      'several forms without the player’s choice',
      (d) => delete row(d.evolutions.lines[8]!.stages[0]).choice,
      'needs choice: "player"',
      'evolutions.lines[8].stages[0]',
    ],
    [
      'a class Starter that is not a species',
      (d) => (d.classes[1]!.starterSpeciesIds = ['evee']),
      'unknown species "evee"',
      'classes[1].starterSpeciesIds[0]',
    ],
    [
      'a class item that is not an item',
      (d) => (d.classes[0]!.classItemId = 'master-ball'),
      'unknown item "master-ball"',
      'classes[0].classItemId',
    ],
    [
      'a class passive the engine does not know',
      (d) => (row(d.classes[0]).passive = 'double_coins'),
      'Invalid option: expected one of',
      'classes[0].passive',
    ],
    [
      'a Ball type listed twice',
      (d) => {
        const ultra = d.items[2]!;
        if (ultra.kind === 'ball') ultra.ballType = 'poke';
      },
      'ball type "poke" is listed twice',
      'items[2].ballType',
    ],
    [
      'a rarity with weight but no pooled species',
      (d) =>
        d.species.forEach((s) => {
          if (s.rarity === 'rare') s.inEncounterPool = false;
        }),
      'no rare species is in the encounter pool',
      'config.rarityWeights.rare',
    ],
  ];

  test.each(cases)('%s', (_name, breakIt, message, path) => {
    const draft = structuredClone(files);
    breakIt(draft);
    expect(() => parseContent(draft)).toThrow(message);
    expect(() => parseContent(draft)).toThrow(`→ at ${path}`);
  });

  test('the untouched files still parse', () => {
    expect(() => parseContent(structuredClone(files))).not.toThrow();
  });
});

describe('the parsed content is the engine’s Content', () => {
  const engineContent = toEngineContent(content);

  test('ParsedContent is structurally an engine Content (compile-time)', () => {
    expectTypeOf<ParsedContent>().toExtend<Content>();
  });

  test('the engine view drops authoring-only fields and keeps every row', () => {
    const keys = new Set(
      [...engineContent.species, ...engineContent.classes, ...engineContent.items].flatMap(
        Object.keys,
      ),
    );
    const authoringOnly = [
      'ability',
      'passiveText',
      'inEncounterPool',
      'bonus',
      'effect',
      'stretch',
    ];
    expect(authoringOnly.filter((key) => keys.has(key))).toEqual([]);
    expect(engineContent.species).toHaveLength(19);
    expect(engineContent.classes.map((entry) => entry.id)).toEqual(
      content.classes.map((entry) => entry.id),
    );
  });

  test('every engine fixture passes with the real content swapped in', () => {
    const fixtures = import.meta.glob<unknown>('../engine/fixtures/*.json', {
      eager: true,
      import: 'default',
    });
    expect(Object.keys(fixtures).length).toBeGreaterThan(0);
    for (const input of Object.values(fixtures)) {
      const original = fixtureSchema.parse(input);
      const fixture = fixtureSchema.parse({
        ...original,
        state: { ...original.state, content: engineContent },
      });
      for (const [seat, expected] of Object.entries(fixture.observation)) {
        expect(
          observe(fixture.state, Number(seat)),
          `${fixture.name}, observation ${seat}`,
        ).toEqual(expected);
      }
      for (const [seat, expected] of Object.entries(fixture.legalActions)) {
        expect(
          legalActions(fixture.state, Number(seat)),
          `${fixture.name}, actions ${seat}`,
        ).toEqual(expected);
      }
    }
  });

  test('createGame builds every class’s starting kit from the real content', () => {
    const { startingKit } = content.config;
    for (const entry of content.classes) {
      const other = content.classes.find((candidate) => candidate.id !== entry.id)!;
      const seat = (classId: string, seatIndex: number, starters: string[]) => ({
        actorId: `player-${seatIndex}`,
        seatIndex,
        classId,
        starterSpeciesId: starters[0],
        controller: 'human' as const,
      });
      const state = createGame(
        createGameConfig({
          seats: [
            seat(entry.id, 0, entry.starterSpeciesIds),
            seat(other.id, 1, other.starterSpeciesIds),
          ],
          seed: 1,
          lapTarget: content.config.lapTargets.quick,
        }),
        engineContent,
      );
      const player = state.players[0]!;
      expect(player.coins, entry.id).toBe(startingKit.coins);
      expect(player.team, entry.id).toHaveLength(startingKit.starters);
      // Ball class items go into the pouch, utility class items stay as items (spec §4.1).
      const ball = content.items.find((item) => item.id === entry.classItemId)!;
      const pouch = ball.kind === 'ball' ? 1 : 0;
      expect(player.balls.poke + player.balls.great + player.balls.ultra, entry.id).toBe(
        startingKit.pokeBalls + pouch,
      );
      expect(player.items.length + pouch, entry.id).toBe(startingKit.classItems);
    }
  });

  test('the engine reads the Main Character and Researcher passives from the real content', () => {
    // Implemented Appendix A passives are registered by engine-owned ID.
    expect(
      Object.fromEntries(
        content.classes.flatMap((entry) => (entry.passive ? [[entry.id, entry.passive]] : [])),
      ),
    ).toEqual({
      'main-character': 'lap_first_catch_bonus',
      researcher: 'lap_first_sale_bonus',
      'nurse-joy': 'turn_start_team_heal',
    });
    const seat = (classId: string, seatIndex: number, starterSpeciesId: string) => ({
      actorId: `player-${seatIndex}`,
      seatIndex,
      classId,
      starterSpeciesId,
      controller: 'human' as const,
    });
    const state = createGame(
      createGameConfig({
        seats: [seat('main-character', 0, 'bulbasaur'), seat('researcher', 1, 'porygon')],
        seed: 1,
        lapTarget: content.config.lapTargets.quick,
      }),
      engineContent,
    );
    const [main, researcher] = state.players as [Player, Player];
    const sale = (player: Player) => {
      const pokemon = player.team[0]!;
      return classBonus(engineContent, player.classId, {
        kind: 'sale',
        pokemon,
        batch: [{ pokemon, basis: 5 }],
      });
    };
    // Appendix A: +1 on the first catch roll each Lap; +3 on the first Pokémon sold at Start each Lap.
    expect(classBonus(engineContent, main.classId, { kind: 'catch', player: main })).toBe(1);
    expect(
      classBonus(engineContent, researcher.classId, { kind: 'catch', player: researcher }),
    ).toBe(0);
    expect(sale(researcher)).toBe(3);
    expect(sale(main)).toBe(0);
  });
});
