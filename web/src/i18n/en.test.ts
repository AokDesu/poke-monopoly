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

test('turn decisions, results, handoffs and every disabled reason have English catalog text', () => {
  const keys: MessageKey[] = [
    'turn.actions',
    'turn.strategyBody',
    'turn.opponent',
    'turn.opponentError',
    'turn.retry',
    'turn.actionError',
    'turn.automatic',
    'turn.moving',
    'turn.encounterBody',
    'turn.lastMove',
    'turn.end',
    'turn.finished',
    'turn.sellHeading',
    'turn.sellBody',
    'turn.shopHeading',
    'turn.shopBody',
    'encounter.heading',
    'encounter.body',
    'encounter.ballChoice',
    'encounter.caught',
    'encounter.escaped',
    'encounter.released',
    'action.reason.NO_BALL',
    'action.reason.NOT_ENOUGH_COINS',
    'action.reason.ITEMS_FULL',
    'action.reason.NOT_YOUR_TURN',
    'action.reason.ALREADY_USED_THIS_TURN',
    'action.reason.NO_VALID_TARGET',
  ];
  for (const key of keys) expect(t(key).trim(), key).not.toBe('');
  expect(t('action.reason.NO_BALL')).toBe('No Ball');
  expect(t('encounter.ballChoice', { ball: t('board.ball.great'), percent: 83 })).toBe(
    'Great Ball · 83%',
  );
});

test('save and results copy is present and never uses Pokémon counts (§1, §4.7)', () => {
  const keys: MessageKey[] = [
    'save.off',
    'save.continueHeading',
    'save.continueBody',
    'save.continue',
    'save.newGame',
    'save.pendingDecision',
    'save.pendingRoll',
    'save.pendingFinished',
    'save.mismatchHeading',
    'save.mismatchNext',
    'save.unreadable',
    'results.body',
    'results.none',
    'results.standings',
    'results.badges',
    'results.winnerMark',
    'results.winCoins',
    'results.winCoinsYou',
    'results.winBadges',
    'results.winBadgesYou',
    'results.coWinners',
    'results.nameJoin',
    'results.playAgain',
    'results.export',
    'game.resumedAiTurn',
  ];
  for (const key of keys) {
    expect(t(key).trim(), key).not.toBe('');
    expect(t(key), key).not.toMatch(/pokémon|pokemon|evolution/i);
  }
  expect(t('save.off')).toBe('Saving is off. The game still plays.');
  expect(t('results.winBadges', { name: 'Ash' })).toBe(
    'Coins are tied. Ash wins with more badges.',
  );
  expect(t('results.coWinners', { names: 'You and Ash' })).toContain('co-winners');
});

test('Shop, Strategy previews and atomic Sell decisions have catalog coverage', () => {
  const keys: MessageKey[] = [
    'shop.buy',
    'shop.buyOne',
    'shop.balance',
    'shop.skip',
    'strategy.targets',
    'strategy.preview',
    'strategy.effect',
    'strategy.target',
    'strategy.targetCoins',
    'strategy.chooseTarget',
    'strategy.cost',
    'strategy.confirm',
    'strategy.skip',
    'sell.coins',
    'sell.price',
    'sell.priceBonus',
    'sell.tired',
    'sell.soloPrice',
    'sell.selectedPrice',
    'sell.total',
    'sell.confirm',
    'sell.keep',
    'sell.rescuePreview',
    'action.engineReason',
  ];
  for (const key of keys) expect(t(key).trim(), key).not.toBe('');
  expect(t('sell.confirm')).toBe('Sell selected');
  expect(t('sell.keep')).toBe('Keep all');
});

test('AI playback controls, status reasons and line bank notices go through the catalog', () => {
  const keys: MessageKey[] = [
    'ai.thinking',
    'ai.playing',
    'ai.now',
    'ai.statusUnavailable',
    'ai.speed',
    'ai.speed.normal',
    'ai.speed.fast',
    'ai.speed.instant',
    'ai.skipLine',
    'ai.speech',
    'ai.reason.disabled',
    'ai.reason.missing_key',
    'ai.reason.budget_exceeded',
    'ai.reason.timeout',
    'ai.reason.rate_limited',
    'ai.reason.auth',
    'ai.reason.stub',
    'ai.action.roll',
    'ai.action.skip',
    'ai.action.catch',
    'ai.action.release',
    'ai.action.buy',
    'ai.action.skip_shop',
    'ai.action.use_item',
    'ai.action.sell',
    'ai.action.keep',
    'ai.action.move',
    'ai.result.caught',
    'ai.result.escaped',
    'ai.result.released',
    'ai.line.fallback-notice-greedy-neutral-1',
    'ai.line.fallback-notice-greedy-neutral-2',
    'ai.line.fallback-notice-greedy-neutral-3',
  ];
  for (const key of keys) expect(t(key).trim(), key).not.toBe('');
  expect(t('ai.line.fallback-notice-greedy-neutral-2', { turn: 7 })).toBe(
    'From turn 7, a backup bot is making my moves.',
  );
});
