import type { SimEngine } from './runner.ts';

/**
 * The real engine for `npm run sim`. Engine/ cannot yet create a game (issue #21) or report its
 * end and winners (issue #25), so this stays null and the CLI runs in rules-pending mode. Once
 * both land, bind them here with `observe`, `legalActions`, `applyAction` and
 * `advanceAutomatically` from engine/index.ts, and the CLI plays real games.
 */
export const realEngine: SimEngine | null = null;
