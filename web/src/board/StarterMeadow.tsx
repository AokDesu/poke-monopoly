import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { SPECIES_MODELS } from '../game/models.ts';
import { FittedModel } from '../ui/three/Model.tsx';
import { Scenery } from '../ui/three/Scenery.tsx';

const STARTERS = [
  { id: 'bulbasaur', x: -1.4, z: 0.6 },
  { id: 'charmander', x: 1.4, z: -0.4 },
  { id: 'squirtle', x: 0.3, z: 1.5 },
  { id: 'porygon', x: -0.7, z: -1.4 },
] as const;

/** Decorative diorama only: no game state, tokens, labels or animation live in WebGL. */
export default function StarterMeadow() {
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ position: [6.5, 7, 8], fov: 35 }}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
      frameloop="demand"
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
    >
      <hemisphereLight args={['#dff4ff', '#5d9e3a', 1.5]} />
      <directionalLight
        castShadow
        position={[4, 9, 5]}
        intensity={2.2}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
      />
      <group scale={0.42}>
        <Scenery startX={0} startZ={0} />
      </group>
      <Suspense fallback={null}>
        {STARTERS.map(({ id, x, z }) => (
          <FittedModel
            key={id}
            file={SPECIES_MODELS[id]!.file}
            height={1.6}
            position={[x, -0.16, z]}
            rotationY={Math.PI + 0.5}
          />
        ))}
      </Suspense>
    </Canvas>
  );
}
