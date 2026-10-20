/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { fixtureSchema, observe } from '../../engine/index.ts';
import {
  assertNoComparableNumbers,
  assertStateTokenBudget,
  buildJevState,
} from '../../ai/state/index.ts';

const fixtures = import.meta.glob<unknown>('../../engine/fixtures/*.json', {
  eager: true,
  import: 'default',
});

function assertNoLeaks(state: unknown, forbidden: string[]): void {
  const text = JSON.stringify(state);
  for (const sentinel of forbidden) expect(text).not.toContain(sentinel);
  expect(text).not.toMatch(/"(?:rng|seed|cursor|drawPile|discardPile|eventDeck|event_order)"\s*:/);
}

for (const [path, input] of Object.entries(fixtures)) {
  test(`${path}: each seat's built state contains only its own secrets (spec §1, §5.4, §8, §9)`, () => {
    const fixture = fixtureSchema.parse(input);
    for (const seat of [0, 1]) {
      const observation = observe(fixture.state, seat);
      expect(observation).toEqual(fixture.observation[String(seat)]);
      const state = buildJevState(observation);
      const opponents = fixture.state.players.filter((player) => player.seatIndex !== seat);
      const forbidden = opponents.flatMap((player) => [
        ...player.items.filter((item) => item.visibility === 'secret').map((item) => item.name),
        ...player.privateResults.map((result) => result.eventId),
      ]);
      forbidden.push(fixture.state.rng.state);
      forbidden.push(...fixture.state.eventDeck.drawPile.filter((id) => id.includes('SENTINEL')));
      assertNoLeaks(state, forbidden);
      assertNoComparableNumbers(state);
      assertStateTokenBudget(state);
      expect(state.you.id).toBe(
        fixture.state.players.find((player) => player.seatIndex === seat)!.actorId,
      );
      expect(state.you.items.map((item) => item.name)).toEqual(
        observation.own.items.map((item) => item.name),
      );
      expect(state.you.private_results.map((result) => result.event_id)).toEqual(
        observation.own.privateResults.map((result) => result.eventId),
      );

      // Equip both seats with distinguishable secrets even in fixtures without them.
      const poisoned = structuredClone(fixture.state);
      const sentinels = ['SECRET_SEAT_0', 'SECRET_SEAT_1'];
      for (const player of poisoned.players) {
        player.items = [
          {
            instanceId: `hidden-${player.seatIndex}`,
            itemId: 'potion',
            name: sentinels[player.seatIndex]!,
            visibility: 'secret',
          },
        ];
        player.privateResults = [
          { kind: 'peek', eventId: `PRIVATE_PEEK_SEAT_${player.seatIndex}` },
        ];
      }
      poisoned.config.seed = 'SEED_SENTINEL';
      poisoned.rng = { state: 'PRIVATE_RNG_SENTINEL', cursor: 987654321 };
      poisoned.eventDeck = {
        drawPile: ['PRIVATE_EVENT_ORDER_SENTINEL', 'ANOTHER_PRIVATE_EVENT_SENTINEL'],
        discardPile: ['PRIVATE_DISCARD_SENTINEL'],
      };
      const built = buildJevState(observe(poisoned, seat));
      const hidden = [
        sentinels[1 - seat]!,
        `PRIVATE_PEEK_SEAT_${1 - seat}`,
        'SEED_SENTINEL',
        'PRIVATE_RNG_SENTINEL',
        '987654321',
        'PRIVATE_EVENT_ORDER_SENTINEL',
        'ANOTHER_PRIVATE_EVENT_SENTINEL',
        'PRIVATE_DISCARD_SENTINEL',
      ];
      assertNoLeaks(built, hidden);
      expect(JSON.stringify(built)).toContain(sentinels[seat]!);
      // Prove the harness fails if a forbidden sentinel is accidentally serialized.
      expect(() => assertNoLeaks({ ...built, leaked: hidden[0] }, hidden)).toThrow();

      const changed = structuredClone(poisoned);
      changed.players.find((player) => player.seatIndex !== seat)!.items[0]!.name =
        'DIFFERENT_HIDDEN_ITEM';
      changed.players.find((player) => player.seatIndex !== seat)!.privateResults[0]!.eventId =
        'DIFFERENT_HIDDEN_PEEK';
      changed.config.seed = 'DIFFERENT_SEED';
      changed.rng = { state: 'DIFFERENT_RNG', cursor: 123456789 };
      changed.eventDeck.drawPile.reverse();
      changed.eventDeck.discardPile.push('DIFFERENT_DISCARD');
      expect(buildJevState(observe(changed, seat))).toEqual(built);
    }
  });
}
