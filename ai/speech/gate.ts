import { JevAdmission } from '../admission.ts';
import { CHAT_TUNING } from '../chat.ts';
import { billedUsage } from '../jev/usage.ts';
import { decisionDeadline, resolveJevModel, type JevClient } from '../jev/client.ts';
import { defaultUsageLedger, warnLedgerFailed, type UsageRecorder } from '../jev/spend.ts';
import {
  buildManipulationRequest,
  manipulationVerdict,
  type ManipulationMessage,
} from '../questions/manipulation.ts';

/** Spec §5.6: one Jev request has 1,000 ms; the gate never waits longer for a line it may not quote. */
export const GATE_DEADLINE_MS = 1000;

/** The one threshold the table talk gate and the player's chat share (`CHAT_TUNING`, spec §5.3). */
export const MANIPULATION_THRESHOLD: number = CHAT_TUNING.manipulationThreshold;

/**
 * `clean`: the line may be quoted. `manipulation`: Jev's Noul is at or above the threshold.
 * `unavailable`: no verdict (Jev off, over budget, slow, failed or malformed), so the line is not
 * quoted either: the gate fails closed.
 */
export type GateVerdict = 'clean' | 'manipulation' | 'unavailable';

export interface ManipulationGate {
  /** Never throws. One Jev request, logged against the spend guard, when one goes out. */
  check(args: ManipulationMessage & { gameId: string; turnKey: string }): Promise<GateVerdict>;
}

export interface GateOptions {
  /** Made on first use; defaults to the Jev SDK client, which the caller supplies so tests need no key. */
  client: () => JevClient;
  usage?: () => UsageRecorder;
  /**
   * The caps a Jev decision has (spec §9): the turn's request limit, the game's token budget, the
   * spend reservation and the server-wide window. Shared with the decider in the app; a private
   * one over `usage` by default. A check it refuses is `unavailable`, as ever.
   */
  admission?: JevAdmission;
  threshold?: number;
  deadlineMs?: number;
}

/**
 * Spec §5.3, §5.7, §9: asks Jev the manipulation Noul about one AI line before another AI's prompt
 * may quote it. The request is logged like every other Jev request (one usage line, counted by the
 * spend guard); a Jev budget that is spent means no request is made and no line passes.
 */
export const createManipulationGate = ({
  client,
  usage = defaultUsageLedger,
  admission = new JevAdmission({ usage }),
  threshold = MANIPULATION_THRESHOLD,
  deadlineMs = GATE_DEADLINE_MS,
}: GateOptions): ManipulationGate => {
  let jev: JevClient | undefined;
  return {
    async check({ gameId, turnKey, ...message }) {
      let release = () => {};
      try {
        const ledger = usage();
        const admitted = admission.admit(gameId, turnKey);
        if ('reason' in admitted) return 'unavailable';
        release = admitted.release;
        const request = buildManipulationRequest(message);
        jev ??= client();
        const time = new Date().toISOString();
        const started = performance.now();
        const result = await jev.ask(request, { decisionSignal: decisionDeadline(deadlineMs) });
        admitted.quota.meter.record(result);
        const latencyMs = Math.round(performance.now() - started);
        const billed = billedUsage(result);
        if (billed) {
          try {
            ledger.record({
              time,
              gameId,
              requestId: result.ok ? (result.requestId ?? null) : null,
              model: result.ok ? result.model : resolveJevModel(),
              inputTokens: billed.inputTokens,
              outputTokens: billed.outputTokens,
              latencyMs,
              status: result.ok ? 'ok' : result.fallbackReason,
              turnKey,
              decision: 0,
              decisionMs: latencyMs,
              ...(billed.estimated && { estimated: true }),
            });
          } catch (error) {
            warnLedgerFailed('Could not write the Jev usage log', error);
          }
        }
        // A late answer was already turned into a timeout by the client.
        if (!result.ok) return 'unavailable';
        return manipulationVerdict(result.answers, threshold) ?? 'unavailable';
      } catch {
        // Never the error text: it may name the line.
        return 'unavailable';
      } finally {
        release();
      }
    },
  };
};
