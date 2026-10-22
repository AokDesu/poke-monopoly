import { Canvas, useFrame } from '@react-three/fiber';
import { Float, RoundedBox } from '@react-three/drei';
import { Suspense, useRef } from 'react';
import type { Group } from 'three';
import { BALL_MODEL, SPECIES_MODELS } from '../../game/models.ts';
import type { BoardSpace, SpaceKind } from '../Board3D.tsx';
import { SpaceMarker } from './BoardMarkers.tsx';
import { FittedModel } from './Model.tsx';
import { Scenery } from './Scenery.tsx';

// Read once from the theme so the scene and the DOM legend share colours.
const KIND_COLOR: Record<SpaceKind, string> = {
  start: '#d3301f',
  wild: '#6cc54a',
  event: '#ffc928',
  shop: '#45a4f0',
  gym: '#9a6ae0',
};
const KIND_HEIGHT: Record<SpaceKind, number> = {
  start: 0.32,
  wild: 0.2,
  event: 0.24,
  shop: 0.28,
  gym: 0.42,
};
// The four Starters stand on the inner field, facing the camera.
const CAMERA: [number, number, number] = [9.2, 10.2, 11.2];
const STARTERS = [
  { id: 'bulbasaur', x: -1.6, z: 0.5 },
  { id: 'squirtle', x: 0.5, z: 1.6 },
  { id: 'charmander', x: 1.6, z: -0.6 },
  { id: 'porygon', x: -0.5, z: -1.6 },
] as const;
const TILE = 1;
const GAP = 0.14;

/** Where a square sits on a square loop: Start at one corner, a quarter of the board per side. */
function tilePosition(position: number, length: number): [number, number] {
  const side = length / 4;
  const step = position % side;
  const half = side / 2;
  const at = (n: number) => (n - half) * (TILE + GAP);
  switch (Math.floor(position / side)) {
    case 0:
      return [at(side - step), at(side)];
    case 1:
      return [at(0), at(side - step)];
    case 2:
      return [at(step), at(0)];
    default:
      return [at(side), at(step)];
  }
}

/** A player pawn: a rounded cone with a head, in the seat's colour. */
function Pawn({ color, x, y, z }: { color: string; x: number; y: number; z: number }) {
  return (
    <group position={[x, y, z]}>
      <mesh castShadow position={[0, 0.3, 0]}>
        <coneGeometry args={[0.2, 0.5, 32]} />
        <meshStandardMaterial color={color} roughness={0.35} />
      </mesh>
      <mesh castShadow position={[0, 0.62, 0]}>
        <sphereGeometry args={[0.14, 32, 16]} />
        <meshStandardMaterial color={color} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Board({ board, still }: { board: readonly BoardSpace[]; still: boolean }) {
  const group = useRef<Group>(null);
  const size = (board.length / 4 + 1) * (TILE + GAP) + 0.5;
  const [startX, startZ] = tilePosition(0, board.length);
  const startHeight = KIND_HEIGHT.start;

  useFrame(({ clock }) => {
    if (still || !group.current) return;
    group.current.rotation.y = Math.sin(clock.elapsedTime * 0.25) * 0.08;
  });

  return (
    <group ref={group}>
      <Scenery startX={startX} startZ={startZ} />
      <RoundedBox args={[size, 0.4, size]} radius={0.22} position={[0, -0.2, 0]} receiveShadow>
        <meshStandardMaterial color="#7fd05a" roughness={0.8} />
      </RoundedBox>
      {board.map(({ position, kind }) => {
        const [x, z] = tilePosition(position, board.length);
        const height = KIND_HEIGHT[kind];
        return (
          <group key={position}>
            <RoundedBox
              args={[TILE, height, TILE]}
              radius={0.08}
              smoothness={3}
              position={[x, height / 2, z]}
              castShadow
              receiveShadow
            >
              <meshStandardMaterial color={KIND_COLOR[kind]} roughness={0.45} />
            </RoundedBox>
            <group position={[x, 0, z]}>
              <SpaceMarker kind={kind} y={height} still={still} />
            </group>
          </group>
        );
      })}
      <Pawn color="#d3301f" x={startX - 0.2} y={startHeight} z={startZ - 0.16} />
      <Pawn color="#2f6feb" x={startX + 0.2} y={startHeight} z={startZ + 0.16} />
      <Suspense fallback={null}>
        {STARTERS.map(({ id, x, z }) => (
          <FittedModel
            key={id}
            file={SPECIES_MODELS[id]!.file}
            height={1.5}
            position={[x, 0, z]}
            // The models face -z; turn each one toward the camera.
            rotationY={Math.atan2(CAMERA[0] - x, CAMERA[2] - z) + Math.PI}
          />
        ))}
        <Float
          speed={still ? 0 : 2}
          rotationIntensity={still ? 0 : 0.6}
          floatIntensity={still ? 0 : 0.8}
        >
          <FittedModel
            file={BALL_MODEL.file}
            height={0.9}
            position={[0.9, 1.9, 0.9]}
            rotationY={-0.6}
          />
        </Float>
      </Suspense>
    </group>
  );
}

export default function BoardScene({
  board,
  still,
}: {
  board: readonly BoardSpace[];
  still: boolean;
}) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: CAMERA, fov: 34 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      frameloop={still ? 'demand' : 'always'}
      onCreated={({ camera }) => camera.lookAt(0, 0.3, 0)}
    >
      <hemisphereLight args={['#dff4ff', '#5d9e3a', 1.1]} />
      <directionalLight
        castShadow
        position={[5, 10, 4]}
        intensity={2.2}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
      />
      <Board board={board} still={still} />
    </Canvas>
  );
}
