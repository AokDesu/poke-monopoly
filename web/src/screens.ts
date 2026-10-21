/** The spec §3 screen flow, in order. A plain state value; there is no router. */
export const SCREENS = ['home', 'setup', 'play', 'results'] as const;

export type Screen = (typeof SCREENS)[number];

/** Spec §3 setup, from the mode choice to the first-player roll; the board follows. */
export const SETUP_STEPS = ['mode', 'class', 'opponents', 'review', 'firstPlayer'] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

export type Route =
  | { readonly screen: 'home' | 'play' | 'results' }
  | { readonly screen: 'setup'; readonly step: SetupStep };
