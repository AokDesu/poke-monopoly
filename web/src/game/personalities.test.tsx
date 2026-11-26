import { act, cleanup, renderHook } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { PERSONALITY_IDS } from '../../../content/lines-schema.ts';
import { createGameConfig } from '../../../engine/index.ts';
import { useTableTalk } from '../board/useTableTalk.ts';
import { engineContent } from './content.ts';
import { PERSONALITIES, type PersonalityId } from './setup.ts';
import { createGameStore, type GameStore } from './store.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Seat 0 is the human; each rival has its own personality (spec §3, §5.5).
const RIVALS: readonly { classId: string; starterSpeciesId: string; personality: PersonalityId }[] =
  [
    { classId: 'researcher', starterSpeciesId: 'porygon', personality: 'aggressive' },
    { classId: 'fisherman', starterSpeciesId: 'magikarp', personality: 'cautious' },
    { classId: 'nurse-joy', starterSpeciesId: 'chansey', personality: 'opportunist' },
  ];

function game(): GameStore {
  const store = createGameStore();
  store.start(
    createGameConfig({
      seats: [{ classId: 'main-character', starterSpeciesId: 'bulbasaur' }, ...RIVALS].map(
        (seat, seatIndex) => ({
          actorId: seatIndex === 0 ? 'human' : `ai-${seatIndex}`,
          seatIndex,
          classId: seat.classId,
          starterSpeciesId: seat.starterSpeciesId,
          controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
        }),
      ),
      seed: 1,
      lapTarget: 2,
    }),
    engineContent,
    RIVALS.map(({ personality }, index) => ({
      seatIndex: index + 1,
      personality,
      difficulty: 'normal' as const,
    })),
  );
  return store;
}

interface Sent {
  readonly seatIndex: number;
  readonly personalityId: string;
}

/** The local server, faked: every seat takes its first enabled action; speech comes from the line bank. */
function fakeServer() {
  const decide: Sent[] = [];
  const speak: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const json = (value: unknown) => new Response(JSON.stringify(value));
      if (path === '/api/ai/status')
        return json({
          backupOnly: false,
          jevEnabled: true,
          reason: null,
          speech: { enabled: true, reason: null },
        });
      if (path === '/api/ai/outcome') return new Response(null, { status: 204 });
      const body = JSON.parse(String(init?.body));
      if (path === '/api/ai/speak') {
        speak.push(body);
        return json({
          source: 'bank',
          text: '{target} is in front. I will watch that closely.',
          lineId: 'taunt-leader-cautious-neutral-1',
          requestId: 'r',
          latencyMs: 1,
        });
      }
      decide.push(body);
      return json({
        choice: body.enabledActions[0].id,
        source: path.endsWith('fallback') ? 'fallback' : 'jev',
      });
    }),
  );
  return { decide, speak };
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

test('each rival sends its own personality on every decision and every table-talk request (§5.5)', async () => {
  const { decide, speak } = fakeServer();
  const store = game();
  renderHook(() => {
    const view = useSyncExternalStore(store.subscribe, () => store.getView());
    return useTableTalk(store, view, {
      pace: 'readable',
      skipping: false,
      paused: false,
      status: null,
    });
  });
  for (let steps = 0; steps < 20_000; steps++) {
    if (store.getSession()!.state.phase.kind === 'finished') break;
    await act(async () => {
      if (store.advance({ human: true })) return;
      const view = store.getView();
      if (view && view.legalActions.enabled.length > 0)
        store.choose(view.legalActions.enabled[0]!.id);
      else if (!(await store.playOpponent(new AbortController().signal))) throw new Error('stuck');
    });
    await settle();
  }
  const expected = new Map(RIVALS.map(({ personality }, index) => [index + 1, personality]));
  for (const sent of [...decide, ...speak]) {
    expect(sent.personalityId, `seat ${sent.seatIndex}`).toBe(expected.get(sent.seatIndex));
  }
  // Every rival was heard on a decision, so the check above covered each personality.
  expect(new Set(decide.map((sent) => sent.personalityId))).toEqual(
    new Set(RIVALS.map(({ personality }) => personality)),
  );
  expect(speak.length).toBeGreaterThan(0);
}, 120_000);

test('setup offers exactly the personalities the content and the server know', () => {
  expect(PERSONALITIES.map((entry) => entry.id).sort()).toEqual([...PERSONALITY_IDS].sort());
  expect(PERSONALITIES.every((entry) => entry.enabled)).toBe(true);
});
