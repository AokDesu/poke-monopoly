/** Spec §3 setup, from the mode choice to the first-player roll; the board follows. */
export const SETUP_STEPS = ['mode', 'class', 'opponents', 'review', 'firstPlayer'] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

/** The spec §3 flow as a plain state value; there is no router. */
export type Route =
  | { readonly screen: 'home' | 'play' | 'results' | 'credits' }
  | { readonly screen: 'setup'; readonly step: SetupStep };
