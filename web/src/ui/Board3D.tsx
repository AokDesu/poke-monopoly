import { lazy, Suspense } from 'react';
import { t } from '../i18n/en.ts';
import { hasWebGl, useReducedMotion } from './three/support.ts';

export type SpaceKind = 'start' | 'wild' | 'event' | 'shop' | 'gym';
export interface BoardSpace {
  readonly position: number;
  readonly kind: SpaceKind;
}

// Three.js loads in its own chunk, only where WebGL exists (not in jsdom tests).
const BoardScene = lazy(() => import('./three/BoardScene.tsx'));
const LEGEND: readonly SpaceKind[] = ['start', 'wild', 'event', 'shop', 'gym'];

/**
 * The content board as a lit 3D toy board, with its legend as plain text. The scene is
 * decorative: everything it shows is also in the legend, so a device without WebGL loses nothing.
 */
export function Board3D({ board }: { board: readonly BoardSpace[] }) {
  const still = useReducedMotion();
  return (
    <figure className="flex flex-col items-center gap-4">
      <div
        aria-hidden="true"
        className="aspect-[5/4] w-full max-w-[34rem] [mask-image:radial-gradient(ellipse_closest-side,#000_70%,transparent)]"
      >
        {hasWebGl() && (
          <Suspense fallback={null}>
            <BoardScene board={board} still={still} />
          </Suspense>
        )}
      </div>
      <figcaption>
        <span className="sr-only">{t('home.boardCaption')}</span>
        <ul className="flex flex-wrap justify-center gap-2 text-sm font-bold">
          {LEGEND.map((kind) => (
            <li
              key={kind}
              className="flex items-center gap-2 rounded-full bg-panel/85 py-1 ps-1.5 pe-3 shadow-[0_3px_0_var(--color-panel-lip)]"
            >
              <span
                aria-hidden="true"
                className="size-4 rounded-full"
                style={{ background: `var(--color-kind-${kind})` }}
              />
              {t(`board.kind.${kind}`)}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
