import type { PeopleStep, WatchStep } from './game/setup.ts';

/** Spec §3 setup, from the mode choice to the first-player roll; the board follows. */
export const SETUP_STEPS = ['mode', 'class', 'opponents', 'review', 'firstPlayer'] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

/** The spec §3 flow as a plain state value; there is no router. */
export type Route =
  | { readonly screen: 'home' | 'presets' | 'play' | 'results' | 'credits' | 'demo' }
  | { readonly screen: 'setup'; readonly step: SetupStep }
  | { readonly screen: 'watch'; readonly step: WatchStep }
  /** Setup with several people (spec §3); `seat` is the person whose class is being chosen. */
  | { readonly screen: 'people'; readonly step: PeopleStep; readonly seat?: number };
