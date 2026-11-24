import type { DecisionDetail, DecisionResponse } from '../../../engine/contract/decision.ts';

/**
 * A typed fake of the decision answer WITH its `detail` (issue #220), for tests and the dev
 * gallery. The real server now sends this field when `DEMO_MODE` is on and Jev decides (#249);
 * the fake stays because tests and the gallery need an answer without a Jev key. Its type is the
 * contract's own, and a test holds it to the contract's schema, so a fake that drifts from the
 * shape fails there and not on screen.
 */
export interface FakeJevAnswerOptions {
  /** The option IDs Jev was given, with its probability for each. */
  options: DecisionDetail['options'];
  /** Jev's confidence; at the Sell Phase (`sellUids`) it is `null` and none is sent. */
  confidence?: number | null;
  questionId?: string;
  /** The action ID Jev chose, or the Pokémon to sell at the Sell Phase. */
  choice?: string;
  sellUids?: readonly string[];
}

export function fakeJevAnswer({
  options,
  confidence,
  questionId = 'strategy',
  choice,
  sellUids,
}: FakeJevAnswerOptions): DecisionResponse {
  const telemetry = { source: 'jev', requestId: 'fake-decision', latencyMs: 0 } as const;
  // The Sell Phase has one yes/no answer per Pokémon, so the real server's confidence is null.
  if (confidence === undefined) confidence = sellUids ? null : 0.62;
  const detail = { questionId, confidence, options: options.map((option) => ({ ...option })) };
  if (sellUids) return { sellUids: [...sellUids], ...telemetry, detail };
  if (choice === undefined) throw new Error('A fake Jev answer needs a choice or sellUids');
  return { choice, ...telemetry, detail };
}
