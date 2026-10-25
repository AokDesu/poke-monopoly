import { expect, test } from 'vitest';
import fixture from '../engine/fixtures/start-of-game-2p.json';
import { projectBoardFixture } from './src/game/store.ts';

// This is also the build-time boundary: raw fixtures must never enter a browser chunk.
test('fixture projection drops full snapshots, actions, opponent secrets and shuffle payloads', () => {
  const input = structuredClone(fixture);
  input.state.players[1]!.items.push({
    instanceId: 'SENTINEL-SECRET-UID',
    itemId: 'SENTINEL-SECRET-ID',
    name: 'SENTINEL-SECRET-NAME',
    visibility: 'secret',
  });
  input.state.players[1]!.balls = { poke: 937, great: 941, ultra: 947 };
  const projected = projectBoardFixture({
    ...input,
    log: [
      {
        action: {
          actorId: 'player-1',
          kind: 'buy',
          payload: { offerId: 'SENTINEL-OFFER' },
          actionSeq: 1,
          stateRevisionBefore: 0,
        },
        events: [
          {
            kind: 'uid_created',
            entity: 'item',
            ownerId: 'player-1',
            instanceId: 'SENTINEL-SECRET-UID',
          },
        ],
      },
      {
        action: {
          actorId: 'engine',
          kind: 'shuffle',
          payload: { deckId: 'events', order: ['SENTINEL-DECK'] },
          actionSeq: 2,
          stateRevisionBefore: 1,
        },
        events: [{ kind: 'random_result', purpose: 'shuffle:events', result: ['SENTINEL-DECK'] }],
      },
    ],
  });
  expect(Object.keys(projected).sort()).toEqual(['events', 'observation']);
  expect(projected.observation.public.players[1]!.itemCount).toBe(2);
  expect(projected.events).toEqual([]);
  expect(JSON.stringify(projected)).not.toMatch(/SENTINEL|937|941|947|rng|initialConfig/);
});
