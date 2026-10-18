import { expect, test } from 'vitest';
import { t, th, type MessageKey } from './th.ts';

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

test.each(situations)('$situation has its Thai UI messages (§3.1)', ({ keys }) => {
  for (const key of keys) {
    expect(Object.hasOwn(th, key), key).toBe(true);
    expect(t(key), key).toMatch(/\p{Script=Thai}/u);
  }
});
