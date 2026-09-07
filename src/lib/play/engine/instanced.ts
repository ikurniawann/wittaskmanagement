import * as THREE from "three";
import { castShadow } from "./shared";

export type InstanceRecord = {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  sx: number; sy: number; sz: number;
  color: number;
  chunk: number;
  /** Optional caller reference (e.g. a task id) for picking. */
  ref?: string;
};

export type InstanceKind = {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  records: InstanceRecord[];
  mesh: THREE.InstancedMesh | null;
  useColor: boolean;
  cast: boolean;
  /** [start, count] per chunk, contiguous after build(). */
  ranges: [number, number][];
};

/** Pure: which chunk a world position belongs to (grid cells → round-robin chunk). */
export function chunkOf(x: number, z: number, cell: number, chunks: number): number {
  const ix = Math.floor(x / cell);
  const iz = Math.floor(z / cell);
  return (((ix * 7 + iz * 13) % chunks) + chunks) % chunks;
}

/** Pure: LOD scale factor — 1 near, smoothstep down to 0 between fadeStart and fadeEnd. */
export function lodScale(dist: number, fadeStart: number, fadeEnd: number): number {
  const t = Math.max(0, Math.min(1, (dist - fadeStart) / (fadeEnd - fadeStart)));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Static props grouped per kind into one InstancedMesh each, split into N spatial
 * chunks. Each frame only ONE chunk recomputes its matrices (staggered → no
 * spike) and only that slice of the buffer is uploaded (`addUpdateRange`).
 * LOD shrinks instances smoothly with distance instead of popping them off.
 */
export class InstancedManager {
  readonly kinds: InstanceKind[] = [];
  private frame = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  readonly cell: number;
  readonly fadeStart: number;
  readonly fadeEnd: number;

  constructor(readonly chunks: number, opts: { cell?: number; fadeStart?: number; fadeEnd?: number } = {}) {
    this.cell = opts.cell ?? 110;
    this.fadeStart = opts.fadeStart ?? 260;
    this.fadeEnd = opts.fadeEnd ?? 340;
  }

  addKind(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, opts: { color?: boolean; cast?: boolean } = {}): InstanceKind {
    geometry.computeBoundingSphere();
    const k: InstanceKind = { name, geometry, material, records: [], mesh: null, useColor: !!opts.color, cast: opts.cast !== false, ranges: [] };
    this.kinds.push(k);
    return k;
  }

  add(kind: InstanceKind, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy?: number, sz?: number, color = 0xffffff, ref?: string): InstanceRecord {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    const r: InstanceRecord = { x, y, z, qx: this.q.x, qy: this.q.y, qz: this.q.z, qw: this.q.w, sx, sy: sy ?? sx, sz: sz ?? sx, color, chunk: chunkOf(x, z, this.cell, this.chunks), ref };
    kind.records.push(r);
    return r;
  }

  addFromMatrix(kind: InstanceKind, m: THREE.Matrix4, color = 0xffffff, ref?: string): InstanceRecord {
    const d = this.dummy;
    d.matrix.copy(m);
    d.matrix.decompose(d.position, d.quaternion, d.scale);
    const r: InstanceRecord = { x: d.position.x, y: d.position.y, z: d.position.z, qx: d.quaternion.x, qy: d.quaternion.y, qz: d.quaternion.z, qw: d.quaternion.w, sx: d.scale.x, sy: d.scale.y, sz: d.scale.z, color, chunk: chunkOf(d.position.x, d.position.z, this.cell, this.chunks), ref };
    kind.records.push(r);
    return r;
  }

  build(scene: THREE.Object3D): void {
    const col = new THREE.Color();
    for (const k of this.kinds) {
      k.records.sort((a, b) => a.chunk - b.chunk);
      k.ranges = [];
      for (let c = 0; c < this.chunks; c++) k.ranges.push([0, 0]);
      k.records.forEach((r, i) => {
        const rg = k.ranges[r.chunk];
        if (rg[1] === 0) rg[0] = i;
        rg[1]++;
      });
      const mesh = new THREE.InstancedMesh(k.geometry, k.material, Math.max(1, k.records.length));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      k.records.forEach((r, i) => {
        this.write(mesh, i, r, 1);
        if (k.useColor) mesh.setColorAt(i, col.setHex(r.color));
      });
      if (k.records.length === 0) mesh.count = 0;
      mesh.frustumCulled = true;
      mesh.computeBoundingSphere();
      mesh.name = k.name;
      if (k.cast) castShadow(mesh);
      k.mesh = mesh;
      scene.add(mesh);
    }
  }

  private write(mesh: THREE.InstancedMesh, i: number, r: InstanceRecord, lod: number): void {
    const d = this.dummy;
    d.position.set(r.x, r.y, r.z);
    d.quaternion.set(r.qx, r.qy, r.qz, r.qw);
    d.scale.set(r.sx * lod, r.sy * lod, r.sz * lod);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }

  /** Recompute one chunk (round-robin) against the nearest of the given camera positions. */
  update(camPositions: readonly THREE.Vector3[]): void {
    const c = this.frame++ % this.chunks;
    for (const k of this.kinds) {
      const rg = k.ranges[c];
      if (!rg || rg[1] === 0 || !k.mesh) continue;
      for (let i = rg[0]; i < rg[0] + rg[1]; i++) {
        const r = k.records[i];
        let d2 = Infinity;
        for (const cp of camPositions) {
          const dx = cp.x - r.x, dz = cp.z - r.z, dd = dx * dx + dz * dz;
          if (dd < d2) d2 = dd;
        }
        this.write(k.mesh, i, r, lodScale(Math.sqrt(d2), this.fadeStart, this.fadeEnd));
      }
      const a = k.mesh.instanceMatrix;
      a.clearUpdateRanges();
      a.addUpdateRange(rg[0] * 16, rg[1] * 16);
      a.needsUpdate = true;
    }
  }

  /** Resolve a picked (mesh, instanceId) back to the record's ref. */
  refOf(mesh: THREE.Object3D, instanceId: number | undefined): string | undefined {
    if (instanceId == null) return undefined;
    const k = this.kinds.find((x) => x.mesh === mesh);
    return k?.records[instanceId]?.ref;
  }

  dispose(): void {
    for (const k of this.kinds) {
      k.mesh?.dispose();
      k.geometry.dispose();
    }
  }
}
