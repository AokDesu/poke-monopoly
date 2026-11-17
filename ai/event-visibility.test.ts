/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import { advanceAutomatically, createGame, createGameConfig, observe } from '../engine/index.ts';
import { buildJevState } from './state/index.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

test('Event draws never send a deck order or another seat’s reward in any Jev state (§4.1, §5.4)', () => {
  const initial = createGame(
    createGameConfig({
      seats: ['rival', 'researcher', 'bug-catcher', 'nurse-joy'].map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        controller: 'ai' as const,
      })),
      seed: 162,
      lapTarget: 2,
    }),
    content,
  );
  initial.phase = { kind: 'resolve' };
  initial.players[0]!.routeProgress = 2;
  initial.eventDeck = { drawPile: ['e4', 'e1', 'e6', 'e3', 'e2', 'e5'], discardPile: [] };
  const after = advanceAutomatically(initial).state;
  const twin = structuredClone(after);
  twin.eventDeck = {
    drawPile: ['HIDDEN-order-a', 'HIDDEN-order-b'],
    discardPile: ['HIDDEN-discard'],
  };
  const reward = after.players[0]!.items.at(-1)!;
  for (const seat of [0, 1, 2, 3]) {
    const requestState = buildJevState(observe(after, seat));
    expect(buildJevState(observe(twin, seat))).toEqual(requestState);
    const text = JSON.stringify(requestState);
    expect(text).not.toMatch(/"(drawPile|discardPile|eventDeck|order|rng|seed)":/);
    expect(text).not.toContain('HIDDEN-');
    if (seat !== 0) expect(text).not.toContain(reward.instanceId);
    else expect(text).toContain(reward.instanceId);
  }
});
