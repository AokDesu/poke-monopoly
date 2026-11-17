import { useSyncExternalStore } from 'react';
import { downloadSave, saveText } from './game/save.ts';
import { decisionTally } from './game/decisions.ts';
import type { GameResults, GameStore, OpponentSettings } from './game/store.ts';
import { t } from './i18n/en.ts';
import { className } from './i18n/names.ts';
import { Button } from './ui/Button.tsx';
import { CoinIcon } from './ui/icons.tsx';
import { Screen } from './ui/Screen.tsx';
import { seatLabel } from './board/labels.ts';

function joinNames(names: readonly string[]): string {
  return names.reduce((left, right) => (left ? t('results.nameJoin', { left, right }) : right), '');
}

function reasonText(
  reason: 'coins' | 'badges' | 'co_winners',
  names: readonly string[],
  youWon: boolean,
): string {
  if (reason === 'co_winners') return t('results.coWinners', { names: joinNames(names) });
  if (reason === 'badges') {
    return youWon ? t('results.winBadgesYou') : t('results.winBadges', { name: names[0] ?? '' });
  }
  return youWon ? t('results.winCoinsYou') : t('results.winCoins', { name: names[0] ?? '' });
}

/** Each seat's class, personality and difficulty: its setup, as a watcher chose it. */
function setupLine(
  results: GameResults,
  opponents: readonly OpponentSettings[],
  seatIndex: number,
): string | undefined {
  const seat = results.seats.find((entry) => entry.seatIndex === seatIndex);
  const settings = opponents.find((entry) => entry.seatIndex === seatIndex);
  if (!seat || !settings) return undefined;
  return t('results.seatSetup', {
    class: className(seat.classId),
    setup: t('watch.setup', {
      personality: t(`personality.${settings.personality}`),
      difficulty: t(`difficulty.${settings.difficulty}`),
    }),
  });
}

export function ResultsScreen({
  store,
  onPlayAgain,
  onWatchAgain,
}: {
  store: GameStore;
  onPlayAgain: () => void;
  /** A watched game's results offer this instead of Play again and Export log. */
  onWatchAgain?: () => void;
}) {
  const results = useSyncExternalStore(store.subscribe, store.getResults);
  const spectator = useSyncExternalStore(store.subscribe, store.getSpectatorView);
  const playAgain = (
    <Button variant="primary" onClick={onPlayAgain}>
      {t('results.playAgain')}
    </Button>
  );
  if (!results) {
    return <Screen heading={t('results.heading')} body={t('results.none')} actions={playAgain} />;
  }
  // No human seat: nobody is "you", and the exported log (hidden hands and seed) never goes to a watcher.
  const watching = spectator !== null && results.humanSeat === undefined;
  const tally = watching ? decisionTally(spectator.feed, results.standings) : undefined;
  const earlier = [...(tally?.values() ?? [])].reduce((sum, seat) => sum + seat.unrecorded, 0);
  const names = results.winners.map((actorId) => {
    const row = results.standings.find((entry) => entry.actorId === actorId);
    return row ? seatLabel(row.seatIndex, results.humanSeat) : t('board.event.player');
  });
  const youWon =
    results.humanSeat !== undefined &&
    results.winners.every((actorId) => {
      const row = results.standings.find((entry) => entry.actorId === actorId);
      return row?.seatIndex === results.humanSeat;
    });
  return (
    <Screen
      heading={t('results.heading')}
      body={t('results.body')}
      actions={
        watching ? (
          <>
            <Button variant="primary" onClick={onWatchAgain ?? onPlayAgain}>
              {t('results.watchAgain')}
            </Button>
            <Button variant="secondary" onClick={onPlayAgain}>
              {t('results.home')}
            </Button>
            <p className="basis-full text-sm text-ink-soft">{t('results.watchAgainHint')}</p>
          </>
        ) : (
          <>
            {playAgain}
            <Button
              variant="secondary"
              onClick={() => {
                const session = store.getSession();
                if (session) downloadSave(saveText(session));
              }}
            >
              {t('results.export')}
            </Button>
          </>
        )
      }
    >
      <div className="panel flex max-w-3xl flex-wrap items-center gap-4 !bg-[linear-gradient(180deg,#fffdf2,#fff1bf)] p-5 shadow-[0_0_0_4px_var(--color-reward)]">
        <span
          className="orb size-14"
          style={{ '--orb': 'var(--color-reward)' } as React.CSSProperties}
        >
          <CoinIcon className="size-7" />
        </span>
        <p role="status" className="font-display text-2xl font-semibold text-balance">
          {reasonText(results.reason, names, youWon && results.winners.length === 1)}
        </p>
      </div>
      <div className="panel mt-8 max-w-3xl overflow-x-auto p-5 sm:p-6">
        <table className="w-full border-collapse text-start">
          <caption className="sr-only">{t('results.standings')}</caption>
          <thead>
            <tr className="border-b border-line text-sm text-ink-soft">
              <th scope="col" className="py-2 pe-4 text-start font-bold">
                {t('review.seats')}
              </th>
              <th scope="col" className="px-4 py-2 text-end font-bold">
                {t('board.coins')}
              </th>
              <th scope="col" className="py-2 ps-4 text-end font-bold">
                {t('results.badges')}
              </th>
            </tr>
          </thead>
          <tbody>
            {results.standings.map((row) => {
              const winner = results.winners.includes(row.actorId);
              return (
                <tr key={row.actorId} className="border-b border-line last:border-b-0">
                  <th
                    scope="row"
                    className="py-3 pe-4 text-start font-display text-lg font-semibold"
                  >
                    {seatLabel(row.seatIndex, results.humanSeat)}
                    {winner && (
                      <span className="ms-2 rounded-full bg-[var(--color-reward)] px-2 py-0.5 text-sm">
                        {t('results.winnerMark')}
                      </span>
                    )}
                    {watching && (
                      <span className="mt-1 block font-sans text-sm font-normal text-ink-soft">
                        {setupLine(results, spectator.opponents, row.seatIndex)}
                      </span>
                    )}
                  </th>
                  <td className="px-4 py-3 text-end text-2xl font-semibold tabular-nums">
                    {row.coins}
                  </td>
                  <td className="py-3 ps-4 text-end text-2xl font-semibold tabular-nums">
                    {row.badges}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {tally && (
        <div className="panel mt-8 max-w-3xl overflow-x-auto p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold">{t('results.decisionsHeading')}</h2>
          <p className="mt-2 text-ink-soft">{t('results.decisionsBody')}</p>
          <table className="mt-4 w-full border-collapse text-start">
            <caption className="sr-only">{t('results.decisionsCaption')}</caption>
            <thead>
              <tr className="border-b border-line text-sm text-ink-soft">
                <th scope="col" className="py-2 pe-4 text-start font-bold">
                  {t('review.seats')}
                </th>
                <th scope="col" className="px-4 py-2 text-end font-bold">
                  {t('results.jev')}
                </th>
                <th scope="col" className="py-2 ps-4 text-end font-bold">
                  {t('results.backup')}
                </th>
              </tr>
            </thead>
            <tbody>
              {results.standings.map((row) => {
                const seat = tally.get(row.seatIndex);
                return (
                  <tr key={row.actorId} className="border-b border-line last:border-b-0">
                    <th
                      scope="row"
                      className="py-3 pe-4 text-start font-display text-lg font-semibold"
                    >
                      {seatLabel(row.seatIndex, undefined)}
                    </th>
                    <td className="px-4 py-3 text-end text-2xl font-semibold tabular-nums">
                      {seat?.jev ?? 0}
                    </td>
                    <td className="py-3 ps-4 text-end text-2xl font-semibold tabular-nums">
                      {seat?.backup ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {earlier > 0 && (
            <p className="mt-3 text-sm text-ink-soft">
              {t('results.decisionsEarlier', { count: earlier })}
            </p>
          )}
        </div>
      )}
    </Screen>
  );
}
