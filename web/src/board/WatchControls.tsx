import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n/en.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { Button } from '../ui/Button.tsx';
import { KeyHint, usePaceKeys } from './AiTurn.tsx';
import type { TurnPlayback } from './useTurnPlayback.ts';

/** An enabled button, or a greyed one that says why (spec §3.1). */
function Control({
  reason,
  variant = 'secondary',
  onClick,
  children,
}: {
  reason: string | null;
  variant?: 'primary' | 'secondary';
  onClick: () => void;
  children: ReactNode;
}) {
  return reason === null ? (
    <ActionButton enabled variant={variant} onClick={onClick}>
      {children}
    </ActionButton>
  ) : (
    <ActionButton enabled={false} reasonText={reason} variant={variant}>
      {children}
    </ActionButton>
  );
}

/** A question that needs an answer before the game goes on. It sits in the flow, not in a modal. */
function Ask({
  question,
  onCancel,
  children,
}: {
  question: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => group.current?.focus(), []);
  return (
    <div
      ref={group}
      className="watch-ask"
      role="group"
      aria-labelledby={id}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <p id={id}>{question}</p>
      <div className="watch-ask-actions">{children}</div>
    </div>
  );
}

export interface WatchControlsProps {
  playback: TurnPlayback;
  finished: boolean;
  /** The browser cannot keep a save, so Leave cannot offer Save and continue later. */
  savingOff: boolean;
  /** Without it there is nowhere to go, so the bar offers no Leave. */
  onLeave?: (how: 'save' | 'end') => void;
}

/**
 * Pause, Next, Step, Skip to results and Leave: every disabled control says why. The pace choice
 * sits in the top bar.
 */
export function WatchControls({ playback, finished, savingOff, onLeave }: WatchControlsProps) {
  usePaceKeys(playback, { next: !finished, pause: !finished });
  const [asking, setAsking] = useState<'skip' | 'leave' | null>(null);
  const opener = useRef<Element | null>(null);
  const ask = (question: 'skip' | 'leave') => {
    opener.current = document.activeElement;
    setAsking(question);
  };
  const close = () => {
    setAsking(null);
    // Back to the control that opened the question, so keyboard users do not lose their place.
    queueMicrotask(() => (opener.current as HTMLElement | null)?.focus());
  };
  const gone = finished ? t('watch.stepFinished') : null;
  return (
    <div className="watch-controls" role="group" aria-label={t('watch.controls')}>
      <div className="watch-buttons">
        <Control reason={gone} onClick={() => playback.setPaused(!playback.paused)}>
          {playback.paused ? t('watch.resume') : t('watch.pause')}
          <KeyHint>{t('pace.keyPause')}</KeyHint>
        </Control>
        <Control reason={gone ?? playback.nextBlocked} variant="primary" onClick={playback.next}>
          {t('pace.next')}
          <KeyHint>{t('pace.keyNext')}</KeyHint>
        </Control>
        <Control reason={gone ?? playback.stepBlocked} onClick={playback.step}>
          {t('watch.step')}
        </Control>
        <Control reason={gone} onClick={() => ask('skip')}>
          {t('watch.skip')}
        </Control>
        {onLeave && (
          <Control reason={null} onClick={() => ask('leave')}>
            {t('watch.leave')}
          </Control>
        )}
      </div>
      {asking === 'skip' && (
        <Ask question={t('watch.skipAsk')} onCancel={close}>
          <Button
            variant="primary"
            onClick={() => {
              setAsking(null);
              playback.skipToEnd();
            }}
          >
            {t('watch.skip')}
          </Button>
          <Button variant="secondary" onClick={close}>
            {t('watch.keepWatching')}
          </Button>
        </Ask>
      )}
      {asking === 'leave' && onLeave && (
        <Ask question={t('watch.leaveAsk')} onCancel={close}>
          <Control
            reason={savingOff ? t('watch.leaveSaveOff') : null}
            variant="primary"
            onClick={() => onLeave('save')}
          >
            {t('watch.leaveSave')}
          </Control>
          <Control reason={null} onClick={() => onLeave('end')}>
            {t('watch.leaveEnd')}
          </Control>
          <Button variant="secondary" onClick={close}>
            {t('watch.keepWatching')}
          </Button>
        </Ask>
      )}
    </div>
  );
}
