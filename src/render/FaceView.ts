import * as THREE from 'three';
import type { Expression } from '../character/face';
import { FACE } from '../character/faceFit';

/*
 * Her eyes and brows, painted on the face patch (src/character/faceFit.ts) by a shader, in
 * a simple anime style: big eyes with a heavy upper lash and a small wing, an indigo iris
 * that lightens toward the bottom, a dark pupil, two highlights, and brows. The expression
 * (src/character/face.ts) bends it: angry lowers the inner lids and slants the brows down
 * toward the nose, a frown pulls the brows down and together and narrows the eyes, pain
 * squeezes the eyes shut and lifts the brows in the middle, and blinks close the lids.
 *
 * The patch is pulled 6 cm toward the camera in depth only (it doesn't move on screen), so
 * her fringe doesn't hide her eyes, the way anime draws eyes and brows over the bangs.
 * Anything really in front of her face still covers it. It fades out as the face turns
 * away, so the far eye never shows through her cheek.
 */

export interface FaceLook {
  material: THREE.ShaderMaterial;
  /** Expression, plus where the eyes point (-1..1: her right, up). */
  set(e: Expression, gazeX: number, gazeY: number): void;
}

/**
 * Scene brightness for the eyes, shared by every face. The shader is unlit, so on a dark
 * stage the whites would glow; the stage sets this (src/render/stages).
 */
const faceLight = { value: 1 };

export function setFaceLight(k: number): void {
  faceLight.value = k;
}

export function faceMaterial(): FaceLook {
  const color = (hex: number) => new THREE.Color(hex);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAngry: { value: 0 },
      uFrown: { value: 0 },
      uPain: { value: 0 },
      uBlink: { value: 0 },
      uGaze: { value: new THREE.Vector2() },
      uWhite: { value: color(0xe9eaf2) },
      uIrisTop: { value: color(0x1e1b4b) },
      uIrisBottom: { value: color(0x818cf8) },
      uPupil: { value: color(0x0b0a1f) },
      uLash: { value: color(0x15110f) },
      uLight: faceLight,
    },
    defines: {
      EYE_X: FACE.eyeX.toFixed(4),
      EYE_W: FACE.eyeHalf.toFixed(4),
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
  });
  material.userData.noGhost = true;
  return {
    material,
    set(e, gazeX, gazeY) {
      const u = material.uniforms;
      u.uAngry.value = e.angry;
      u.uFrown.value = e.frown;
      u.uPain.value = e.pain;
      u.uBlink.value = e.blink;
      (u.uGaze.value as THREE.Vector2).set(gazeX, gazeY);
    },
  };
}

const VERT = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  attribute vec2 aFace;
  varying vec2 vFace;
  varying float vFacing;
  void main() {
    vFace = aFace;
    #include <skinbase_vertex>
    #include <beginnormal_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
    vFacing = dot(normalize(normalMatrix * objectNormal), normalize(-mv.xyz));
    // Toward the camera along the view ray: same spot on screen, in front of the bangs.
    mv.xyz += normalize(-mv.xyz) * 0.06;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform float uAngry;
  uniform float uFrown;
  uniform float uPain;
  uniform float uBlink;
  uniform vec2 uGaze;
  uniform vec3 uWhite;
  uniform vec3 uIrisTop;
  uniform vec3 uIrisBottom;
  uniform vec3 uPupil;
  uniform vec3 uLash;
  uniform float uLight;
  varying vec2 vFace;
  varying float vFacing;

  /** Coverage of a stroke |d| < w (half its width), antialiased over aa. */
  float stroke(float d, float w, float aa) {
    return 1.0 - smoothstep(w - aa, w + aa, abs(d));
  }

  /** Paints a over the color so far. */
  void over(inout vec4 c, vec3 rgb, float a) {
    c.rgb = mix(c.rgb, rgb, a);
    c.a = a + c.a * (1.0 - a);
  }

  void main() {
    float side = vFace.x >= 0.0 ? 1.0 : -1.0;
    // Eye space: units of half an eye's width, mirrored so +x runs to the outer corner.
    vec2 q = vec2((abs(vFace.x) - EYE_X) / EYE_W, vFace.y / EYE_W);
    float aa = max(fwidth(q.x), fwidth(q.y)) * 0.9 + 1e-4;
    float inner = clamp(0.5 - 0.5 * q.x, 0.0, 1.0); // 1 at the corner by her nose

    // ---- lids. Almond: rounder below, the outer corner a touch higher.
    float xx = clamp(q.x, -1.0, 1.0);
    float shape = sqrt(max(0.0, 1.0 - xx * xx));
    float top = 0.95 * pow(shape, 0.65) + 0.14 * q.x;
    float bot = -0.66 * pow(shape, 0.95) + 0.03 * q.x;
    // Angry brings the upper lid down toward the nose; a frown narrows the eye.
    top -= uAngry * 0.38 * inner * shape + uFrown * 0.22 * shape;
    float close = max(max(uBlink, uPain), 0.0);
    float lid = mix(top, bot + 0.05, close);
    float inEye = smoothstep(-aa, aa, lid - q.y) * smoothstep(-aa, aa, q.y - bot) * step(abs(q.x), 1.0);

    vec4 c = vec4(0.0);

    // ---- the eye: white, iris, pupil, highlights. Iris in face space, so it follows the gaze.
    vec2 irisAt = vec2(side * EYE_X + uGaze.x * 0.32 * EYE_W, -0.06 * EYE_W + uGaze.y * 0.22 * EYE_W);
    vec2 ir = (vFace - irisAt) / vec2(0.56 * EYE_W, 0.76 * EYE_W);
    float iris = length(ir);
    float shade = smoothstep(0.45, 0.0, lid - q.y); // under the upper lid
    vec3 eye = mix(uWhite, uWhite * 0.62, shade);
    float irisA = 1.0 - smoothstep(1.0 - aa * 2.0, 1.0, iris);
    vec3 irisRgb = mix(uIrisTop, uIrisBottom, smoothstep(0.6, -0.9, ir.y));
    irisRgb = mix(irisRgb, uIrisTop * 0.6, smoothstep(0.75, 1.0, iris)); // darker rim
    irisRgb *= 1.0 - 0.45 * shade;
    eye = mix(eye, irisRgb, irisA);
    float pupil = length((vFace - irisAt - vec2(0.0, 0.05 * EYE_W)) / vec2(0.22 * EYE_W, 0.34 * EYE_W));
    eye = mix(eye, uPupil, 1.0 - smoothstep(1.0 - aa * 4.0, 1.0, pupil));
    // Highlights: the same side on both eyes (light from one place).
    float h1 = length((vFace - irisAt - vec2(0.17 * EYE_W, 0.26 * EYE_W)) / (0.15 * EYE_W));
    float h2 = length((vFace - irisAt - vec2(-0.16 * EYE_W, -0.32 * EYE_W)) / (0.07 * EYE_W));
    float glint = max(1.0 - smoothstep(0.8, 1.0, h1), 0.8 * (1.0 - smoothstep(0.7, 1.0, h2)));
    eye = mix(eye, vec3(1.0), glint * irisA);
    over(c, eye, inEye);

    // ---- upper lash: heavy, thicker toward the outer corner, with a small wing.
    float thick = 0.14 + 0.14 * smoothstep(-0.4, 1.0, q.x);
    float lash = stroke(q.y - (lid + thick * 0.3), thick * 0.5, aa) * (1.0 - smoothstep(1.0, 1.06, abs(q.x)));
    float corner = mix(0.14, 0.08, close); // the upper lid's height at the outer corner
    float wx = q.x - 0.88;
    float wing = stroke(q.y - (corner + 0.12 + wx * 0.55), 0.12 * (1.0 - smoothstep(0.0, 0.42, wx)), aa)
      * step(0.0, wx) * (1.0 - step(0.42, wx));
    over(c, uLash, max(lash, wing));
    // Lower lash: a thin hint toward the outer corner.
    float low = stroke(q.y - (bot - 0.03), 0.035, aa) * smoothstep(0.0, 0.5, q.x) * (1.0 - smoothstep(0.92, 1.0, q.x));
    over(c, uLash, low * 0.7 * (1.0 - close));

    // ---- brow. Neutral: a soft arch. Angry: slants down toward the nose. Frown: lower and
    // drawn together. Pain: the inner ends lift.
    float bx = q.x + 0.18 * uFrown; // a frown pulls the inner ends in
    float arch = 1.0 - clamp(bx * bx, 0.0, 1.0);
    float by = 1.72 + 0.26 * arch * (1.0 - 0.6 * uAngry) - 0.06 * bx;
    float bInner = clamp(0.5 - 0.5 * bx, 0.0, 1.0);
    by += uAngry * (-0.52 * bInner + 0.18 * (1.0 - bInner));
    by -= uFrown * (0.22 + 0.22 * bInner);
    by += uPain * (0.5 * bInner - 0.08);
    float bth = mix(0.22, 0.07, clamp((bx + 1.0) / 2.1, 0.0, 1.0));
    float ends = smoothstep(-1.05, -0.9, bx) * (1.0 - smoothstep(0.9, 1.12, bx));
    over(c, uLash, stroke(q.y - by, bth * 0.5, aa) * ends);

    c.a *= smoothstep(0.08, 0.35, vFacing);
    if (c.a < 0.003) discard;
    c.rgb *= uLight;
    gl_FragColor = c;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
