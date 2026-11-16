import type { SpeechStatus } from '../../engine/contract/decision.ts';
import { defaultUsageLedger, type UsageRecorder } from '../jev/spend.ts';

/** Spec §9: Haiku is off unless `HAIKU_ENABLED=true`. Read only here and in the client, inside ai/. */
export const haikuEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.HAIKU_ENABLED?.trim().toLowerCase() === 'true';

/** One printable ASCII value without whitespace, as in the rules-helper; anything else counts as no key. */
export const haikuApiKey = (env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key && /^[\x21-\x7e]+$/.test(key) ? key : undefined;
};

/**
 * The speech half of `GET /api/ai/status`: the kill switch, key presence and Haiku's own cap, read
 * per call so the "Voice off" badge tells the truth. The ledger is opened only once Haiku is on
 * and keyed, so a server without Haiku never reads the usage log.
 */
export const speechStatus = (
  usage: () => Pick<UsageRecorder, 'budgetExceeded'> = defaultUsageLedger,
  env: NodeJS.ProcessEnv = process.env,
): SpeechStatus => {
  if (!haikuEnabled(env)) return { enabled: false, reason: 'disabled' };
  if (!haikuApiKey(env)) return { enabled: false, reason: 'missing_key' };
  if (usage().budgetExceeded('haiku')) return { enabled: false, reason: 'budget_exceeded' };
  return { enabled: true, reason: null };
};
