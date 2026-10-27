import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { fixtureSchema, observe, type EngineEvent } from '../../../engine/index.ts';
import fixture from '../../../engine/fixtures/start-of-game-2p.json';
import { t } from '../i18n/en.ts';
import type { SeatFeedEntry } from '../game/store.ts';
import { EventLog } from './EventLog.tsx';

const observation = observe(fixtureSchema.parse(fixture).state, 0);

test('event messages preserve transfer direction and placeholder/final-round meaning without raw payloads', () => {
  const events: EngineEvent[] = [
    {
      kind: 'coin_transfer',
      source: { kind: 'bank' },
      destination: { kind: 'player', actorId: 'player-0' },
      amount: 5,
      reason: 'start_income',
    },
    {
      kind: 'coin_transfer',
      source: { kind: 'player', actorId: 'player-0' },
      destination: { kind: 'bank' },
      amount: 3,
      reason: 'shop_purchase',
    },
    { kind: 'space_resolved', seatIndex: 1, position: 6, effect: 'none_yet' },
    { kind: 'final_table_round', triggerSeatIndex: 0, targetOwnTurnNo: 8 },
    { kind: 'random_result', purpose: 'event_shuffle', result: ['SENTINEL-DECK-ORDER'] },
    { kind: 'uid_created', entity: 'pokemon', instanceId: 'INTERNAL-UID', ownerId: 'player-0' },
    { kind: 'phase_changed', from: 'move', to: 'resolve' },
  ];
  const { container } = render(<EventLog observation={observation} events={events} />);
  expect(container.textContent).toContain('The bank paid 5 coins to You. Start income.');
  expect(container.textContent).toContain('You paid 3 coins to The bank. Shop purchase.');
  expect(container.textContent).toContain(
    'AI rival · seat 1 landed on square 6: Gym. Nothing happens here yet.',
  );
  expect(container.textContent).toContain('You triggered the final table round.');
  expect(container.innerHTML).not.toMatch(/SENTINEL|INTERNAL-UID|event_shuffle|player-0/);
  expect(
    screen.getAllByRole('listitem').map((row) => row.getAttribute('data-message-key')),
  ).toEqual([
    'board.event.coins',
    'board.event.coins',
    'board.event.noneYet',
    'board.event.finalRound',
    'board.event.randomDraw',
    'board.event.pokemonCreated',
    'board.event.phase',
  ]);
});

test('an empty event feed still explains the state', () => {
  render(<EventLog observation={observation} events={[]} />);
  expect(screen.getByText(t('board.logEmpty'))).toBeTruthy();
});

// Spec §5.7: dialogue annotations are persisted separately; showing lines is deferred.
test.each(['events', 'feed'] as const)(
  '%s keeps dialogue annotations out of the event log while preserving game events',
  (source) => {
    const annotations: EngineEvent[] = [
      {
        kind: 'line_selected',
        situation: 'game_start',
        personalityId: 'greedy',
        trustBucket: 'neutral',
        lineId: 'INTERNAL-LINE-ID',
      },
      { kind: 'random_result', purpose: 'line:game_start', result: 2, drawCounter: 1 },
    ];
    const props = (events: EngineEvent[]) => ({
      observation,
      events,
      ...(source === 'feed' && {
        feed: [
          {
            before: observation.public,
            record: {
              action: {
                kind: 'skip',
                actorId: 'player-0',
                actionSeq: 1,
                stateRevisionBefore: 0,
                payload: {},
              },
              events,
            },
          },
        ] satisfies SeatFeedEntry[],
      }),
    });
    const { container, rerender } = render(
      <EventLog
        {...props([...annotations, { kind: 'random_result', purpose: 'movement', result: 6 }])}
      />,
    );
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'The die rolled 6.',
    ]);
    expect(container.textContent).not.toContain('INTERNAL-LINE-ID');
    rerender(<EventLog {...props(annotations)} />);
    expect(screen.getByText(t('board.logEmpty'))).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
  },
);
