import * as THREE from 'three';
import type { ArenaLayout } from '../app/arena';
import type { StageId } from '../app/stages';
import { faceLighting, STAGE_BUILDERS, type BuiltStage } from './stages';

/** What PostFx needs to know when the stage changes. */
export interface StageLook {
  bloom: { strength: number; threshold: number };
}

/**
 * Renderer and scene, plus the current stage (src/render/stages): meshes, lights, sky and
 * fog. Every stage builds from the same ArenaLayout as the physics colliders, so switching
 * the look never changes where she can walk.
 */
export class ArenaView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private stage: BuiltStage | null = null;
  private stageId: StageId | null = null;
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private faceLightFor: (normal: THREE.Vector3) => number = () => 1;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly layout: ArenaLayout,
    private readonly reducedMotion: boolean,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // r187 dropped PCFSoft; PCF is filtered too
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
  }

  get current(): StageId | null {
    return this.stageId;
  }

  /** Builds the new stage, then drops the old one and frees its GPU memory. */
  setStage(id: StageId): StageLook {
    const next = STAGE_BUILDERS[id](this.layout, { reducedMotion: this.reducedMotion });
    if (this.stage) {
      this.scene.remove(this.stage.root);
      this.stage.dispose();
    }
    this.envTarget?.dispose();
    this.envTarget = null;

    this.stage = next;
    this.stageId = id;
    this.scene.add(next.root);
    this.scene.background = next.background;
    this.scene.fog = next.fog;
    this.renderer.toneMappingExposure = next.exposure;
    if (next.envScene) {
      // Sky as image based light: soft fill from above, warm on the sun side.
      this.envTarget = this.pmrem.fromScene(next.envScene, 0, 1, 1000);
      this.scene.environment = this.envTarget.texture;
      this.scene.environmentIntensity = next.envIntensity;
    } else {
      this.scene.environment = null;
    }
    this.faceLightFor = faceLighting(next);
    return { bloom: next.bloom };
  }

  /** How bright her unlit eyes should be for a face pointing along `normal` (see faceLight.ts). */
  faceLight(normal: THREE.Vector3): number {
    return this.faceLightFor(normal);
  }

  /** Wind, clouds, flames. Real seconds. */
  update(time: number): void {
    this.stage?.update(time);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
  }

  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }
}
