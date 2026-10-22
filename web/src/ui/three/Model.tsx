import { useGLTF } from '@react-three/drei';
import { useMemo } from 'react';
import { Box3, Group, type Mesh, Vector3 } from 'three';

interface FittedModelProps {
  file: string;
  /** World height the model is scaled to, standing on y = 0 and centred on x/z. */
  height: number;
  position?: [number, number, number];
  rotationY?: number;
}

/** A licensed GLB (web/public/models), cloned so several copies can share one download. */
export function FittedModel({ file, height, position, rotationY = 0 }: FittedModelProps) {
  const { scene } = useGLTF(file);
  const object = useMemo(() => {
    const model = scene.clone(true);
    const size = new Box3().setFromObject(model).getSize(new Vector3());
    model.scale.setScalar(height / Math.max(size.y, 1e-6));
    const box = new Box3().setFromObject(model);
    const center = box.getCenter(new Vector3());
    model.position.set(-center.x, -box.min.y, -center.z);
    model.traverse((child) => {
      if ((child as Mesh).isMesh) child.castShadow = true;
    });
    const holder = new Group();
    holder.add(model);
    return holder;
  }, [scene, height]);
  return <primitive object={object} position={position} rotation={[0, rotationY, 0]} />;
}
