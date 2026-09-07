import * as THREE from "three";
import type { SharedUniforms } from "./shared";

/**
 * ONE vertex shader + ONE fragment shader for every piece of scene geometry
 * (opaque, transparent, sky, skinned characters). Per-material differences are
 * uniforms only (materialFactory). Why this cuts draw-call cost: WebGL pays for
 * `useProgram` + a full uniform/attribute rebind on every program switch; with a
 * single program family three.js sorts by program and only uniform updates remain.
 * three still compiles small variants for USE_INSTANCING / USE_SKINNING /
 * DOUBLE_SIDED, but the source is identical.
 *
 * Outputs (GLSL3 MRT):
 *   location 0 — cel-lit colour (RGBA16F, HDR: luminance > 1 feeds bloom)
 *   location 1 — view-space normal (xyz) + normalised linear depth (a)
 */
export const VS_UNIFIED = /* glsl */ `
  uniform mat4 uShadowMatrix;
  uniform float uNormalOffset;
  #include <skinning_pars_vertex>
  out vec3 vWN; out vec3 vWP; out vec2 vUv; out vec3 vCol; out vec4 vShadow; out float vViewZ; out float vTint;
  void main() {
    vec3 transformed = position;
    vec3 objectNormal = normal;
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <skinning_vertex>
    vec4 lp = vec4(transformed, 1.0);
    vec3 n = objectNormal;
    #ifdef USE_INSTANCING
      lp = instanceMatrix * lp;
      n = mat3(instanceMatrix) * n;
    #endif
    vec4 wp = modelMatrix * lp;
    vWP = wp.xyz;
    vWN = normalize(mat3(modelMatrix) * n);
    vUv = uv;
    vCol = color.rgb;
    // colour alpha (when present) is a tint mask: 1 = takes uColor, 0 = keeps its own colour
    #ifdef USE_COLOR_ALPHA
      vTint = color.a;
    #else
      vTint = 1.0;
    #endif
    #ifdef USE_INSTANCING_COLOR
      vCol *= instanceColor;
    #endif
    // Normal offset keeps the 1-tap hard shadow free of acne.
    vShadow = uShadowMatrix * vec4(wp.xyz + vWN * uNormalOffset, 1.0);
    vec4 mv = viewMatrix * wp;
    vViewZ = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

export const FS_UNIFIED = /* glsl */ `
  layout(location = 0) out vec4 gColor;
  layout(location = 1) out vec4 gNormal;
  in vec3 vWN; in vec3 vWP; in vec2 vUv; in vec3 vCol; in vec4 vShadow; in float vViewZ; in float vTint;
  uniform vec3 uColor; uniform float uOpacity; uniform sampler2D uMap; uniform float uUseMap;
  uniform vec3 uRamp; uniform vec2 uThresholds; uniform vec2 uRim; uniform vec2 uSpec; uniform float uHatch; uniform float uReflect;
  uniform float uUnlit; uniform vec3 uEmissive; uniform float uWriteG; uniform float uSky; uniform float uFogMul;
  uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uHemiSky; uniform vec3 uHemiGround;
  uniform vec3 uSkyTop; uniform vec3 uSkyMid; uniform vec3 uSkyBottom;
  uniform vec3 uFogColor; uniform vec2 uFogRange; uniform sampler2D uShadowMap; uniform float uShadowBias; uniform float uFar;
  vec3 skyGradient(float h) { return h > 0.0 ? mix(uSkyMid, uSkyTop, pow(h, 0.55)) : mix(uSkyMid, uSkyBottom, clamp(-h * 5.0, 0.0, 1.0)); }
  float ramp3(float x) {
    float w = fwidth(x) * 1.5 + 0.01;
    float a = smoothstep(uThresholds.x - w, uThresholds.x + w, x);
    float b = smoothstep(uThresholds.y - w, uThresholds.y + w, x);
    return mix(uRamp.x, mix(uRamp.y, uRamp.z, b), a);
  }
  void main() {
    if (uSky > 0.5) {
      vec3 d = normalize(vWP - cameraPosition);
      gColor = vec4(skyGradient(d.y), 1.0);
      gNormal = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    vec3 N = normalize(vWN); if (!gl_FrontFacing) N = -N;
    vec4 tex = mix(vec4(1.0), texture(uMap, vUv), uUseMap);
    vec3 base = mix(vCol, uColor * vCol, vTint) * tex.rgb;
    float alpha = uOpacity * tex.a;
    vec3 V = normalize(cameraPosition - vWP);
    vec3 sc = vShadow.xyz / vShadow.w;
    float sh = 1.0;
    if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) sh = step(sc.z - uShadowBias, texture(uShadowMap, sc.xy).r);
    float ndl = max(dot(N, uSunDir), 0.0) * sh;
    float band = ramp3(ndl);
    vec3 hemi = mix(uHemiGround, uHemiSky, N.y * 0.5 + 0.5);
    vec3 lit = base * (hemi + uSunColor * band);
    vec3 Hh = normalize(uSunDir + V);
    float sp = pow(max(dot(N, Hh), 0.0), uSpec.y);
    lit += uSunColor * uSpec.x * sh * smoothstep(0.45, 0.55, sp);
    float fres = pow(1.0 - max(dot(N, V), 0.0), uRim.y);
    lit += mix(uHemiSky, vec3(1.0), 0.4) * fres * uRim.x;
    if (uReflect > 0.0) { vec3 R = reflect(-V, N); lit = mix(lit, skyGradient(R.y) * (0.4 + 0.6 * base), uReflect * (0.25 + 0.75 * fres)); }
    if (uHatch > 0.0) { float l = step(0.0, sin((gl_FragCoord.x + gl_FragCoord.y) * 0.9)); lit *= 1.0 - uHatch * 0.35 * l * (1.0 - smoothstep(0.0, 0.5, ndl)); }
    lit = mix(lit, base, uUnlit) + uEmissive;
    float fog = smoothstep(uFogRange.x, uFogRange.y, vViewZ) * uFogMul;
    lit = mix(lit, uFogColor, fog);
    gColor = vec4(lit, alpha);
    vec3 vn = normalize(mat3(viewMatrix) * N);
    gNormal = vec4(vn, vViewZ / uFar) * uWriteG;
  }`;

export type MaterialKind = "metal" | "rock" | "foliage" | "skin" | "water" | "dirt" | "glow" | "sky";

type KindPreset = {
  ramp?: [number, number, number];
  thr?: [number, number];
  rim?: [number, number];
  spec?: [number, number];
  hatch?: number;
  reflect?: number;
  unlit?: number;
  sky?: number;
};

/** ramp = band intensities [dark, mid, lit]; thr = band edges; rim/spec = [strength, power]. */
export const KINDS: Record<MaterialKind, KindPreset> = {
  metal: { ramp: [0.42, 0.78, 1.0], thr: [0.18, 0.55], rim: [0.35, 3.0], spec: [0.7, 48], hatch: 0.0, reflect: 0.3 },
  rock: { ramp: [0.32, 0.66, 1.0], thr: [0.22, 0.6], rim: [0.12, 2.5], spec: [0.0, 8], hatch: 0.7, reflect: 0.0 },
  foliage: { ramp: [0.45, 0.8, 1.0], thr: [0.15, 0.5], rim: [0.3, 2.0], spec: [0.0, 8], hatch: 0.35, reflect: 0.0 },
  skin: { ramp: [0.5, 0.85, 1.0], thr: [0.2, 0.55], rim: [0.2, 3.0], spec: [0.2, 16], hatch: 0.0, reflect: 0.0 },
  water: { ramp: [0.6, 0.85, 1.0], thr: [0.2, 0.5], rim: [0.4, 2.0], spec: [1.0, 96], hatch: 0.0, reflect: 0.8 },
  dirt: { ramp: [0.4, 0.75, 1.0], thr: [0.2, 0.55], rim: [0.0, 1.0], spec: [0.0, 8], hatch: 0.5, reflect: 0.0 },
  glow: { unlit: 1 },
  sky: { sky: 1 },
};

export type MaterialOptions = {
  map?: THREE.Texture;
  opacity?: number;
  emissive?: THREE.ColorRepresentation;
  transparent?: boolean;
  depthWrite?: boolean;
  side?: THREE.Side;
  additive?: boolean;
  polygonOffset?: boolean;
  noFog?: boolean;
  normalOffset?: number;
};

export type UnifiedMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uColor: { value: THREE.Color };
    uOpacity: { value: number };
    uMap: { value: THREE.Texture };
    uUseMap: { value: number };
    uEmissive: { value: THREE.Color };
    uWriteG: { value: number };
  } & Record<string, THREE.IUniform>;
};

let whiteTex: THREE.DataTexture | null = null;
function getWhiteTex(): THREE.DataTexture {
  if (!whiteTex) {
    whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    whiteTex.needsUpdate = true;
  }
  return whiteTex;
}

/**
 * Same shader every time; only uniform values differ per `kind`. Returned
 * materials share the `shared` uniform objects by reference.
 */
export function materialFactory(
  shared: SharedUniforms,
  color: THREE.ColorRepresentation,
  kind: MaterialKind,
  opts: MaterialOptions = {},
): UnifiedMaterial {
  const k = KINDS[kind] ?? KINDS.dirt;
  const uniforms: Record<string, THREE.IUniform> = {
    uColor: { value: new THREE.Color(color) },
    uOpacity: { value: opts.opacity ?? 1 },
    uMap: { value: opts.map ?? getWhiteTex() },
    uUseMap: { value: opts.map ? 1 : 0 },
    uRamp: { value: new THREE.Vector3().fromArray(k.ramp ?? [1, 1, 1]) },
    uThresholds: { value: new THREE.Vector2().fromArray(k.thr ?? [0.5, 0.5]) },
    uRim: { value: new THREE.Vector2().fromArray(k.rim ?? [0, 1]) },
    uSpec: { value: new THREE.Vector2().fromArray(k.spec ?? [0, 8]) },
    uHatch: { value: k.hatch ?? 0 },
    uReflect: { value: k.reflect ?? 0 },
    uUnlit: { value: k.unlit ?? 0 },
    uSky: { value: k.sky ?? 0 },
    uEmissive: { value: new THREE.Color(opts.emissive ?? 0x000000) },
    uWriteG: { value: opts.transparent ? 0 : 1 },
    uFogMul: { value: opts.noFog ? 0 : 1 },
    uNormalOffset: { value: opts.normalOffset ?? 0.25 },
    ...shared,
  };
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VS_UNIFIED,
    fragmentShader: FS_UNIFIED,
    uniforms,
    vertexColors: true,
    side: opts.side ?? THREE.FrontSide,
    transparent: !!opts.transparent,
    depthWrite: opts.depthWrite ?? !opts.transparent,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    polygonOffset: !!opts.polygonOffset,
    polygonOffsetFactor: opts.polygonOffset ? -2 : 0,
    fog: false,
    lights: false,
  });
  return mat as UnifiedMaterial;
}
