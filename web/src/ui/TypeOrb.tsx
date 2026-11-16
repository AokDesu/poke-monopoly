import type { CSSProperties } from 'react';

import type { PokemonType } from '../game/content.ts';

const ICON: Record<PokemonType, string> = {
  grass: 'M8 21c0-9 5-14 13-15-1 8-6 13-13 15Zm0 0 7-8',
  fire: 'M12 21c-4 0-6-3-6-6 0-4 4-6 4-10 3 2 4 4 4 6 1-1 1-2 1-3 2 2 3 4 3 7 0 3-2 6-6 6Z',
  water: 'M12 3c3 5 6 8 6 11.5A6 6 0 0 1 6 14.5C6 11 9 8 12 3Z',
  bug: 'M12 7a4 4 0 0 1 4 4v4a4 4 0 0 1-8 0v-4a4 4 0 0 1 4-4Zm0 0V4m-3 1 1.5 2M15 5l-1.5 2M8 13H5m14 0h-3',
  electric: 'M13 3 6 13.5h5L10 21l8-11.5h-5L13 3Z',
  flying: 'M3 14c5 0 8-3 9-8 1 5 4 8 9 8-4 1-7 3-9 6-2-3-5-5-9-6Z',
  fighting:
    'M7 11V8a2 2 0 0 1 4 0V7a2 2 0 0 1 4 0v1a2 2 0 0 1 3 2v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6v-3Zm4-3v3m4-3v3',
  dragon: 'M12 3.5 19 10l-7 10.5L5 10l7-6.5Zm0 0V20.5M5 10h14',
  normal: 'M12 4.5 14.2 9l4.8.7-3.5 3.4.8 4.9-4.3-2.3L7.7 18l.8-4.9L5 9.7 9.8 9 12 4.5Z',
};

/** A lit sphere in the type colour with its type mark; decorative, the name is text nearby. */
export function TypeOrb({
  type,
  className = 'size-14',
}: {
  type: PokemonType;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`orb ${className}`}
      style={{ '--orb': `var(--color-type-${type})` } as CSSProperties}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-1/2 drop-shadow-[0_1px_1px_rgb(0_0_0/0.35)]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={ICON[type]} />
      </svg>
    </span>
  );
}
