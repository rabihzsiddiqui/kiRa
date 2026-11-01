import * as THREE from 'three';

export interface SkyLook {
  zenith: number;
  horizon: number;
  /** Haze below the horizon line. Matches the fog so far terrain melts into it. */
  ground: number;
  sun: number;
  cloud: number;
  cloudShade: number;
  /** 0..1, how much of the sky is cloud. */
  cover: number;
  /** Sun disc brightness. Above the bloom threshold, so it glows. */
  sunGlow: number;
}

export const SKY_RADIUS = 420;

/**
 * Sky dome: a gradient from horizon to zenith, a sun disc with a halo, and fbm clouds
 * projected onto a flat layer overhead so they shrink toward the horizon. Clouds drift on
 * real time (`uTime`), held still under reduced motion.
 */
export function skyDome(look: SkyLook, sunDir: THREE.Vector3): { mesh: THREE.Mesh; uniforms: { uTime: { value: number } } } {
  const col = (hex: number) => new THREE.Color(hex);
  const uniforms = {
    uZenith: { value: col(look.zenith) },
    uHorizon: { value: col(look.horizon) },
    uGround: { value: col(look.ground) },
    uSun: { value: col(look.sun) },
    uCloud: { value: col(look.cloud) },
    uCloudShade: { value: col(look.cloudShade) },
    uSunDir: { value: sunDir.clone().normalize() },
    uCover: { value: look.cover },
    uSunGlow: { value: look.sunGlow },
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 24), material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, uniforms };
}

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSun;
  uniform vec3 uCloud;
  uniform vec3 uCloudShade;
  uniform vec3 uSunDir;
  uniform float uCover;
  uniform float uSunGlow;
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
    col = mix(col, uGround, smoothstep(0.0, -0.06, h));

    float sd = max(dot(d, uSunDir), 0.0);
    // Warm halo round the sun, wider and fainter toward the horizon.
    col += uSun * (pow(sd, 6.0) * 0.12 + pow(sd, 90.0) * 0.35);

    float cloud = 0.0;
    if (h > 0.0) {
      vec2 p = d.xz / (h + 0.15) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
      float n = fbm(p);
      cloud = smoothstep(1.0 - uCover, 1.0 - uCover + 0.3, n) * smoothstep(0.0, 0.18, h);
      // Thicker parts are darker underneath; edges near the sun light up.
      float body = smoothstep(0.45, 0.95, fbm(p * 1.9 + 4.0));
      vec3 cc = mix(uCloud, uCloudShade, body * 0.7);
      cc += uSun * pow(sd, 5.0) * 0.25;
      col = mix(col, cc, cloud * 0.92);
    }

    float disc = smoothstep(0.99955, 0.9998, sd) * (1.0 - cloud * 0.8);
    col += uSun * disc * uSunGlow;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
