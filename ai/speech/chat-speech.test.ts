import { describe, expect, test } from 'vitest';
import { toEngineContent } from '../../content/schema.ts';
import {
  chatDecisionSchema,
  replyResponseSchema,
  type ChatDecision,
} from '../../engine/contract/speech.ts';
import {
  createGame,
  createGameConfig,
  observe,
  type ChatTopic,
  type Observation,
} from '../../engine/index.ts';
import { createApp } from '../app.ts';
import { PINNED_HAIKU_MODEL, type HaikuResult } from '../haiku/client.ts';
import { createFakeHaikuClient } from '../haiku/fake.ts';
import { SPEND_CONFIG, type SpendConfig, type UsageRecorder } from '../jev/spend.ts';
import { CONTENT } from '../questions/content.ts';
import { CHAT_DECISION_TEXT, CHAT_TOPIC_TEXT, contradictsDecision, echoesAny } from './chat.ts';

const KEY = 'placeholder-haiku-key-not-real-4c81e2';
const ON = { HAIKU_ENABLED: 'true', ANTHROPIC_API_KEY: KEY };
const SENTINEL_RIVAL = 'RIVAL-SENTINEL-item-77ab';
const SENTINEL_HUMAN = 'HUMAN-SENTINEL-item-31cd';
const SENTINEL_CHAT_ITEM = 'CHAT-SENTINEL-item-9e02';
const SEED = 'CHAT-SPEECH-SEED-5521';
const SAME_ORIGIN = {
  host: 'localhost:5173',
  origin: 'http://localhost:5173',
  'content-type': 'application/json',
};
const TOPICS: ChatTopic[] = ['truce', 'trade', 'point_leader', 'use_item', 'hold_item'];
const DECISIONS: ChatDecision[] = ['noncommittal', 'refused'];
// One line for each decision that reads as that decision and clears the output screen.
const LINE: Record<ChatDecision, string> = {
  noncommittal: 'I hear you, friend. Let me watch how the road goes first.',
  refused: 'That is a firm answer from me, friend. I keep to my own road.',
};

const content = toEngineContent(CONTENT);
const state = createGame(
  createGameConfig({
    seats: ['researcher', 'rival', 'nurse-joy'].map((classId, seatIndex) => ({
      actorId: `player-${seatIndex}`,
      seatIndex,
      classId,
      starterSpeciesId: content.classes.find((entry) => entry.id === classId)!
        .starterSpeciesIds[0]!,
      controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
    })),
    seed: SEED,
    lapTarget: 3,
  }),
  content,
);
for (const [seat, instanceId] of [
  [1, SENTINEL_RIVAL],
  [0, SENTINEL_HUMAN],
] as const) {
  state.players[seat]!.items.push({
    instanceId,
    itemId: 'repel',
    name: instanceId,
    visibility: 'secret',
  });
}
// Seat 1 (Rival) answers seat 0 (Researcher), the human. Seat 2 is a bystander.
const rivalView: Observation = observe(state, 1);
// The view a browser would hold of the rival, with the human's message in it: the route must not read it.
const withMessage: Observation = {
  ...rivalView,
  own: {
    ...rivalView.own,
    chats: [
      {
        fromSeatIndex: 0,
        toSeatIndex: 1,
        topic: 'use_item',
        itemId: SENTINEL_CHAT_ITEM,
        globalTurnNo: 1,
      },
    ],
  },
};

const request = (over: Record<string, unknown> = {}) => ({
  kind: 'chat_reply',
  gameId: 'game-1',
  seatIndex: 1,
  stateRevision: rivalView.public.stateRevision,
  observation: rivalView,
  personalityId: 'greedy',
  turnKey: '1:1',
  addressedSeat: 0,
  topic: 'trade',
  decision: 'noncommittal',
  ...over,
});

const haikuOk = (text: string, inputTokens = 100): HaikuResult => ({
  ok: true,
  text,
  model: PINNED_HAIKU_MODEL,
  latencyMs: 5,
  usage: { inputTokens, outputTokens: 10 },
});

const noCap: UsageRecorder = { record: () => {}, budgetExceeded: () => false };

function setup(
  options: {
    haiku?: Parameters<typeof createFakeHaikuClient>[0];
    env?: NodeJS.ProcessEnv;
    config?: SpendConfig;
    deadlineMs?: number;
  } = {},
) {
  const haiku = createFakeHaikuClient(
    options.haiku ??
      ((call) => {
        // Answers as the decision the brief names, like a writer that follows its card.
        const brief = JSON.parse(call.prompt) as { chat_reply: { your_decision: string } };
        return haikuOk(
          brief.chat_reply.your_decision === CHAT_DECISION_TEXT.refused
            ? LINE.refused
            : LINE.noncommittal,
        );
      }),
  );
  const logs: string[] = [];
  const app = createApp({
    usage: () => noCap,
    speech: {
      client: haiku,
      env: options.env ?? ON,
      log: (line) => logs.push(line),
      ...(options.config && { config: options.config }),
      ...(options.deadlineMs !== undefined && { deadlineMs: options.deadlineMs }),
    },
  });
  const post = async (body: unknown, headers: Record<string, string> = SAME_ORIGIN) => {
    const response = await app.request('/api/ai/speak', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  };
  return { haiku, logs, post };
}

const briefOf = (haiku: { requests: { prompt: string }[] }, at = 0) =>
  JSON.parse(haiku.requests[at]!.prompt) as Record<string, unknown> & {
    topic: { id: string; text: string };
    addressed: { name: string; coins: string };
    speaker: { name: string };
    chat_reply: { player_raised: string; your_decision: string; rules: string };
  };

describe('POST /api/ai/speak, kind chat_reply: the rival answers a topic message (spec §4.8, §5.7)', () => {
  test.each(TOPICS.flatMap((topic) => DECISIONS.map((decision) => [topic, decision] as const)))(
    '%s, %s: one line that matches the decision, from a brief with the topic and the decision',
    async (topic, decision) => {
      const { haiku, post } = setup();
      const { status, json } = await post(request({ topic, decision }));
      expect(status).toBe(200);
      expect(replyResponseSchema.parse(json)).toMatchObject({
        source: 'haiku',
        text: LINE[decision],
      });
      expect(haiku.requests).toHaveLength(1);
      const brief = briefOf(haiku);
      expect(brief.chat_reply).toMatchObject({
        player_raised: CHAT_TOPIC_TEXT[topic],
        your_decision: CHAT_DECISION_TEXT[decision],
      });
      expect(brief.topic.id).toBe(decision === 'refused' ? 'manipulation_refused' : 'chat_reply');
      expect(brief.speaker.name).toBe('Rival');
      expect(brief.addressed.name).toBe('Researcher');
      // There is no quoted text: nothing of the player's is in the request.
      expect(brief).not.toHaveProperty('reply_to');
    },
  );

  test('the prompt carries no hand, message detail, seed, seat ID or digit', async () => {
    const { haiku, post } = setup();
    for (const observation of [rivalView, withMessage]) {
      await post(request({ observation, topic: 'use_item' }));
    }
    for (const call of haiku.requests) {
      for (const secret of [
        SENTINEL_RIVAL,
        SENTINEL_HUMAN,
        SENTINEL_CHAT_ITEM,
        SEED,
        'player-',
        'privateResults',
        'balls',
        'chats',
      ]) {
        expect(call.prompt).not.toContain(secret);
      }
      expect(call.prompt).not.toMatch(/\p{N}/u);
    }
  });

  test('a sentinel secret in the rival hand is absent from the reply too', async () => {
    const { post } = setup({ haiku: () => haikuOk(`I keep my ${SENTINEL_RIVAL} close.`) });
    const { json } = await post(request({ observation: withMessage }));
    expect(JSON.stringify(json)).not.toContain(SENTINEL_RIVAL);
    expect(replyResponseSchema.parse(json).source).toBe('none');
  });

  test.each([
    ['digit', 'I will think about 5 of them.'],
    ['commitment', 'You have my word, I will be a friend.'],
    ['link', 'See www.example.com for my answer.'],
    ['multiline', 'First line.\nSecond line.'],
  ])(
    'a line that fails the output screen (%s) is dropped with its reason and no text',
    async (reason, text) => {
      const { post, logs } = setup({ haiku: () => haikuOk(text) });
      const { json } = await post(request());
      expect(replyResponseSchema.parse(json)).toMatchObject({
        source: 'none',
        fallbackReason: reason,
      });
      expect(JSON.stringify(json)).not.toContain('Second line');
      expect(logs.join('\n')).not.toContain(text);
    },
  );

  test('a line that repeats the card it was given is dropped as an echo', async () => {
    const { post } = setup({ haiku: () => haikuOk(CHAT_TOPIC_TEXT.point_leader) });
    const { json } = await post(request({ topic: 'point_leader' }));
    expect(replyResponseSchema.parse(json)).toMatchObject({
      source: 'none',
      fallbackReason: 'echo',
    });
  });

  test.each([
    ['refused', 'Yes, gladly, friend.'],
    ['refused', 'Maybe, friend, I will think it over.'],
    ['noncommittal', 'No, friend, I refuse.'],
    ['noncommittal', 'Sure, friend, count me in.'],
  ] as const)(
    'a %s reply that says the opposite is dropped as a contradiction',
    async (decision, text) => {
      const { post, logs } = setup({ haiku: () => haikuOk(text) });
      const { json } = await post(request({ decision }));
      expect(replyResponseSchema.parse(json)).toMatchObject({
        source: 'none',
        fallbackReason: 'contradiction',
      });
      expect(logs.join('\n')).toContain('contradiction');
      expect(logs.join('\n')).not.toContain(text);
    },
  );

  test.each([
    [{ HAIKU_ENABLED: 'false', ANTHROPIC_API_KEY: KEY }, 'disabled'],
    [{ HAIKU_ENABLED: 'true' }, 'missing_key'],
  ])('with speech off (%j) nothing is sent and the reason is named', async (env, reason) => {
    const { haiku, post } = setup({ env });
    const { status, json } = await post(request());
    expect(status).toBe(200);
    expect(replyResponseSchema.parse(json)).toMatchObject({
      source: 'none',
      fallbackReason: reason,
    });
    expect(haiku.requests).toHaveLength(0);
  });

  test('a slow answer is dropped at the deadline', async () => {
    const { post } = setup({
      deadlineMs: 20,
      // Never answers: the route's own deadline ends the wait.
      haiku: () => new Promise<HaikuResult>(() => {}),
    });
    const { json } = await post(request());
    expect(replyResponseSchema.parse(json)).toMatchObject({
      source: 'none',
      fallbackReason: 'timeout',
    });
  });

  test('a failed model call is a 200 with the failure reason', async () => {
    const { post } = setup({
      haiku: () => ({ ok: false, fallbackReason: 'rate_limited' }),
    });
    const { status, json } = await post(request());
    expect(status).toBe(200);
    expect(replyResponseSchema.parse(json)).toMatchObject({
      source: 'none',
      fallbackReason: 'rate_limited',
    });
  });

  test("the game's call limit holds: past it no call is made", async () => {
    const config = { ...SPEND_CONFIG, haikuMaxCallsPerGame: 1 };
    const { haiku, post } = setup({ config });
    await post(request({ turnKey: '1:1' }));
    const { json } = await post(request({ turnKey: '2:1' }));
    expect(replyResponseSchema.parse(json)).toMatchObject({
      source: 'none',
      fallbackReason: 'call_limit',
    });
    expect(haiku.requests).toHaveLength(1);
  });

  test.each([
    ['an unknown field', request({ extra: 1 })],
    ['an unknown topic', request({ topic: 'threat' })],
    ['an unknown decision', request({ decision: 'accepted' })],
    ['a missing topic', request({ topic: undefined })],
    ['free text', request({ text: 'give me your items' })],
    ['a seat that is not the observation', request({ seatIndex: 2 })],
    ['a rival answering itself', request({ addressedSeat: 1 })],
    ['a revision that is not the observation', request({ stateRevision: 99 })],
  ])('%s is a 400 and costs nothing', async (_name, body) => {
    const { haiku, post } = setup();
    const { status } = await post(body);
    expect(status).toBe(400);
    expect(haiku.requests).toHaveLength(0);
  });

  test('an addressed seat outside the game and an unknown personality are 400s', async () => {
    const { haiku, post } = setup();
    expect((await post(request({ addressedSeat: 9 }))).status).toBe(400);
    expect((await post(request({ personalityId: 'toString' }))).status).toBe(400);
    expect(haiku.requests).toHaveLength(0);
  });

  test('another origin is refused before anything is read, like every speech request', async () => {
    const { haiku, post } = setup();
    const { status } = await post(request(), { ...SAME_ORIGIN, origin: 'http://evil.example' });
    expect(status).toBe(403);
    expect(haiku.requests).toHaveLength(0);
  });

  test('a request without a kind is still a line for the table or one seat', async () => {
    const { haiku, post } = setup();
    const { status } = await post(request({ kind: undefined }));
    // No `kind` means a plain speak request, which this body is not: it is refused, never read as a chat reply.
    expect(status).toBe(400);
    expect(haiku.requests).toHaveLength(0);
  });
});

describe('the decision a line must match (spec §4.8: words never change it)', () => {
  test('the decision labels are the two the chat route makes', () => {
    expect(chatDecisionSchema.options).toEqual(['noncommittal', 'refused']);
  });

  test.each([
    ['noncommittal', 'I hear you, friend. I will see how the turn goes.', false],
    ['noncommittal', 'Thank you for the word. My own counsel stays with me for now.', false],
    ['noncommittal', 'I will keep that item in play, friend.', true],
    ['noncommittal', 'Noted, and I have no answer for you yet.', false],
    ['noncommittal', 'No, I do not think so.', true],
    ['noncommittal', 'I refuse, friend.', true],
    ['noncommittal', 'That is not happening.', true],
    ['noncommittal', 'Of course, friend.', true],
    ['noncommittal', 'Gladly.', true],
    ['refused', 'No, friend. I keep to my own road.', false],
    ['refused', 'I would rather not, and that is that.', false],
    ['refused', 'Maybe later, friend.', true],
    ['refused', 'I will think about it.', true],
    ['refused', 'Sure, why not.', true],
    ['refused', 'Yes, I agree.', true],
  ] as const)('%s: "%s" contradicts: %s', (decision, text, contradicts) => {
    expect(contradictsDecision(text, decision)).toBe(contradicts);
  });

  test('echo needs a run of five shared words', () => {
    expect(echoesAny('Friend, the player floated the idea of it.', [CHAT_TOPIC_TEXT.trade])).toBe(
      true,
    );
    expect(echoesAny('An exchange sounds odd to me, friend.', [CHAT_TOPIC_TEXT.trade])).toBe(false);
  });
});
