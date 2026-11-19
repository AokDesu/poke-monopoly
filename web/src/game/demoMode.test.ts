import { afterEach, expect, test, vi } from 'vitest';
import { aiStatusSchema } from '../../../engine/contract/decision.ts';
import { demoRequested, demoSettingOf, fetchDemoSetting } from './demoMode.ts';
import { modelNumber } from './demoChoice.ts';

afterEach(() => vi.unstubAllGlobals());

// Only a bare `?demo`, `?demo=1` and `?demo=true` open demo mode (issue #247); a spelled-out off
// value or anything unclear keeps it closed, since demo mode shows a rival's private options.
test.each([
  ['?demo', true],
  ['?demo=1', true],
  ['?demo=true', true],
  ['?seed=3&demo', true],
  ['?demo=', true],
  ['', false],
  ['?seed=3', false],
  ['?demo=0', false],
  ['?demo=false', false],
  ['?demo=False', false],
  ['?demo=TRUE', false],
  ['?demo=yes', false],
  ['?demo=on', false],
  ['?demo=2', false],
  ['?demo=0&demo', false],
  ['?demo&demo=0', false],
  ['?demo=true&demo=1', true],
  ['?demonstration', false],
  ['?P5-A01', false],
])('%s asks for demo mode: %s', (search, expected) => {
  expect(demoRequested(search)).toBe(expected);
});

const base = { jevEnabled: true, backupOnly: false, reason: null };
const speech = { enabled: true, reason: null };

// The browser reads the flag as a field, so it must behave the same on a server that has not added
// it yet (today's strict schema) and on one that has (`demo: boolean`, issue #249).
test.each([
  ['a status without the field (the server today)', { ...base, speech }, false],
  ['demo: false', { ...base, speech, demo: false }, false],
  ['demo: true', { ...base, speech, demo: true }, true],
  ['demo: "true"', { ...base, speech, demo: 'true' }, false],
  ['demo: 1', { ...base, speech, demo: 1 }, false],
  ['demo: null', { ...base, speech, demo: null }, false],
  ['demo: an object', { ...base, speech, demo: {} }, false],
  ['a null body', null, false],
  ['a string body', 'demo', false],
  ['an array body', [true], false],
])('the server setting from %s is %s', (_name, status, expected) => {
  expect(demoSettingOf(status)).toBe(expected);
});

test('today’s strict status schema accepts the status the browser reads, and the field is not in it yet', () => {
  expect(aiStatusSchema.safeParse({ ...base, speech }).success).toBe(true);
  expect('demo' in aiStatusSchema.shape).toBe(false);
});

function stubStatus(answer: () => Response | Promise<Response>) {
  const paths: string[] = [];
  vi.stubGlobal('fetch', async (path: string) => {
    paths.push(path);
    return answer();
  });
  return paths;
}

test('the setting is on only when the status answers ok with demo: true', async () => {
  const paths = stubStatus(() => Response.json({ ...base, speech, demo: true }));
  expect(await fetchDemoSetting(new AbortController().signal)).toBe(true);
  expect(paths).toEqual(['/api/ai/status']);
});

test('a missing, false, refused, failed or unreadable answer is off', async () => {
  const answers: (() => Response | Promise<Response>)[] = [
    () => Response.json({ ...base, speech }),
    () => Response.json({ ...base, speech, demo: false }),
    () => Response.json({ demo: true }, { status: 503 }),
    () => new Response('not json', { status: 200 }),
    () => Promise.reject(new Error('network down')),
  ];
  for (const answer of answers) {
    stubStatus(answer);
    expect(await fetchDemoSetting(new AbortController().signal)).toBe(false);
  }
});

test('an aborted request is off', async () => {
  vi.stubGlobal('fetch', (_path: string, init: RequestInit) => {
    const { promise, reject } = Promise.withResolvers<Response>();
    init.signal!.addEventListener('abort', () => reject(new DOMException('aborted')));
    return promise;
  });
  const controller = new AbortController();
  const pending = fetchDemoSetting(controller.signal);
  controller.abort();
  expect(await pending).toBe(false);
});

test.each([
  [0.8299999, '0.83'],
  [0.83, '0.83'],
  [0.62, '0.62'],
  [0.07000000000000001, '0.07'],
  [0.999, '1.00'],
  [1, '1.00'],
  [0, '0.00'],
  [0.004, '<0.01'],
  [0.005, '0.01'],
])('Jev’s number %s is shown as %s', (value, text) => {
  expect(modelNumber(value)).toBe(text);
});
