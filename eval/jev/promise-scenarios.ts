import { PERSONALITIES } from '../../ai/fallback/index.ts';
import { promiseTable, type EvalScenario } from './scenario-kit.ts';

/**
 * Spec §5.3, §5.5, §8 (issue #59, S11 promise half): decision scenarios for the promise response.
 * Seat 0, the AI, is asked about a `no_attack` promise by the human at seat 1, who is in its Social
 * window. Four table states, each shared by all four personalities, so a pair differs only in the
 * personality text of the request (spec §8: paired scenarios swap personality, everything else held
 * constant):
 *
 * - the promise goes to the AI (`recipient`) or the AI is asked to make it (`promiser`);
 * - the AI's trust in the human is `high` (two kept promises) or `low` (one broken promise).
 *
 * Every request comes from the real question builder over the engine's own observation: trust as a
 * named bucket, memory as event evidence, the human's earlier message as quoted data. The acceptable
 * sets are judgements from `content/personalities/<id>.json`; the `reason` of each cites the weights
 * it rests on and a test checks the cited values against the files. The fallback policy's answer is
 * a cross-check, not the source.
 */

type PersonalityId = keyof typeof PERSONALITIES;
const ACCEPT = 'respond:accept';
const REJECT = 'respond:reject';

interface Verdict {
  acceptable: readonly string[];
  reason: string;
}

interface Group {
  /** Scenario IDs are `<personality>-<group>`. */
  group: string;
  description: string;
  role: 'recipient' | 'promiser';
  trust: 'high' | 'low';
  verdicts: Record<PersonalityId, Verdict>;
}

const GROUPS: readonly Group[] = [
  {
    group: 'promise-recipient-high-trust',
    description:
      'The human, who kept two promises to the AI, now promises not to attack it, after asking for a truce.',
    role: 'recipient',
    trust: 'high',
    verdicts: {
      greedy: {
        acceptable: [ACCEPT],
        reason:
          'Greedy: loyalty 0.5 and a rival who has twice kept its word: a free protection from a trusted rival costs nothing, so accepting is right.',
      },
      aggressive: {
        acceptable: [ACCEPT],
        reason:
          'Aggressive: loyalty 0.4 gives its trust little weight, but the promise binds only the rival and the rival has kept its word twice, so accepting costs nothing.',
      },
      cautious: {
        acceptable: [ACCEPT],
        reason:
          'Cautious: loyalty 0.8 and aggression 0.2: it avoids fights and values a kept promise, and this rival has kept two, so it accepts.',
      },
      opportunist: {
        acceptable: [ACCEPT],
        reason:
          'Opportunist: loyalty 0.2 is a steady friend only while it suits, and a free protection from a rival that keeps its word suits it.',
      },
    },
  },
  {
    group: 'promise-recipient-low-trust',
    description:
      'The human, who broke a promise to the AI, now promises not to attack it, after asking for a truce.',
    role: 'recipient',
    trust: 'low',
    verdicts: {
      greedy: {
        acceptable: [REJECT],
        reason:
          'Greedy: loyalty 0.5 is not enough to take the word of a rival that already broke one to it; it rejects.',
      },
      aggressive: {
        acceptable: [REJECT],
        reason:
          'Aggressive: aggression 0.9 and loyalty 0.4: it owes a rival that broke its word nothing and keeps itself free to strike back, so it rejects.',
      },
      cautious: {
        acceptable: [ACCEPT, REJECT],
        reason:
          'Cautious: loyalty 0.8 lets a rival make amends and costs it nothing, yet the break is on record, so either answer is defensible.',
      },
      opportunist: {
        acceptable: [REJECT],
        reason:
          'Opportunist: loyalty 0.2, a steady friend only while it suits: a promise from a rival that broke the last one is worth little, so it rejects.',
      },
    },
  },
  {
    group: 'promise-promiser-high-trust',
    description:
      'The human, who kept two promises to the AI, asks the AI to promise not to attack them, after asking for a truce.',
    role: 'promiser',
    trust: 'high',
    verdicts: {
      greedy: {
        acceptable: [ACCEPT],
        reason:
          'Greedy: loyalty 0.5 and aggression 0.3: it avoids fights it may lose and the rival has earned its trust, so it makes the promise.',
      },
      aggressive: {
        acceptable: [ACCEPT, REJECT],
        reason:
          'Aggressive: aggression 0.9 wants to stay free to strike, yet loyalty 0.4 and a rival that kept its word twice make a promise possible; either answer fits.',
      },
      cautious: {
        acceptable: [ACCEPT],
        reason:
          'Cautious: loyalty 0.8 and aggression 0.2: it keeps promises to protect a lead and the rival is trusted, so it makes the promise.',
      },
      opportunist: {
        acceptable: [ACCEPT, REJECT],
        reason:
          'Opportunist: loyalty 0.2 means a promise binds it only while it suits; a trusted rival makes it cheap, so either answer fits.',
      },
    },
  },
  {
    group: 'promise-promiser-low-trust',
    description:
      'The human, who broke a promise to the AI, asks the AI to promise not to attack them, after asking for a truce.',
    role: 'promiser',
    trust: 'low',
    verdicts: {
      greedy: {
        acceptable: [REJECT],
        reason:
          'Greedy: loyalty 0.5 does not stretch to binding itself for a rival that broke its own word; it rejects.',
      },
      aggressive: {
        acceptable: [REJECT],
        reason:
          'Aggressive: aggression 0.9 and loyalty 0.4: no reason to tie its hands for a rival that broke a promise to it, so it rejects.',
      },
      cautious: {
        acceptable: [ACCEPT, REJECT],
        reason:
          'Cautious: loyalty 0.8 keeps its own word even to a doubtful rival, but aggression 0.2 and the recorded break make rejecting safe too; either fits.',
      },
      opportunist: {
        acceptable: [REJECT],
        reason:
          'Opportunist: loyalty 0.2 and a rival that broke the last promise: binding itself for nothing does not pay, so it rejects.',
      },
    },
  },
];

const IDS: readonly PersonalityId[] = ['greedy', 'aggressive', 'cautious', 'opportunist'];

/** One table state per group, the same for every personality. */
const tableFor = (group: Group, seed: number) => () => ({
  state: promiseTable({
    seed,
    direction: group.role === 'recipient' ? 'offer' : 'ask',
    trust: group.trust === 'high' ? 2 : -2,
    history: group.trust === 'high' ? ['kept', 'kept'] : ['broken'],
    chats: [{ topic: 'truce' }],
  }),
});

/** Spec §8: 16 promise response scenarios, four tables by four personalities. */
export const PROMISE_SCENARIOS: readonly EvalScenario[] = GROUPS.flatMap((group, index) =>
  IDS.map((id): EvalScenario => ({
    id: `${id}-${group.group}`,
    description: group.description,
    personality: PERSONALITIES[id],
    build: tableFor(group, 41 + index),
    acceptable: group.verdicts[id].acceptable,
    reason: group.verdicts[id].reason,
  })),
);
