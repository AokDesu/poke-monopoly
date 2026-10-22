import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';
import type { SpaceKind } from '../Board3D.tsx';

interface MarkerProps {
  /** Top of the tile the marker stands on. */
  y: number;
  still: boolean;
}

/** Wild: a tuft of tall grass blades. */
function TallGrass({ y }: MarkerProps) {
  const blades: [number, number, number][] = [
    [-0.18, 0.32, -0.1],
    [0.05, 0.42, -0.18],
    [0.2, 0.3, 0.05],
    [-0.05, 0.36, 0.16],
    [-0.24, 0.26, 0.2],
  ];
  return (
    <group position={[0, y, 0]}>
      {blades.map(([x, height, z], index) => (
        <mesh key={index} position={[x, height / 2, z]} rotation={[0, 0, (index - 2) * 0.12]}>
          <coneGeometry args={[0.07, height, 5]} />
          <meshStandardMaterial color="#2f8f3a" roughness={0.7} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** Shop: a small house with a blue roof and a white awning. */
function Shop({ y }: MarkerProps) {
  return (
    <group position={[0, y, 0]}>
      <mesh castShadow position={[0, 0.2, 0]}>
        <boxGeometry args={[0.52, 0.4, 0.46]} />
        <meshStandardMaterial color="#fff8ec" roughness={0.6} />
      </mesh>
      <mesh castShadow position={[0, 0.54, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[0.46, 0.3, 4]} />
        <meshStandardMaterial color="#2b6fd6" roughness={0.5} flatShading />
      </mesh>
      <mesh position={[0, 0.12, 0.24]}>
        <boxGeometry args={[0.2, 0.24, 0.02]} />
        <meshStandardMaterial color="#2b6fd6" />
      </mesh>
    </group>
  );
}

/** Gym: a wide hall with a domed roof and a badge on top. */
function Gym({ y }: MarkerProps) {
  return (
    <group position={[0, y, 0]}>
      <mesh castShadow position={[0, 0.24, 0]}>
        <boxGeometry args={[0.7, 0.48, 0.6]} />
        <meshStandardMaterial color="#efe6ff" roughness={0.55} />
      </mesh>
      <mesh castShadow position={[0, 0.48, 0]}>
        <sphereGeometry args={[0.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#7a4ad0" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.88, 0]} rotation={[0, Math.PI / 4, 0]}>
        <octahedronGeometry args={[0.1]} />
        <meshStandardMaterial color="#ffc928" metalness={0.4} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.16, 0.301]}>
        <boxGeometry args={[0.2, 0.32, 0.02]} />
        <meshStandardMaterial color="#7a4ad0" />
      </mesh>
    </group>
  );
}

/** Event: a floating "mystery block" that turns slowly. */
function EventBlock({ y, still }: MarkerProps) {
  const block = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (still || !block.current) return;
    block.current.rotation.y = clock.elapsedTime * 0.8;
    block.current.position.y = y + 0.42 + Math.sin(clock.elapsedTime * 2) * 0.05;
  });
  return (
    <group ref={block} position={[0, y + 0.42, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.38, 0.38, 0.38]} />
        <meshStandardMaterial color="#ffb300" roughness={0.35} />
      </mesh>
      {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((turn) => (
        <mesh
          key={turn}
          rotation={[0, turn, 0]}
          position={[Math.sin(turn) * 0.192, 0, Math.cos(turn) * 0.192]}
        >
          <boxGeometry args={[0.16, 0.16, 0.01]} />
          <meshStandardMaterial color="#fff4c2" />
        </mesh>
      ))}
    </group>
  );
}

/** Start: a flag on a pole beside the pawns. */
function StartFlag({ y }: MarkerProps) {
  return (
    <group position={[-0.32, y, -0.32]}>
      <mesh castShadow position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.9, 8]} />
        <meshStandardMaterial color="#f7f9ff" />
      </mesh>
      <mesh castShadow position={[0.17, 0.76, 0]}>
        <boxGeometry args={[0.32, 0.2, 0.02]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0.17, 0.76, 0.012]}>
        <boxGeometry args={[0.1, 0.2, 0.01]} />
        <meshStandardMaterial color="#15264a" />
      </mesh>
    </group>
  );
}

const MARKERS: Record<SpaceKind, (props: MarkerProps) => React.JSX.Element> = {
  start: StartFlag,
  wild: TallGrass,
  event: EventBlock,
  shop: Shop,
  gym: Gym,
};

/** What a space is, shown on the tile itself; the DOM legend names each kind. */
export function SpaceMarker({ kind, y, still }: { kind: SpaceKind } & MarkerProps) {
  const Marker = MARKERS[kind];
  return <Marker y={y} still={still} />;
}
