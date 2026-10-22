import { ContactShadows } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useRef } from 'react';
import type { Group } from 'three';
import { FittedModel } from './Model.tsx';

interface SpeciesStageProps {
  files: readonly string[];
  /** Turns the models slowly, for the selected card. */
  spin: boolean;
  still: boolean;
}

function Lineup({ files, spin, still }: SpeciesStageProps) {
  const group = useRef<Group>(null);
  const gap = 1.25;
  useFrame(({ clock }, delta) => {
    if (!group.current || still) return;
    group.current.children.forEach((child, index) => {
      child.rotation.y = spin
        ? child.rotation.y + delta * 0.9
        : Math.PI + 0.35 + Math.sin(clock.elapsedTime * 0.8 + index) * 0.25;
    });
  });
  return (
    <group ref={group}>
      {files.map((file, index) => (
        <group key={file} position={[(index - (files.length - 1) / 2) * gap, 0, 0]}>
          <FittedModel file={file} height={1} rotationY={Math.PI + 0.35} />
        </group>
      ))}
    </group>
  );
}

/** A small turntable of Starter models for a class card; decorative, the names are text. */
export default function SpeciesStage(props: SpeciesStageProps) {
  const wide = props.files.length > 1;
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 1.1, wide ? 4.6 : 2.6], fov: 32 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      frameloop={props.still ? 'demand' : 'always'}
      onCreated={({ camera }) => camera.lookAt(0, 0.45, 0)}
    >
      <hemisphereLight args={['#ffffff', '#88b86a', 1.4]} />
      <directionalLight position={[2, 4, 3]} intensity={1.8} />
      <Suspense fallback={null}>
        <Lineup {...props} />
      </Suspense>
      <ContactShadows position={[0, 0, 0]} opacity={0.35} scale={6} blur={2} far={1.5} />
    </Canvas>
  );
}
