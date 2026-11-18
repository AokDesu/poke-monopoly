/**
 * Records Jev's answers to the chat eval set (issue #166; spec §5.3, §7, §9). Live, never run in CI
 * or by an agent: a person with the key in a git-ignored `.env` runs
 * `npx tsx eval/jev/chat-record.ts --language th` and `--language en` from the repository root.
 * The request is the one the game would send (`buildChatRequest`), to seat P2 of the start-of-game
 * fixture. One call per item, no retries; the file is written once and never overwritten.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { format, resolveConfig } from 'prettier';
import { buildJevState } from '../../ai/state/index.ts';
import {
  PINNED_JEV_MODEL,
  createSdkJevClient,
  decisionDeadline,
  jevEnabled,
  resolveJevModel,
  type JevClient,
} from '../../ai/jev/client.ts';
import { fixtureSchema, observe } from '../../engine/index.ts';
import { AI_SEAT, buildChatRequest, loadChatSet, type ChatItem } from './chat.ts';
import { RECORDED_DIR, type Recording } from './chat-recorded.ts';
import { isEntryPoint } from './spike.ts';
import { toTrialRecord } from './thai-trial.ts';

const FIXTURE = join(import.meta.dirname, '../../engine/fixtures/start-of-game-2p.json');
const DEFAULT_RETRY_AFTER_MS = 1000;
const MAX_RETRY_AFTER_MS = 60_000;
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export interface RecordChatOptions {
  client: JevClient;
  items: readonly ChatItem[];
  language: ChatItem['language'];
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/** Sends the items of one language one at a time, each once, as seat P2 would receive them. */
export const recordChat = async ({
  client,
  items,
  language,
  sleep = delay,
  now = () => new Date(),
}: RecordChatOptions): Promise<Recording> => {
  const { state } = fixtureSchema.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  const own = buildJevState(observe(state, Number(AI_SEAT.slice(1)) - 1));
  const mine = items.filter((item) => item.language === language);
  const recordedAt = now().toISOString();
  const answers: Recording['answers'] = {};
  for (const [index, item] of mine.entries()) {
    const result = await client.ask(buildChatRequest(item, own), {
      decisionSignal: decisionDeadline(),
    });
    answers[item.id] = toTrialRecord(result);
    if (!result.ok && result.fallbackReason === 'rate_limited' && index < mine.length - 1)
      await sleep(Math.min(result.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS, MAX_RETRY_AFTER_MS));
  }
  return { language, model: PINNED_JEV_MODEL, recordedAt, answers };
};

/** The file as `npm run format:check` expects it, so it can be committed as written. */
export const formatRecording = async (recording: Recording, path: string): Promise<string> =>
  format(JSON.stringify(recording), { ...(await resolveConfig(path)), parser: 'json' });

const main = async (): Promise<void> => {
  const { values } = parseArgs({ options: { language: { type: 'string' } } });
  if (values.language !== 'th' && values.language !== 'en')
    throw new Error('Pass --language th or --language en.');
  const language = values.language;
  const path = join(RECORDED_DIR, `${language}.json`);
  if (process.env.CI !== undefined)
    throw new Error('Recording makes live calls; it refuses to run when CI is set.');
  if (existsSync(path))
    throw new Error(`${path} already holds a recording. Remove it deliberately to record again.`);
  if (existsSync('.env')) process.loadEnvFile('.env');
  if (!jevEnabled()) throw new Error('JEV_ENABLED is false; recording needs live calls.');
  const model = resolveJevModel();
  if (model !== PINNED_JEV_MODEL)
    throw new Error(`JEV_MODEL is ${model}; recording runs on ${PINNED_JEV_MODEL} only.`);
  const recording = await recordChat({
    client: createSdkJevClient(),
    items: await loadChatSet(),
    language,
  });
  const answered = Object.values(recording.answers).filter((answer) => answer.ok).length;
  console.log(`${language}: ${answered}/${Object.keys(recording.answers).length} items answered.`);
  if (answered === 0) throw new Error('No item got an answer; nothing was written.');
  await mkdir(RECORDED_DIR, { recursive: true });
  await writeFile(path, await formatRecording(recording, path));
  console.log(`Wrote ${path}`);
};

if (isEntryPoint(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
