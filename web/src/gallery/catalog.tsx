import type { ReactNode } from 'react';
import { EncounterDialog } from '../board/EncounterDialog.tsx';
import { SellPanel } from '../board/SellPanel.tsx';
import { TurnPanel } from '../board/TurnPanel.tsx';
import { t, type MessageKey } from '../i18n/en.ts';
import { pendingLine, SavePrompt } from '../SavePrompt.tsx';
import { createScenes, STATIC_PLAYBACK, type GalleryFixtures, type Scene } from './scenes.ts';

export interface GalleryExample {
  readonly id: string;
  readonly caption: MessageKey;
  readonly render: () => ReactNode;
}

/** One spec row that has a screen in this build, with the examples that show it. */
export interface GalleryRow {
  readonly id: string;
  /** Row number in the spec §3.1 table; `null` for the §3 "Backup bot mode" badge line. */
  readonly specRow: number | null;
  /** The spec's own wording for the situation. */
  readonly label: MessageKey;
  /** Catalog keys the examples must put on screen; the gallery test fails if one is missing. */
  readonly keys: readonly MessageKey[];
  readonly examples: readonly GalleryExample[];
}

/** A spec §3.1 row with nothing for a player to see yet, and why. */
export interface PendingRow {
  readonly specRow: number;
  readonly label: MessageKey;
  readonly reason: MessageKey;
}

const once = <T,>(make: () => T): (() => T) => {
  let made: { value: T } | undefined;
  return () => (made ??= { value: make() }).value;
};
const noop = () => {};

/** Builds the rows over the given fixtures. A scene is made the first time an example asks. */
export function galleryRows(fixtures: GalleryFixtures): readonly GalleryRow[] {
  const scenes = createScenes(fixtures);
  const noBall = once(scenes.noBallEncounter);
  const noBallAuto = once(scenes.noBallAutoReleased);
  const noCoins = once(scenes.shopNothingAffordable);
  const itemsFull = once(scenes.shopItemsFull);
  const sellPhase = once(scenes.sellPhaseFullTeam);
  const wholeTeamSold = once(scenes.wholeTeamSold);
  const decisionOpen = once(scenes.rivalDecisionOpen);
  const rivalFallback = (reason: string, rivals: 1 | 2) =>
    once(() => scenes.rivalLeftShop({ source: 'fallback', fallbackReason: reason }, rivals));
  const timeoutOfOne = rivalFallback('timeout', 1);
  const timeoutOfTwo = rivalFallback('timeout', 2);
  const rateLimited = rivalFallback('rate_limited', 2);
  const notAnOption = rivalFallback('not_an_option', 2);
  const revisionMismatch = rivalFallback('revision_mismatch', 2);
  const lowConfidence = rivalFallback('low_confidence', 2);

  const turnPanel = (scene: Pick<Scene, 'view'>, extra?: { notice?: string }) => (
    <TurnPanel
      view={scene.view}
      playback={STATIC_PLAYBACK}
      actionError={false}
      onChoose={noop}
      {...extra}
    />
  );

  return [
    {
      id: 'only-legal-action',
      specRow: 1,
      label: 'gallery.row.onlyLegalAction',
      keys: ['turn.onlyLegalAction', 'turn.automatic'],
      examples: [
        {
          id: 'before',
          caption: 'gallery.example.beforeAuto',
          render: () => turnPanel(noBall()),
        },
        {
          id: 'after',
          caption: 'gallery.example.afterAuto',
          render: () => turnPanel(noBallAuto()),
        },
      ],
    },
    {
      id: 'no-ball',
      specRow: 3,
      label: 'gallery.row.noBall',
      keys: ['encounter.noBall', 'encounter.catch', 'action.reason.NO_BALL', 'encounter.release'],
      examples: [
        {
          id: 'encounter',
          caption: 'gallery.example.noBall',
          render: () => (
            <EncounterDialog
              inline
              observation={noBall().view.observation}
              legalActions={noBall().view.legalActions}
              catchOdds={noBall().view.catchOdds}
              onChoose={noop}
            />
          ),
        },
      ],
    },
    {
      id: 'shop-no-coins',
      specRow: 4,
      label: 'gallery.row.shopNoCoins',
      keys: ['action.reason.NOT_ENOUGH_COINS', 'shop.skip'],
      examples: [
        {
          id: 'shop',
          caption: 'gallery.example.shopNoCoins',
          render: () => turnPanel(noCoins()),
        },
      ],
    },
    {
      id: 'items-full',
      specRow: 5,
      label: 'gallery.row.itemsFull',
      keys: ['action.reason.ITEMS_FULL', 'shop.skip'],
      examples: [
        {
          id: 'shop',
          caption: 'gallery.example.itemsFull',
          render: () => turnPanel(itemsFull()),
        },
      ],
    },
    {
      id: 'backup-badge',
      specRow: null,
      label: 'gallery.row.backupBadge',
      keys: ['ai.backupBadge', 'ai.reason.timeout', 'ai.reason.rate_limited'],
      examples: [
        {
          id: 'one-of-two',
          caption: 'gallery.example.badgeOneOfTwo',
          render: () => turnPanel(timeoutOfTwo()),
        },
        {
          id: 'rate-limited',
          caption: 'gallery.example.badgeRateLimited',
          render: () => turnPanel(rateLimited()),
        },
      ],
    },
    {
      id: 'invalid-answer',
      specRow: 7,
      label: 'gallery.row.invalidAnswer',
      keys: ['ai.backupBadge', 'ai.backupInvalidAnswer', 'ai.backupRevisionMismatch'],
      examples: [
        {
          id: 'not-an-option',
          caption: 'gallery.example.notAnOption',
          render: () => turnPanel(notAnOption()),
        },
        {
          id: 'revision-mismatch',
          caption: 'gallery.example.revisionMismatch',
          render: () => turnPanel(revisionMismatch()),
        },
      ],
    },
    {
      id: 'low-confidence',
      specRow: 8,
      label: 'gallery.row.lowConfidence',
      keys: ['ai.backupBadge', 'ai.backupLowConfidence'],
      examples: [
        {
          id: 'low-confidence',
          caption: 'gallery.example.lowConfidence',
          render: () => turnPanel(lowConfidence()),
        },
      ],
    },
    {
      id: 'all-backup',
      specRow: 9,
      label: 'gallery.row.allBackup',
      keys: ['ai.allBackupBanner', 'ai.backupBadge'],
      examples: [
        {
          id: 'every-rival',
          caption: 'gallery.example.everyRivalBackup',
          render: () => turnPanel(timeoutOfOne()),
        },
        {
          id: 'server-backup-only',
          caption: 'gallery.example.serverBackupOnly',
          render: () => (
            <TurnPanel
              view={decisionOpen().view}
              playback={{
                ...STATIC_PLAYBACK,
                status: { jevEnabled: false, backupOnly: true, reason: 'disabled' },
              }}
              actionError={false}
              onChoose={noop}
            />
          ),
        },
      ],
    },
    {
      id: 'browser-closed',
      specRow: 12,
      label: 'gallery.row.browserClosed',
      keys: ['save.pendingDecision', 'save.continue', 'game.resumedAiTurn'],
      examples: [
        {
          id: 'continue-prompt',
          caption: 'gallery.example.continuePrompt',
          render: () => (
            <SavePrompt
              kind="continue"
              pending={pendingLine({
                phase: decisionOpen().view.observation.public.phase.kind,
                waiting: 'decision',
                seatIndex: decisionOpen().view.observation.public.activeSeatIndex,
                humanSeat: decisionOpen().view.seatIndex,
                aiDecision: true,
              })}
              onContinue={noop}
              onNewGame={noop}
            />
          ),
        },
        {
          id: 'after-continue',
          caption: 'gallery.example.afterContinue',
          render: () => turnPanel(decisionOpen(), { notice: t('game.resumedAiTurn') }),
        },
      ],
    },
    {
      id: 'team-empty',
      specRow: 13,
      label: 'gallery.row.teamEmpty',
      keys: ['sell.rescuePreview', 'sell.rescueStarter'],
      examples: [
        {
          id: 'preview',
          caption: 'gallery.example.sellWholeTeam',
          render: () => (
            <SellPanel
              inline
              observation={sellPhase().view.observation}
              quoteSale={sellPhase().store.quoteSale}
              initialSelection={sellPhase().teamIds}
              onSell={noop}
            />
          ),
        },
        {
          id: 'after',
          caption: 'gallery.example.afterWholeTeamSale',
          render: () => turnPanel(wholeTeamSold()),
        },
      ],
    },
  ];
}
/** Every §3.1 row not in `GALLERY_ROWS`. The test holds both lists to the spec's table. */
export const PENDING_ROWS: readonly PendingRow[] = [
  { specRow: 2, label: 'gallery.row.shortlistEmpty', reason: 'gallery.pending.engine' },
  { specRow: 6, label: 'gallery.row.jevTimeoutDeal', reason: 'gallery.pending.dealsBadge' },
  { specRow: 10, label: 'gallery.row.chatUnclassified', reason: 'gallery.pending.chat' },
  { specRow: 11, label: 'gallery.row.chatManipulation', reason: 'gallery.pending.chat' },
  { specRow: 14, label: 'gallery.row.eventDeckOut', reason: 'gallery.pending.eventDeck' },
];
