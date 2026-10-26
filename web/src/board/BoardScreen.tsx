import { useSyncExternalStore } from 'react';
import type { GameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { Screen } from '../ui/Screen.tsx';
import { Board } from './Board.tsx';

export function BoardScreen({ store }: { store: GameStore }) {
  const view = useSyncExternalStore(store.subscribe, store.getView);
  return view ? (
    <Board
      observation={view.observation}
      events={view.feed.flatMap((entry) => entry.record.events)}
    />
  ) : (
    <Screen heading={t('play.heading')} body={t('board.noGame')} />
  );
}
