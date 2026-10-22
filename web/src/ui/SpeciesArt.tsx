import { lazy, Suspense } from 'react';
import { speciesType } from '../game/content.ts';
import { SPECIES_MODELS } from '../game/models.ts';
import { hasWebGl, useReducedMotion } from './three/support.ts';
import { TypeOrb } from './TypeOrb.tsx';

const SpeciesStage = lazy(() => import('./three/SpeciesStage.tsx'));

interface SpeciesArtProps {
  speciesIds: readonly string[];
  /** The selected card turns its models. */
  spin?: boolean;
}

function Orbs({ speciesIds }: { speciesIds: readonly string[] }) {
  return (
    <span className="flex items-center justify-center gap-1">
      {speciesIds.map((id) => (
        <TypeOrb key={id} type={speciesType(id)} className="size-12" />
      ))}
    </span>
  );
}

/**
 * The Starters of a class as 3D models when every one has a licensed model and WebGL exists,
 * otherwise as type orbs. Decorative: the species names are always text beside it.
 */
export function SpeciesArt({ speciesIds, spin = false }: SpeciesArtProps) {
  const still = useReducedMotion();
  const files = speciesIds.map((id) => SPECIES_MODELS[id]?.file);
  const modelled = files.every((file) => file !== undefined);
  return (
    <span
      aria-hidden="true"
      className={`grid h-28 place-items-center rounded-2xl bg-[radial-gradient(circle_at_50%_70%,#e3f6d8,#c9ecff)] ${
        speciesIds.length > 1 ? 'w-44 sm:w-52' : 'w-28'
      }`}
    >
      {modelled && hasWebGl() ? (
        <Suspense fallback={<Orbs speciesIds={speciesIds} />}>
          <SpeciesStage files={files as string[]} spin={spin} still={still} />
        </Suspense>
      ) : (
        <Orbs speciesIds={speciesIds} />
      )}
    </span>
  );
}
