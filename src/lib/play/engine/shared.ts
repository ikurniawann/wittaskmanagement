import * as THREE from "three";

/**
 * Uniforms shared by every material in the scene. ONE `{ value }` object per
 * uniform is referenced by all materials, so a per-frame update happens once
 * (sun, fog, shadow matrix, time) instead of once per material.
 */
export type SharedUniforms = {
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uHemiSky: { value: THREE.Color };
  uHemiGround: { value: THREE.Color };
  uSkyTop: { value: THREE.Color };
  uSkyMid: { value: THREE.Color };
  uSkyBottom: { value: THREE.Color };
  uFogColor: { value: THREE.Color };
  uFogRange: { value: THREE.Vector2 };
  uShadowMatrix: { value: THREE.Matrix4 };
  uShadowMap: { value: THREE.Texture | null };
  uShadowBias: { value: number };
  uFar: { value: number };
  uTime: { value: number };
};

export function createSharedUniforms(opts?: {
  sunDir?: THREE.Vector3;
  fogNear?: number;
  fogFar?: number;
  far?: number;
}): SharedUniforms {
  return {
    uSunDir: { value: (opts?.sunDir ?? new THREE.Vector3(110, 200, 70)).clone().normalize() },
    uSunColor: { value: new THREE.Color(0xfff1d6).multiplyScalar(1.15) },
    uHemiSky: { value: new THREE.Color(0xbfd9ff).multiplyScalar(0.55) },
    uHemiGround: { value: new THREE.Color(0x7a8c55).multiplyScalar(0.45) },
    uSkyTop: { value: new THREE.Color(0x3c88dd) },
    uSkyMid: { value: new THREE.Color(0xa8d8f5) },
    uSkyBottom: { value: new THREE.Color(0xe9f0da) },
    uFogColor: { value: new THREE.Color(0xbfddf0) },
    uFogRange: { value: new THREE.Vector2(opts?.fogNear ?? 220, opts?.fogFar ?? 760) },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMap: { value: null },
    uShadowBias: { value: 0.0012 },
    uFar: { value: opts?.far ?? 1500 },
    uTime: { value: 0 },
  };
}

/** Layer 1 = shadow casters. Transparent / non-caster objects never get it. */
export const SHADOW_LAYER = 1;

export function castShadow<T extends THREE.Object3D>(o: T): T {
  o.layers.enable(SHADOW_LAYER);
  return o;
}

/** sRGB 0..1 channel → linear. Used where a colour arrives as a hex outside THREE.Color. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
