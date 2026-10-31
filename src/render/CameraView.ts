import * as THREE from 'three';
import type { CameraPose } from '../camera/CameraRig';

/**
 * Copies the engine-free CameraPose from the CameraRig onto a three.js camera.
 * All camera behaviour lives in src/camera; this only applies the result.
 */
export class CameraView {
  readonly camera: THREE.PerspectiveCamera;

  constructor(aspect: number, fov = 60) {
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 200);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  apply(pose: CameraPose): void {
    const c = this.camera;
    c.position.set(pose.position.x, pose.position.y, pose.position.z);
    c.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
    // lookAt resets the roll, so add the dutch angle after it.
    if (pose.roll !== 0) c.rotateZ(-pose.roll);
    if (Math.abs(c.fov - pose.fov) > 1e-3) {
      c.fov = pose.fov;
      c.updateProjectionMatrix();
    }
  }
}
