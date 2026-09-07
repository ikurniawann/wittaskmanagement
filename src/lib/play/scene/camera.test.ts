import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { groundBasis } from "./camera";

describe("groundBasis", () => {
  const up = new THREE.Vector3(0, 1, 0);
  it("right is screen-right (fwd × up) for every yaw step", () => {
    for (let k = 0; k < 8; k++) {
      const yaw = (k * Math.PI) / 4;
      const { fwd, right } = groundBasis(yaw);
      const expected = new THREE.Vector3().crossVectors(fwd, up);
      expect(right.distanceTo(expected)).toBeLessThan(1e-9);
      expect(Math.abs(fwd.y)).toBe(0);
      expect(Math.abs(right.length() - 1)).toBeLessThan(1e-9);
    }
  });
  it("at yaw 0 the camera looks down -z and right is +x", () => {
    const { fwd, right } = groundBasis(0);
    expect(fwd.z).toBeCloseTo(-1);
    expect(right.x).toBeCloseTo(1);
  });
});
