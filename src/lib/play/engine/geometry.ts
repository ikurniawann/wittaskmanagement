import * as THREE from "three";

const _o = new THREE.Object3D();

/** Compose a local transform matrix (rotation in radians, uniform scale when sy/sz omitted). */
export function partMatrix(
  x = 0, y = 0, z = 0,
  rx = 0, ry = 0, rz = 0,
  sx = 1, sy?: number, sz?: number,
): THREE.Matrix4 {
  _o.position.set(x, y, z);
  _o.rotation.set(rx, ry, rz);
  _o.scale.set(sx, sy ?? sx, sz ?? sx);
  _o.updateMatrix();
  return _o.matrix.clone();
}

export type MergePart = { g: THREE.BufferGeometry; c?: THREE.ColorRepresentation; m: THREE.Matrix4 };

/**
 * Merge primitives + a colour per part into ONE non-indexed BufferGeometry
 * (position / normal / uv / color) → one draw call per merged object.
 */
export function mergeParts(parts: MergePart[]): THREE.BufferGeometry {
  const gs = parts.map((p) => {
    const g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
    g.applyMatrix4(p.m);
    return g;
  });
  const total = gs.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  const c = new THREE.Color();
  gs.forEach((g, i) => {
    const n = g.attributes.position.count;
    c.set(parts[i].c ?? 0xffffff);
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array as Float32Array, o * 2);
    for (let k = 0; k < n; k++) {
      col[(o + k) * 3] = c.r;
      col[(o + k) * 3 + 1] = c.g;
      col[(o + k) * 3 + 2] = c.b;
    }
    o += n;
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/**
 * Procedural canvas texture. `linear` marks multiplier masks (no sRGB decode);
 * colour textures are decoded from sRGB so the lighting stays linear.
 */
export function canvasTex(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  rep?: [number, number],
  linear = false,
): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  if (ctx) draw(ctx);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (rep) t.repeat.set(rep[0], rep[1]);
  return t;
}
