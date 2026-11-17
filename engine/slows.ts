import type { Player } from './contract/schema.ts';

/** Pending slows by source (§4.6, Appendix C.5 D8): `minus` subtracts, `cap` limits. */
export const SLOWS = {
  repel: { kind: 'minus', n: 2 },
  string_shot: { kind: 'minus', n: 1 },
  sticky_web: { kind: 'cap', n: 2 },
} as const;

export type SlowId = keyof typeof SLOWS;
export type SlowKind = (typeof SLOWS)[SlowId]['kind'];

/** The same kind never stacks on a target that still has it pending (§4.6, D8). */
export function hasSlowKind(player: Player, kind: SlowKind): boolean {
  return (player.pendingSlows ?? []).some((slow) => SLOWS[slow].kind === kind);
}

export function addSlow(target: Player, slow: SlowId): void {
  if (hasSlowKind(target, SLOWS[slow].kind)) throw new RangeError('Target is already slowed');
  target.pendingSlows = [...(target.pendingSlows ?? []), slow];
}

/**
 * Steps for the owner's next actual move from value `v` (the d6 after any reroll, or a fixed move):
 * `max(1, min(v − minus, cap))`, after which every pending slow clears (§4.6, D8). Displacement is
 * not an actual move and never calls this (D9).
 */
export function slowedSteps(player: Player, value: number): number {
  let minus = 0;
  let cap = Infinity;
  for (const slow of player.pendingSlows ?? []) {
    const { kind, n } = SLOWS[slow];
    if (kind === 'minus') minus += n;
    else cap = Math.min(cap, n);
  }
  delete player.pendingSlows;
  return Math.max(1, Math.min(value - minus, cap));
}
