import { describe, expect, test } from 'vitest';
import { parseSimArgs } from './args.ts';
import {
  EXPLOIT_POLICY_IDS,
  POLICIES,
  RandomPolicy,
  type Policy,
  type PolicyFactory,
} from './policy.ts';
import { reproduceCommand, seatPolicies, type SeatSetup } from './runner.ts';

const seat = (seatIndex: number): SeatSetup => ({
  seatIndex,
  actorId: `a${seatIndex}`,
  classId: 'c',
});
const game = { seed: 7 };

/** A registry whose every policy remembers the name it was built under. */
function named(): Record<string, PolicyFactory> {
  return Object.fromEntries(
    ['random', 'fallback', 'a', 'b', 'c'].map((name) => [
      name,
      () => ({ name, decide: () => 'x' }) as unknown as Policy,
    ]),
  );
}
const built = (policy: Policy) => (policy as unknown as { name: string }).name;

describe('per-seat policy selection (§8 Simulation)', () => {
  test('without options every seat plays --policy, as before', () => {
    const pick = seatPolicies({ policy: 'fallback', seats: 3 }, named());
    expect([0, 1, 2].map((i) => built(pick(seat(i), game)))).toEqual([
      'fallback',
      'fallback',
      'fallback',
    ]);
  });

  test('--seat-policies picks one policy per seat', () => {
    const pick = seatPolicies(
      { policy: 'fallback', seats: 3, seatPolicies: ['a', 'b', 'c'] },
      named(),
    );
    expect([0, 1, 2].map((i) => built(pick(seat(i), game)))).toEqual(['a', 'b', 'c']);
  });

  test('--social seats the human at 0 on random, or on --human-policy', () => {
    const base = { policy: 'fallback', seats: 2, social: true } as const;
    expect(built(seatPolicies(base, named())(seat(0), game))).toBe('random');
    expect(built(seatPolicies(base, named())(seat(1), game))).toBe('fallback');
    const human = seatPolicies({ ...base, humanPolicy: 'b', seatPolicies: ['a', 'c'] }, named());
    expect(built(human(seat(0), game))).toBe('b');
    expect(built(human(seat(1), game))).toBe('c');
  });

  test('the real human default is the random policy', () => {
    const pick = seatPolicies({ policy: 'sell-all', seats: 2, social: true }, POLICIES);
    expect(pick(seat(0), game)).toBeInstanceOf(RandomPolicy);
  });

  test('--human-seats applies the human policy to each scripted seat', () => {
    const pick = seatPolicies(
      {
        policy: 'fallback',
        seats: 4,
        humanSeats: 2,
        humanPolicy: 'b',
        seatPolicies: ['a', 'a', 'c', 'a'],
      },
      named(),
    );
    expect([0, 1, 2, 3].map((i) => built(pick(seat(i), game)))).toEqual(['b', 'b', 'c', 'a']);
  });

  test('an unknown name or a wrong count is an error before any game', () => {
    expect(() => seatPolicies({ policy: 'nope', seats: 2 }, named())).toThrow(
      'Unknown policy: nope',
    );
    expect(() =>
      seatPolicies({ policy: 'a', seats: 2, seatPolicies: ['a', 'zz'] }, named()),
    ).toThrow('Unknown policy: zz');
    expect(() => seatPolicies({ policy: 'a', seats: 3, seatPolicies: ['a'] }, named())).toThrow(
      '--seat-policies needs 3 names; got 1',
    );
    expect(() =>
      seatPolicies({ policy: 'a', seats: 2, social: true, humanPolicy: 'toString' }, named()),
    ).toThrow('Unknown policy: toString');
  });

  test('every exploit selector works as --policy, --seat-policies and --human-policy', () => {
    for (const id of EXPLOIT_POLICY_IDS) {
      expect(parseSimArgs(['--policy', id]).policy).toBe(id);
      expect(
        parseSimArgs(['--seats', '2', '--seat-policies', `${id},random`]).seatPolicies,
      ).toEqual([id, 'random']);
      expect(parseSimArgs(['--social', '--human-policy', id]).humanPolicy).toBe(id);
    }
  });
});

describe('the new flags in the CLI', () => {
  test('default options are unchanged', () => {
    const options = parseSimArgs([]);
    expect(options).not.toHaveProperty('seatPolicies');
    expect(options).not.toHaveProperty('humanPolicy');
  });

  test('bad values are range errors', () => {
    expect(() => parseSimArgs(['--human-policy', 'random'])).toThrow(
      '--human-policy needs --social',
    );
    expect(() => parseSimArgs(['--social', '--human-policy', 'nope'])).toThrow(
      '--human-policy must be one of',
    );
    expect(() => parseSimArgs(['--human-seats', '0'])).toThrow('--human-seats');
    expect(() => parseSimArgs(['--human-seats', '1.5'])).toThrow('--human-seats');
    expect(() => parseSimArgs(['--seats', '3', '--human-seats', '4'])).toThrow('--human-seats');
    expect(() => parseSimArgs(['--seats', '2', '--seat-policies', 'random'])).toThrow(
      '--seat-policies needs 2 names; got 1',
    );
    expect(() => parseSimArgs(['--seats', '2', '--seat-policies', 'random,nope'])).toThrow(
      '--seat-policies must be one of',
    );
    expect(() => parseSimArgs(['--seats', '2', '--seat-policies', 'random,constructor'])).toThrow(
      '--seat-policies must be one of',
    );
  });

  test('a reproduce command carries the per-seat flags', () => {
    const options = parseSimArgs([
      ...['--seats', '2', '--social', '--seat-policies', 'sell-all,fallback'],
      ...['--human-policy', 'never-negotiate'],
    ]);
    const command = reproduceCommand(options, 5);
    expect(command).toContain('--seat-policies sell-all,fallback');
    expect(command).toContain('--human-policy never-negotiate');
    expect(parseSimArgs(command.replace(/^npm run sim -- /, '').split(' '))).toMatchObject({
      seatPolicies: ['sell-all', 'fallback'],
      humanPolicy: 'never-negotiate',
      seed: 5,
    });
  });

  test('a reproduce command carries the human count and policy without --social', () => {
    const options = parseSimArgs([
      '--seats',
      '4',
      '--human-seats',
      '2',
      '--human-policy',
      'always-pvp',
    ]);
    const command = reproduceCommand(options, 5);
    expect(parseSimArgs(command.replace(/^npm run sim -- /, '').split(' '))).toMatchObject({
      humanSeats: 2,
      humanPolicy: 'always-pvp',
      seed: 5,
    });
  });
});
