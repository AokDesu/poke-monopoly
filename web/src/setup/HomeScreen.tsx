import type { ComponentProps } from 'react';
import { t } from '../i18n/th.ts';
import { BoardRing } from '../ui/BoardRing.tsx';
import { ArrowIcon, DieIcon } from '../ui/icons.tsx';
import { Screen } from '../ui/Screen.tsx';
import { TicketButton } from '../ui/Ticket.tsx';

interface HomeScreenProps {
  board: ComponentProps<typeof BoardRing>['board'];
  /** False when content has too few playable classes for every seat to have its own. */
  canStart: boolean;
  onNewGame: () => void;
  onRandomAll: () => void;
}

export function HomeScreen({ board, canStart, onNewGame, onRandomAll }: HomeScreenProps) {
  const reason = canStart ? undefined : t('home.notEnoughClasses');
  return (
    <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-16">
      <Screen heading={t('home.heading')} body={t('home.body')}>
        <ul className="grid max-w-xl gap-4">
          <li>
            <TicketButton
              title={t('home.newGame')}
              description={t('home.newGameHint')}
              stub={<ArrowIcon />}
              disabledReason={reason}
              onClick={onNewGame}
            />
          </li>
          <li>
            <TicketButton
              title={t('home.randomAll')}
              description={t('home.randomAllHint')}
              stub={<DieIcon />}
              disabledReason={reason}
              onClick={onRandomAll}
            />
          </li>
        </ul>
      </Screen>
      <BoardRing board={board} />
    </div>
  );
}
