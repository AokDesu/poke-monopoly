import { parseArgs } from 'node:util';
import { createHaikuClient } from '../haiku/client.ts';
import { haikuApiKey, haikuEnabled } from '../haiku/status.ts';
import { defaultUsageLedger } from '../jev/spend.ts';
import { runSmoke, SMOKE_BRIEFS, summarize } from './smoke.ts';

// `npm run speech:smoke [-- --rounds 4]`: the owner-run live check of the speech route (spec §9).
// It sends real requests with the real key and spends real credit; no coding agent runs it.
const fmt = (value: number | null, digits = 0) => (value === null ? 'n/a' : value.toFixed(digits));

try {
  const { values } = parseArgs({ options: { rounds: { type: 'string', default: '4' } } });
  const rounds = Number(values.rounds);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds * SMOKE_BRIEFS.length > 60) {
    throw new Error('--rounds must be a whole number from 1 to 20 (one game allows 60 calls).');
  }
  if (!haikuEnabled() || !haikuApiKey()) {
    throw new Error(
      'Set HAIKU_ENABLED=true and ANTHROPIC_API_KEY in .env first; nothing was sent.',
    );
  }
  console.log(`Sending ${rounds * SMOKE_BRIEFS.length} real Haiku requests, one at a time.`);
  const calls = await runSmoke({ client: createHaikuClient() }, rounds);
  for (const call of calls) {
    console.log(
      [
        call.situation.padEnd(14),
        call.source.padEnd(5),
        `${fmt(call.latencyMs)} ms`.padStart(8),
        `${fmt(call.inputTokens)} in / ${fmt(call.outputTokens)} out`.padEnd(16),
        `THB ${fmt(call.thb, 4)}`,
        call.fallbackReason ? `[${call.fallbackReason}]` : '',
        call.text ?? '(no line)',
      ].join('  '),
    );
  }
  const summary = summarize(calls);
  console.log(
    `\n${summary.calls} calls, ${summary.sent} sent, ${summary.haikuLines} Haiku lines passed the screen.`,
  );
  console.log(`Latency p50 ${fmt(summary.latencyP50Ms)} ms, p95 ${fmt(summary.latencyP95Ms)} ms.`);
  console.log(
    `Per call: ${fmt(summary.inputTokensPerCall)} input tokens, THB ${fmt(summary.thbPerCall, 4)}.`,
  );
  console.log(`Haiku spend so far: THB ${defaultUsageLedger().spentThb('haiku').toFixed(4)}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The speech smoke check failed.');
  process.exitCode = 1;
}
