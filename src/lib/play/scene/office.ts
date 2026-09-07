import * as THREE from "three";
import {
  castShadow,
  GameLoop,
  InstancedManager,
  type InstanceRecord,
  materialFactory,
  mergeParts,
  ParticlePool,
  partMatrix,
  PlayRenderer,
  srgbToLinear,
  type UnifiedMaterial,
} from "../engine";
import type { PlayHandoff, PlayTask, PlayWorld } from "../types";
import { layout, type DeskSlot, type OfficeLayout, type Room } from "../world/layout";
import { mapTask, personClip, type TaskVisual } from "../world/mapping";
import { IsoCamera } from "./camera";
import { CharacterKit, type Character, type ClipName } from "./characters";
import { cosmeticsForLevel } from "../xp/badges";
import { boardTexture, bubbleTexture, countdownLabel, drawBoard, signTexture } from "./textures";

// EPIC-024/025 — the office scene. Everything drawn here comes from `layout()`
// and `mapTask()`; the scene holds no rules. Nothing moves unless data changed:
// `applyTask` / `setHandoffs` / `setApprovalsWaiting` / `bubble` are the only
// ways in, and they are driven by the activity stream or by the user's own
// actions.

export type Pick =
  | { kind: "task"; id: string }
  | { kind: "person"; id: string }
  | { kind: "event"; id: string }
  | { kind: "room"; id: string }
  | { kind: "handoff"; id: string }
  | { kind: "approvals" }
  | null;

export type OfficeHandlers = {
  onPick: (p: Pick) => void;
  onHover: (p: Pick) => void;
};

/** Hide/show one static instanced prop; the InstancedManager rewrites its chunk within a few frames. */
function setInstanceScale(r: InstanceRecord, s: number): void { r.sx = s; r.sy = s; r.sz = s; }

type DeskRef = { slot: DeskSlot; room: Room; monitor?: InstanceRecord; chair?: InstanceRecord };
type StackRef = { task: PlayTask; visual: TaskVisual; x: number; y: number; z: number; pop: number; fade: number };
type PersonRef = { id: string; x: number; z: number; facing: number; clip: ClipName; phase: number };
type CourierRef = { handoff: PlayHandoff; char: Character | null; path: THREE.Vector3[]; seg: number; t: number; done: boolean; placeholderIndex: number };
type Bubble = { mesh: THREE.Mesh; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; life: number; x: number; z: number };

const hex = (c: string) => parseInt(c.replace("#", ""), 16);
const WALK_SPEED = 1.4;
const BUBBLE_LIFE = 6;

export class OfficeScene {
  readonly world: PlayWorld;
  readonly layout: OfficeLayout;
  private readonly r: PlayRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: IsoCamera;
  private readonly loop: GameLoop;
  private readonly instanced: InstancedManager;
  private readonly particles: ParticlePool;
  private readonly container: HTMLElement;
  private readonly ro: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly deskOf = new Map<string, DeskRef>(); // personId → desk
  private readonly stacks: StackRef[] = [];
  private readonly deskOrder = new Map<string, string[]>(); // desk key → task ids in slot order
  private readonly people: PersonRef[] = [];
  private readonly characters = new Map<string, Character>(); // personId → rigged character
  private kit: CharacterKit | null = null;
  private kitFailed = false;
  private stackMesh!: THREE.InstancedMesh;
  private auraMesh!: THREE.InstancedMesh;
  private chainMesh!: THREE.InstancedMesh;
  private ghostMesh!: THREE.InstancedMesh;
  private taskCap = 0;
  private ghostCap = 0;
  private personMesh!: THREE.InstancedMesh;
  private courierMesh!: THREE.InstancedMesh;
  private readonly couriers: CourierRef[] = [];
  private envelopeMesh: THREE.InstancedMesh | null = null;
  private readonly boards: { id: string; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mesh: THREE.Mesh; name: string; showDate: string | null; phase: string; health: string | null }[] = [];
  private readonly bubbles: Bubble[] = [];
  private readonly highlight: THREE.Mesh;
  private readonly pickables: THREE.Object3D[] = [];
  private readonly dummy = new THREE.Object3D();
  private sky!: THREE.Mesh;
  private time = 0;
  private lastBoard = 0;
  private lastSmoke = 0;
  private hovered: Pick = null;
  private readonly stats: HTMLDivElement;
  private statsOn = false;
  private disposed = false;
  private reducedMotion = false;
  private tweening = false;
  fpsSamples: number[] = [];

  constructor(container: HTMLElement, world: PlayWorld, private readonly handlers: OfficeHandlers) {
    this.container = container;
    this.world = world;
    this.layout = layout(world.divisions);
    const b = this.layout.bounds;
    this.r = new PlayRenderer(container, undefined, { fogNear: 260, fogFar: 700 });
    this.r.canvas.style.display = "block";
    this.r.canvas.style.touchAction = "none";
    this.r.canvas.tabIndex = 0;
    this.instanced = new InstancedManager(this.r.tier.chunks, { cell: 30, fadeStart: 220, fadeEnd: 300 });
    this.particles = new ParticlePool(this.r.tier.particles, this.r.shared);
    this.scene.add(this.particles.mesh);
    this.camera = new IsoCamera(this.r.canvas, 1, (x, y) => this.handlers.onPick(this.castFrom(x, y)), (x, y) => this.hoverAt(x, y));
    this.highlight = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 32), materialFactory(this.r.shared, 0xffffff, "glow", { emissive: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.stats = document.createElement("div");
    this.stats.style.cssText = "position:absolute;left:8px;top:40px;z-index:5;padding:6px 8px;background:rgba(0,0,0,.55);color:#fff;font:12px/1.4 ui-monospace,monospace;white-space:pre;pointer-events:none;display:none";
    container.appendChild(this.stats);

    this.buildStatic();
    this.buildPeople();
    this.buildTasks();
    this.buildCouriers(world.handoffs);
    this.buildBoards();
    this.buildApprovalRoom(world.approvalsWaiting);
    this.buildBubbles();
    this.instanced.build(this.scene);

    const mine = this.deskOf.get(world.me.id);
    if (mine) this.camera.jump(mine.slot.x, mine.slot.z, 34);
    else this.camera.jump(b.x + b.w / 2, this.layout.lobby.z + this.layout.lobby.d / 2, 60);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.loop = new GameLoop({
      render: (dt, now) => this.frame(dt, now),
      applyPixelRatio: (ratio) => { this.r.setPixelRatio(ratio); this.resize(); },
    });
    this.loop.start();
    window.addEventListener("keydown", this.onKey);
    void this.loadCharacters();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === "F3") { e.preventDefault(); this.statsOn = !this.statsOn; this.stats.style.display = this.statsOn ? "block" : "none"; }
  };

  // ---- rigged characters (T-244) --------------------------------------------
  private async loadCharacters(): Promise<void> {
    try {
      this.kit = await CharacterKit.load();
    } catch (e) {
      this.kitFailed = true;
      console.warn("[play] character model unavailable, keeping placeholders", e);
      return;
    }
    if (this.disposed) return;
    for (const p of this.people) this.spawnPerson(p);
    for (const c of this.couriers) this.spawnCourier(c);
    this.personMesh.visible = false;
    this.courierMesh.visible = false;
    const idx = this.pickables.indexOf(this.personMesh);
    if (idx >= 0) this.pickables.splice(idx, 1);
  }

  private spawnPerson(p: PersonRef): void {
    if (!this.kit) return;
    const room = this.deskOf.get(p.id)?.room;
    const tint = hex(this.world.divisions.find((d) => d.id === room?.divisionId)?.color ?? "#999999");
    const char = this.kit.create(this.r.shared, tint);
    char.group.position.set(p.x, 0, p.z);
    char.group.rotation.y = p.facing;
    char.play(p.clip, 0);
    char.mixer.update(p.phase);
    if (this.reducedMotion) char.mixer.timeScale = 0;
    char.proxy.userData.pick = { kind: "person", id: p.id } satisfies Pick;
    castShadow(char.mesh);
    this.scene.add(char.group);
    this.pickables.push(char.proxy);
    this.characters.set(p.id, char);
    this.applyCosmetics(p.id);
  }

  // ---- cosmetics (EPIC-026 T-263): purely visual, unlocked by level -----------------
  private readonly cosmeticMeshes = new Map<string, THREE.Object3D[]>();
  applyCosmetics(personId: string): void {
    const person = this.world.people.find((x) => x.id === personId);
    const char = this.characters.get(personId);
    const desk = this.deskOf.get(personId);
    if (!person || !char) return;
    (this.cosmeticMeshes.get(personId) ?? []).forEach((m) => { m.parent?.remove(m); (m as THREE.Mesh).geometry?.dispose(); });
    const out: THREE.Object3D[] = [];
    const S = this.r.shared, c = person.cosmetics ?? {};
    if (c.hat === "cap") {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 12), materialFactory(S, 0xe62e2e, "skin"));
      cap.position.set(0, 1.72, 0.02);
      const peak = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.18), materialFactory(S, 0xe62e2e, "skin"));
      peak.position.set(0, 1.68, 0.2);
      char.group.add(cap, peak); out.push(cap, peak);
    } else if (c.hat === "crown") {
      const crown = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 6, 10), materialFactory(S, 0xf5c518, "metal", { emissive: 0x4a3a00 }));
      crown.position.set(0, 1.78, 0); crown.rotation.x = Math.PI / 2;
      char.group.add(crown); out.push(crown);
    }
    if (c.plant === "fern" && desk) {
      const fern = new THREE.Mesh(mergeParts([
        { g: new THREE.CylinderGeometry(0.1, 0.08, 0.18, 8), c: 0x8a5a3c, m: partMatrix(0, 0.09, 0) },
        { g: new THREE.SphereGeometry(0.18, 8, 6), c: 0x4fa35a, m: partMatrix(0, 0.3, 0) },
      ]), materialFactory(S, 0xffffff, "foliage"));
      const f = desk.slot.facing;
      fern.position.set(desk.slot.x + Math.cos(f) * 0.7, 0.82, desk.slot.z - Math.sin(f) * 0.7);
      this.scene.add(fern); out.push(fern);
    }
    // Instanced props are static, so an upgraded monitor/chair hides its instance
    // (scale 0, picked up by the next chunk pass) and draws a dedicated mesh instead.
    if (desk?.monitor) setInstanceScale(desk.monitor, c.monitor === "wide" ? 0 : 1);
    if (desk?.chair) setInstanceScale(desk.chair, c.chair === "red" ? 0 : 1);
    if (c.monitor === "wide" && desk) {
      const wide = new THREE.Mesh(mergeParts([
        { g: new THREE.BoxGeometry(1.15, 0.46, 0.04), c: 0x1b1e23, m: partMatrix(0, 1.07, -0.2) },
        { g: new THREE.BoxGeometry(1.05, 0.36, 0.01), c: 0x3a6ea5, m: partMatrix(0, 1.08, -0.175) },
        { g: new THREE.BoxGeometry(0.26, 0.2, 0.1), c: 0x4a4e55, m: partMatrix(0, 0.83, -0.2) },
      ]), materialFactory(S, 0xffffff, "metal"));
      wide.position.set(desk.slot.x, 0, desk.slot.z); wide.rotation.y = desk.slot.facing;
      this.scene.add(wide); out.push(wide);
    }
    if (c.chair === "red" && desk) {
      const f = desk.slot.facing;
      const chair = castShadow(new THREE.Mesh(mergeParts([
        { g: new THREE.BoxGeometry(0.54, 0.1, 0.54), c: 0xc0262e, m: partMatrix(0, 0.46, 0) },
        { g: new THREE.BoxGeometry(0.54, 0.62, 0.1), c: 0xc0262e, m: partMatrix(0, 0.8, -0.24) },
        { g: new THREE.BoxGeometry(0.1, 0.1, 0.4), c: 0x2a2e36, m: partMatrix(-0.3, 0.62, 0) },
        { g: new THREE.BoxGeometry(0.1, 0.1, 0.4), c: 0x2a2e36, m: partMatrix(0.3, 0.62, 0) },
        { g: new THREE.CylinderGeometry(0.04, 0.04, 0.45, 6), c: 0x8c8f94, m: partMatrix(0, 0.22, 0) },
      ]), materialFactory(S, 0xffffff, "metal")));
      chair.position.set(desk.slot.x - Math.sin(f) * 0.9, 0, desk.slot.z - Math.cos(f) * 0.9); chair.rotation.y = f;
      this.scene.add(chair); out.push(chair);
    }
    this.cosmeticMeshes.set(personId, out);
  }

  /** Level-up moment: confetti + bubble + a wave (EPIC-026 T-263). */
  levelUp(personId: string, level: number): void {
    const p = this.personAt(personId);
    const person = this.world.people.find((x) => x.id === personId);
    if (!p) return;
    this.bubble(personId, `Level ${level}!`);
    if (person) { person.level = level; person.cosmetics = cosmeticsForLevel(level); this.applyCosmetics(personId); }
    if (this.reducedMotion) return;
    this.gesture(personId, "wave", 2.5);
    const cols = [[0.9, 0.2, 0.2], [0.95, 0.75, 0.1], [0.2, 0.55, 0.95], [0.3, 0.8, 0.45], [1, 1, 1]];
    for (let i = 0; i < 48; i++) {
      const c = cols[i % cols.length], a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 2;
      this.particles.emit(p.x, 1.9, p.z, Math.cos(a) * sp, 2.5 + Math.random() * 2.5, Math.sin(a) * sp, 0.12, 1.6 + Math.random() * 0.6, c[0], c[1], c[2], 0.2, 1);
    }
  }

  private spawnCourier(c: CourierRef): void {
    if (!this.kit || c.char) return;
    const char = this.kit.create(this.r.shared, 0xf5c518);
    const p = c.path[Math.min(c.seg, c.path.length - 1)];
    char.group.position.copy(p);
    char.play(c.done || this.reducedMotion ? "idle" : "walk", 0);
    char.proxy.userData.pick = { kind: "handoff", id: c.handoff.id } satisfies Pick;
    castShadow(char.mesh);
    this.scene.add(char.group);
    this.pickables.push(char.proxy);
    c.char = char;
  }

  // ---- static geometry ------------------------------------------------------
  private buildStatic(): void {
    const S = this.r.shared, L = this.layout, b = L.bounds;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(880, 24, 12), materialFactory(S, 0xffffff, "sky", { side: THREE.BackSide, depthWrite: false }));
    this.scene.add(this.sky);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), materialFactory(S, 0x6f9a56, "dirt"));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(b.x + b.w / 2, -0.05, b.z + b.d / 2);
    this.scene.add(ground);

    const floorParts: { g: THREE.BufferGeometry; c: number; m: THREE.Matrix4 }[] = [];
    const wallParts: { g: THREE.BufferGeometry; c: number; m: THREE.Matrix4 }[] = [];
    const slab = (r: { x: number; z: number; w: number; d: number }, c: number, y = 0.05) =>
      floorParts.push({ g: new THREE.BoxGeometry(r.w, 0.1, r.d), c, m: partMatrix(r.x + r.w / 2, y, r.z + r.d / 2) });
    slab(L.lobby, 0xd9d4c7);
    L.corridors.forEach((c) => slab(c, 0xc9c4b8));
    slab(L.approvalRoom, 0xd6c7a8);
    const wall = (x: number, z: number, w: number, d: number, c: number) =>
      wallParts.push({ g: new THREE.BoxGeometry(w, 1.1, d), c, m: partMatrix(x + w / 2, 0.55, z + d / 2) });
    const roomWalls = (r: { rect: { x: number; z: number; w: number; d: number }; door: { x: number; z: number } }, c: number) => {
      const { x, z, w, d } = r.rect, t = 0.25, doorW = 3;
      wall(x, z, w, t, c);
      wall(x, z + d - t, w, t, c);
      wall(x, z, t, d, c);
      wall(x + w - t, z, t, d, c);
      wallParts.push({ g: new THREE.BoxGeometry(doorW, 0.02, t * 2), c: 0xd9d4c7, m: partMatrix(r.door.x, 0.06, r.door.z) });
    };
    for (const room of L.rooms) {
      const tint = new THREE.Color(hex(room.color)).lerp(new THREE.Color(0xffffff), 0.55).getHex();
      slab(room.rect, tint);
      roomWalls(room, 0xe9e7e1);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), materialFactory(S, 0xffffff, "glow", { map: signTexture(room.name, room.color), noFog: true }));
      sign.position.set(room.door.x, 2.4, room.door.z + (room.side === -1 ? 0.2 : -0.2));
      sign.rotation.y = room.side === -1 ? 0 : Math.PI;
      sign.userData.pick = { kind: "room", id: room.divisionId } satisfies Pick;
      this.scene.add(sign);
      const wb = new THREE.Mesh(new THREE.BoxGeometry(4, 1.6, 0.1), materialFactory(S, 0xf4f4f2, "skin"));
      wb.position.set(room.whiteboard.x, 1.4, room.whiteboard.z);
      castShadow(wb);
      this.scene.add(wb);
    }
    roomWalls({ rect: L.approvalRoom, door: L.approvalRoom.door }, 0xe6d9bf);
    this.scene.add(new THREE.Mesh(mergeParts(floorParts), materialFactory(S, 0xffffff, "dirt")));
    this.scene.add(castShadow(new THREE.Mesh(mergeParts(wallParts), materialFactory(S, 0xffffff, "metal"))));

    const deskK = this.instanced.addKind("desk", new THREE.BoxGeometry(1.6, 0.08, 0.8), materialFactory(S, 0xc9a97a, "rock"));
    const legK = this.instanced.addKind("legs", new THREE.BoxGeometry(1.5, 0.7, 0.7), materialFactory(S, 0x8a7a66, "rock"), { cast: false });
    const chairK = this.instanced.addKind("chair", mergeParts([
      { g: new THREE.BoxGeometry(0.5, 0.08, 0.5), c: 0x2a2e36, m: partMatrix(0, 0.45, 0) },
      { g: new THREE.BoxGeometry(0.5, 0.5, 0.08), c: 0x2a2e36, m: partMatrix(0, 0.72, -0.22) },
      { g: new THREE.CylinderGeometry(0.04, 0.04, 0.45, 6), c: 0x8c8f94, m: partMatrix(0, 0.22, 0) },
    ]), materialFactory(S, 0xffffff, "metal"));
    const monK = this.instanced.addKind("monitor", mergeParts([
      { g: new THREE.BoxGeometry(0.7, 0.42, 0.04), c: 0x1b1e23, m: partMatrix(0, 1.05, -0.2) },
      { g: new THREE.BoxGeometry(0.2, 0.2, 0.1), c: 0x4a4e55, m: partMatrix(0, 0.83, -0.2) },
    ]), materialFactory(S, 0xffffff, "metal"), { cast: false });
    for (const room of L.rooms) {
      for (const desk of room.desks) {
        const f = desk.facing;
        this.instanced.add(deskK, desk.x, 0.78, desk.z, 0, f, 0, 1);
        this.instanced.add(legK, desk.x, 0.36, desk.z, 0, f, 0, 1);
        const monitor = this.instanced.add(monK, desk.x, 0, desk.z, 0, f, 0, 1);
        const chair = this.instanced.add(chairK, desk.x - Math.sin(f) * 0.9, 0, desk.z - Math.cos(f) * 0.9, 0, f, 0, 1);
        if (desk.personId) this.deskOf.set(desk.personId, { slot: desk, room, monitor, chair });
      }
    }
    const plantK = this.instanced.addKind("plant", mergeParts([
      { g: new THREE.CylinderGeometry(0.22, 0.18, 0.4, 8), c: 0x8a5a3c, m: partMatrix(0, 0.2, 0) },
      { g: new THREE.SphereGeometry(0.42, 8, 6), c: 0x3e8e4e, m: partMatrix(0, 0.75, 0) },
    ]), materialFactory(S, 0xffffff, "foliage"));
    for (const room of L.rooms) this.instanced.add(plantK, room.rect.x + 0.8, 0, room.rect.z + room.rect.d - 0.8, 0, 0, 0, 1);
    // approval room table
    const table = castShadow(new THREE.Mesh(new THREE.BoxGeometry(5, 0.1, 2.2), materialFactory(S, 0x8a5a3c, "rock")));
    table.position.set(L.approvalRoom.x + L.approvalRoom.w / 2, 0.9, L.approvalRoom.z + L.approvalRoom.d / 2);
    table.userData.pick = { kind: "approvals" } satisfies Pick;
    this.scene.add(table);
    this.pickables.push(table);
  }

  // ---- people ---------------------------------------------------------------
  private buildPeople(): void {
    const S = this.r.shared;
    const body = mergeParts([
      { g: new THREE.CapsuleGeometry(0.28, 0.6, 4, 10), c: 0xffffff, m: partMatrix(0, 0.85, 0) },
      { g: new THREE.SphereGeometry(0.22, 12, 10), c: 0xf2d3b8, m: partMatrix(0, 1.5, 0) },
    ]);
    const seated = this.world.people.filter((p) => this.deskOf.has(p.id));
    this.personMesh = new THREE.InstancedMesh(body, materialFactory(S, 0xffffff, "skin"), Math.max(1, seated.length));
    this.personMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.personMesh.name = "people";
    const col = new THREE.Color();
    seated.forEach((p, i) => {
      const d = this.deskOf.get(p.id)!;
      const f = d.slot.facing;
      this.people.push({ id: p.id, x: d.slot.x - Math.sin(f) * 0.9, z: d.slot.z - Math.cos(f) * 0.9, facing: f, clip: "idle", phase: (i * 1.7) % 6.28 });
      this.personMesh.setColorAt(i, col.set(hex(this.world.divisions.find((dv) => dv.id === d.room.divisionId)?.color ?? "#999999")));
    });
    if (seated.length === 0) this.personMesh.count = 0;
    castShadow(this.personMesh);
    this.scene.add(this.personMesh);
    this.pickables.push(this.personMesh);
  }

  private personAt(id: string): PersonRef | undefined {
    return this.people.find((p) => p.id === id);
  }

  /** Recompute the owner clip from their visible stacks; applies to rigged and placeholder alike. */
  private refreshClip(personId: string | null | undefined): void {
    if (!personId) return;
    const p = this.personAt(personId);
    if (!p) return;
    const mine = this.stacks.filter((s) => s.visual.target.kind === "person" && s.visual.target.personId === personId && s.fade === 0).map((s) => s.visual);
    const clip = personClip(mine);
    if (clip === p.clip) return;
    p.clip = clip;
    this.characters.get(personId)?.play(clip);
  }

  /** One-off gesture (e.g. "wave" on completion); returns to the data-driven clip afterwards. */
  private gesture(personId: string, clip: ClipName, seconds: number): void {
    const p = this.personAt(personId), c = this.characters.get(personId);
    if (!p || !c || this.reducedMotion) return;
    c.play(clip);
    window.setTimeout(() => { if (!this.disposed) c.play(p.clip); }, seconds * 1000);
  }

  // ---- tasks -------------------------------------------------------------------
  private deskKey(v: TaskVisual): string {
    return v.target.kind === "person" ? "p:" + v.target.personId : "w:" + v.target.divisionId;
  }

  private slotFor(v: TaskVisual, taskId: string): number {
    const key = this.deskKey(v);
    const list = this.deskOrder.get(key) ?? [];
    let i = list.indexOf(taskId);
    if (i < 0) { i = list.length; list.push(taskId); this.deskOrder.set(key, list); }
    return i;
  }

  private releaseSlot(v: TaskVisual, taskId: string): void {
    const key = this.deskKey(v);
    const list = this.deskOrder.get(key);
    if (!list) return;
    const i = list.indexOf(taskId);
    if (i >= 0) list.splice(i, 1);
  }

  private placeStack(s: StackRef): boolean {
    const v = s.visual;
    if (v.target.kind === "person") {
      const d = this.deskOf.get(v.target.personId);
      if (!d) return false;
      const n = this.slotFor(v, s.task.id), f = d.slot.facing;
      const lx = -0.55 + (n % 3) * 0.5, lz = 0.22 - Math.floor(n / 3) * 0.3;
      s.x = d.slot.x + Math.cos(f) * lx + Math.sin(f) * lz;
      s.z = d.slot.z - Math.sin(f) * lx + Math.cos(f) * lz;
      s.y = 0.82;
      return true;
    }
    const room = this.layout.rooms.find((r) => r.divisionId === (v.target as { divisionId: string }).divisionId);
    if (!room) return false;
    const n = this.slotFor(v, s.task.id);
    s.x = room.whiteboard.x - 1.6 + (n % 8) * 0.45;
    s.z = room.whiteboard.z + (room.side === -1 ? 0.35 : -0.35);
    s.y = 0.05 + Math.floor(n / 8) * 0.2;
    return true;
  }

  private buildTasks(): void {
    for (const t of this.world.tasks) {
      const v = mapTask(t);
      if (!v.visible) continue;
      const s: StackRef = { task: t, visual: v, x: 0, y: 0, z: 0, pop: 0, fade: 0 };
      if (this.placeStack(s)) this.stacks.push(s);
    }
    this.allocTaskMeshes(Math.max(32, this.stacks.length * 2));
    this.allocGhostMesh(Math.max(32, this.stacks.reduce((n, s) => n + s.visual.ghosts, 0) * 2));
    this.writeTaskInstances();
    for (const p of this.people) this.refreshClip(p.id);
  }

  private allocTaskMeshes(cap: number): void {
    const S = this.r.shared;
    if (this.stackMesh) {
      const i = this.pickables.indexOf(this.stackMesh);
      if (i >= 0) this.pickables.splice(i, 1);
      [this.stackMesh, this.auraMesh, this.chainMesh].forEach((m) => { this.scene.remove(m); m.dispose(); });
    }
    this.taskCap = cap;
    this.stackMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 1, 0.42), materialFactory(S, 0xffffff, "skin"), cap);
    this.auraMesh = new THREE.InstancedMesh(new THREE.RingGeometry(0.5, 0.7, 24), materialFactory(S, 0xff5a3c, "glow", { emissive: 0xff5a3c, transparent: true, opacity: 0.7, depthWrite: false, additive: true }), cap);
    this.chainMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(0.14, 0.04, 6, 12), materialFactory(S, 0x4a4e55, "metal"), cap);
    for (const m of [this.stackMesh, this.auraMesh, this.chainMesh]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; }
    this.stackMesh.name = "tasks";
    castShadow(this.stackMesh);
    this.scene.add(this.stackMesh, this.auraMesh, this.chainMesh);
    this.pickables.push(this.stackMesh);
  }

  private allocGhostMesh(cap: number): void {
    if (this.ghostMesh) { this.scene.remove(this.ghostMesh); this.ghostMesh.dispose(); }
    this.ghostCap = cap;
    const geo = mergeParts([{ g: new THREE.CapsuleGeometry(0.24, 0.5, 4, 8), c: 0xffffff, m: partMatrix(0, 0.75, 0) }, { g: new THREE.SphereGeometry(0.2, 10, 8), c: 0xffffff, m: partMatrix(0, 1.35, 0) }]);
    this.ghostMesh = new THREE.InstancedMesh(geo, materialFactory(this.r.shared, 0xbfd9ff, "skin", { transparent: true, opacity: 0.38, depthWrite: false }), cap);
    this.ghostMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ghostMesh.frustumCulled = false;
    this.scene.add(this.ghostMesh);
  }

  /** Write every task-related instance from `stacks` (cheap: tens of matrices). */
  private writeTaskInstances(): void {
    if (this.stacks.length > this.taskCap) this.allocTaskMeshes(this.stacks.length * 2);
    const ghostsNeeded = this.stacks.reduce((n, s) => n + s.visual.ghosts, 0);
    if (ghostsNeeded > this.ghostCap) this.allocGhostMesh(ghostsNeeded * 2);
    const col = new THREE.Color(), d = this.dummy, zero = new THREE.Matrix4().makeScale(0, 0, 0);
    let gi = 0, ai = 0, ci = 0;
    this.stacks.forEach((s, i) => {
      const k = (1 + 0.35 * s.pop) * (1 - s.fade);
      const h = 0.12 * s.visual.stackHeight;
      d.position.set(s.x, s.y + (h * k) / 2, s.z); d.rotation.set(0, 0, 0); d.scale.set(k, h * k, k); d.updateMatrix();
      this.stackMesh.setMatrixAt(i, d.matrix);
      this.stackMesh.setColorAt(i, col.set(hex(s.visual.colour)));
      if (s.visual.aura && s.fade === 0) { d.position.set(s.x, s.y + 0.02, s.z); d.rotation.set(-Math.PI / 2, 0, 0); d.scale.set(k, k, k); d.updateMatrix(); this.auraMesh.setMatrixAt(ai++, d.matrix); }
      if (s.visual.chain && s.fade === 0) { d.position.set(s.x, s.y + h + 0.08, s.z); d.rotation.set(Math.PI / 2, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); this.chainMesh.setMatrixAt(ci++, d.matrix); }
      const desk = s.visual.target.kind === "person" ? this.deskOf.get(s.visual.target.personId) : undefined;
      for (let g = 0; g < s.visual.ghosts && s.fade === 0; g++) {
        const f = desk ? desk.slot.facing : 0;
        const qx = (desk ? desk.slot.x : s.x) + Math.sin(f) * (1.3 + g * 0.7), qz = (desk ? desk.slot.z : s.z) + Math.cos(f) * (1.3 + g * 0.7);
        d.position.set(qx, 0, qz); d.rotation.set(0, f + Math.PI, 0); d.scale.set(1, 1, 1); d.updateMatrix();
        this.ghostMesh.setMatrixAt(gi++, d.matrix);
      }
    });
    for (let i = this.stacks.length; i < this.taskCap; i++) this.stackMesh.setMatrixAt(i, zero);
    for (let i = ai; i < this.taskCap; i++) this.auraMesh.setMatrixAt(i, zero);
    for (let i = ci; i < this.taskCap; i++) this.chainMesh.setMatrixAt(i, zero);
    for (let i = gi; i < this.ghostCap; i++) this.ghostMesh.setMatrixAt(i, zero);
    this.stackMesh.count = Math.max(1, this.stacks.length);
    this.stackMesh.instanceMatrix.needsUpdate = true;
    if (this.stackMesh.instanceColor) this.stackMesh.instanceColor.needsUpdate = true;
    this.auraMesh.instanceMatrix.needsUpdate = true;
    this.chainMesh.instanceMatrix.needsUpdate = true;
    this.ghostMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * The live path (EPIC-025): a task changed somewhere. `task === null` means it is
   * no longer visible to this actor. Restacks the desk, refreshes owner clips, and
   * starts a small pop/fade tween (skipped under reduced motion).
   */
  applyTask(task: PlayTask | null, effect: "restack" | "complete" | "spawn", id?: string): void {
    const taskId = task?.id ?? id;
    if (!taskId) return;
    const idx = this.stacks.findIndex((s) => s.task.id === taskId);
    const prev = idx >= 0 ? this.stacks[idx] : null;
    const v = task ? mapTask(task) : null;
    const gone = !task || !v || !v.visible;
    if (gone) {
      if (!prev) return;
      this.releaseSlot(prev.visual, taskId);
      if (this.reducedMotion) this.stacks.splice(idx, 1);
      else { prev.fade = 0.0001; this.tweening = true; }
      this.writeTaskInstances();
      const owner = prev.visual.target.kind === "person" ? prev.visual.target.personId : null;
      this.refreshClip(owner);
      if (effect === "complete" && owner) this.gesture(owner, "wave", 2.5);
      this.relayoutDesk(prev.visual);
      return;
    }
    const oldOwner = prev && prev.visual.target.kind === "person" ? prev.visual.target.personId : null;
    if (prev && this.deskKey(prev.visual) !== this.deskKey(v!)) { this.releaseSlot(prev.visual, taskId); this.relayoutDesk(prev.visual); }
    const s: StackRef = prev ?? { task: task!, visual: v!, x: 0, y: 0, z: 0, pop: 0, fade: 0 };
    s.task = task!;
    s.visual = v!;
    if (!this.placeStack(s)) return;
    if (!prev) this.stacks.push(s);
    if (!this.reducedMotion) { s.pop = 1; this.tweening = true; }
    this.writeTaskInstances();
    const owner = v!.target.kind === "person" ? v!.target.personId : null;
    this.refreshClip(owner);
    if (oldOwner && oldOwner !== owner) this.refreshClip(oldOwner);
    this.taskById.set(taskId, task!);
  }

  private readonly taskById = new Map<string, PlayTask>();

  /** After a slot is freed, the remaining stacks on that desk close the gap. */
  private relayoutDesk(v: TaskVisual): void {
    const key = this.deskKey(v);
    for (const s of this.stacks) if (this.deskKey(s.visual) === key && s.fade === 0) this.placeStack(s);
  }

  private tickTweens(dt: number): void {
    if (!this.tweening) return;
    let active = false;
    for (let i = this.stacks.length - 1; i >= 0; i--) {
      const s = this.stacks[i];
      if (s.pop > 0) { s.pop = Math.max(0, s.pop - dt * 2.5); active = true; }
      if (s.fade > 0) { s.fade = Math.min(1, s.fade + dt * 1.5); active = true; if (s.fade >= 1) this.stacks.splice(i, 1); }
    }
    this.writeTaskInstances();
    this.tweening = active;
  }

  // ---- couriers (T-252) ---------------------------------------------------------
  private courierPath(h: PlayHandoff): THREE.Vector3[] {
    const L = this.layout;
    const from = L.rooms.find((r) => r.divisionId === h.fromDivisionId);
    const to = L.rooms.find((r) => r.divisionId === h.toDivisionId);
    const lobbyZ = L.lobby.z + L.lobby.d / 2;
    const a = from?.door ?? { x: L.lobby.x + 2, z: lobbyZ };
    const b = to?.door ?? { x: L.lobby.x + L.lobby.w - 2, z: lobbyZ };
    const corridorZ = (side: -1 | 1) => (side === -1 ? L.corridors[0].z + L.corridors[0].d / 2 : L.corridors[1].z + L.corridors[1].d / 2);
    const pts = [new THREE.Vector3(a.x, 0, a.z)];
    if (from) pts.push(new THREE.Vector3(a.x, 0, corridorZ(from.side)));
    if (to) pts.push(new THREE.Vector3(b.x, 0, corridorZ(to.side)));
    else pts.push(new THREE.Vector3(b.x, 0, lobbyZ));
    // wait just outside the destination door, on the corridor side
    pts.push(new THREE.Vector3(b.x + 1.2, 0, to ? corridorZ(to.side) : lobbyZ));
    return pts;
  }

  private buildCouriers(list: PlayHandoff[]): void {
    const S = this.r.shared;
    const geo = mergeParts([
      { g: new THREE.CapsuleGeometry(0.28, 0.6, 4, 10), c: 0xf5c518, m: partMatrix(0, 0.85, 0) },
      { g: new THREE.SphereGeometry(0.22, 12, 10), c: 0xf2d3b8, m: partMatrix(0, 1.5, 0) },
      { g: new THREE.BoxGeometry(0.5, 0.4, 0.4), c: 0xb8865b, m: partMatrix(0, 0.9, 0.42) },
    ]);
    this.courierMesh = new THREE.InstancedMesh(geo, materialFactory(S, 0xffffff, "skin"), Math.max(1, list.length, 8));
    this.courierMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.courierMesh.frustumCulled = false;
    castShadow(this.courierMesh);
    this.scene.add(this.courierMesh);
    this.setHandoffs(list, true);
  }

  /** Replace the courier set from data. New handoffs start walking; known ones keep their place. */
  setHandoffs(list: PlayHandoff[], initial = false): void {
    const keep = new Set(list.map((h) => h.id));
    for (let i = this.couriers.length - 1; i >= 0; i--) {
      const c = this.couriers[i];
      if (keep.has(c.handoff.id)) continue;
      if (c.char) { this.scene.remove(c.char.group); const pi = this.pickables.indexOf(c.char.proxy); if (pi >= 0) this.pickables.splice(pi, 1); c.char.dispose(); }
      this.couriers.splice(i, 1);
    }
    for (const h of list) {
      if (this.couriers.some((c) => c.handoff.id === h.id)) continue;
      const path = this.courierPath(h);
      // a courier from the initial snapshot has been walking for a while: start mid-way
      const c: CourierRef = { handoff: h, char: null, path, seg: initial ? Math.max(0, path.length - 2) : 0, t: initial ? 0.6 : 0, done: false, placeholderIndex: this.couriers.length };
      this.couriers.push(c);
      if (this.kit) this.spawnCourier(c);
    }
    this.world.handoffs = list;
    this.writeCourierPlaceholders();
  }

  private writeCourierPlaceholders(): void {
    if (this.kit) return;
    const d = this.dummy, zero = new THREE.Matrix4().makeScale(0, 0, 0);
    if (this.couriers.length > this.courierMesh.count) this.courierMesh.count = Math.min(this.courierMesh.instanceMatrix.count, this.couriers.length);
    this.couriers.forEach((c, i) => {
      if (i >= this.courierMesh.instanceMatrix.count) return;
      const p = this.courierPos(c);
      d.position.copy(p); d.rotation.set(0, this.courierHeading(c), 0); d.scale.set(1, 1, 1); d.updateMatrix();
      this.courierMesh.setMatrixAt(i, d.matrix);
    });
    for (let i = this.couriers.length; i < this.courierMesh.instanceMatrix.count; i++) this.courierMesh.setMatrixAt(i, zero);
    this.courierMesh.instanceMatrix.needsUpdate = true;
  }

  private courierPos(c: CourierRef): THREE.Vector3 {
    const a = c.path[Math.min(c.seg, c.path.length - 1)], b = c.path[Math.min(c.seg + 1, c.path.length - 1)];
    return a.clone().lerp(b, c.t);
  }
  private courierHeading(c: CourierRef): number {
    const a = c.path[Math.min(c.seg, c.path.length - 1)], b = c.path[Math.min(c.seg + 1, c.path.length - 1)];
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  private tickCouriers(dt: number): void {
    for (const c of this.couriers) {
      if (c.done) continue;
      if (this.reducedMotion) { c.seg = c.path.length - 2; c.t = 1; }
      const a = c.path[c.seg], b = c.path[c.seg + 1];
      if (!b) { c.done = true; c.char?.play("idle"); continue; }
      const len = a.distanceTo(b) || 0.001;
      c.t += (WALK_SPEED * dt) / len;
      if (c.t >= 1) { c.t = 0; c.seg++; if (c.seg >= c.path.length - 1) { c.done = true; c.char?.play("idle"); } }
      if (c.char) {
        c.char.group.position.copy(this.courierPos(c));
        c.char.group.rotation.y = this.courierHeading(c);
      }
    }
    if (!this.kit) this.writeCourierPlaceholders();
  }

  // ---- event boards (T-253) --------------------------------------------------------
  private buildBoards(): void {
    const S = this.r.shared;
    this.world.events.slice(0, this.layout.eventBoards.length).forEach((ev, i) => {
      const slot = this.layout.eventBoards[i];
      const { tex, ctx } = boardTexture();
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2), materialFactory(S, 0xffffff, "glow", { map: tex, noFog: true }));
      mesh.position.set(slot.x + 0.1, 2.2, slot.z);
      mesh.rotation.y = slot.facing;
      mesh.userData.pick = { kind: "event", id: ev.id } satisfies Pick;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.2, 0.15), materialFactory(S, 0x4a4e55, "metal"));
      post.position.set(slot.x, 1.6, slot.z);
      castShadow(post);
      this.scene.add(mesh, post);
      this.pickables.push(mesh);
      this.boards.push({ id: ev.id, ctx, tex, mesh, name: ev.name, showDate: ev.showDate, phase: ev.phase ?? "—", health: ev.health });
    });
    this.redrawBoards(new Date());
  }

  private redrawBoards(now: Date): void {
    for (const b of this.boards) {
      drawBoard(b.ctx, { name: b.name, countdown: countdownLabel(b.showDate, now), phase: b.phase, health: b.health });
      b.tex.needsUpdate = true;
      // show week: the board pulses (emissive), unless motion is reduced
      const ms = b.showDate ? new Date(b.showDate).getTime() - now.getTime() : Infinity;
      const mat = b.mesh.material as UnifiedMaterial;
      const week = ms > 0 && ms < 7 * 86400000;
      mat.uniforms.uEmissive.value.setScalar(week && !this.reducedMotion ? 0.25 + 0.25 * Math.sin(now.getTime() / 400) : 0);
    }
  }

  /** Sun + sky follow the clock (WIB). Cosmetic only. */
  setTimeOfDay(hour: number): void {
    const S = this.r.shared;
    const t = ((hour - 6 + 24) % 24) / 12; // 0 at 06:00, 1 at 18:00, >1 night
    const day = t >= 0 && t <= 1;
    const elev = day ? Math.sin(t * Math.PI) : 0.08;
    const az = day ? (t - 0.5) * Math.PI * 0.9 : 0;
    const dir = new THREE.Vector3(Math.sin(az) * 0.7 + 0.35, Math.max(0.25, elev) + 0.15, Math.cos(az) * 0.5 + 0.3).normalize();
    this.r.shadow.setDirection(dir);
    const warm = day ? Math.pow(1 - Math.abs(t - 0.5) * 2, 0.5) : 0; // 0 at dawn/dusk, 1 at noon
    S.uSunColor.value.set(0xfff1d6).lerp(new THREE.Color(0xffb27a), day ? 1 - warm : 1).multiplyScalar(day ? 0.85 + 0.3 * warm : 0.45);
    S.uSkyTop.value.set(0x3c88dd).lerp(new THREE.Color(0x141a33), day ? (1 - warm) * 0.35 : 0.85);
    S.uSkyMid.value.set(0xa8d8f5).lerp(new THREE.Color(0xf2a26b), day ? (1 - warm) * 0.5 : 0.2).lerp(new THREE.Color(0x2b3050), day ? 0 : 0.7);
    S.uSkyBottom.value.set(0xe9f0da).lerp(new THREE.Color(0x3a3d4d), day ? 0 : 0.7);
    S.uFogColor.value.copy(S.uSkyMid.value);
    S.uHemiSky.value.copy(S.uSkyMid.value).multiplyScalar(0.55);
  }

  // ---- approval room (T-252) ----------------------------------------------------
  private buildApprovalRoom(n: number): void {
    this.setApprovalsWaiting(n);
  }

  setApprovalsWaiting(n: number): void {
    const A = this.layout.approvalRoom, S = this.r.shared;
    if (this.envelopeMesh) { this.scene.remove(this.envelopeMesh); const i = this.pickables.indexOf(this.envelopeMesh); if (i >= 0) this.pickables.splice(i, 1); this.envelopeMesh.dispose(); this.envelopeMesh = null; }
    this.world.approvalsWaiting = n;
    if (n <= 0) return;
    const env = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.04, 0.34), materialFactory(S, 0xf4efe2, "skin"), n);
    const d = this.dummy;
    for (let i = 0; i < n; i++) {
      d.position.set(A.x + A.w / 2 - 2 + (i % 8) * 0.55, 0.98 + Math.floor(i / 8) * 0.05, A.z + A.d / 2 - 0.6 + Math.floor(i / 8) * 0.5);
      d.rotation.set(0, ((i * 0.37) % 0.4) - 0.2, 0); d.scale.set(1, 1, 1); d.updateMatrix();
      env.setMatrixAt(i, d.matrix);
    }
    env.userData.pick = { kind: "approvals" } satisfies Pick;
    env.frustumCulled = false;
    this.scene.add(env);
    this.pickables.push(env);
    this.envelopeMesh = env;
  }

  // ---- speech bubbles (T-254) -----------------------------------------------------
  private buildBubbles(): void {
    for (let i = 0; i < 8; i++) {
      const { tex, ctx } = bubbleTexture();
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), materialFactory(this.r.shared, 0xffffff, "glow", { map: tex, transparent: true, noFog: true, depthWrite: false }));
      mesh.visible = false;
      this.scene.add(mesh);
      this.bubbles.push({ mesh, ctx, tex, life: 0, x: 0, z: 0 });
    }
  }

  /** Speech bubble above a person for BUBBLE_LIFE seconds; ignored for people without a desk. */
  bubble(personId: string, text: string): void {
    const p = this.personAt(personId);
    if (!p) return;
    const b = this.bubbles.reduce((best, x) => (x.life < best.life ? x : best), this.bubbles[0]);
    const { ctx, tex } = b;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = "rgba(20,22,27,0.92)";
    ctx.beginPath();
    ctx.roundRect(8, 8, 496, 96, 24);
    ctx.fill();
    ctx.fillStyle = "#F4F4F2";
    ctx.font = "600 44px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 22), 256, 58);
    tex.needsUpdate = true;
    b.life = BUBBLE_LIFE;
    b.x = p.x;
    b.z = p.z;
    b.mesh.visible = true;
  }

  private tickBubbles(dt: number): void {
    for (const b of this.bubbles) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) { b.mesh.visible = false; continue; }
      b.mesh.position.set(b.x, 2.45 + (BUBBLE_LIFE - b.life) * 0.05, b.z);
      b.mesh.quaternion.copy(this.camera.cam.quaternion);
      (b.mesh.material as UnifiedMaterial).uniforms.uOpacity.value = Math.min(1, b.life);
    }
  }

  // ---- picking ----------------------------------------------------------------------
  private castFrom(x: number, y: number): Pick {
    const rect = this.r.canvas.getBoundingClientRect();
    this.ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera.cam);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const h of hits) {
      const o = h.object;
      if (o === this.stackMesh && h.instanceId != null) { const s = this.stacks[h.instanceId]; return s && s.fade === 0 ? { kind: "task", id: s.task.id } : null; }
      if (o === this.personMesh && h.instanceId != null) return { kind: "person", id: this.people[h.instanceId].id };
      if (o.userData.pick) return o.userData.pick as Pick;
    }
    return null;
  }

  private hoverAt(x: number, y: number): void {
    const p = this.castFrom(x, y);
    const same = p?.kind === this.hovered?.kind && (p as { id?: string } | null)?.id === (this.hovered as { id?: string } | null)?.id;
    if (same) return;
    this.hovered = p;
    this.r.canvas.style.cursor = p ? "pointer" : "default";
    this.handlers.onHover(p);
    if (p?.kind === "task") {
      const s = this.stacks.find((r) => r.task.id === p.id);
      if (s) { this.highlight.position.set(s.x, s.y + 0.03, s.z); this.highlight.scale.setScalar(0.45); this.highlight.visible = true; return; }
    }
    if (p?.kind === "person") {
      const q = this.personAt(p.id);
      if (q) { this.highlight.position.set(q.x, 0.03, q.z); this.highlight.scale.setScalar(0.7); this.highlight.visible = true; return; }
    }
    this.highlight.visible = false;
  }

  // ---- public controls ----------------------------------------------------------------
  focusTask(id: string): boolean {
    const s = this.stacks.find((r) => r.task.id === id);
    if (!s) return false;
    this.camera.focus(s.x, s.z, 26);
    return true;
  }
  focusPerson(id: string): boolean {
    const d = this.deskOf.get(id);
    if (!d) return false;
    this.camera.focus(d.slot.x, d.slot.z, 30);
    return true;
  }
  focusLobby(): void {
    this.camera.focus(this.layout.lobby.x + this.layout.lobby.w / 2, this.layout.lobby.z + this.layout.lobby.d / 2, 60);
  }
  focusApprovals(): void {
    const A = this.layout.approvalRoom;
    this.camera.focus(A.x + A.w / 2, A.z + A.d / 2, 30);
  }
  focusHandoff(id: string): boolean {
    const c = this.couriers.find((x) => x.handoff.id === id);
    if (!c) return false;
    const p = this.courierPos(c);
    this.camera.focus(p.x, p.z, 26);
    return true;
  }
  rotate(dir: 1 | -1): void {
    this.camera.rotateStep(dir);
  }
  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.camera.snapMoves = on;
    this.characters.forEach((c) => { c.mixer.timeScale = on ? 0 : 1; });
    this.couriers.forEach((c) => { if (c.char) c.char.mixer.timeScale = on ? 0 : 1; });
    if (on) this.particles.clear();
  }
  get drawCalls(): number {
    return this.r.stats.calls;
  }
  get fps(): number {
    return this.loop.fps;
  }
  get characterMode(): "rigged" | "placeholder" {
    return this.characters.size ? "rigged" : "placeholder";
  }
  get characterKitFailed(): boolean {
    return this.kitFailed;
  }

  // ---- per frame ------------------------------------------------------------------------
  private frame(dt: number, now: number): void {
    if (this.disposed) return;
    this.time += dt;
    this.r.beginFrame(this.time);
    this.camera.update(dt);
    this.sky.position.copy(this.camera.cam.position);
    if (this.characters.size) this.characters.forEach((c) => c.mixer.update(dt));
    else this.animatePlaceholders();
    for (const c of this.couriers) c.char?.mixer.update(dt);
    this.tickCouriers(dt);
    this.tickTweens(dt);
    this.tickBubbles(dt);
    if (now - this.lastBoard > 1000) { this.lastBoard = now; this.redrawBoards(new Date()); }
    if (!this.reducedMotion && now - this.lastSmoke > 180) { this.lastSmoke = now; this.emitSmoke(); }
    this.instanced.update([this.camera.cam.position]);
    this.particles.update(dt, this.camera.cam);
    const t = this.camera.target;
    this.r.shadow.render(this.r.renderer, this.scene, t.x, t.z);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.r.renderView(this.scene, this.camera.cam, { x: 0, y: 0, w, h }, false);
    if (this.statsOn) {
      const s = this.r.stats;
      this.stats.textContent = `fps ${this.loop.fps.toFixed(0)}  px ${this.r.renderer.getPixelRatio().toFixed(2)}\ncalls ${s.calls}  tris ${s.triangles}  prog ${s.programs}`;
    }
    if (this.fpsSamples.length < 600) this.fpsSamples.push(this.loop.fps);
  }

  private animatePlaceholders(): void {
    const d = this.dummy, t = this.time;
    this.people.forEach((p, i) => {
      let bob = 0, lean = 0, jx = 0, jz = 0;
      if (!this.reducedMotion) {
        if (p.clip === "idle") bob = Math.sin(t * 1.6 + p.phase) * 0.02;
        else if (p.clip === "work") { bob = Math.sin(t * 5 + p.phase) * 0.03; lean = 0.18; }
        else if (p.clip === "panic") { jx = Math.sin(t * 18 + p.phase) * 0.05; jz = Math.cos(t * 15 + p.phase) * 0.05; lean = 0.08 * Math.sin(t * 9); }
      }
      d.position.set(p.x + jx, bob, p.z + jz);
      d.rotation.set(lean, p.facing, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      this.personMesh.setMatrixAt(i, d.matrix);
    });
    if (this.people.length) this.personMesh.instanceMatrix.needsUpdate = true;
  }

  private emitSmoke(): void {
    const cam = this.camera.cam.position;
    for (const s of this.stacks) {
      if (!s.visual.smoke || s.fade > 0) continue;
      const dx = s.x - cam.x, dz = s.z - cam.z;
      if (dx * dx + dz * dz > 90 * 90) continue;
      this.particles.emit(s.x + (Math.random() - 0.5) * 0.2, s.y + 0.3, s.z + (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.15, 0.9, (Math.random() - 0.5) * 0.15, 0.35, 1.4, srgbToLinear(0.35), srgbToLinear(0.35), srgbToLinear(0.36), 1.6, 0.45);
    }
  }

  private resize(): void {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.r.resize(w, h);
    this.camera.setAspect(w / h);
  }

  dispose(): void {
    this.disposed = true;
    this.loop.stop();
    this.ro.disconnect();
    window.removeEventListener("keydown", this.onKey);
    this.camera.dispose();
    this.instanced.dispose();
    this.particles.dispose();
    this.characters.forEach((c) => c.dispose());
    this.couriers.forEach((c) => c.char?.dispose());
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as UnifiedMaterial | UnifiedMaterial[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.boards.forEach((b) => b.tex.dispose());
    this.bubbles.forEach((b) => b.tex.dispose());
    this.stats.remove();
    this.r.dispose();
  }
}
