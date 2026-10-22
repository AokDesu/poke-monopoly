/** A low-poly tree: trunk and two stacked crowns. */
function Tree({ x, z, scale = 1 }: { x: number; z: number; scale?: number }) {
  return (
    <group position={[x, -0.4, z]} scale={scale}>
      <mesh castShadow position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.1, 0.14, 0.6, 6]} />
        <meshStandardMaterial color="#8a5a33" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0, 0.9, 0]}>
        <coneGeometry args={[0.55, 0.9, 7]} />
        <meshStandardMaterial color="#2f9a45" roughness={0.75} flatShading />
      </mesh>
      <mesh castShadow position={[0, 1.35, 0]}>
        <coneGeometry args={[0.4, 0.7, 7]} />
        <meshStandardMaterial color="#3fb257" roughness={0.75} flatShading />
      </mesh>
    </group>
  );
}

function Rock({ x, z, scale = 1 }: { x: number; z: number; scale?: number }) {
  return (
    <mesh castShadow position={[x, -0.3, z]} scale={[scale, scale * 0.7, scale]}>
      <dodecahedronGeometry args={[0.28]} />
      <meshStandardMaterial color="#a3adbd" roughness={0.9} flatShading />
    </mesh>
  );
}

const TREES = [
  { x: -6.2, z: -3.4, scale: 1.2 },
  { x: -5.6, z: -5.2, scale: 0.9 },
  { x: -3.6, z: -6.1, scale: 1.1 },
  { x: 4.6, z: -6.0, scale: 1.25 },
  { x: 6.3, z: -4.2, scale: 1 },
  { x: -6.4, z: 2.6, scale: 1 },
  { x: 6.1, z: 1.4, scale: 0.85 },
];
const ROCKS = [
  { x: -5.1, z: 0.6, scale: 1.2 },
  { x: 5.3, z: -2.0, scale: 1 },
  { x: -1.4, z: -5.8, scale: 0.9 },
  { x: 2.2, z: 5.6, scale: 0.8 },
];

/** The meadow around the board: ground, a dirt path to Start, trees and rocks. */
export function Scenery({ startX, startZ }: { startX: number; startZ: number }) {
  return (
    <group>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.41, 0]}>
        <circleGeometry args={[9, 48]} />
        <meshStandardMaterial color="#8fd86a" roughness={1} />
      </mesh>
      {/* A dirt path leading out from the Start corner. */}
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, -Math.PI / 4]}
        position={[startX + 2.2, -0.4, startZ + 2.2]}
      >
        <planeGeometry args={[0.9, 4.6]} />
        <meshStandardMaterial color="#d8b17a" roughness={1} />
      </mesh>
      {TREES.map((tree) => (
        <Tree key={`${tree.x}:${tree.z}`} {...tree} />
      ))}
      {ROCKS.map((rock) => (
        <Rock key={`${rock.x}:${rock.z}`} {...rock} />
      ))}
    </group>
  );
}
