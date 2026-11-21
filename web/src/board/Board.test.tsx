import { render, screen, within } from '@testing-library/react';
import { expect, expectTypeOf, test } from 'vitest';
import {
  fixtureSchema,
  observe,
  type GameState,
  type Observation,
  type SpectatorObservation,
} from '../../../engine/index.ts';
import { content } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import { Board, type BoardProps } from './Board.tsx';

const fixtures = Object.values(
  import.meta.glob('../../../engine/fixtures/*.json', { eager: true, import: 'default' }),
).map((input) => fixtureSchema.parse(input));

// The component's public seam takes a seat's observation or the watcher's public view, and cannot
// accept a replay/audit snapshot.
expectTypeOf<BoardProps['observation']>().toEqualTypeOf<Observation | SpectatorObservation>();
expectTypeOf<GameState>().not.toExtend<BoardProps['observation']>();

test.each(fixtures)('$name shows the engine projection, not recomputed game values', (fixture) => {
  const observation = observe(fixture.state, 0);
  render(<Board observation={observation} />);
  const squares = screen.getByRole('list', { name: t('board.loop') });
  expect(within(squares).getAllByRole('listitem')).toHaveLength(24);
  for (const space of observation.public.board) {
    expect(
      screen.getByLabelText(
        t('board.squareLabel', { position: space.position, kind: t(`board.kind.${space.kind}`) }),
      ),
    ).toBeTruthy();
  }
  for (const player of observation.public.players) {
    const token = screen.getByTestId(`token-${player.seatIndex}`);
    expect(token.closest('[data-position]')?.getAttribute('data-position')).toBe(
      String(player.position),
    );
    expect(token.textContent).toBe(String(player.seatIndex));
    const panel = screen.getByTestId(`player-${player.seatIndex}`);
    expect(within(panel).getByLabelText(t('board.coins')).textContent).toBe(String(player.coins));
    // The engine's square number, named with its kind as the board shows it.
    const square = observation.public.board.find((space) => space.position === player.position)!;
    expect(within(panel).getByLabelText(t('board.position')).textContent).toBe(
      t('beat.square', { kind: t(`board.kind.${square.kind}`), position: player.position }),
    );
    expect(within(panel).getByLabelText(t('board.lap')).textContent).toBe(
      `${player.creditedLap} / ${observation.public.lapTarget}`,
    );
    for (const pokemon of player.team) {
      const species = content.species.find((entry) => entry.id === pokemon.speciesId)!;
      const card = within(panel).getByTestId(pokemon.instanceId);
      expect(card.textContent).toContain(species.name);
      expect(within(card).getByLabelText(t('board.battle')).textContent).toBe(
        String(species.battle),
      );
      for (const tag of species.tags) expect(card.textContent).toMatch(new RegExp(tag, 'i'));
    }
    if (player.seatIndex === observation.own.seatIndex) {
      for (const ball of ['poke', 'great', 'ultra'] as const) {
        expect(within(panel).getByLabelText(t(`board.ball.${ball}`)).textContent).toBe(
          String(observation.own.balls[ball]),
        );
      }
      for (const item of observation.own.items) expect(panel.textContent).toContain(item.name);
    } else {
      expect(within(panel).getByLabelText(t('board.itemCount')).textContent).toBe(
        String(player.itemCount),
      );
      expect(within(panel).queryByLabelText(t('board.balls'))).toBeNull();
      expect(within(panel).queryByLabelText(t('board.items'))).toBeNull();
    }
  }
  expect(screen.getByLabelText(t('board.globalTurn')).textContent).toBe(
    String(observation.public.globalTurnNo),
  );
  expect(screen.getByTestId('active-seat').getAttribute('data-seat')).toBe(
    String(observation.public.activeSeatIndex),
  );
  // A read-only board offers no game action. The only buttons are each seat's local details
  // toggle and the Game record, which only opens what has already happened.
  for (const button of screen.queryAllByRole('button')) {
    expect(
      button.classList.contains('player-toggle') || button.textContent === t('record.open'),
    ).toBe(true);
  }
});

test('shared tokens and wrapped/negative movement use observe positions', () => {
  const state = structuredClone(fixtures[0]!.state);
  state.players[0]!.routeProgress = -1;
  state.players[1]!.routeProgress = 47;
  render(<Board observation={observe(state, 0)} />);
  for (const seat of [0, 1]) {
    expect(
      screen.getByTestId(`token-${seat}`).closest('[data-position]')?.getAttribute('data-position'),
    ).toBe('23');
  }
});

test('seat 0 DOM never exposes opponent secret items or an opponent Ball pouch', () => {
  const state = structuredClone(fixtures[0]!.state);
  state.players[1]!.items.push({
    instanceId: 'SENTINEL-SECRET-UID',
    itemId: 'SENTINEL-SECRET-ID',
    name: 'SENTINEL-SECRET-NAME',
    visibility: 'secret',
  });
  state.players[1]!.balls = { poke: 937, great: 941, ultra: 947 };
  const { container } = render(<Board observation={observe(state, 0)} />);
  expect(container.innerHTML).not.toMatch(/SENTINEL|937|941|947/);
  const rival = screen.getByTestId('player-1');
  expect(within(rival).getByLabelText(t('board.itemCount')).textContent).toBe('2');
  for (const ball of ['poke', 'great', 'ultra'] as const)
    expect(within(rival).queryByLabelText(t(`board.ball.${ball}`))).toBeNull();
});
