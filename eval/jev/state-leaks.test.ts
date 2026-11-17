/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { checkChatLeaks, loadChatSet } from './chat.ts';
import {
  applyAction,
  createGame,
  createGameConfig,
  fixtureSchema,
  observe,
} from '../../engine/index.ts';
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

const chatItems = await loadChatSet();

for (const [path, input] of Object.entries(fixtures)) {
  test(`${path}: no chat item or chat request carries another seat's secrets (spec §5.4, §8)`, () => {
    const { state } = fixtureSchema.parse(input);
    for (const { seatIndex } of state.players)
      expect(checkChatLeaks(chatItems, state, seatIndex)).toBe(chatItems.length);
  });
}

/** Seats 0 and 1 trade a promise and a chat; seat 2 is outside both (spec §4.8, §5.4, #143). */
function threeSeatSocial() {
  const scenario = fixtureSchema.parse(
    fixtures['../../engine/fixtures/start-of-game-2p.json'],
  ).state;
  const content = structuredClone(scenario.content);
  content.classes.push({
    id: 'team-rocket',
    name: 'Team Rocket',
    starterSpeciesIds: ['eevee'],
    classItemId: 'pickpocket',
  });
  const state = createGame(
    createGameConfig({
      seats: [
        ...scenario.config.seats,
        { actorId: 'player-2', seatIndex: 2, classId: 'team-rocket', controller: 'ai' as const },
      ],
      seed: 4,
      lapTarget: 3,
      socialWindow: true,
    }),
    content,
  );
  state.phase = { kind: 'social' };
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.turnBudgets = {
    tacticalAction: 1,
    catchAttempt: 1,
    pokemonAbility: 1,
    socialInteraction: 1,
  };
  return state;
}

function act(
  state: ReturnType<typeof threeSeatSocial>,
  seat: number,
  kind: string,
  payload: object,
) {
  const revision = observe(state, seat).public.stateRevision;
  const result = applyAction(state, {
    actorId: state.players[seat]!.actorId,
    actionSeq: revision + 1,
    stateRevisionBefore: revision,
    kind,
    payload,
  } as never);
  if ('rejected' in result) throw new Error(result.reason);
  return result.state;
}

test("social state: a seat sees its own promise and pending card, never a third party's (spec §4.8, §5.4)", () => {
  const offered = act(threeSeatSocial(), 0, 'offer_promise', {
    targetSeatIndex: 1,
    direction: 'offer',
  });
  const responder = buildJevState(observe(offered, 1));
  expect(responder.social?.pending_card).toMatchObject({ from_id: 'player-0' });
  const bystander = buildJevState(observe(offered, 2));
  expect(bystander.social).toEqual({ promises: [], broken_promises: [], trust: [] });
  expect(JSON.stringify(bystander)).not.toMatch(/pending_card|no_attack/);

  const accepted = act(offered, 1, 'respond', { answer: 'accept' });
  for (const seat of [0, 1]) {
    expect(buildJevState(observe(accepted, seat)).social?.promises).toEqual([
      {
        kind: 'no_attack',
        promiser_id: 'player-0',
        recipient_id: 'player-1',
        yours_to_keep: seat === 0,
      },
    ]);
  }
  const outside = buildJevState(observe(accepted, 2));
  expect(outside.social?.promises).toEqual([]);
  assertNoComparableNumbers(outside);
  assertStateTokenBudget(outside);
});

test('social state: trust is a named bucket per opponent, supplied once S07 provides it', () => {
  const state = threeSeatSocial();
  const built = buildJevState(observe(state, 0), { trust: { 'player-1': 'wary' } });
  expect(built.social?.trust).toEqual([{ id: 'player-1', bucket: 'wary' }]);
});
