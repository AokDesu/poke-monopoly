import { useEffect, useSyncExternalStore } from 'react';
import { firstPlayerRoll } from '../game/firstPlayer.ts';
import type { GameStore } from '../game/store.ts';
import { className } from '../i18n/names.ts';
import { t } from '../i18n/en.ts';
import { Button } from '../ui/Button.tsx';
import { DieFace } from '../ui/DieFace.tsx';
import { DieIcon } from '../ui/icons.tsx';
import { Screen } from '../ui/Screen.tsx';
import { SetupProgress } from './SetupProgress.tsx';

interface FirstPlayerScreenProps {
  store: GameStore;
  onToBoard: () => void;
  onQuit: () => void;
}

/**
 * The first-player roll (spec §3): every seat's roll, attempt by attempt, read from the human
 * seat's view. A tie for the top roll starts a new attempt for the tied seats only; the human
 * and AI seats all roll automatically (§3.1). Every number is an engine dice result.
 */
export function FirstPlayerScreen({ store, onToBoard, onQuit }: FirstPlayerScreenProps) {
  const view = useSyncExternalStore(store.subscribe, store.getView);
  useEffect(() => {
    if (!view || view.observation.public.phase.kind !== 'first_player_roll') return;
    // Deferred so Continue can show the saved rolls before the next automatic step.
    const timer = window.setTimeout(() => {
      store.advance({ human: true });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [store, view]);
  const quit = (
    <Button variant="secondary" onClick={onQuit}>
      {t('firstPlayer.quit')}
    </Button>
  );
  if (!view) {
    return (
      <Screen
        before={<SetupProgress step="firstPlayer" />}
        heading={t('firstPlayer.heading')}
        body={t('firstPlayer.noGame')}
        actions={quit}
      />
    );
  }

  const { attempts, firstSeat, humanToRoll } = firstPlayerRoll(view);
  const players = view.observation.public.players;
  const seatName = (seatIndex: number) =>
    seatIndex === view.seatIndex ? t('seat.you') : t('seat.ai');
  const seatClass = (seatIndex: number) =>
    className(players.find((player) => player.seatIndex === seatIndex)?.classId ?? '');

  return (
    <Screen
      before={<SetupProgress step="firstPlayer" />}
      heading={t('firstPlayer.heading')}
      body={t('firstPlayer.body')}
      actions={
        <>
          {quit}
          {firstSeat !== undefined && (
            <Button variant="primary" className="ms-auto" onClick={onToBoard}>
              {t('firstPlayer.toBoard')}
            </Button>
          )}
        </>
      }
    >
      {firstSeat !== undefined && (
        <div
          role="status"
          className="panel mb-8 flex flex-wrap items-center gap-4 !bg-[linear-gradient(180deg,#fffdf2,#fff1bf)] p-5 shadow-[0_0_0_4px_var(--color-reward)]"
        >
          <span
            className="orb size-14"
            style={{ '--orb': 'var(--color-reward)' } as React.CSSProperties}
          >
            <DieIcon className="size-7" />
          </span>
          <span>
            <span className="block font-display text-3xl font-semibold">
              {firstSeat === view.seatIndex ? t('firstPlayer.youStart') : t('firstPlayer.aiStarts')}
            </span>
            <span className="text-ink-soft">{t('firstPlayer.thenSeatOrder')}</span>
          </span>
        </div>
      )}
      {humanToRoll && attempts.length > 1 && (
        <p role="status" className="panel mb-8 p-5 font-bold">
          {t('firstPlayer.yourTie')}
        </p>
      )}
      <ol className="grid gap-6">
        {attempts.map((attempt, index) => (
          <li key={index} className="panel p-5 sm:p-6">
            <h2 className="text-xl">
              {t('firstPlayer.attempt')} {index + 1}
            </h2>
            {index > 0 && <p className="text-ink-soft">{t('firstPlayer.tie')}</p>}
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {attempt.contenders.map((seatIndex, order) => {
                const roll = attempt.rolls.find((entry) => entry.seatIndex === seatIndex);
                return (
                  <li
                    key={seatIndex}
                    data-seat={seatIndex}
                    className="flex items-center gap-4 rounded-2xl bg-panel-tint p-3 shadow-[inset_0_0_0_2px_var(--color-line)]"
                  >
                    {roll ? (
                      <DieFace value={roll.value} order={order} />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="size-14 shrink-0 rounded-xl border-2 border-dashed border-panel-lip"
                      />
                    )}
                    <span className="flex-1">
                      <span className="block font-display text-lg font-semibold">
                        {seatName(seatIndex)}
                      </span>
                      <span className="block text-sm text-ink-soft">{seatClass(seatIndex)}</span>
                    </span>
                    <span className="font-display text-2xl font-semibold tabular-nums">
                      {roll ? (
                        <>
                          <span className="text-base">{t('firstPlayer.rolled')}</span> {roll.value}
                        </>
                      ) : (
                        <span className="text-base text-ink-soft">{t('firstPlayer.waiting')}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </Screen>
  );
}
