import { describe, expect, it } from "vitest";
import { BONES, CHARACTER_HEIGHT, CharacterKit, CLIPS } from "./characters";

describe("Reddie character kit (T-271)", () => {
  const kit = CharacterKit.build();

  it("is one skinned geometry with a tint mask and per-vertex bone bindings", () => {
    const g = kit.geometry;
    for (const name of ["position", "normal", "uv", "color", "skinIndex", "skinWeight"]) expect(g.attributes[name]).toBeDefined();
    expect(g.attributes.color.itemSize).toBe(4);
    const col = g.attributes.color.array as Float32Array;
    let tinted = 0;
    for (let i = 3; i < col.length; i += 4) if (col[i] === 1) tinted++;
    expect(tinted).toBeGreaterThan(0); // shoulders, emblem, belt take the division colour
    expect(tinted).toBeLessThan(col.length / 4 / 2); // …but most of the body stays Reddie red
    const sw = g.attributes.skinWeight.array as Float32Array;
    for (let i = 0; i < sw.length; i += 4) expect(sw[i]).toBe(1);
  });

  it("stands on the ground at the mascot height", () => {
    const bb = kit.geometry.boundingBox!;
    expect(bb.min.y).toBeGreaterThan(-0.01);
    expect(bb.max.y).toBeCloseTo(CHARACTER_HEIGHT, 1);
    expect(bb.max.x).toBeLessThan(0.5);
  });

  it("has all five clips, each driving every bone plus the hips position", () => {
    const names = ["idle", "work", "walk", "wave", "panic"] as const;
    for (const n of names) {
      const clip = kit.clips.get(n)!;
      expect(clip).toBeDefined();
      expect(clip.duration).toBe(CLIPS[n].duration);
      const targets = new Set(clip.tracks.map((t) => t.name));
      for (const [bone] of BONES) if (bone !== "root") expect(targets.has(`${bone}.quaternion`)).toBe(true);
      expect(targets.has("hips.position")).toBe(true);
    }
  });

  it("sits on the chair when working: hips lowered, thighs forward, arms out", () => {
    const w = CLIPS.work.tracks;
    expect(w.hips.pos![0][2]).toBeLessThan(0.6);
    expect(w.hip_L.rot![0][1]).toBeLessThan(-60);
    expect(w.knee_L.rot![0][1]).toBeGreaterThan(60);
    expect(w.shoulder_R.rot![0][1]).toBeLessThan(-30);
  });
});
