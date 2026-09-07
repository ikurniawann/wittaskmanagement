import * as THREE from "three";
import type { SharedUniforms } from "./shared";

/**
 * Zero-allocation particle pool. All state lives in Float32Arrays allocated
 * once; slots are reused through a ring buffer cursor. Opacity and tint are
 * InstancedBufferAttributes; position/scale are written straight into
 * `instanceMatrix.array` — no Object3D, no `new` in the update loop.
 */
export class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  readonly count: number;
  private cursor = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly dur: Float32Array;
  private readonly size: Float32Array;
  private readonly grow: Float32Array;
  private readonly alpha: Float32Array;
  private readonly opacity: THREE.InstancedBufferAttribute;
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly arr: Float32Array;

  constructor(count: number, shared: SharedUniforms) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.age = new Float32Array(count);
    this.dur = new Float32Array(count);
    this.size = new Float32Array(count);
    this.grow = new Float32Array(count);
    this.alpha = new Float32Array(count);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.opacity.setUsage(THREE.DynamicDrawUsage);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.tint.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aOpacity", this.opacity);
    geo.setAttribute("aTint", this.tint);
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      uniforms: { uFogColor: shared.uFogColor, uFogRange: shared.uFogRange },
      vertexShader: /* glsl */ `
        in float aOpacity; in vec3 aTint;
        out vec2 vUv; out float vO; out vec3 vT; out float vZ;
        void main() {
          vec3 c = instanceMatrix[3].xyz; float s = instanceMatrix[0][0];
          vec4 mv = modelViewMatrix * vec4(c, 1.0); mv.xy += position.xy * s;
          vZ = -mv.z; vUv = uv; vO = aOpacity; vT = aTint; gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        layout(location = 0) out vec4 gColor; layout(location = 1) out vec4 gNormal;
        in vec2 vUv; in float vO; in vec3 vT; in float vZ;
        uniform vec3 uFogColor; uniform vec2 uFogRange;
        void main() {
          float d = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.25, d) * vO;
          if (a < 0.01) discard;
          gColor = vec4(mix(vT, uFogColor, smoothstep(uFogRange.x, uFogRange.y, vZ)), a);
          gNormal = vec4(0.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = "particles";
    this.arr = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < count; i++) {
      this.arr[i * 16 + 15] = 1;
      this.age[i] = 1;
      this.dur[i] = 0;
    }
  }

  /** Next ring-buffer slot that would be written (exposed for tests). */
  get nextSlot(): number {
    return this.cursor;
  }

  isAlive(i: number): boolean {
    return this.age[i] < this.dur[i];
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, dur: number, r: number, g: number, b: number, grow: number, alpha: number): number {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.age[i] = 0; this.dur[i] = dur; this.size[i] = size; this.grow[i] = grow; this.alpha[i] = alpha;
    const t = this.tint.array as Float32Array;
    t[i * 3] = r; t[i * 3 + 1] = g; t[i * 3 + 2] = b;
    this.tint.needsUpdate = true;
    return i;
  }

  update(dt: number, camera: THREE.Camera): void {
    const a = this.arr, op = this.opacity.array as Float32Array, cp = camera.position;
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      if (this.age[i] >= this.dur[i]) continue;
      dirty = true;
      const o = i * 16, p = i * 3;
      this.age[i] += dt;
      if (this.age[i] >= this.dur[i]) { a[o] = a[o + 5] = a[o + 10] = 0; op[i] = 0; continue; }
      this.pos[p] += this.vel[p] * dt; this.pos[p + 1] += this.vel[p + 1] * dt; this.pos[p + 2] += this.vel[p + 2] * dt;
      const s = this.size[i] * (1 + this.age[i] * this.grow[i]);
      a[o] = a[o + 5] = a[o + 10] = s; a[o + 12] = this.pos[p]; a[o + 13] = this.pos[p + 1]; a[o + 14] = this.pos[p + 2];
      const dx = this.pos[p] - cp.x, dy = this.pos[p + 1] - cp.y, dz = this.pos[p + 2] - cp.z, d2 = dx * dx + dy * dy + dz * dz;
      op[i] = this.alpha[i] * (1 - this.age[i] / this.dur[i]) * (d2 < 6 ? d2 / 6 : 1);
    }
    if (dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.opacity.needsUpdate = true; }
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) {
      this.age[i] = 1; this.dur[i] = 0;
      const o = i * 16;
      this.arr[o] = this.arr[o + 5] = this.arr[o + 10] = 0;
      (this.opacity.array as Float32Array)[i] = 0;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.opacity.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
