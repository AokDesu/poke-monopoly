import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Spec §6.8, git-ignored with the rest of `logs/`: one line per Jev decision event. */
export const DECISION_LOG_PATH = 'logs/jev-decisions.jsonl';

/**
 * One §6.8 event with the decision it belongs to. Only these fields are ever written: no state,
 * question text, observation or key. `choice` and the `probabilities` keys are engine action IDs.
 */
export interface DecisionRecord {
  time: string;
  gameId: string;
  seatIndex: number;
  turnKey: string;
  stateRevision: number;
  decisionPoint: string;
  requestId: string | null;
  model: string | null;
  questionId: string;
  choice: string;
  probabilities: Record<string, number> | null;
  confidence: number | null;
  /** Easy's seeded draw out of 2^32; null when the choice was not sampled. */
  sampled: number | null;
  fallbackReason: string | null;
}

export type DecisionLog = (record: DecisionRecord) => void;

/**
 * A log that appends each record to `path` in the background, making its folder whenever it is
 * missing (on the first write, or after it was removed). Writes keep their order and are never
 * awaited by a decision; a failed write is dropped with one warning for the log's lifetime.
 */
export const fileDecisionLog = (path: string = DECISION_LOG_PATH): DecisionLog => {
  let queue: Promise<void> = Promise.resolve();
  let warned = false;
  const append = async (line: string) => {
    try {
      await appendFile(path, line);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, line);
    }
  };
  return (record) => {
    const line = `${JSON.stringify(record)}\n`;
    queue = queue
      .then(() => append(line))
      .catch(() => {
        if (warned) return;
        warned = true;
        console.warn('Could not write the Jev decision log.');
      });
  };
};
