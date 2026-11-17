import { describe, expect, test } from 'vitest';
import { DecisionJournal, type DecisionIds, type JournalAnswer } from './decision-journal.ts';
import type { DecisionEvent, DecisionRecord } from './decision-log.ts';

const ids = (turnKey: string): DecisionIds => ({
  gameId: 'g',
  seatIndex: 1,
  turnKey,
  stateRevision: 7,
  decisionPoint: 'strategy',
});
const jev: JournalAnswer = { choice: 'use-item:item-0', source: 'jev' };
const timeout: JournalAnswer = { choice: 'skip', source: 'fallback', fallbackReason: 'timeout' };
const event: DecisionEvent = {
  requestId: 'req_1',
  model: 'jev-1.13.0',
  questionId: 'strategy',
  choice: 'use-item:item-0',
  probabilities: { 'use-item:item-0': 1 },
  confidence: 1,
  sampled: null,
  fallbackReason: null,
};

const journal = (max?: number) => {
  const records: DecisionRecord[] = [];
  return { records, journal: new DecisionJournal((line) => records.push(line), max) };
};

describe('DecisionJournal (spec §6.8)', () => {
  test('logs the server’s events when the browser applied its answer, in either order', () => {
    const a = journal();
    a.journal.propose(ids('t1'), jev, [event]);
    a.journal.applied(ids('t1'), jev);
    const b = journal();
    b.journal.applied(ids('t1'), jev);
    b.journal.propose(ids('t1'), jev, [event]);
    for (const { records } of [a, b]) {
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ requestId: 'req_1', choice: 'use-item:item-0' });
    }
  });

  test('logs the outcome the browser applied when it differs from the proposal', () => {
    const { records, journal: j } = journal();
    j.propose(ids('t1'), jev, [event]);
    j.applied(ids('t1'), timeout);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      choice: 'skip',
      fallbackReason: 'timeout',
      requestId: null,
      probabilities: null,
    });
  });

  test('a Sell outcome logs the sold Pokémon the way the orchestrator does', () => {
    const { records, journal: j } = journal();
    const sold: JournalAnswer = {
      sellUids: ['a', 'b'],
      source: 'fallback',
      fallbackReason: 'timeout',
    };
    j.propose({ ...ids('t1'), decisionPoint: 'sell' }, { sellUids: [], source: 'jev' }, []);
    j.applied({ ...ids('t1'), decisionPoint: 'sell' }, sold);
    expect(records.map((line) => [line.choice, line.questionId])).toEqual([['sell:a+b', 'sell']]);
  });

  test('holds at most `max` open decisions and drops the oldest unlogged', () => {
    const { records, journal: j } = journal(2);
    for (const turn of ['t1', 't2', 't3']) j.propose(ids(turn), jev, [event]);
    j.applied(ids('t1'), jev); // t1 was dropped: its report finds nothing waiting
    j.applied(ids('t3'), jev);
    expect(records.map((line) => line.turnKey)).toEqual(['t3']);
  });

  test('without a log it keeps nothing', () => {
    const j = new DecisionJournal();
    for (let turn = 0; turn < 5000; turn++) j.propose(ids(`t${turn}`), jev, [event]);
    expect(() => j.applied(ids('t0'), jev)).not.toThrow();
  });
});
