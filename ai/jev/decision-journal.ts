import type { DecisionFallbackReason } from '../../engine/contract/decision.ts';
import type { DecisionEvent, DecisionLog, DecisionRecord } from './decision-log.ts';

/** How many decisions may wait for their other half at once; the oldest is dropped past this. */
export const MAX_OPEN_DECISIONS = 1_024;

/** The decision an answer or an outcome belongs to: the request's own identifiers. */
export interface DecisionIds {
  gameId: string;
  seatIndex: number;
  turnKey: string;
  stateRevision: number;
  decisionPoint: string;
}

/** An answer as the wire carries it: IDs and a source, either the server's or the browser's. */
export type JournalAnswer = ({ choice: string } | { sellUids: string[] }) & {
  source: 'jev' | 'fallback';
  fallbackReason?: DecisionFallbackReason;
};

const keyOf = (ids: DecisionIds) =>
  JSON.stringify([ids.gameId, ids.seatIndex, ids.turnKey, ids.stateRevision, ids.decisionPoint]);

const choiceOf = (answer: JournalAnswer) =>
  'choice' in answer ? answer.choice : `sell:${answer.sellUids.join('+')}`;

const same = (a: JournalAnswer, b: JournalAnswer) =>
  choiceOf(a) === choiceOf(b) &&
  a.source === b.source &&
  (a.fallbackReason ?? null) === (b.fallbackReason ?? null);

/** The event for an applied answer that no Jev question produced (a fallback, a timeout). */
const appliedEvent = (ids: DecisionIds, answer: JournalAnswer): DecisionEvent => ({
  requestId: null,
  model: null,
  questionId: ids.decisionPoint,
  choice: choiceOf(answer),
  probabilities: null,
  confidence: null,
  sampled: null,
  fallbackReason: answer.fallbackReason ?? null,
});

interface Open {
  ids: DecisionIds;
  proposal?: { answer: JournalAnswer; events: readonly DecisionEvent[] };
  applied?: JournalAnswer;
}

/**
 * Spec §6.8: the decision events of what the browser actually applied. The server proposes an
 * answer and the browser applies either that or its own fallback (the deadline passed first, the
 * request failed), so a decision is logged only once both are known, in either order, and the
 * events are the server's only when the browser used its answer. Otherwise one event records the
 * outcome the browser used. The fallback prepared in parallel is never a decision: it is not
 * proposed here. Fields come from an explicit list, so no state or key can reach the log. A
 * decision whose other half never arrives is dropped unlogged, oldest first.
 */
export class DecisionJournal {
  readonly #open = new Map<string, Open>();
  readonly #log: DecisionLog | undefined;
  readonly #max: number;
  #warned = false;

  constructor(log?: DecisionLog, max: number = MAX_OPEN_DECISIONS) {
    this.#log = log;
    this.#max = max;
  }

  /** What the server answered: the events of that answer, held until the browser reports. */
  propose(ids: DecisionIds, answer: JournalAnswer, events: readonly DecisionEvent[]): void {
    this.#join(ids, (open) => (open.proposal = { answer, events }));
  }

  /** What the browser applied. */
  applied(ids: DecisionIds, answer: JournalAnswer): void {
    this.#join(ids, (open) => (open.applied = answer));
  }

  #join(ids: DecisionIds, set: (open: Open) => unknown): void {
    if (!this.#log) return;
    const key = keyOf(ids);
    const open = this.#open.get(key) ?? { ids };
    set(open);
    this.#open.delete(key);
    if (!open.proposal || !open.applied) {
      this.#open.set(key, open);
      for (const oldest of this.#open.keys()) {
        if (this.#open.size <= this.#max) break;
        this.#open.delete(oldest);
      }
      return;
    }
    const { proposal, applied } = open;
    const events = same(proposal.answer, applied)
      ? proposal.events.length > 0
        ? proposal.events
        : [appliedEvent(ids, applied)]
      : [appliedEvent(ids, applied)];
    this.#write(ids, events);
  }

  #write(ids: DecisionIds, events: readonly DecisionEvent[]): void {
    const time = new Date().toISOString();
    for (const event of events) {
      const line: DecisionRecord = {
        time,
        gameId: ids.gameId,
        seatIndex: ids.seatIndex,
        turnKey: ids.turnKey,
        stateRevision: ids.stateRevision,
        decisionPoint: ids.decisionPoint,
        requestId: event.requestId,
        model: event.model,
        questionId: event.questionId,
        choice: event.choice,
        probabilities: event.probabilities,
        confidence: event.confidence,
        sampled: event.sampled,
        fallbackReason: event.fallbackReason,
      };
      try {
        this.#log!(line);
      } catch {
        // Never the error itself: it could carry a path or request material.
        if (!this.#warned) console.warn('Could not write the Jev decision log.');
        this.#warned = true;
      }
    }
  }
}
