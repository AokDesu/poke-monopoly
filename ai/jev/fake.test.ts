import { noul } from '@typesafe-ai/sdk';
import { expect, test } from 'vitest';
import type { JevRequest, JevResult } from './client.ts';
import { createFakeJevClient } from './fake.ts';

const request: JevRequest = { state: 'board', questions: { sell: noul('Sell team[0] now?') } };
const answer: JevResult = {
  ok: true,
  answers: { sell: { type: 'noul', noul: 0.8 } },
  requestId: 'fake_1',
  model: 'jev-1.13.0',
  latencyMs: 0,
  usage: { inputTokens: 5, outputTokens: 1 },
};

test('answers from its responder and records each request', async () => {
  const client = createFakeJevClient(() => answer);
  expect(await client.ask(request, { decisionSignal: new AbortController().signal })).toBe(answer);
  expect(client.requests).toEqual([request]);
});

test('discards an answer once the decision signal has fired', async () => {
  const decision = new AbortController();
  const client = createFakeJevClient(async () => {
    decision.abort();
    return answer;
  });
  expect(await client.ask(request, { decisionSignal: decision.signal })).toEqual({
    ok: false,
    fallbackReason: 'timeout',
  });
  expect(await client.ask(request, { decisionSignal: decision.signal })).toEqual({
    ok: false,
    fallbackReason: 'timeout',
  });
  expect(client.requests).toHaveLength(1);
});
