import * as THREE from 'three';

/*
 * Her outfit, painted onto the skinned body by the shader rather than modeled. Every
 * pixel knows where it sits on her at rest (the bind pose: x = her right, y = up, her
 * front is -Z, meters, feet at 0) and, on the arms, how far down the arm it is. Bands of
 * that decide the color, so edges stay crisp however low-poly the body is, and changing
 * the outfit is changing numbers here.
 *
 * Top to bottom: an indigo collar with a gold edge; the tunic with a cream front panel
 * edged in gold; leather harness straps over the shoulders, one across the chest, a
 * diagonal from her left shoulder; a wide belt with a gold buckle; dark trousers; tall
 * brown boots with a lighter cuff. Arms: short indigo sleeves with a gold hem, cream
 * undersleeves, long leather bracers with two dark bands, fingerless gloves.
 *
 * The armor, skirt panels, scabbard and sword are real geometry (CharacterFigure.ts,
 * SkinnedBody.ts).
 */

export interface OutfitColors {
  skin: number;
  tunic: number;
  cream: number;
  gold: number;
  leather: number;
  leatherDark: number;
  pants: number;
  boots: number;
  bootCuff: number;
  sole: number;
}

const VERTEX_PARS = /* glsl */ `
attribute float aArm;
varying vec3 vRest;
varying float vArm;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 uSkin, uTunic, uCream, uGold, uLeather, uLeatherDark, uPants, uBoots, uBootCuff, uSole;
varying vec3 vRest;
varying float vArm;

float band(float v, float a, float b) { return step(a, v) * step(v, b); }

vec3 armColor(float s) {
  if (s < 0.115) return uTunic;          // short sleeve
  if (s < 0.128) return uGold;           // its hem
  if (s < 0.315) return uCream;          // undersleeve, over the elbow (0.27)
  if (s < 0.5) {                         // bracer to the wrist (0.505)
    if (band(s, 0.35, 0.362) + band(s, 0.43, 0.442) > 0.0) return uLeatherDark;
    return uLeather;
  }
  if (s < 0.58) return uLeatherDark;     // fingerless glove
  return uSkin;
}

vec3 bodyColor(vec3 p) {
  float ax = abs(p.x);
  bool front = p.z < 0.0;
  // Neck: skin under the head, then the standing collar.
  if (p.y > 1.5) return uSkin;
  if (p.y > 1.488) return uGold;
  if (p.y > 1.43) return uTunic;
  // Belt and below.
  if (p.y < 0.012) return uSole;
  if (p.y < 0.43) return uBoots;
  if (p.y < 0.47) return uBootCuff;
  if (p.y < 0.99) return uPants;
  if (p.y < 1.07) {
    if (front && p.x > 0.02 && p.x < 0.05 && p.y > 1.014 && p.y < 1.046) {
      return (p.x > 0.026 && p.x < 0.044 && p.y > 1.02 && p.y < 1.04) ? uLeather : uGold; // buckle
    }
    if (band(p.y, 0.996, 1.004) + band(p.y, 1.056, 1.064) > 0.0) return uLeatherDark;
    return uLeather;
  }
  // Harness: a strap each side, front to back over the shoulders (it holds the
  // breastplate on); one across the chest; a diagonal from her left shoulder.
  if (ax > 0.078 && ax < 0.098 && p.y < 1.44) return uLeather;
  if (front && band(p.y, 1.355, 1.371) > 0.0 && ax < 0.098) return uLeather;
  if (front) {
    vec2 a = vec2(-0.1, 1.41), b = vec2(0.14, 1.1);
    vec2 d = b - a;
    float t = clamp(dot(p.xy - a, d) / dot(d, d), 0.0, 1.0);
    if (length(p.xy - (a + d * t)) < 0.012) return uLeather;
  }
  // Tunic, with the cream front panel and its gold edges and center seam.
  if (front && ax < 0.066) {
    if (ax > 0.06 || ax < 0.0025) return uGold;
    return uCream;
  }
  return uTunic;
}
`;

/**
 * A lit material that paints the outfit. The body geometry must carry `aArm` (distance
 * along the arm, -1 elsewhere). Starts from `base`'s settings (roughness and so on).
 */
export function outfitMaterial(colors: OutfitColors, params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, ...params });
  const uniforms = {
    uSkin: { value: new THREE.Color(colors.skin) },
    uTunic: { value: new THREE.Color(colors.tunic) },
    uCream: { value: new THREE.Color(colors.cream) },
    uGold: { value: new THREE.Color(colors.gold) },
    uLeather: { value: new THREE.Color(colors.leather) },
    uLeatherDark: { value: new THREE.Color(colors.leatherDark) },
    uPants: { value: new THREE.Color(colors.pants) },
    uBoots: { value: new THREE.Color(colors.boots) },
    uBootCuff: { value: new THREE.Color(colors.bootCuff) },
    uSole: { value: new THREE.Color(colors.sole) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;\nvArm = aArm;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vArm >= 0.0 ? armColor(vArm) : bodyColor(vRest);');
  };
  m.customProgramCacheKey = () => 'kira-outfit';
  return m;
}
