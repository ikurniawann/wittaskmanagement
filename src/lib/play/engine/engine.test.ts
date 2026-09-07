import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { chunkOf, lodScale, InstancedManager } from "./instanced";
import { nextPixelRatio } from "./loop";
import { buildLutData } from "./post";
import { ParticlePool } from "./particles";
import { createSharedUniforms } from "./shared";
import { KINDS } from "./shader";

describe("InstancedManager chunking", () => {
  it("chunkOf is deterministic and within range", () => {
    for (let i = 0; i < 200; i++) {
      const x = (i * 37) % 900 - 450, z = (i * 91) % 700 - 350;
      const c = chunkOf(x, z, 110, 8);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(8);
      expect(chunkOf(x, z, 110, 8)).toBe(c);
    }
  });
  it("neighbouring positions in the same cell share a chunk", () => {
    expect(chunkOf(10, 10, 110, 8)).toBe(chunkOf(100, 100, 110, 8));
  });
  it("lodScale is 1 near, 0 far, monotonic in between", () => {
    expect(lodScale(0, 260, 340)).toBe(1);
    expect(lodScale(1000, 260, 340)).toBe(0);
    let prev = 1;
    for (let d = 260; d <= 340; d += 5) {
      const s = lodScale(d, 260, 340);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
    expect(lodScale(300, 260, 340)).toBeCloseTo(0.5, 5);
  });
  it("build() produces contiguous chunk ranges", () => {
    const m = new InstancedManager(4, { cell: 50 });
    const kind = m.addKind("box", new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    for (let i = 0; i < 40; i++) m.add(kind, (i * 23) % 400, 0, (i * 57) % 300, 0, 0, 0, 1, undefined, undefined, 0xffffff, "ref" + i);
    const scene = new THREE.Scene();
    m.build(scene);
    const total = kind.ranges.reduce((s, r) => s + r[1], 0);
    expect(total).toBe(40);
    kind.ranges.forEach((rg, c) => {
      for (let i = rg[0]; i < rg[0] + rg[1]; i++) expect(kind.records[i].chunk).toBe(c);
    });
    expect(m.refOf(kind.mesh!, 3)).toBe(kind.records[3].ref);
  });
});

describe("GameLoop adaptive resolution", () => {
  it("steps down under 50 fps and up over 58 fps within clamps", () => {
    expect(nextPixelRatio(1.5, 30, 1, 2)).toBe(1.35);
    expect(nextPixelRatio(1.5, 60, 1, 2)).toBe(1.6);
    expect(nextPixelRatio(1.0, 30, 1, 2)).toBe(1.0);
    expect(nextPixelRatio(2.0, 60, 1, 2)).toBe(2.0);
    expect(nextPixelRatio(1.5, 55, 1, 2)).toBe(1.5);
  });
});

describe("LUT", () => {
  it("is a 256x16 RGBA8 table with identity-ish corners", () => {
    const d = buildLutData();
    expect(d.length).toBe(256 * 16 * 4);
    expect(d[3]).toBe(255);
    // black stays near black, white stays near white
    expect(d[0] + d[1] + d[2]).toBeLessThan(40);
    const wi = (15 * 256 + 15 * 16 + 15) * 4;
    expect(d[wi] + d[wi + 1] + d[wi + 2]).toBeGreaterThan(700);
  });
});

describe("ParticlePool", () => {
  it("emits into a ring buffer and ages particles out without allocation", () => {
    const pool = new ParticlePool(4, createSharedUniforms());
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 50, 0);
    for (let i = 0; i < 5; i++) pool.emit(i, 0, 0, 0, 1, 0, 1, 0.5, 1, 1, 1, 0, 1);
    expect(pool.nextSlot).toBe(1); // 5 emits over 4 slots wrapped once
    expect(pool.isAlive(0)).toBe(true);
    pool.update(0.25, cam);
    expect(pool.isAlive(0)).toBe(true);
    pool.update(0.3, cam);
    expect(pool.isAlive(0)).toBe(false);
    pool.clear();
    for (let i = 0; i < 4; i++) expect(pool.isAlive(i)).toBe(false);
  });
});

describe("material presets", () => {
  it("every kind has either a ramp or a special flag", () => {
    for (const [name, k] of Object.entries(KINDS)) {
      const ok = !!k.ramp || k.unlit === 1 || k.sky === 1;
      expect(ok, name).toBe(true);
    }
  });
});
