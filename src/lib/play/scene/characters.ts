import * as THREE from "three";
import { materialFactory, type SharedUniforms, type UnifiedMaterial } from "../engine";

// EPIC-027 T-271 — the Reddie robot, built in code.
//
// Every character is the reddie.id mascot: a big red round helmet with a dark
// visor and two white eyes, a red body with dark ball joints, stubby legs.
// Nothing is loaded: the rig (13 bones), the mesh (rigid parts bound 100 % to
// their bone) and the five clips are authored here, so the kit is ready the
// moment the scene is — no glTF, no fetch, no CC0 model to credit.
//
// Same contract as the previous glTF kit (EPIC-024 T-244): ONE SkinnedMesh per
// character through the unified shader, one draw call, vertex-colour alpha as
// the division tint mask (1 = takes uColor, 0 = keeps its own colour). The
// division colour lands on the shoulder balls, the chest emblem and the belt,
// so a room still reads as one team while everyone is unmistakably Reddie.

export type ClipName = "idle" | "work" | "walk" | "wave" | "panic";

export type Character = {
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  material: UnifiedMaterial;
  mixer: THREE.AnimationMixer;
  play: (clip: ClipName, fade?: number) => void;
  /** Invisible box used for cheap picking instead of the skinned triangles. */
  proxy: THREE.Mesh;
  dispose: () => void;
};

/** Standing height in metres; the head top is where cosmetics sit (see office.ts). */
export const CHARACTER_HEIGHT = 1.72;

const RED = 0xd62b2b, RED_DARK = 0xa81f24, DARK = 0x1c1c22, GREY = 0x3a3d45, WHITE = 0xffffff;

/** Rest pose: bone name, parent, world position. Children hang straight down from their joint. */
export const BONES: readonly [name: string, parent: string | null, x: number, y: number, z: number][] = [
  ["root", null, 0, 0, 0],
  ["hips", "root", 0, 0.88, 0],
  ["spine", "hips", 0, 0.96, 0],
  ["neck", "spine", 0, 1.3, 0],
  ["head", "neck", 0, 1.36, 0],
  ["shoulder_L", "spine", 0.26, 1.24, 0],
  ["elbow_L", "shoulder_L", 0.26, 1.0, 0],
  ["shoulder_R", "spine", -0.26, 1.24, 0],
  ["elbow_R", "shoulder_R", -0.26, 1.0, 0],
  ["hip_L", "hips", 0.12, 0.86, 0],
  ["knee_L", "hip_L", 0.12, 0.46, 0],
  ["hip_R", "hips", -0.12, 0.86, 0],
  ["knee_R", "hip_R", -0.12, 0.46, 0],
];

type Part = { g: THREE.BufferGeometry; c: number; tint?: boolean; bone: string; m: THREE.Matrix4 };

const _o = new THREE.Object3D();
function at(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz); _o.scale.set(sx, sy, sz); _o.updateMatrix();
  return _o.matrix.clone();
}

/** The mascot's body parts in rest-pose world space. Mirrored parts are generated for both sides. */
function bodyParts(): Part[] {
  const parts: Part[] = [];
  const HEAD_Y = 1.42, HR = 0.34;
  // helmet: a slightly squashed sphere; visor: a front patch of a marginally larger sphere
  parts.push({ g: new THREE.SphereGeometry(HR, 22, 16), c: RED, bone: "head", m: at(0, HEAD_Y, 0, 0, 0, 0, 1, 0.88, 0.96) });
  parts.push({ g: new THREE.SphereGeometry(HR + 0.006, 22, 12, Math.PI / 2 - 1.0, 2.0, Math.PI / 2 - 0.62, 1.12), c: DARK, bone: "head", m: at(0, HEAD_Y, 0, 0, 0, 0, 1, 0.88, 0.96) });
  // helmet brow ridge along the visor's top edge (a horizontal torus arc centred on +Z)
  parts.push({ g: new THREE.TorusGeometry(0.285, 0.03, 6, 24, 2.0), c: RED_DARK, bone: "head", m: at(0, HEAD_Y + 0.175, 0, Math.PI / 2, 0, Math.PI / 2 - 1.0, 1, 1, 0.96) });
  // eyes + smile on the visor surface
  for (const sx of [-1, 1]) parts.push({ g: new THREE.SphereGeometry(0.042, 10, 8), c: WHITE, bone: "head", m: at(sx * 0.1, HEAD_Y + 0.02, 0.318, 0, 0, 0, 1, 1.45, 0.5) });
  parts.push({ g: new THREE.TorusGeometry(0.05, 0.012, 5, 12, Math.PI), c: WHITE, bone: "head", m: at(0, HEAD_Y - 0.1, 0.325, 0, 0, Math.PI, 1, 0.6, 0.5) });
  // ears: red disc with a dark centre
  for (const sx of [-1, 1]) {
    parts.push({ g: new THREE.CylinderGeometry(0.075, 0.075, 0.06, 14), c: RED_DARK, bone: "head", m: at(sx * (HR - 0.005), HEAD_Y, 0, 0, 0, Math.PI / 2) });
    parts.push({ g: new THREE.CylinderGeometry(0.045, 0.045, 0.02, 12), c: DARK, bone: "head", m: at(sx * (HR + 0.03), HEAD_Y, 0, 0, 0, Math.PI / 2) });
  }
  // neck
  parts.push({ g: new THREE.CylinderGeometry(0.065, 0.07, 0.14, 12), c: DARK, bone: "neck", m: at(0, 1.3, 0) });
  // torso: chest (spine) + belly (hips) + dark grille + tinted emblem + tinted belt
  parts.push({ g: new THREE.SphereGeometry(0.2, 18, 14), c: RED, bone: "spine", m: at(0, 1.13, 0, 0, 0, 0, 1.08, 1.12, 0.82) });
  parts.push({ g: new THREE.SphereGeometry(0.175, 16, 12), c: RED_DARK, bone: "hips", m: at(0, 0.95, 0, 0, 0, 0, 1.1, 0.78, 0.9) });
  parts.push({ g: new THREE.BoxGeometry(0.2, 0.1, 0.03), c: DARK, bone: "spine", m: at(0, 1.05, 0.15) });
  parts.push({ g: new THREE.CylinderGeometry(0.05, 0.05, 0.03, 14), c: WHITE, tint: true, bone: "spine", m: at(0, 1.17, 0.165, Math.PI / 2, 0, 0) });
  parts.push({ g: new THREE.CylinderGeometry(0.195, 0.195, 0.05, 18, 1, true), c: WHITE, tint: true, bone: "hips", m: at(0, 1.0, 0, 0, 0, 0, 1, 1, 0.85) });
  // arms: tinted shoulder ball, red upper arm, dark elbow, red forearm, dark-red hand
  for (const sx of [-1, 1]) {
    const sh = sx < 0 ? "shoulder_R" : "shoulder_L", el = sx < 0 ? "elbow_R" : "elbow_L";
    parts.push({ g: new THREE.SphereGeometry(0.085, 14, 10), c: WHITE, tint: true, bone: sh, m: at(sx * 0.26, 1.24, 0) });
    parts.push({ g: new THREE.CapsuleGeometry(0.06, 0.14, 4, 10), c: RED, bone: sh, m: at(sx * 0.26, 1.12, 0) });
    parts.push({ g: new THREE.SphereGeometry(0.058, 12, 8), c: DARK, bone: el, m: at(sx * 0.26, 1.0, 0) });
    parts.push({ g: new THREE.CapsuleGeometry(0.056, 0.12, 4, 10), c: RED, bone: el, m: at(sx * 0.26, 0.9, 0) });
    parts.push({ g: new THREE.SphereGeometry(0.062, 12, 8), c: RED_DARK, bone: el, m: at(sx * 0.26, 0.79, 0, 0, 0, 0, 0.9, 1.1, 0.6) });
  }
  // legs: dark hip ball, red thigh, dark knee, red shin, dark foot
  for (const sx of [-1, 1]) {
    const hp = sx < 0 ? "hip_R" : "hip_L", kn = sx < 0 ? "knee_R" : "knee_L";
    parts.push({ g: new THREE.SphereGeometry(0.07, 12, 8), c: DARK, bone: hp, m: at(sx * 0.12, 0.86, 0) });
    parts.push({ g: new THREE.CapsuleGeometry(0.085, 0.2, 4, 12), c: RED, bone: hp, m: at(sx * 0.12, 0.66, 0) });
    parts.push({ g: new THREE.SphereGeometry(0.062, 12, 8), c: DARK, bone: kn, m: at(sx * 0.12, 0.46, 0) });
    parts.push({ g: new THREE.CylinderGeometry(0.075, 0.095, 0.3, 12), c: RED, bone: kn, m: at(sx * 0.12, 0.27, 0) });
    parts.push({ g: new THREE.CylinderGeometry(0.11, 0.12, 0.09, 14), c: DARK, bone: kn, m: at(sx * 0.12, 0.045, 0.01) });
    parts.push({ g: new THREE.CylinderGeometry(0.1, 0.11, 0.02, 14), c: GREY, bone: kn, m: at(sx * 0.12, 0.1, 0.01) });
  }
  return parts;
}

// ---- clips ---------------------------------------------------------------------
type Deg = [x: number, y: number, z: number];
type Keys = { rot?: [t: number, ...Deg][]; pos?: [t: number, x: number, y: number, z: number][] };
type ClipSpec = { duration: number; tracks: Record<string, Keys> };

const D = Math.PI / 180;
const _e = new THREE.Euler(), _q = new THREE.Quaternion();

/** Local rest position of a bone (relative to its parent). */
function localRest(name: string): [number, number, number] {
  const b = BONES.find((x) => x[0] === name)!;
  const p = b[1] ? BONES.find((x) => x[0] === b[1])! : null;
  return p ? [b[2] - p[2], b[3] - p[3], b[4] - p[4]] : [b[2], b[3], b[4]];
}

/**
 * Build a clip. Every bone gets a rotation track (rest = identity when the spec
 * omits it) and `hips` always gets a position track, so cross-fades between any
 * two clips blend every joint instead of leaving a limb where the last clip put it.
 */
function makeClip(name: string, spec: ClipSpec): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [bone] of BONES) {
    if (bone === "root") continue;
    const keys = spec.tracks[bone]?.rot ?? [[0, 0, 0, 0], [spec.duration, 0, 0, 0]];
    const times: number[] = [], values: number[] = [];
    for (const [t, x, y, z] of keys) {
      _q.setFromEuler(_e.set(x * D, y * D, z * D));
      times.push(t); values.push(_q.x, _q.y, _q.z, _q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  }
  const rest = localRest("hips");
  const pk = spec.tracks.hips?.pos ?? [[0, ...rest], [spec.duration, ...rest]];
  tracks.push(new THREE.VectorKeyframeTrack("hips.position", pk.map((k) => k[0]), pk.flatMap((k) => [k[1], k[2], k[3]])));
  return new THREE.AnimationClip(name, spec.duration, tracks);
}

/** Facing +Z. Legs forward = negative X rotation; the -X (right) arm lifts outward with negative Z. */
export const CLIPS: Record<ClipName, ClipSpec> = {
  idle: {
    duration: 2.4,
    tracks: {
      hips: { pos: [[0, 0, 0.88, 0], [1.2, 0, 0.895, 0], [2.4, 0, 0.88, 0]] },
      spine: { rot: [[0, 0, 0, 0], [1.2, 1.5, 0, 0], [2.4, 0, 0, 0]] },
      head: { rot: [[0, 0, 0, 0], [0.6, 0, 5, 0], [1.2, 0, 0, 0], [1.8, 0, -5, 0], [2.4, 0, 0, 0]] },
      shoulder_L: { rot: [[0, 0, 0, 0], [1.2, 0, 0, 3], [2.4, 0, 0, 0]] },
      shoulder_R: { rot: [[0, 0, 0, 0], [1.2, 0, 0, -3], [2.4, 0, 0, 0]] },
    },
  },
  // seated at the desk: hips on the chair, thighs forward, arms typing
  work: {
    duration: 1.2,
    tracks: {
      hips: { pos: [[0, 0, 0.56, 0], [1.2, 0, 0.56, 0]] },
      spine: { rot: [[0, 6, 0, 0], [1.2, 6, 0, 0]] },
      head: { rot: [[0, 8, 0, 0], [0.6, 8, 3, 0], [1.2, 8, 0, 0]] },
      hip_L: { rot: [[0, -85, 0, 0], [1.2, -85, 0, 0]] },
      hip_R: { rot: [[0, -85, 0, 0], [1.2, -85, 0, 0]] },
      knee_L: { rot: [[0, 82, 0, 0], [1.2, 82, 0, 0]] },
      knee_R: { rot: [[0, 82, 0, 0], [1.2, 82, 0, 0]] },
      shoulder_L: { rot: [[0, -55, 0, 0], [1.2, -55, 0, 0]] },
      shoulder_R: { rot: [[0, -55, 0, 0], [1.2, -55, 0, 0]] },
      elbow_L: { rot: [[0, -22, 0, 0], [0.3, -32, 0, 0], [0.6, -22, 0, 0], [0.9, -14, 0, 0], [1.2, -22, 0, 0]] },
      elbow_R: { rot: [[0, -22, 0, 0], [0.3, -14, 0, 0], [0.6, -22, 0, 0], [0.9, -32, 0, 0], [1.2, -22, 0, 0]] },
    },
  },
  walk: {
    duration: 0.9,
    tracks: {
      hips: { pos: [[0, 0, 0.88, 0], [0.225, 0, 0.865, 0], [0.45, 0, 0.88, 0], [0.675, 0, 0.865, 0], [0.9, 0, 0.88, 0]] },
      spine: { rot: [[0, 4, 0, 0], [0.9, 4, 0, 0]] },
      hip_L: { rot: [[0, -30, 0, 0], [0.45, 30, 0, 0], [0.9, -30, 0, 0]] },
      hip_R: { rot: [[0, 30, 0, 0], [0.45, -30, 0, 0], [0.9, 30, 0, 0]] },
      knee_L: { rot: [[0, 5, 0, 0], [0.45, 5, 0, 0], [0.675, 48, 0, 0], [0.9, 5, 0, 0]] },
      knee_R: { rot: [[0, 5, 0, 0], [0.225, 48, 0, 0], [0.45, 5, 0, 0], [0.9, 5, 0, 0]] },
      shoulder_L: { rot: [[0, 25, 0, 0], [0.45, -25, 0, 0], [0.9, 25, 0, 0]] },
      shoulder_R: { rot: [[0, -25, 0, 0], [0.45, 25, 0, 0], [0.9, -25, 0, 0]] },
      elbow_L: { rot: [[0, -15, 0, 0], [0.9, -15, 0, 0]] },
      elbow_R: { rot: [[0, -15, 0, 0], [0.9, -15, 0, 0]] },
    },
  },
  wave: {
    duration: 1.6,
    tracks: {
      hips: { pos: [[0, 0, 0.88, 0], [1.6, 0, 0.88, 0]] },
      head: { rot: [[0, 0, 0, 0], [0.8, 0, 8, 6], [1.6, 0, 0, 0]] },
      shoulder_R: { rot: [[0, 0, 0, -150], [1.6, 0, 0, -150]] },
      elbow_R: { rot: [[0, 0, 0, -25], [0.4, 0, 0, 25], [0.8, 0, 0, -25], [1.2, 0, 0, 25], [1.6, 0, 0, -25]] },
      shoulder_L: { rot: [[0, 0, 0, 6], [1.6, 0, 0, 6]] },
    },
  },
  panic: {
    duration: 0.7,
    tracks: {
      hips: { pos: [[0, 0, 0.88, 0], [0.35, 0, 0.93, 0], [0.7, 0, 0.88, 0]] },
      head: { rot: [[0, 0, -15, 0], [0.35, 0, 15, 0], [0.7, 0, -15, 0]] },
      shoulder_L: { rot: [[0, 0, 0, 150], [0.7, 0, 0, 150]] },
      shoulder_R: { rot: [[0, 0, 0, -150], [0.7, 0, 0, -150]] },
      elbow_L: { rot: [[0, 0, 0, 15], [0.35, 0, 0, -15], [0.7, 0, 0, 15]] },
      elbow_R: { rot: [[0, 0, 0, -15], [0.35, 0, 0, 15], [0.7, 0, 0, -15]] },
    },
  },
};

export class CharacterKit {
  private static loading: Promise<CharacterKit> | null = null;

  private constructor(
    readonly geometry: THREE.BufferGeometry,
    private readonly rigTemplate: THREE.Object3D,
    private readonly boneNames: string[],
    private readonly boneInverses: THREE.Matrix4[],
    readonly clips: Map<ClipName, THREE.AnimationClip>,
    /** Model height in metres. */
    readonly scale: number,
  ) {}

  /** Build once per page; every scene shares the geometry and clips. Async to keep the old contract. */
  static load(): Promise<CharacterKit> {
    if (!CharacterKit.loading) CharacterKit.loading = Promise.resolve().then(() => CharacterKit.build()).catch((e) => { CharacterKit.loading = null; throw e; });
    return CharacterKit.loading;
  }

  /** Synchronous construction — exposed for tests. */
  static build(): CharacterKit {
    // rig: bones in the table's order, positioned locally, world matrices from the rest pose
    const rig = new THREE.Group();
    rig.name = "reddie";
    const bones: THREE.Bone[] = [];
    const byName = new Map<string, THREE.Bone>();
    for (const [name, parent] of BONES) {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(...localRest(name));
      (parent ? byName.get(parent)! : rig).add(b);
      bones.push(b);
      byName.set(name, b);
    }
    rig.updateMatrixWorld(true);
    const boneIndex = new Map(bones.map((b, i) => [b.name, i]));
    const inverses = bones.map((b) => b.matrixWorld.clone().invert());

    // mesh: every part in rest-pose world space, bound 100 % to its bone
    const parts = bodyParts().map((p) => {
      const g = (p.g.index ? p.g.toNonIndexed() : p.g.clone()) as THREE.BufferGeometry;
      p.g.dispose();
      g.applyMatrix4(p.m);
      const n = g.attributes.position.count;
      const c = new THREE.Color(p.c);
      const col = new Float32Array(n * 4), si = new Float32Array(n * 4), sw = new Float32Array(n * 4);
      const bi = boneIndex.get(p.bone) ?? 0;
      for (let i = 0; i < n; i++) {
        col[i * 4] = c.r; col[i * 4 + 1] = c.g; col[i * 4 + 2] = c.b; col[i * 4 + 3] = p.tint ? 1 : 0;
        si[i * 4] = bi; sw[i * 4] = 1;
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 4));
      g.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
      g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      return g;
    });
    const geometry = mergeSkinned(parts);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const clips = new Map<ClipName, THREE.AnimationClip>();
    for (const [name, spec] of Object.entries(CLIPS) as [ClipName, ClipSpec][]) clips.set(name, makeClip(name, spec));
    return new CharacterKit(geometry, rig, bones.map((b) => b.name), inverses, clips, CHARACTER_HEIGHT);
  }

  create(shared: SharedUniforms, tint: THREE.ColorRepresentation): Character {
    const rig = this.rigTemplate.clone(true);
    const bones = this.boneNames.map((n) => rig.getObjectByName(n) as THREE.Bone);
    const skeleton = new THREE.Skeleton(bones, this.boneInverses.map((m) => m.clone()));
    const material = materialFactory(shared, tint, "skin", { normalOffset: 0.08 });
    const mesh = new THREE.SkinnedMesh(this.geometry, material);
    mesh.frustumCulled = false; // bounds are in bind pose; the characters are few
    mesh.bind(skeleton, new THREE.Matrix4());
    const group = new THREE.Group();
    group.add(rig, mesh);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.7), new THREE.MeshBasicMaterial());
    proxy.position.y = 0.9;
    proxy.visible = false;
    group.add(proxy);
    const mixer = new THREE.AnimationMixer(rig);
    let current: THREE.AnimationAction | null = null;
    const play = (name: ClipName, fade = 0.3) => {
      const clip = this.clips.get(name) ?? this.clips.get("idle");
      if (!clip) return;
      const next = mixer.clipAction(clip);
      if (current === next) return;
      next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(fade).play();
      if (current) current.fadeOut(fade);
      current = next;
    };
    return {
      group, mesh, material, mixer, play, proxy,
      dispose: () => { mixer.stopAllAction(); material.dispose(); skeleton.dispose(); (proxy.material as THREE.Material).dispose(); proxy.geometry.dispose(); },
    };
  }
}

/** Merge non-indexed geometries that all carry position/normal/uv/color(4)/skinIndex/skinWeight. */
function mergeSkinned(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ["position", "normal", "uv", "color", "skinIndex", "skinWeight"] as const;
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const item = parts[0].attributes[name].itemSize;
    const total = parts.reduce((s, g) => s + g.attributes[name].count, 0);
    const arr = new Float32Array(total * item);
    let o = 0;
    for (const g of parts) { arr.set(g.attributes[name].array as Float32Array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, item));
  }
  parts.forEach((g) => g.dispose());
  return out;
}
