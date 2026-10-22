import { useSyncExternalStore } from 'react';

/** jsdom (tests) and old browsers have no WebGL 2: callers show their 2D fallback instead. */
export const hasWebGl = () => typeof WebGL2RenderingContext !== 'undefined';

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribe(listener: () => void) {
  if (typeof matchMedia === 'undefined') return () => {};
  const list = matchMedia(REDUCED);
  list.addEventListener('change', listener);
  return () => list.removeEventListener('change', listener);
}

/** True when the player asked for reduced motion: scenes then hold still. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typeof matchMedia !== 'undefined' && matchMedia(REDUCED).matches,
    () => false,
  );
}
