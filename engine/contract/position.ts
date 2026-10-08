/** Visible square from signed whole-square movement (spec §6.5). */
export function positionOf(routeProgress: number): number {
  return ((routeProgress % 24) + 24) % 24;
}
