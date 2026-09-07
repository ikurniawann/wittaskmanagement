import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { materialFactory, type SharedUniforms, type UnifiedMaterial } from "../engine";

// EPIC-024 T-244 — rigged characters through the unified shader.
//
// The source model (RobotExpressive, CC0, public/play/robot.glb) is 14 meshes:
// twelve rigid parts parented to bones and two skinned hands. Drawing that as-is
// costs 14 draw calls per character. Instead every part is folded into ONE
// SkinnedMesh: rigid parts get a single 100 % weight on their parent bone, the
// hands keep their weights remapped onto one shared skeleton. Result: one draw
// call per character, one material, the same program family as everything else.
//
// Vertex colour alpha is a TINT MASK: 1 = takes the division colour (uColor),
// 0 = keeps its own colour (grey / black details). See FS_UNIFIED.

export type ClipName = "idle" | "work" | "walk" | "wave" | "panic";
const CLIP_SOURCE: Record<ClipName, string> = { idle: "Idle", work: "Sitting", walk: "Walking", wave: "Wave", panic: "No" };

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

export class CharacterKit {
  private static loading: Promise<CharacterKit> | null = null;

  private constructor(
    readonly geometry: THREE.BufferGeometry,
    private readonly rigTemplate: THREE.Object3D,
    private readonly boneNames: string[],
    private readonly boneInverses: THREE.Matrix4[],
    readonly clips: Map<ClipName, THREE.AnimationClip>,
    /** Model height after scaling to `height` metres. */
    readonly scale: number,
  ) {}

  /** Load once per page; every scene shares the geometry and clips. */
  static load(url = "/play/robot.glb", height = 1.75): Promise<CharacterKit> {
    if (!CharacterKit.loading) CharacterKit.loading = CharacterKit.build(url, height).catch((e) => { CharacterKit.loading = null; throw e; });
    return CharacterKit.loading;
  }

  private static async build(url: string, height: number): Promise<CharacterKit> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    root.updateMatrixWorld(true);

    // bones in a stable order, bind inverses from the loaded (rest) pose
    const bones: THREE.Bone[] = [];
    root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
    const boneIndex = new Map(bones.map((b, i) => [b, i]));
    const boneInverses = bones.map((b) => b.matrixWorld.clone().invert());

    // fold every part into one geometry in root space
    const parts: THREE.BufferGeometry[] = [];
    const nm = new THREE.Matrix3();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()) as THREE.BufferGeometry;
      for (const k of Object.keys(g.morphAttributes)) delete g.morphAttributes[k];
      const n = g.attributes.position.count;
      g.applyMatrix4(m.matrixWorld);
      nm.getNormalMatrix(m.matrixWorld);
      const col = new Float32Array(n * 4);
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      const tint = mat.name === "Main";
      const c = tint ? new THREE.Color(1, 1, 1) : mat.color.clone();
      for (let i = 0; i < n; i++) { col[i * 4] = c.r; col[i * 4 + 1] = c.g; col[i * 4 + 2] = c.b; col[i * 4 + 3] = tint ? 1 : 0; }
      g.setAttribute("color", new THREE.BufferAttribute(col, 4));
      const si = new Float32Array(n * 4), sw = new Float32Array(n * 4);
      const sk = m as THREE.SkinnedMesh;
      if (sk.isSkinnedMesh && g.attributes.skinIndex) {
        const osi = g.attributes.skinIndex, osw = g.attributes.skinWeight;
        for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) {
          const b = sk.skeleton.bones[osi.getComponent(i, k)];
          si[i * 4 + k] = b ? (boneIndex.get(b) ?? 0) : 0;
          sw[i * 4 + k] = osw.getComponent(i, k);
        }
      } else {
        let p: THREE.Object3D | null = m.parent, bi = 0;
        while (p && !(p as THREE.Bone).isBone) p = p.parent;
        if (p) bi = boneIndex.get(p as THREE.Bone) ?? 0;
        for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
      }
      g.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
      g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      parts.push(g);
    });
    const geometry = mergeSkinned(parts);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const scale = height / Math.max(0.001, bb.max.y - bb.min.y);
    // shift feet to y = 0 and bake the scale so characters place at ground level
    const fix = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(0, -bb.min.y, 0));
    geometry.applyMatrix4(fix);
    // bones must see the same root transform: bind inverses absorb it
    const fixInv = fix.clone().invert();
    const inverses = boneInverses.map((inv) => inv.clone().multiply(fixInv));
    geometry.computeBoundingSphere();

    // rig template = the node tree without meshes; per-character clones come from it
    const rig = root.clone(true);
    const drop: THREE.Object3D[] = [];
    rig.traverse((o) => { if ((o as THREE.Mesh).isMesh) drop.push(o); });
    drop.forEach((o) => o.parent?.remove(o));
    rig.applyMatrix4(fix); // root carries the scale/offset so bone.matrixWorld = fix * chain
    const boneNames = bones.map((b) => b.name);

    const clips = new Map<ClipName, THREE.AnimationClip>();
    const nameSet = new Set<string>();
    rig.traverse((o) => nameSet.add(o.name));
    for (const [key, src] of Object.entries(CLIP_SOURCE) as [ClipName, string][]) {
      const clip = gltf.animations.find((a) => a.name === src);
      if (!clip) continue;
      // keep only tracks that target nodes still present in the rig
      const tracks = clip.tracks.filter((t) => nameSet.has(t.name.split(".")[0]));
      clips.set(key, new THREE.AnimationClip(clip.name, clip.duration, tracks));
    }
    return new CharacterKit(geometry, rig, boneNames, inverses, clips, scale);
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
