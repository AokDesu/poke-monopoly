import type { SimEngine } from './runner.ts';

/**
 * The real engine for `npm run sim`. Engine/ can create a game (`createGame`, issue #21) but cannot
 * yet report its end and winners (issue #25), so no game can finish: this stays null and the CLI
 * runs in rules-pending mode. Once #25 lands, bind `createGame`, `observe`, `legalActions`,
 * `applyAction` and `advanceAutomatically` from engine/index.ts here, and the CLI plays real games.
 */
export const realEngine: SimEngine | null = null;
