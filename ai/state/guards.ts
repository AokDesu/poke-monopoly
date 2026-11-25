export const STATE_TOKEN_BUDGET = 4_000;

// Exact paths: an arbitrary nested field named "id" is not an exemption.
const identifierPaths = [
  /^you\.seat_id$/,
  /^opponents\[\d+\]\.seat_id$/,
  /^board\[\d+\]\.space_id$/,
  /^active_seat_id$/,
];

// Engine IDs are opaque strings and may consist entirely of digits.
const stringIdentifierPaths = [
  /^(?:you|opponents\[\d+\])\.(?:id|class_id)$/,
  /^(?:you|opponents\[\d+\])\.team\[\d+\]\.(?:id|species_id)$/,
  /^you\.items\[\d+\]\.(?:id|item_id)$/,
  /^opponents\[\d+\]\.known_items\[\d+\]\.(?:id|item_id)$/,
  /^you\.private_results\[\d+\]\.event_id$/,
  // The promise question's seats and the asker's quoted chat name actors by the same opaque ID.
  /^promise_offer\.(?:asked_by_id|promiser_id|recipient_id)$/,
  /^recent_chat\[\d+\]\.from$/,
  // A battle question names the other seat in the same way: the challenger, the winner's loser,
  // the opponent of a window and the active seat that used a Pickpocket.
  /^challenge\.from_id$/,
  /^reward\.loser_id$/,
  /^window\.(?:opponent_id|attacker_id)$/,
];

/** Reject raw numeric data, including numeric strings; rank/Lap labels are prose. */
export function assertNoComparableNumbers(state: unknown): void {
  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'string' && stringIdentifierPaths.some((pattern) => pattern.test(path)))
      return;
    if (
      typeof value === 'number' ||
      (typeof value === 'string' && /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(value))
    ) {
      if (
        !identifierPaths.some((pattern) => pattern.test(path)) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < 0
      ) {
        throw new TypeError(`Comparable number at ${path || '<root>'}`);
      }
    } else if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    } else if (value !== null && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        visit(entry, path ? `${path}.${key}` : key);
      }
    }
  };
  visit(state, '');
}

export function estimateStateTokens(state: unknown): number {
  const serialized = JSON.stringify(state);
  if (serialized === undefined) throw new TypeError('State must be JSON serializable');
  return serialized.length / 4;
}

export function assertStateTokenBudget(state: unknown): void {
  if (estimateStateTokens(state) > STATE_TOKEN_BUDGET) {
    throw new RangeError('Jev state exceeds the 4,000-token budget');
  }
}
