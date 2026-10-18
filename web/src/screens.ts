/** The spec §3 screen flow, in order. A plain state value; there is no router. */
export const SCREENS = ['home', 'setup', 'play', 'results'] as const;

export type Screen = (typeof SCREENS)[number];
