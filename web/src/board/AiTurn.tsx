import { useEffect, useRef, type ReactNode } from 'react';
import type { AiStatus } from '../../../engine/contract/decision.ts';
import { PACES, type Pace } from '../game/setup.ts';
import type { SeatView, SpectatorView } from '../game/store.ts';
import type { AiDecision } from '../game/ai.ts';
import { t, type MessageKey } from '../i18n/en.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import type { TurnPlayback } from './useTurnPlayback.ts';

const REASONS: Record<string, MessageKey> = {
  disabled: 'ai.reason.disabled',
  missing_key: 'ai.reason.missing_key',
  budget_exceeded: 'ai.reason.budget_exceeded',
  timeout: 'ai.reason.timeout',
  rate_limited: 'ai.reason.rate_limited',
  auth: 'ai.reason.auth',
};

const NOTES: Record<string, MessageKey> = {
  not_an_option: 'ai.backupInvalidAnswer',
  invalid_choice: 'ai.backupInvalidAnswer',
  revision_mismatch: 'ai.backupRevisionMismatch',
  low_confidence: 'ai.backupLowConfidence',
};

const UNAVAILABLE = new Set([
  'disabled',
  'missing_key',
  'budget_exceeded',
  'timeout',
  'network',
  'rate_limited',
  'server_error',
  'auth',
]);

const isBackup = (decision: AiDecision | undefined) =>
  decision?.source === 'fallback' && UNAVAILABLE.has(decision.fallbackReason ?? '');

/** The reason line under a "Backup bot mode" badge, or null when the answer did not fall back for lack of Jev. */
export const backupReasonText = (decision: AiDecision | undefined): string | null =>
  isBackup(decision) ? t(REASONS[decision?.fallbackReason ?? ''] ?? 'ai.backupUnavailable') : null;

/** The existing words for why the backup bot decided: the badge reasons, then the per-turn notes. */
export const fallbackReasonText = (reason: string | undefined) =>
  t(REASONS[reason ?? ''] ?? NOTES[reason ?? ''] ?? 'ai.backupUnavailable');

/** Each AI seat's latest decision, from the feed. */
function latestDecisions(view: SeatView | SpectatorView): Map<number, AiDecision> {
  const latest = new Map<number, AiDecision>();
  for (const entry of view.feed)
    if (entry.decision) latest.set(entry.before.activeSeatIndex, entry.decision);
  return latest;
}

/**
 * The AI seats the backup bot is playing, each with its reason (spec §3): every AI while the
 * server says Jev is off, otherwise the seats whose latest decision fell back for lack of Jev.
 * A fallback during normal play is a per-turn note instead, never this badge.
 */
export function backupSeats(
  view: SeatView | SpectatorView,
  status: AiStatus | null,
): Map<number, string> {
  const latest = latestDecisions(view);
  const seats = new Map<number, string>();
  for (const player of view.observation.public.players) {
    if (player.seatIndex === view.seatIndex) continue;
    if (status?.backupOnly) {
      seats.set(player.seatIndex, t(REASONS[status.reason ?? ''] ?? 'ai.backupUnavailable'));
    } else {
      const reason = backupReasonText(latest.get(player.seatIndex));
      if (reason !== null) seats.set(player.seatIndex, reason);
    }
  }
  return seats;
}

/**
 * The pace choice, shared by a player's turn panel and the watcher's control bar. It shows the pace
 * the table runs at, Instant while skipping, so any choice there ends the skip.
 */
export function PaceSelect({ playback }: { playback: TurnPlayback }) {
  return (
    <label className="ai-speed">
      <span>{t('pace.label')}</span>
      <select
        value={playback.skipping ? 'instant' : playback.pace}
        onChange={(event) => playback.setPace(event.target.value as Pace)}
      >
        {PACES.map((pace) => (
          <option key={pace} value={pace}>
            {t(`pace.${pace}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A key the control answers to, shown beside its name. */
export const KeyHint = ({ children }: { children: ReactNode }) => (
  <kbd className="key-hint" aria-hidden="true">
    {children}
  </kbd>
);

/** A field that takes typed letters: P typed there is a letter, not Pause. */
const TEXT_FIELDS = 'input, textarea, select, [contenteditable="true"]';
/** A focused control Space activates: Space there presses it, not Next. */
const SPACE_TARGETS = `${TEXT_FIELDS}, button, a[href], summary, [role="button"]`;

/** True when a key press belongs to whatever has focus, or to an open dialog. */
function keyIsTaken(event: KeyboardEvent, owners: string): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return true;
  if (document.querySelector('dialog[open]')) return true;
  return event.target instanceof Element && event.target.closest(owners) !== null;
}

/**
 * Space for Next and P for Pause while the table plays (spec §3: turns can be sped up). A key
 * meant for a focused field or button, or for an open dialog, is left alone.
 */
export function usePaceKeys(playback: TurnPlayback, keys: { next: boolean; pause: boolean }) {
  const live = useRef(playback);
  live.current = playback;
  const { next, pause } = keys;
  useEffect(() => {
    if (!next && !pause) return;
    const onKey = (event: KeyboardEvent) => {
      const now = live.current;
      if (
        event.key === ' ' &&
        next &&
        now.nextBlocked === null &&
        !keyIsTaken(event, SPACE_TARGETS)
      ) {
        event.preventDefault();
        now.next();
      } else if (
        (event.key === 'p' || event.key === 'P') &&
        pause &&
        !event.repeat &&
        !keyIsTaken(event, TEXT_FIELDS)
      ) {
        event.preventDefault();
        now.setPaused(!now.paused);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [next, pause]);
}

/**
 * The pace buttons of a player's game, in the card's footer: while a rival plays, Pause (P), Next
 * (Space) and Skip to my turn; on the player's own turn at Step pace, Next, which reads "End turn"
 * when it passes the turn. The pace choice itself sits in the top bar (`PaceSelect`). The keys are
 * the card router's (`usePaceKeys`), so they work whichever card is showing.
 */
export function PaceButtons({ view, playback }: { view: SeatView; playback: TurnPlayback }) {
  const game = view.observation.public;
  const finished = game.phase.kind === 'finished';
  const rivalTurn = !finished && game.activeSeatIndex !== view.seatIndex;
  const showNext = rivalTurn || (!finished && playback.pace === 'step');
  if (!rivalTurn && !showNext) return null;
  // On the player's own turn Next only ends a hold; while they decide there is nothing to end.
  const nextBlocked =
    !rivalTurn && !playback.holding ? t('pace.nothingToHold') : playback.nextBlocked;
  const endTurn = !rivalTurn && playback.holding && game.phase.kind === 'end';
  return (
    <div className="pace-controls" role="group" aria-label={t('pace.controls')}>
      {rivalTurn && (
        <ActionButton
          enabled
          variant="secondary"
          aria-keyshortcuts="P"
          onClick={() => playback.setPaused(!playback.paused)}
        >
          {playback.paused ? t('pace.resume') : t('pace.pause')}
          <KeyHint>{t('pace.keyPause')}</KeyHint>
        </ActionButton>
      )}
      {showNext &&
        (nextBlocked === null ? (
          <ActionButton
            enabled
            variant="reward"
            aria-keyshortcuts="Space"
            data-primary=""
            onClick={playback.next}
          >
            {endTurn ? t('pace.endTurn') : t('pace.next')}
            <KeyHint>{t('pace.keyNext')}</KeyHint>
          </ActionButton>
        ) : (
          <ActionButton enabled={false} variant="reward" reasonText={nextBlocked}>
            {t('pace.next')}
            <KeyHint>{t('pace.keyNext')}</KeyHint>
          </ActionButton>
        ))}
      {rivalTurn &&
        (playback.skipping ? (
          <ActionButton enabled={false} variant="secondary" reasonText={t('pace.alreadySkipping')}>
            {t('pace.skipToMyTurn')}
          </ActionButton>
        ) : (
          <ActionButton enabled variant="secondary" onClick={playback.skipToMyTurn}>
            {t('pace.skipToMyTurn')}
          </ActionButton>
        ))}
    </div>
  );
}

/**
 * The single "every AI on the backup bot" banner (spec §3, §3.1), once, above the seat rows: while
 * the server says Jev is off for every AI, or every AI's latest decision fell back for lack of it.
 * Each seat's own Backup bot badge sits on its row.
 */
export function AllBackupBanner({
  view,
  playback,
}: {
  view: SeatView | SpectatorView;
  playback: TurnPlayback;
}) {
  const latest = latestDecisions(view);
  const opponents = view.observation.public.players.filter(
    (player) => player.seatIndex !== view.seatIndex,
  );
  const allBackup =
    playback.status?.backupOnly ||
    (opponents.length > 0 && opponents.every((player) => isBackup(latest.get(player.seatIndex))));
  if (!allBackup) return null;
  return (
    <p className="ai-backup-banner" role="status">
      {t('ai.allBackupBanner')}
    </p>
  );
}

/**
 * What the AI side of the table needs said beside the turn: a fallback note on this turn, whether
 * the status could be read, whether an AI is thinking and whether the table is skipping. The single
 * backup banner sits above the rows (`AllBackupBanner`), each seat's badge on its row.
 */
export function AiTurn({
  view,
  playback,
}: {
  view: SeatView | SpectatorView;
  playback: TurnPlayback;
}) {
  const game = view.observation.public;
  const decision = latestDecisions(view).get(game.activeSeatIndex);
  const note =
    game.activeSeatIndex !== view.seatIndex &&
    !playback.status?.backupOnly &&
    !isBackup(decision) &&
    decision?.source === 'fallback' &&
    NOTES[decision.fallbackReason ?? ''];
  if (!note && !playback.statusUnavailable && !playback.thinking && !playback.skipping) return null;
  return (
    <div className="ai-playback">
      {note && (
        <p className="ai-turn-note" data-ai-seat={game.activeSeatIndex}>
          {t(note)}
        </p>
      )}
      {playback.statusUnavailable && <p className="ai-status-note">{t('ai.statusUnavailable')}</p>}
      {playback.thinking && (
        <p className="ai-thinking" role="status">
          {t('ai.thinking')}
        </p>
      )}
      {playback.skipping && (
        <p className="ai-thinking" role="status">
          {/* A watcher holds no seat: the only skip there is to the results. */}
          {view.seatIndex === undefined ? t('watch.skipping') : t('pace.skipping')}
        </p>
      )}
    </div>
  );
}
