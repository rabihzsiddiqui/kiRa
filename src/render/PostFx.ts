import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { GradeParams } from '../feel/PostGrade';

/**
 * Objects on this layer keep their color while the world is graded (her body, her
 * afterimages). Enable it on top of layer 0: `obj.layers.enable(KEEP_COLOR_LAYER)`.
 */
export const KEEP_COLOR_LAYER = 1;

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tMask: { value: null as THREE.Texture | null },
    saturation: { value: 1 },
    tint: { value: 0 },
    tintColor: { value: new THREE.Color(0.62, 0.66, 1.0) }, // cool indigo multiply
    aberration: { value: 0 },
    radialBlur: { value: 0 },
    center: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tMask;
    uniform float saturation;
    uniform float tint;
    uniform vec3 tintColor;
    uniform float aberration;
    uniform float radialBlur;
    uniform vec2 center;
    varying vec2 vUv;

    // Chromatic aberration: red and blue pushed apart along the line from the center.
    vec3 sampleSplit(vec2 uv) {
      vec2 d = (uv - center) * aberration * 0.014;
      return vec3(texture2D(tDiffuse, uv + d).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d).b);
    }

    void main() {
      vec3 col;
      if (radialBlur > 0.001) {
        // Zoom blur toward her: average samples pulled in along the line to the center.
        vec2 toCenter = vUv - center;
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 10; i++) {
          acc += sampleSplit(vUv - toCenter * (float(i) / 9.0) * radialBlur * 0.06);
        }
        col = acc / 10.0;
      } else {
        col = sampleSplit(vUv);
      }

      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 graded = mix(vec3(luma), col, saturation);
      graded *= mix(vec3(1.0), tintColor, tint * 2.0);

      // She keeps her color: the mask is white where she is drawn.
      float keep = texture2D(tMask, vUv).r;
      gl_FragColor = vec4(mix(graded, col, keep), 1.0);
    }`,
};

/**
 * Post-processing stack on three's own add-ons:
 *   render -> bloom -> grade (desaturate + tint, aberration, radial blur) -> output (tone map, sRGB)
 *
 * The grade's numbers come from PostGrade (src/feel), so this file only applies them.
 */
export class PostFx {
  private readonly composer: EffectComposer;
  private readonly grade: ShaderPass;
  private readonly mask: THREE.WebGLRenderTarget;
  private readonly black = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
  private readonly white = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  private maskClear = true;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    reducedMotion: boolean,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    // MSAA on the composer's target: the canvas's own antialias does not apply here.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    // Subtle: only bright emissive and additive things (sparks, glints, slash arcs) bloom.
    this.composer.addPass(new UnrealBloomPass(size, reducedMotion ? 0.35 : 0.55, 0.4, 0.88));
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.mask = new THREE.WebGLRenderTarget(Math.max(1, size.x / 2), Math.max(1, size.y / 2));
    this.grade.uniforms.tMask.value = this.mask.texture;
  }

  setSize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    const ratio = this.renderer.getPixelRatio();
    this.mask.setSize(Math.max(1, (width * ratio) / 2), Math.max(1, (height * ratio) / 2));
  }

  /** `focus` = her position in UV space (0..1), the center of the blur and aberration. */
  render(params: GradeParams, focus: THREE.Vector2, dt: number): void {
    const u = this.grade.uniforms;
    u.saturation.value = params.saturation;
    u.tint.value = params.tint;
    u.aberration.value = params.aberration;
    u.radialBlur.value = params.radialBlur;
    u.center.value.copy(focus);

    // The mask only matters while the world is graded; skip the extra pass otherwise.
    if (params.saturation < 0.999 || params.tint > 0.001) this.renderMask();
    else if (!this.maskClear) this.clearMask();

    this.composer.render(dt);
  }

  /**
   * Everything in black (so walls in front of her still hide her), then only the
   * keep-color layer in white, depth tested against that first pass.
   */
  private renderMask(): void {
    const { renderer, scene, camera } = this;
    const bg = scene.background;
    const prevLayers = camera.layers.mask;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;

    scene.background = null;
    renderer.setRenderTarget(this.mask);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.autoClear = false;

    scene.overrideMaterial = this.black;
    renderer.render(scene, camera);
    scene.overrideMaterial = this.white;
    camera.layers.set(KEEP_COLOR_LAYER);
    renderer.render(scene, camera);

    scene.overrideMaterial = null;
    camera.layers.mask = prevLayers;
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
    scene.background = bg;
    this.maskClear = false;
  }

  private clearMask(): void {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.mask);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.setRenderTarget(prev);
    this.maskClear = true;
  }
}
