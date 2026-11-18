import { vi } from 'vitest';
import type { ChatMessage } from '../../../engine/index.ts';
import { engineContent } from '../game/content.ts';
import {
  configForSetup,
  createGameStore,
  type GameStore,
  type OpponentSettings,
} from '../game/store.ts';

/** Test helpers for the Social window: a human at seat 0 and one or two AI rivals. */

const RIVALS = [
  { classId: 'main-character', starterSpeciesId: 'bulbasaur' },
  { classId: 'rival', starterSpeciesId: 'eevee' },
];

export function socialGame(
  rivals: 1 | 2,
  seed: string | number = 'social-seed',
  /** The settings the game starts with: every rival's by default; fewer to leave a seat without. */
  settings?: readonly OpponentSettings[],
): GameStore {
  const opponents = RIVALS.slice(0, rivals).map((choice) => ({
    ...choice,
    personality: 'greedy' as const,
    difficulty: 'normal' as const,
  }));
  const store = createGameStore();
  store.start(
    {
      ...configForSetup(
        {
          mode: 'quick',
          human: { classId: 'researcher', starterSpeciesId: 'porygon' },
          opponents,
        },
        seed,
      ),
      lapTarget: 10,
    },
    engineContent,
    settings ??
      opponents.map((_, index) => ({
        seatIndex: index + 1,
        personality: 'greedy' as const,
        difficulty: 'normal' as const,
      })),
  );
  return store;
}

/** What a request to `/api/ai/chat` carries, as far as these tests read it. */
export interface ChatRequestBody {
  gameId: string;
  seatIndex: number;
  stateRevision: number;
  observation: { own: { seatIndex: number; items?: unknown; chats?: ChatMessage[] } };
}

/** The reply the server would send for a request to `/api/ai/chat`. */
export function replyFor(request: ChatRequestBody, extra: Record<string, unknown> = {}) {
  const message = request.observation.own.chats!.findLast(
    (entry) => entry.toSeatIndex === request.seatIndex,
  )!;
  return {
    fromSeatIndex: message.fromSeatIndex,
    toSeatIndex: message.toSeatIndex,
    visibleToSeats: [message.fromSeatIndex, message.toSeatIndex],
    topic: message.topic,
    situation: 'chat_reply',
    lineId: 'chat-reply-greedy-neutral-1',
    refused: false,
    source: 'fallback',
    fallbackReason: 'disabled',
    requestId: 'request-1',
    latencyMs: 1,
    ...extra,
  };
}

/** What a request to `/api/ai/speak` with `kind: 'chat_reply'` carries, as far as these tests read it. */
export interface ChatSpeechBody {
  kind: 'chat_reply';
  gameId: string;
  seatIndex: number;
  stateRevision: number;
  addressedSeat: number;
  topic: string;
  decision: 'noncommittal' | 'refused';
  personalityId: string;
  turnKey: string;
  observation: { public: unknown; own: Record<string, unknown> };
}

/** The speech route's answer when it has no line: generated speech is off. */
export const speechOff = () =>
  new Response(
    JSON.stringify({
      source: 'none',
      fallbackReason: 'disabled',
      requestId: 'speech-1',
      latencyMs: 1,
    }),
  );

/** The speech route's answer with the rival's own line. */
export const speechLine = (text: string) =>
  new Response(JSON.stringify({ source: 'haiku', text, requestId: 'speech-1', latencyMs: 1 }));

export interface FakeServer {
  /** Request bodies sent to each route, in order. */
  calls: { decide: unknown[]; chat: unknown[]; speak: ChatSpeechBody[] };
}

/**
 * The local server, faked. Rivals take their first enabled action. `chat` answers the topic
 * route: by default a bank reply; pass a function to fail, hold or change it. `speak` answers the
 * speech route's `chat_reply` kind the same way: by default no line and no named reason, as for a
 * server that is down. Table talk requests are not recorded and get no line.
 */
export function fakeServer(
  chat: (
    request: ChatRequestBody,
    init: RequestInit | undefined,
  ) => Response | Promise<Response> = (request) => new Response(JSON.stringify(replyFor(request))),
  speak: (
    request: ChatSpeechBody,
    init: RequestInit | undefined,
  ) => Response | Promise<Response> = () => new Response('', { status: 503 }),
): FakeServer {
  const server: FakeServer = { calls: { decide: [], chat: [], speak: [] } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path === '/api/ai/status')
        return new Response(
          JSON.stringify({ backupOnly: true, jevEnabled: false, reason: 'disabled' }),
        );
      if (path === '/api/ai/outcome') return new Response(null, { status: 204 });
      const body = JSON.parse(String(init?.body));
      if (path === '/api/ai/chat') {
        server.calls.chat.push(body);
        return chat(body, init);
      }
      if (path === '/api/ai/speak') {
        // Table talk (the greeting, a round's banter) is a different request kind with its own
        // tests; here it simply has no line, so only the rival's chat words are under test.
        if (body.kind !== 'chat_reply') return new Response('', { status: 503 });
        server.calls.speak.push(body);
        return speak(body, init);
      }
      if (path === '/api/ai/decide') server.calls.decide.push(body);
      return new Response(
        JSON.stringify({
          choice: body.enabledActions[0].id,
          source: 'fallback',
          fallbackReason: 'stub',
        }),
      );
    }),
  );
  return server;
}

/**
 * Plays the game on until the human's own Social window opens: the human's other steps take the
 * pass choice, rivals take their first action. Returns false if it never opens.
 */
export async function toHumanSocial(store: GameStore): Promise<boolean> {
  for (let step = 0; step < 800; step++) {
    const { state } = store.getSession()!;
    if (state.activeSeatIndex === 0 && state.phase.kind === 'social') return true;
    if (state.phase.kind === 'finished') return false;
    if (store.advance({ human: true })) continue;
    if (state.activeSeatIndex === 0) {
      const options = store.getView()!.legalActions.enabled;
      const pass =
        options.find((choice) => ['skip', 'release', 'skip_shop'].includes(choice.kind)) ??
        options.find((choice) => choice.id === 'finish-sell') ??
        options[0]!;
      store.choose(pass.id);
    } else {
      await store.playOpponent(new AbortController().signal);
    }
  }
  return false;
}
