import { z } from 'zod';

export const GYM_DCS = Object.freeze({ 6: 5, 12: 7, 18: 9 } as const);

/** Serializable pre-roll evidence, frozen recursively when parsed. No live state references. */
export const battleMemberSnapshotSchema = z
  .strictObject({
    instanceId: z.string().min(1),
    speciesId: z.string().min(1),
    // Current effective form's printed stat, including fallback evolution arithmetic.
    printedBattle: z.int().nonnegative(),
    battleBonus: z.int().nonnegative(),
    debuffs: z.int().nonnegative(),
    effectiveBattle: z.int(),
  })
  .refine(
    (member) =>
      member.effectiveBattle === member.printedBattle + member.battleBonus - member.debuffs,
    {
      message: 'Effective battle must match the confirmed member modifiers',
    },
  )
  .readonly();

export const combatantSnapshotSchema = z
  .strictObject({
    seatIndex: z.int().nonnegative(),
    member: battleMemberSnapshotSchema,
    classBonus: z.int(),
    abilityBonus: z.int().nonnegative(),
    itemBonus: z.int(),
    debuffs: z.int().nonnegative(),
  })
  .readonly();

export const pvpSnapshotSchema = z
  .strictObject({
    kind: z.literal('pvp'),
    attacker: combatantSnapshotSchema,
    defender: combatantSnapshotSchema,
  })
  .refine((snapshot) => snapshot.attacker.seatIndex !== snapshot.defender.seatIndex, {
    message: 'Cannot battle yourself',
  })
  .readonly();

export const gymSnapshotSchema = z
  .strictObject({
    kind: z.literal('gym'),
    challenger: combatantSnapshotSchema,
    position: z.union([z.literal(6), z.literal(12), z.literal(18)]),
    dc: z.union([z.literal(5), z.literal(7), z.literal(9)]),
  })
  .refine((snapshot) => snapshot.dc === GYM_DCS[snapshot.position], {
    message: 'Gym DC must match its board position',
  })
  .readonly();

export type BattleMemberSnapshot = z.infer<typeof battleMemberSnapshotSchema>;
export type CombatantSnapshot = z.infer<typeof combatantSnapshotSchema>;
export type PvpSnapshot = z.infer<typeof pvpSnapshotSchema>;
export type GymSnapshot = z.infer<typeof gymSnapshotSchema>;
