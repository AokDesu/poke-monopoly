import { expect, test } from 'vitest';
import { classOptions } from '../game/content.ts';
import { DIFFICULTIES, PERSONALITIES } from '../game/setup.ts';
import { MODES } from '../game/store.ts';
import { en, t, type MessageKey } from './en.ts';

// Independent checklist: every row of spec §3.1, plus its visible actions and §3's badge.
// Do not derive this list from the catalog: deleting a required key must fail the test.
const situations = [
  { situation: 'only one legal action', keys: ['turn.onlyLegalAction'] },
  {
    situation: 'shortlist still empty after personality filtering',
    keys: ['turn.noAvailableOptions'],
  },
  {
    situation: 'Pokémon found but no Ball',
    keys: ['encounter.catch', 'encounter.noBall', 'encounter.release'],
  },
  {
    situation: 'not enough coins for anything in the Shop',
    keys: ['shop.notEnoughCoins', 'shop.skip'],
  },
  {
    situation: 'utility-item inventory full in the Shop (Balls stay buyable)',
    keys: ['shop.itemsFull', 'shop.skip'],
  },
  {
    situation: 'Jev timeout, rate limit, or error mid-deal',
    keys: ['ai.backupBadge', 'ai.backupUnavailable', 'deal.reconfirmAfterFallback', 'deal.confirm'],
  },
  {
    situation: 'invalid answer or mismatched revision',
    keys: ['ai.backupInvalidAnswer', 'ai.backupRevisionMismatch'],
  },
  { situation: 'confidence below the floor', keys: ['ai.backupLowConfidence'] },
  { situation: 'every AI in backup mode', keys: ['ai.allBackupBanner'] },
  {
    situation: 'unclassifiable chat (UI notice, not a line-bank reply)',
    keys: ['chat.unclassified'],
  },
  {
    situation: 'rule-breaking or hidden-information request (UI notice, not a line-bank reply)',
    keys: ['chat.manipulationRefused'],
  },
  { situation: 'resume after closing the browser during an AI turn', keys: ['game.resumedAiTurn'] },
  { situation: 'team empty after the Sell Phase', keys: ['sell.rescueStarter'] },
  { situation: 'Event deck runs out', keys: ['event.deckReshuffled'] },
] as const satisfies readonly { situation: string; keys: readonly MessageKey[] }[];

test.each(situations)('$situation has its UI messages (§3.1)', ({ keys }) => {
  for (const key of keys) {
    expect(Object.hasOwn(en, key), key).toBe(true);
    expect(t(key).trim(), key).not.toBe('');
  }
});

test('the whole catalog is English: no Thai script left in any message (§3)', () => {
  const thai = Object.entries(en).filter(([, text]) => /\p{Script=Thai}/u.test(text));
  expect(thai).toEqual([]);
});

test('every choice setup can show has its text (§1, §3)', () => {
  const keys: MessageKey[] = [
    ...(Object.keys(MODES) as (keyof typeof MODES)[]).map((mode) => `mode.${mode}` as const),
    ...PERSONALITIES.map((entry) => `personality.${entry.id}` as const),
    ...DIFFICULTIES.flatMap((level) => [`difficulty.${level}`, `difficulty.${level}Hint`] as const),
  ];
  for (const key of keys) expect(t(key).trim(), key).not.toBe('');
  // A class becomes playable once the engine implements its passive; it then needs its wording.
  for (const option of classOptions.filter((entry) => entry.playable)) {
    expect(Object.hasOwn(en, `class.passive.${option.id}`), option.id).toBe(true);
  }
});

test('the board catalog covers landmarks, inventories and every engine event kind', () => {
  const keys: MessageKey[] = [
    'board.kind.start',
    'board.kind.wild',
    'board.kind.event',
    'board.kind.shop',
    'board.kind.gym',
    'board.turn',
    'board.lap',
    'board.coins',
    'board.balls',
    'board.items',
    'board.itemCount',
    'board.emptyTeam',
    'board.emptyItems',
    'board.hiddenInventory',
    'board.logEmpty',
    'board.event.randomRoll',
    'board.event.randomDraw',
    'board.event.coins',
    'board.event.pokemonCreated',
    'board.event.itemCreated',
    'board.event.pokemonDestroyed',
    'board.event.itemDestroyed',
    'board.event.space',
    'board.event.noneYet',
    'board.event.phase',
    'board.event.hostileItem',
    'board.event.finalRound',
    'board.fixtureMissingBody',
  ];
  for (const key of keys) expect(t(key).trim(), key).not.toBe('');
  expect(t('board.squareLabel', { position: 6, kind: t('board.kind.gym') })).toBe('Square 6: Gym');
});
