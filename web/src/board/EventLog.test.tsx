import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import {
  createGame,
  createGameConfig,
  fixtureSchema,
  observe,
  observeSpectator,
  type EngineEvent,
} from '../../../engine/index.ts';
import { engineContent } from '../game/content.ts';
import fixture from '../../../engine/fixtures/start-of-game-2p.json';
import { t } from '../i18n/en.ts';
import type { SeatFeedEntry } from '../game/store.ts';
import { EventLog } from './EventLog.tsx';

const observation = observe(fixtureSchema.parse(fixture).state, 0);

test('event messages preserve transfer direction and landing/final-round meaning without raw payloads', () => {
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
    { kind: 'space_resolved', seatIndex: 1, position: 6 },
    { kind: 'final_table_round', triggerSeatIndex: 0, targetOwnTurnNo: 8 },
    { kind: 'random_result', purpose: 'event_shuffle', result: ['SENTINEL-DECK-ORDER'] },
    { kind: 'uid_created', entity: 'pokemon', instanceId: 'INTERNAL-UID', ownerId: 'player-0' },
    { kind: 'phase_changed', from: 'move', to: 'resolve' },
  ];
  const { container } = render(<EventLog observation={observation} events={events} />);
  expect(container.textContent).toContain('The bank paid 5 coins to You. Start income.');
  expect(container.textContent).toContain('You paid 3 coins to The bank. Shop purchase.');
  expect(container.textContent).toContain('AI rival · seat 1 landed on square 6: Gym.');
  expect(container.textContent).toContain('You triggered the final table round.');
  expect(container.innerHTML).not.toMatch(/SENTINEL|INTERNAL-UID|event_shuffle|player-0/);
  expect(
    screen.getAllByRole('listitem').map((row) => row.getAttribute('data-message-key')),
  ).toEqual([
    'board.event.coins',
    'board.event.coins',
    'board.event.space',
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
  '%s keeps dialogue records out of announcements, says an evolution in words and never shows an internal ID',
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
      {
        kind: 'pokemon_evolved',
        ownerId: 'player-0',
        instanceId: 'INTERNAL-UID',
        fromFormId: 'caterpie',
        toFormId: 'metapod',
        evolutionStage: 1,
      },
      {
        kind: 'battle_reward_resolved',
        rewardId: 'INTERNAL-REWARD',
        winnerId: 'player-0',
        source: { kind: 'gym' },
        choice: { kind: 'evolve', instanceId: 'INTERNAL-UID', nextFormId: 'metapod' },
        coinAmount: 0,
      },
    ];
    const props = (events: EngineEvent[]) => ({
      observation,
      events,
      ...(source === 'feed' && {
        feed: [
          {
            before: { ...observation.public, leader: null, pokemon: [] },
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
      'Your Caterpie evolved into Metapod.',
      'The die rolled 6.',
    ]);
    expect(container.textContent).not.toContain('INTERNAL-');
    rerender(<EventLog {...props(annotations.slice(0, 2))} />);
    expect(screen.getByText(t('board.logEmpty'))).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
  },
);

// Spec §4.8: a Deal Card's payment is its two parties' alone, so only they see it in the shared log.
test('a deal payment shows to the two parties and to no bystander or watcher', () => {
  const state = createGame(
    createGameConfig({
      seats: [
        { classId: 'main-character', starterSpeciesId: 'bulbasaur' },
        { classId: 'researcher', starterSpeciesId: 'porygon' },
        { classId: 'fisherman', starterSpeciesId: 'magikarp' },
      ].map((seat, seatIndex) => ({
        actorId: seatIndex === 0 ? 'human' : `ai-${seatIndex}`,
        seatIndex,
        ...seat,
        controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
      })),
      seed: 1,
      lapTarget: 2,
    }),
    engineContent,
  );
  const payment = (reason: string): EngineEvent => ({
    kind: 'coin_transfer',
    source: { kind: 'player', actorId: 'ai-1' },
    destination: { kind: 'player', actorId: 'human' },
    amount: 6,
    reason,
  });
  const rows = (viewer: ReturnType<typeof observe> | ReturnType<typeof observeSpectator>) => {
    const { unmount } = render(<EventLog observation={viewer} events={[payment('deal')]} />);
    const text = screen.queryAllByRole('listitem').map((row) => row.textContent);
    unmount();
    return text;
  };
  // The paying party and the paid party both read it.
  expect(rows(observe(state, 0))).toEqual(['AI rival · seat 1 paid 6 coins to You. ']);
  expect(rows(observe(state, 1))).toEqual(['You paid 6 coins to AI rival · seat 0. ']);
  // A third seat and a watcher read nothing, even if the record reached their feed.
  expect(rows(observe(state, 2))).toEqual([]);
  expect(rows(observeSpectator(state))).toEqual([]);
  // The same payment under another reason is ordinary public news for the third seat.
  const other = render(
    <EventLog observation={observe(state, 2)} events={[payment('pvp_reward')]} />,
  );
  expect(other.container.textContent).toContain('paid 6 coins');
});
