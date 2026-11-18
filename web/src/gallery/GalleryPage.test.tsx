import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test } from 'vitest';
import encounterNoBall from '../../../engine/fixtures/encounter-no-ball.json';
import sellPhaseThree from '../../../engine/fixtures/sell-phase-three-pokemon.json';
import shopLowCoins from '../../../engine/fixtures/shop-low-coins.json';
import shopNoCoins from '../../../engine/fixtures/shop-no-coins.json';
import { t, type MessageKey } from '../i18n/en.ts';
import { galleryRows, PENDING_ROWS } from './catalog.tsx';
import { GalleryPage } from './GalleryPage.tsx';
import type { GalleryFixtures } from './scenes.ts';

afterEach(cleanup);

const fixtures: GalleryFixtures = {
  'encounter-no-ball': encounterNoBall,
  'sell-phase-three-pokemon': sellPhaseThree,
  'shop-low-coins': shopLowCoins,
  'shop-no-coins': shopNoCoins,
};

// Independent checklist (spec §3.1 and §3's badge): the rows that have a screen in this build and
// the catalog keys each must put on screen. Do not derive it from the gallery: deleting a key from
// an example must fail the test.
const SHOWN = [
  {
    id: 'only-legal-action',
    specRow: '1',
    keys: [
      'turn.onlyLegalAction',
      'turn.automatic',
      'choice.challengeGym',
      'battle.gymAutoSkipped',
    ],
  },
  {
    id: 'no-ball',
    specRow: '3',
    keys: ['encounter.noBall', 'encounter.catch', 'action.reason.NO_BALL', 'encounter.release'],
  },
  { id: 'shop-no-coins', specRow: '4', keys: ['action.reason.NOT_ENOUGH_COINS', 'shop.skip'] },
  { id: 'items-full', specRow: '5', keys: ['action.reason.ITEMS_FULL', 'shop.skip'] },
  {
    id: 'backup-badge',
    specRow: 'ai-turns',
    keys: ['ai.backupBadge', 'ai.reason.timeout', 'ai.reason.rate_limited'],
  },
  {
    id: 'invalid-answer',
    specRow: '7',
    keys: ['ai.backupInvalidAnswer', 'ai.backupRevisionMismatch'],
  },
  { id: 'low-confidence', specRow: '8', keys: ['ai.backupLowConfidence'] },
  { id: 'all-backup', specRow: '9', keys: ['ai.allBackupBanner', 'ai.backupBadge'] },
  {
    id: 'browser-closed',
    specRow: '12',
    keys: ['save.pendingDecision', 'save.continue', 'game.resumedAiTurn'],
  },
  { id: 'team-empty', specRow: '13', keys: ['sell.rescuePreview', 'sell.rescueStarter'] },
  { id: 'event-deck-out', specRow: '14', keys: ['event.card.heading', 'event.deckReshuffled'] },
  {
    id: 'haiku-off',
    specRow: '15',
    keys: [
      'talk.voiceOff',
      'talk.reason.disabled',
      'talk.reason.missing_key',
      'talk.reason.budget_exceeded',
      'talk.bank',
    ],
  },
  { id: 'haiku-screen-fail', specRow: '16', keys: ['talk.bank', 'talk.onlyWords', 'talk.empty'] },
  {
    id: 'ai-exchange',
    specRow: 'ai-turns',
    keys: ['talk.aiWritten', 'talk.bank', 'talk.onlyWords'],
  },
  {
    id: 'casual-talk',
    specRow: 'ai-turns',
    keys: ['talk.bank', 'talk.toYou', 'talk.onlyWords'],
  },
  {
    id: 'jev-panel',
    specRow: 'ai-turns',
    keys: [
      'demo.heading',
      'demo.banner',
      'demo.chosen',
      'demo.confidence',
      'demo.sellNote',
      'demo.byBackup',
      'ai.reason.timeout',
    ],
  },
  {
    id: 'watch-browser-closed',
    specRow: '17',
    keys: ['save.pendingWatched', 'save.continue', 'game.resumedAiTurn'],
  },
  { id: 'watch-all-backup', specRow: '18', keys: ['ai.allBackupBanner', 'ai.backupBadge'] },
  {
    id: 'pvp-gym',
    specRow: 'battle',
    keys: [
      'challenge.heading',
      'challenge.intro',
      'battle.heading.response',
      'battle.declineNote',
      'battle.forcedBy',
      'battle.heading.window',
      'battle.withThis',
      'battle.heading.gym',
      'battle.termsGym',
      'battle.heading.reward',
      'battle.reward.evolveGroup',
      'battle.reward.choose',
      'battle.result',
      'board.event.pvpResolved',
    ],
  },
  {
    id: 'social-window',
    specRow: 'social',
    keys: [
      'social.onlyWords',
      'social.topic.truce',
      'social.topic.trade',
      'social.topic.point_leader',
      'social.topic.use_item',
      'social.topic.hold_item',
      'social.skip',
      'social.reason.chooseRival',
      'social.reason.noThirdSeat',
      'social.spent',
      'social.waiting',
      'social.noticeTruce',
      'social.continue',
      'talk.bank',
      'talk.aiWritten',
      'talk.voiceOff',
      'social.refused',
      'social.failed.timeout',
      'social.retry',
    ],
  },
  {
    id: 'abilities',
    specRow: 'abilities',
    keys: ['ability.heading', 'ability.planned', 'ability.choosePrompt', 'battle.heading.window'],
  },
] as const satisfies readonly { id: string; specRow: string; keys: readonly MessageKey[] }[];

/** Rows with nothing for a player to see in this build (no free-text chat or deals screen, engine-only). */
const PENDING = ['2', '6', '10', '11'];

/** A catalog message as a pattern, so templated values (`{value}`) match whatever the engine says. */
function shown(root: HTMLElement, key: MessageKey): boolean {
  const pattern = t(key)
    .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
    .replace(/\{\w+\}/g, '.+');
  return new RegExp(pattern).test(root.textContent ?? '');
}
const missing = (root: HTMLElement, keys: readonly MessageKey[]) =>
  keys.filter((key) => !shown(root, key));
const section = (id: string) => document.querySelector<HTMLElement>(`[data-gallery-row="${id}"]`)!;
/** The examples only: a row's heading repeats spec words such as "Not enough coins". */
const examples = (id: string) => section(id).querySelector<HTMLElement>('.gallery-examples')!;

/** The spec's §3.1 table: its "Situation" column, in order. */
function specSituations(): string[] {
  const spec = readFileSync(join(process.cwd(), 'docs', 'SPEC-v1.0-PokeMonopoly.md'), 'utf8');
  const table = spec.split('### 3.1 Decisions you never made')[1]!.split('\n\n')[2]!;
  return table
    .split('\n')
    .slice(2)
    .map((line) => line.split('|')[1]!.trim());
}

test('every §3.1 row that has a screen shows each of its catalog keys, labelled with its spec row', () => {
  render(<GalleryPage fixtures={fixtures} />);
  expect(
    [...document.querySelectorAll('[data-gallery-row]')].map((el) =>
      el.getAttribute('data-gallery-row'),
    ),
  ).toEqual(SHOWN.map((row) => row.id));
  for (const row of SHOWN) {
    const el = section(row.id);
    expect(el.getAttribute('data-spec-row'), row.id).toBe(row.specRow);
    expect(missing(examples(row.id), row.keys), row.id).toEqual([]);
    const label =
      row.specRow === 'ai-turns'
        ? t('gallery.specAiTurns')
        : row.specRow === 'battle'
          ? t('gallery.specBattle')
          : row.specRow === 'social'
            ? t('gallery.specSocial')
            : row.specRow === 'abilities'
              ? t('gallery.specAbilities')
              : t('gallery.specRow', { row: row.specRow });
    expect(within(el).getByText(label), row.id).toBeTruthy();
  }
});

test('the gallery fails to show a key when its screen no longer does (Shop with coins has no "Not enough coins")', () => {
  const rich = structuredClone(shopLowCoins);
  rich.state.players[0]!.coins = 99;
  render(<GalleryPage fixtures={{ ...fixtures, 'shop-no-coins': rich }} />);
  expect(
    missing(examples('shop-no-coins'), ['action.reason.NOT_ENOUGH_COINS', 'shop.skip']),
  ).toEqual(['action.reason.NOT_ENOUGH_COINS']);
});

test('the catalog declares exactly the checklist keys', () => {
  expect(galleryRows(fixtures).map(({ id, keys }) => ({ id, keys }))).toEqual(
    SHOWN.map(({ id, keys }) => ({ id, keys })),
  );
});

test('every row of the spec §3.1 table is shown or listed as pending, under the spec’s own words', () => {
  render(<GalleryPage fixtures={fixtures} />);
  const situations = specSituations();
  expect(situations).toHaveLength(18);
  const pending = [...document.querySelectorAll<HTMLElement>('.gallery-pending li')];
  expect(pending.map((li) => li.getAttribute('data-spec-row'))).toEqual(PENDING);
  expect(PENDING_ROWS.map((row) => String(row.specRow))).toEqual(PENDING);
  situations.forEach((situation, index) => {
    const row = String(index + 1);
    const el =
      pending.find((li) => li.getAttribute('data-spec-row') === row) ??
      document.querySelector<HTMLElement>(`[data-gallery-row][data-spec-row="${row}"]`);
    expect(el, `spec row ${row} is neither shown nor pending`).toBeTruthy();
    expect(el!.querySelector('h2, strong')!.textContent, `spec row ${row}`).toBe(situation);
  });
});

test('the examples are fixed: two builds give the same screens', () => {
  const markup = () =>
    galleryRows(fixtures).map((row) =>
      row.examples.map((example) => renderToStaticMarkup(<>{example.render()}</>)),
    );
  expect(markup()).toEqual(markup());
});

test('the examples are inert: choosing in one changes nothing on the page', () => {
  render(<GalleryPage fixtures={fixtures} />);
  const shop = section('items-full');
  const before = shop.innerHTML;
  fireEvent.click(within(shop).getByRole('button', { name: 'Buy Poké Ball · 1 coin' }));
  fireEvent.click(within(shop).getByRole('button', { name: t('shop.skip') }));
  expect(shop.innerHTML).toBe(before);
  expect(within(shop).getByText(t('shop.balance', { coins: 20 }))).toBeTruthy();
});

test('the two dialogs open in the page flow, not as modals, so every example is visible', () => {
  render(<GalleryPage fixtures={fixtures} />);
  const dialogs = [...document.querySelectorAll('dialog')];
  expect(dialogs).toHaveLength(2);
  for (const dialog of dialogs) expect(dialog.open).toBe(true);
});

test('an invalid answer, revision mismatch or low confidence shows a per-turn note, never the badge or banner (§3)', () => {
  render(<GalleryPage fixtures={fixtures} />);
  for (const id of ['invalid-answer', 'low-confidence']) {
    const text = examples(id).textContent!;
    expect(text, id).not.toContain(t('ai.backupBadge'));
    expect(text, id).not.toContain(t('ai.allBackupBanner'));
  }
  for (const id of ['backup-badge', 'all-backup']) {
    expect(examples(id).textContent!, id).toContain(t('ai.backupBadge'));
  }
});

test('the "What Jev chose" panel lives only in its own row, and every example of it carries the private-options banner', () => {
  render(<GalleryPage fixtures={fixtures} />);
  for (const row of SHOWN) {
    const found = examples(row.id).querySelectorAll('.jev-panel');
    if (row.id !== 'jev-panel') {
      expect(found.length, row.id).toBe(0);
      expect(examples(row.id).textContent!, row.id).not.toContain(t('demo.heading'));
    } else {
      expect(found.length).toBe(4);
      for (const panel of found) expect(panel.textContent).toContain(t('demo.banner'));
    }
  }
});
