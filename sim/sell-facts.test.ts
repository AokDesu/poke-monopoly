import { expect, test } from 'vitest';
import { saleFacts } from '../engine/index.ts';
import { realEngine } from './engine.ts';

test('sim Sell facts forward the engine keep values alongside sale coins (§5.6)', () => {
  const state = realEngine.createGame({
    seed: 160,
    lapTarget: 3,
    seats: realEngine.classIds.slice(0, 2).map((classId, seatIndex) => ({
      classId,
      seatIndex,
      actorId: `P${seatIndex}`,
    })),
  });
  state.phase = { kind: 'sell', destinationPosition: 0 };
  const rows = saleFacts(state, state.activeSeatIndex);
  expect(realEngine.facts!(state, state.activeSeatIndex)).toMatchObject({
    keepValue: Object.fromEntries(rows.map((row) => [row.instanceId, row.keepValue])),
  });
});
