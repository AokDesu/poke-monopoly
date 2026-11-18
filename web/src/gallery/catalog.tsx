import type { ReactNode } from 'react';
import type { AiSpeechEvent } from '../../../engine/index.ts';
import type { PublicGame, VoiceReason } from '../game/tableTalk.ts';
import { EncounterDialog } from '../board/EncounterDialog.tsx';
import { SellPanel } from '../board/SellPanel.tsx';
import { TableTalkPanel } from '../board/TableTalk.tsx';
import { TurnPanel } from '../board/TurnPanel.tsx';
import { WatchPanel } from '../board/WatchPanel.tsx';
import { t, type MessageKey } from '../i18n/en.ts';
import { className } from '../i18n/names.ts';
import { pendingLine, SavePrompt } from '../SavePrompt.tsx';
import type { TurnPlayback } from '../board/useTurnPlayback.ts';
import type { ChatReplyControls, ChatReplyState } from '../board/useChatReply.ts';
import type { ChatReply } from '../game/chat.ts';
import {
  createScenes,
  STATIC_PLAYBACK,
  type GalleryFixtures,
  type Scene,
  type WatchScene,
} from './scenes.ts';

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
  /** The spec section of a row with no §3.1 number, when it is not the §3 AI-turns line. */
  readonly spec?: { readonly id: string; readonly label: MessageKey };
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
  const watchOpen = once(scenes.watchDecisionOpen);
  const rivalFallback = (reason: string, rivals: 1 | 2) =>
    once(() => scenes.rivalLeftShop({ source: 'fallback', fallbackReason: reason }, rivals));
  const timeoutOfOne = rivalFallback('timeout', 1);
  const timeoutOfTwo = rivalFallback('timeout', 2);
  const rateLimited = rivalFallback('rate_limited', 2);
  const notAnOption = rivalFallback('not_an_option', 2);
  const revisionMismatch = rivalFallback('revision_mismatch', 2);
  const lowConfidence = rivalFallback('low_confidence', 2);

  const talk = (
    voiceOff: VoiceReason | null,
    lines: readonly AiSpeechEvent[],
    players: PublicGame['players'] = decisionOpen().view.observation.public.players,
  ) => (
    <TableTalkPanel
      lines={lines}
      players={players}
      viewerSeat={decisionOpen().view.seatIndex}
      hidden={false}
      onToggle={noop}
      voiceOff={voiceOff}
    />
  );
  const bankLine: AiSpeechEvent = {
    kind: 'ai_speech',
    speakerSeatIndex: 1,
    addressedSeatIndex: 0,
    source: 'bank',
    lineId: 'taunt-leader-cautious-neutral-1',
    text: t('ai.line.taunt-leader-cautious-neutral-1', {
      target: className(decisionOpen().view.observation.public.players[0]!.classId),
    }),
    globalTurnNo: 12,
  };
  const exchangeLines: readonly AiSpeechEvent[] = [
    {
      kind: 'ai_speech',
      speakerSeatIndex: 2,
      addressedSeatIndex: 1,
      source: 'haiku',
      text: 'That was a lucky catch, and I am glad to see it.',
      globalTurnNo: 12,
    },
    {
      kind: 'ai_speech',
      speakerSeatIndex: 1,
      addressedSeatIndex: 2,
      source: 'haiku',
      text: 'Thank you. The tall grass has been kind to me today.',
      globalTurnNo: 12,
    },
  ];
  // Two rivals, so the exchange is between two AI seats and the player only watches. The scene
  // clones seat 1 for seat 2, so seat 2 gets the class its config names.
  const exchangePlayers = () =>
    timeoutOfTwo().view.observation.public.players.map((player) =>
      player.seatIndex === 2 ? { ...player, classId: 'researcher' } : player,
    );
  const socialOpenTwo = once(() => scenes.socialWindowOpen(2));
  const socialOpenOne = once(() => scenes.socialWindowOpen(1));
  const socialSent = once(scenes.socialMessageSent);
  const reply = (state: ChatReplyState): ChatReplyControls => ({ state, retry: noop });
  const chatReply = (lineId: string, refused = false): ChatReply => ({
    fromSeatIndex: 0,
    toSeatIndex: 1,
    visibleToSeats: [0, 1],
    topic: 'truce',
    situation: refused ? 'manipulation_refused' : 'chat_reply',
    lineId,
    refused,
    source: 'jev',
    requestId: 'gallery',
    latencyMs: 0,
  });
  const turnPanel = (
    scene: Pick<Scene, 'view'>,
    extra?: { notice?: string; social?: ChatReplyControls },
  ) => (
    <TurnPanel
      view={scene.view}
      playback={STATIC_PLAYBACK}
      actionError={false}
      onChoose={noop}
      {...extra}
    />
  );

  const watchPanel = (
    scene: Pick<WatchScene, 'view'>,
    extra?: { notice?: string; status?: TurnPlayback['status'] },
  ) => (
    <WatchPanel
      view={scene.view}
      playback={{ ...STATIC_PLAYBACK, status: extra?.status ?? null }}
      notice={extra?.notice}
      savingOff={false}
      onLeave={noop}
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
      keys: ['ai.backupInvalidAnswer', 'ai.backupRevisionMismatch'],
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
      keys: ['ai.backupLowConfidence'],
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
                status: {
                  jevEnabled: false,
                  backupOnly: true,
                  reason: 'disabled',
                  speech: { enabled: false, reason: 'disabled' },
                },
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
                turn: decisionOpen().view.observation.public.globalTurnNo,
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
    {
      id: 'haiku-off',
      specRow: 15,
      label: 'gallery.row.haikuOff',
      keys: [
        'talk.voiceOff',
        'talk.reason.disabled',
        'talk.reason.missing_key',
        'talk.reason.budget_exceeded',
        'talk.bank',
      ],
      examples: [
        {
          id: 'disabled',
          caption: 'gallery.example.voiceDisabled',
          render: () => talk('disabled', [bankLine]),
        },
        {
          id: 'missing-key',
          caption: 'gallery.example.voiceMissingKey',
          render: () => talk('missing_key', [bankLine]),
        },
        {
          id: 'budget',
          caption: 'gallery.example.voiceBudget',
          render: () => talk('budget_exceeded', []),
        },
      ],
    },
    {
      id: 'haiku-screen-fail',
      specRow: 16,
      label: 'gallery.row.haikuScreenFail',
      keys: ['talk.bank', 'talk.onlyWords', 'talk.empty'],
      examples: [
        {
          id: 'bank-line',
          caption: 'gallery.example.screenBank',
          render: () => talk(null, [bankLine]),
        },
        {
          id: 'silence',
          caption: 'gallery.example.screenSilence',
          render: () => talk(null, []),
        },
      ],
    },
    {
      id: 'ai-exchange',
      specRow: null,
      label: 'gallery.row.aiExchange',
      keys: ['talk.aiWritten', 'talk.onlyWords', 'talk.empty'],
      examples: [
        {
          id: 'exchange',
          caption: 'gallery.example.exchange',
          render: () => talk(null, [bankLine, ...exchangeLines], exchangePlayers()),
        },
        {
          id: 'exchange-dropped',
          caption: 'gallery.example.exchangeDropped',
          render: () => talk(null, []),
        },
      ],
    },
    {
      id: 'watch-browser-closed',
      specRow: 17,
      label: 'gallery.row.watchBrowserClosed',
      keys: ['save.pendingWatched', 'save.continue', 'game.resumedAiTurn'],
      examples: [
        {
          id: 'continue-prompt',
          caption: 'gallery.example.watchContinue',
          render: () => (
            <SavePrompt
              kind="continue"
              pending={pendingLine({
                phase: watchOpen().view.observation.public.phase.kind,
                waiting: 'decision',
                seatIndex: watchOpen().view.observation.public.activeSeatIndex,
                turn: watchOpen().view.observation.public.globalTurnNo,
                aiDecision: true,
              })}
              onContinue={noop}
              onNewGame={noop}
            />
          ),
        },
        {
          id: 'after-continue',
          caption: 'gallery.example.watchAfterContinue',
          render: () => watchPanel(watchOpen(), { notice: t('game.resumedAiTurn') }),
        },
      ],
    },
    {
      id: 'watch-all-backup',
      specRow: 18,
      label: 'gallery.row.watchAllBackup',
      keys: ['ai.allBackupBanner', 'ai.backupBadge'],
      examples: [
        {
          id: 'server-backup-only',
          caption: 'gallery.example.watchAllBackup',
          render: () =>
            watchPanel(watchOpen(), {
              status: {
                jevEnabled: false,
                backupOnly: true,
                reason: 'disabled',
                speech: { enabled: false, reason: 'disabled' },
              },
            }),
        },
      ],
    },
    {
      id: 'social-window',
      specRow: null,
      spec: { id: 'social', label: 'gallery.specSocial' },
      label: 'gallery.row.socialWindow',
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
      examples: [
        {
          id: 'open-two-rivals',
          caption: 'gallery.example.socialOpenTwo',
          render: () => turnPanel(socialOpenTwo()),
        },
        {
          id: 'open-one-rival',
          caption: 'gallery.example.socialOpenOne',
          render: () => turnPanel(socialOpenOne()),
        },
        {
          id: 'waiting',
          caption: 'gallery.example.socialWaiting',
          render: () => turnPanel(socialSent(), { social: reply({ status: 'waiting' }) }),
        },
        {
          id: 'reply',
          caption: 'gallery.example.socialReply',
          render: () =>
            turnPanel(socialSent(), {
              social: reply({
                status: 'ready',
                reply: chatReply('chat-reply-cautious-neutral-1'),
                words: null,
                voiceOff: null,
              }),
            }),
        },
        {
          id: 'reply-words',
          caption: 'gallery.example.socialReplyWords',
          render: () =>
            turnPanel(socialSent(), {
              social: reply({
                status: 'ready',
                reply: chatReply('chat-reply-cautious-neutral-1'),
                words: 'Thank you for saying so. I would rather look at the road before I answer.',
                voiceOff: null,
              }),
            }),
        },
        {
          id: 'reply-voice-off',
          caption: 'gallery.example.socialVoiceOff',
          render: () =>
            turnPanel(socialSent(), {
              social: reply({
                status: 'ready',
                reply: chatReply('chat-reply-cautious-neutral-1'),
                words: null,
                voiceOff: 'disabled',
              }),
            }),
        },
        {
          id: 'refused',
          caption: 'gallery.example.socialRefused',
          render: () =>
            turnPanel(socialSent(), {
              social: reply({
                status: 'ready',
                reply: chatReply('manipulation-refused-greedy-neutral-2', true),
                words: null,
                voiceOff: null,
              }),
            }),
        },
        {
          id: 'failed',
          caption: 'gallery.example.socialFailed',
          render: () =>
            turnPanel(socialSent(), { social: reply({ status: 'failed', reason: 'timeout' }) }),
        },
      ],
    },
  ];
}
/** Every §3.1 row not in `GALLERY_ROWS`. The test holds both lists to the spec's table. */
export const PENDING_ROWS: readonly PendingRow[] = [
  { specRow: 2, label: 'gallery.row.shortlistEmpty', reason: 'gallery.pending.engine' },
  { specRow: 6, label: 'gallery.row.jevTimeoutDeal', reason: 'gallery.pending.dealsBadge' },
  { specRow: 10, label: 'gallery.row.chatUnclassified', reason: 'gallery.pending.chatFreeText' },
  { specRow: 11, label: 'gallery.row.chatManipulation', reason: 'gallery.pending.chatFreeText' },
  { specRow: 14, label: 'gallery.row.eventDeckOut', reason: 'gallery.pending.eventDeck' },
];
