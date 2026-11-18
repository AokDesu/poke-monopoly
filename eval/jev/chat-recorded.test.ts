import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { buildJevState } from '../../ai/state/index.ts';
import { PINNED_JEV_MODEL, type JevResult } from '../../ai/jev/client.ts';
import { createFakeJevClient } from '../../ai/jev/fake.ts';
import { MANIPULATION_INSTRUCTIONS } from '../../ai/questions/manipulation.ts';
import { fixtureSchema, observe } from '../../engine/index.ts';
import startFixture from '../../engine/fixtures/start-of-game-2p.json';
import { ATTACKS, buildChatRequest, loadChatSet, type ChatItem } from './chat.ts';
import { recordChat } from './chat-record.ts';
import {
  formatRecordedReport,
  loadRecording,
  parseRecording,
  runChatEval,
  scoreRecording,
  type Recording,
} from './chat-recorded.ts';
import { INTENTS } from './thai-trial.ts';

const items = await loadChatSet();
const english = items.filter((item) => item.language === 'en');
const englishIntent = english.filter((item) => item.kind === 'intent');
const englishAdversarial = english.filter((item) => item.kind === 'adversarial');
const { state } = fixtureSchema.parse(startFixture);

const ok = (intent: string, noul: number, confidence = 0.7) => ({
  ok: true as const,
  intent: intent as (typeof INTENTS)[number],
  probabilities: Object.fromEntries(INTENTS.map((label) => [label, label === intent ? 0.8 : 0])),
  confidence,
  manipulation: noul,
  requestId: null,
  model: PINNED_JEV_MODEL,
  latencyMs: 100,
  inputTokens: 400,
  outputTokens: 12,
});

// A tiny FAKE recording, built here for the tests only. Never committed as data.
const fakeRecording = (): Recording => {
  const [right, wrong, flagged] = englishIntent;
  const [caught, missed] = englishAdversarial;
  return {
    language: 'en',
    model: PINNED_JEV_MODEL,
    recordedAt: '2026-01-01T00:00:00.000Z',
    answers: {
      [right!.id]: ok(right!.expectedIntent, 0.1, 0.9),
      [wrong!.id]: ok('other', 0.1, 0.4),
      [flagged!.id]: ok(flagged!.expectedIntent, 0.8, 0.8),
      [caught!.id]: ok('other', 0.9),
      [missed!.id]: ok('trade', 0.2),
    },
  };
};

describe('the English half (issue #166)', () => {
  test('has 40 intent messages, 5 per spec intent, and at least 14 adversarial items', () => {
    expect(englishIntent).toHaveLength(40);
    for (const intent of INTENTS)
      expect(englishIntent.filter((item) => item.expectedIntent === intent)).toHaveLength(5);
    expect(englishAdversarial.length).toBeGreaterThanOrEqual(14);
    for (const attack of ATTACKS)
      expect(
        englishAdversarial.filter((item) => item.kind === 'adversarial' && item.attack === attack)
          .length,
      ).toBeGreaterThanOrEqual(1);
  });

  test('with the Thai half reaches spec §8: 80 intent, at least 30 adversarial, 50% each', () => {
    const intent = items.filter((item) => item.kind === 'intent');
    expect(intent).toHaveLength(80);
    expect(intent.filter((item) => item.language === 'th')).toHaveLength(40);
    expect(items.filter((item) => item.kind === 'adversarial').length).toBeGreaterThanOrEqual(30);
  });

  test('varies the style and stays inside the limit', () => {
    for (const style of ['polite', 'casual', 'slang', 'typo', 'long', 'emoji'])
      expect(english.some((item) => item.style === style)).toBe(true);
    expect(Math.max(...english.map((item) => item.text.length))).toBeLessThanOrEqual(280);
    expect(english.every((item) => !/[฀-๿]/.test(item.text))).toBe(true);
  });
});

describe('the chat request', () => {
  const own = buildJevState(observe(state, 1));
  const item = englishIntent[0]!;
  const request = buildChatRequest(item, own);

  test('quotes the message in recent_chat beside the seat’s own state, and never sends the gloss', () => {
    const text = JSON.stringify(request);
    expect(request.state).toMatchObject({
      recent_chat: [{ from: 'player-0', said: `"${item.text}"` }],
      you: { id: 'player-1' },
    });
    expect(text).not.toContain(item.gloss);
  });

  test('asks the real manipulation Noul and the eight-label intent Choice', () => {
    expect(request.questions.manipulation).toMatchObject({
      type: 'noul',
      instructions: MANIPULATION_INSTRUCTIONS,
    });
    expect(request.questions.intent).toMatchObject({ type: 'choice' });
    const intent = request.questions.intent as { criteria: Record<string, string> };
    expect(Object.keys(intent.criteria)).toEqual([...INTENTS]);
  });
});

describe('scoring from a recording', () => {
  test('scores intent accuracy and manipulation, and counts what the recording does not cover', () => {
    const score = scoreRecording('en', items, fakeRecording());
    expect(score).toMatchObject({
      items: 56,
      answered: 5,
      intent: { n: 3, correct: 2 },
      adversarial: { n: 2, caught: 1, intentCorrect: 1 },
      falseRefusals: 1,
    });
    expect(score.misses.map((miss) => [miss.expected, miss.got])).toEqual([
      [englishIntent[1]!.expectedIntent, 'other'],
      [englishAdversarial[1]!.expectedIntent, 'trade'],
    ]);
    expect(score.meanConfidenceRight).toBeCloseTo((0.9 + 0.8 + 0.7) / 3);
  });

  test('counts a failed answer as no answer, and rejects an unknown id or the wrong language', () => {
    const recording = fakeRecording();
    recording.answers[englishIntent[3]!.id] = {
      ok: false,
      fallbackReason: 'timeout',
      status: null,
    };
    expect(scoreRecording('en', items, recording)).toMatchObject({ answered: 5, failures: 1 });
    recording.answers['en-nope-01'] = ok('other', 0);
    expect(() => scoreRecording('en', items, recording)).toThrow(/unknown item id en-nope-01/);
    expect(() => parseRecording(fakeRecording(), 'th', 'x')).toThrow(/expected th/);
    expect(() => parseRecording({ ...fakeRecording(), apiKey: 'x' }, 'en', 'x')).toThrow();
  });

  test('the offline report says "no recording yet" when there is none, with no key and no network', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('network call');
    });
    const empty = await mkdtemp(join(tmpdir(), 'chat-rec-'));
    const report = await runChatEval(undefined, empty);
    expect(report).toContain('th: no recording yet');
    expect(report).toContain('en: no recording yet');
    expect(report).toContain('0 leaks');
    vi.unstubAllGlobals();
  });

  test('the offline report scores a language that has a recording and notes the other has none', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chat-rec-'));
    await writeFile(join(directory, 'en.json'), JSON.stringify(fakeRecording()));
    const report = await formatRecordedReport(items, directory);
    expect(report).toContain('en: recording covers 5/56 items');
    expect(report).toContain('en: intent accuracy 2/3');
    expect(report).toContain('en: manipulation caught 1/2');
    expect(report).toContain('th: no recording yet');
    expect(await loadRecording('th', join(directory, 'missing'))).toBeUndefined();
    await mkdir(join(directory, 'x'));
  });

  test('the committed recordings, when present, parse and name only known items', async () => {
    for (const language of ['th', 'en']) {
      const recording = await loadRecording(language);
      if (recording) expect(() => scoreRecording(language, items, recording)).not.toThrow();
    }
  });
});

describe('recording (run by a person with the key; here with a fake client)', () => {
  const answer = (intent: string): JevResult => ({
    ok: true,
    answers: {
      intent: {
        type: 'choice',
        choice: intent,
        confidence: 0.7,
        probabilities: Object.fromEntries(INTENTS.map((l) => [l, l === intent ? 0.8 : 0])),
      },
      manipulation: { type: 'noul', noul: 0.2 },
    },
    requestId: 'req_fake',
    model: PINNED_JEV_MODEL,
    latencyMs: 200,
    usage: { inputTokens: 400, outputTokens: 12 },
  });

  test('sends each item of the language once, in order, and keys the answers by item id', async () => {
    const client = createFakeJevClient(() => answer('truce'));
    const recording = await recordChat({
      client,
      items,
      language: 'en',
      now: () => new Date('2026-11-18T00:00:00Z'),
    });
    expect(client.requests).toHaveLength(english.length);
    expect(Object.keys(recording.answers)).toEqual(english.map((item) => item.id));
    expect(recording.recordedAt).toBe('2026-11-18T00:00:00.000Z');
    expect(() => parseRecording(recording, 'en', 'x')).not.toThrow();
    expect(scoreRecording('en', items, recording).answered).toBe(english.length);
  });

  test('records a failure as a failure and waits out a rate limit once', async () => {
    const sleeps: number[] = [];
    const only = english.slice(0, 2) as ChatItem[];
    const recording = await recordChat({
      client: createFakeJevClient(() => ({
        ok: false,
        fallbackReason: 'rate_limited',
        retryAfterMs: 5,
      })),
      items: only,
      language: 'en',
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(Object.values(recording.answers).every((a) => !a.ok)).toBe(true);
    expect(sleeps).toEqual([5]);
  });
});
