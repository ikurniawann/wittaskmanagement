import * as THREE from "three";
import {
  castShadow,
  GameLoop,
  InstancedManager,
  materialFactory,
  mergeParts,
  ParticlePool,
  partMatrix,
  PlayRenderer,
  srgbToLinear,
  type UnifiedMaterial,
} from "../engine";
import type { PlayTask, PlayWorld } from "../types";
import { layout, type DeskSlot, type OfficeLayout, type Room } from "../world/layout";
import { mapTask, personClip, type TaskVisual } from "../world/mapping";
import { IsoCamera } from "./camera";
import { CharacterKit, type Character, type ClipName } from "./characters";
import { boardTexture, countdownLabel, drawBoard, signTexture } from "./textures";

// EPIC-024 — the office scene. Everything drawn here comes from `layout()` and
// `mapTask()`; the scene itself holds no rules. Characters are procedural
// placeholders (T-244 swaps in rigged glTF) and move only when data says so.

export type Pick =
  | { kind: "task"; id: string }
  | { kind: "person"; id: string }
  | { kind: "event"; id: string }
  | { kind: "room"; id: string }
  | null;

export type OfficeHandlers = {
  onPick: (p: Pick) => void;
  onHover: (p: Pick) => void;
};

type DeskRef = { slot: DeskSlot; room: Room };
type StackRef = { task: PlayTask; visual: TaskVisual; x: number; y: number; z: number };

const hex = (c: string) => parseInt(c.replace("#", ""), 16);

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
  private readonly people: { id: string; x: number; z: number; facing: number; clip: "idle" | "work" | "panic"; phase: number }[] = [];
  /** Rigged characters (T-244); empty until the kit has loaded, placeholders show meanwhile. */
  private readonly characters: { id: string | null; char: Character }[] = [];
  private kitFailed = false;
  private stackMesh!: THREE.InstancedMesh;
  private auraMesh!: THREE.InstancedMesh;
  private chainMesh!: THREE.InstancedMesh;
  private ghostMesh!: THREE.InstancedMesh;
  private personMesh!: THREE.InstancedMesh;
  private courierMesh!: THREE.InstancedMesh;
  private readonly boards: { id: string; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mesh: THREE.Mesh; name: string; showDate: string | null; phase: string; health: string | null }[] = [];
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
    this.camera = new IsoCamera(this.r.canvas, 1, (x, y) => this.handlers.onPick(this.pickAt(x, y)), (x, y) => this.hoverAt(x, y));
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
    this.buildCouriers();
    this.buildBoards();
    this.buildApprovalRoom();
    this.instanced.build(this.scene);

    // start on my own desk, else the lobby
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

  // ---- rigged characters (T-244) --------------------------------------------
  private async loadCharacters(): Promise<void> {
    let kit: CharacterKit;
    try {
      kit = await CharacterKit.load();
    } catch (e) {
      this.kitFailed = true;
      console.warn("[play] character model unavailable, keeping placeholders", e);
      return;
    }
    if (this.disposed) return;
    const S = this.r.shared;
    // people at their desks
    this.people.forEach((p) => {
      const room = this.deskOf.get(p.id)?.room;
      const tint = hex(this.world.divisions.find((d) => d.id === room?.divisionId)?.color ?? "#999999");
      const char = kit.create(S, tint);
      char.group.position.set(p.x, 0, p.z);
      char.group.rotation.y = p.facing;
      char.play(p.clip as ClipName, 0);
      char.mixer.update(p.phase); // desynchronise the loops
      char.proxy.userData.pick = { kind: "person", id: p.id } satisfies Pick;
      castShadow(char.mesh);
      this.scene.add(char.group);
      this.pickables.push(char.proxy);
      this.characters.push({ id: p.id, char });
    });
    // couriers walk in place between the two rooms
    this.world.handoffs.forEach((h, i) => {
      const m = new THREE.Matrix4();
      this.courierMesh.getMatrixAt(i, m);
      const char = kit.create(S, 0xf5c518);
      char.group.applyMatrix4(m);
      char.play("walk", 0);
      char.mixer.update((i * 0.7) % 1.2);
      castShadow(char.mesh);
      this.scene.add(char.group);
      this.characters.push({ id: null, char });
    });
    // placeholders off, picking now goes through the proxies
    this.personMesh.visible = false;
    this.courierMesh.visible = false;
    const idx = this.pickables.indexOf(this.personMesh);
    if (idx >= 0) this.pickables.splice(idx, 1);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === "F3") { e.preventDefault(); this.statsOn = !this.statsOn; this.stats.style.display = this.statsOn ? "block" : "none"; }
  };

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
    const roomWalls = (r: Room | { rect: { x: number; z: number; w: number; d: number }; door: { x: number; z: number } }, c: number) => {
      const { x, z, w, d } = r.rect, t = 0.25, doorW = 3;
      wall(x, z, w, t, c); // north
      wall(x, z + d - t, w, t, c); // south
      wall(x, z, t, d, c); // west
      wall(x + w - t, z, t, d, c); // east
      // door: cut by overlaying floor-coloured gap → simpler: a lower "threshold" block
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
      // whiteboard
      const wb = new THREE.Mesh(new THREE.BoxGeometry(4, 1.6, 0.1), materialFactory(S, 0xf4f4f2, "skin"));
      wb.position.set(room.whiteboard.x, 1.4, room.whiteboard.z);
      castShadow(wb);
      this.scene.add(wb);
    }
    roomWalls({ rect: L.approvalRoom, door: L.approvalRoom.door }, 0xe6d9bf);
    const floors = new THREE.Mesh(mergeParts(floorParts), materialFactory(S, 0xffffff, "dirt"));
    this.scene.add(floors);
    const walls = castShadow(new THREE.Mesh(mergeParts(wallParts), materialFactory(S, 0xffffff, "metal")));
    this.scene.add(walls);

    // desks, chairs, monitors → instanced
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
        this.instanced.add(monK, desk.x, 0, desk.z, 0, f, 0, 1);
        // chair sits on the side the person faces away from the desk front
        const cz = desk.z - Math.cos(f) * 0.9, cx = desk.x - Math.sin(f) * 0.9;
        this.instanced.add(chairK, cx, 0, cz, 0, f, 0, 1);
        if (desk.personId) this.deskOf.set(desk.personId, { slot: desk, room });
      }
    }
    const plantK = this.instanced.addKind("plant", mergeParts([
      { g: new THREE.CylinderGeometry(0.22, 0.18, 0.4, 8), c: 0x8a5a3c, m: partMatrix(0, 0.2, 0) },
      { g: new THREE.SphereGeometry(0.42, 8, 6), c: 0x3e8e4e, m: partMatrix(0, 0.75, 0) },
    ]), materialFactory(S, 0xffffff, "foliage"));
    for (const room of L.rooms) this.instanced.add(plantK, room.rect.x + 0.8, 0, room.rect.z + room.rect.d - 0.8, 0, 0, 0, 1);
  }

  // ---- people (procedural placeholders) ------------------------------------
  private buildPeople(): void {
    const S = this.r.shared;
    const body = mergeParts([
      { g: new THREE.CapsuleGeometry(0.28, 0.6, 4, 10), c: 0xffffff, m: partMatrix(0, 0.85, 0) },
      { g: new THREE.SphereGeometry(0.22, 12, 10), c: 0xf2d3b8, m: partMatrix(0, 1.5, 0) },
      { g: new THREE.BoxGeometry(0.16, 0.3, 0.26), c: 0x2a2e36, m: partMatrix(-0.14, 0.15, 0) },
      { g: new THREE.BoxGeometry(0.16, 0.3, 0.26), c: 0x2a2e36, m: partMatrix(0.14, 0.15, 0) },
    ]);
    const byPerson = new Map<string, TaskVisual[]>();
    for (const t of this.world.tasks) {
      const v = mapTask(t);
      if (v.target.kind === "person") byPerson.set(v.target.personId, [...(byPerson.get(v.target.personId) ?? []), v]);
    }
    const seated = this.world.people.filter((p) => this.deskOf.has(p.id));
    this.personMesh = new THREE.InstancedMesh(body, materialFactory(S, 0xffffff, "skin"), Math.max(1, seated.length));
    this.personMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.personMesh.name = "people";
    const col = new THREE.Color();
    seated.forEach((p, i) => {
      const d = this.deskOf.get(p.id)!;
      const f = d.slot.facing;
      const x = d.slot.x - Math.sin(f) * 0.9, z = d.slot.z - Math.cos(f) * 0.9;
      this.people.push({ id: p.id, x, z, facing: f, clip: personClip(byPerson.get(p.id) ?? []), phase: (i * 1.7) % 6.28 });
      this.personMesh.setColorAt(i, col.set(hex(this.world.divisions.find((dv) => dv.id === d.room.divisionId)?.color ?? "#999999")));
    });
    if (seated.length === 0) this.personMesh.count = 0;
    castShadow(this.personMesh);
    this.personMesh.userData.pickKind = "person";
    this.scene.add(this.personMesh);
    this.pickables.push(this.personMesh);
  }

  // ---- tasks as paper stacks, auras, chains, ghost waiters -------------------
  private buildTasks(): void {
    const S = this.r.shared;
    const perDesk = new Map<string, number>();
    for (const t of this.world.tasks) {
      const v = mapTask(t);
      if (!v.visible) continue;
      let dx = 0, dz = 0, key: string;
      if (v.target.kind === "person") {
        const d = this.deskOf.get(v.target.personId);
        if (!d) continue;
        key = "p:" + v.target.personId;
        const n = perDesk.get(key) ?? 0;
        perDesk.set(key, n + 1);
        const f = d.slot.facing;
        const lx = -0.55 + (n % 3) * 0.5, lz = 0.22 - Math.floor(n / 3) * 0.3; // far half of the desk, monitor keeps the near half
        dx = d.slot.x + Math.cos(f) * lx + Math.sin(f) * lz;
        dz = d.slot.z - Math.sin(f) * lx + Math.cos(f) * lz;
        this.stacks.push({ task: t, visual: v, x: dx, y: 0.82, z: dz });
      } else {
        const wantDivision = v.target.divisionId;
        const room = this.layout.rooms.find((r) => r.divisionId === wantDivision);
        if (!room) continue;
        key = "w:" + room.divisionId;
        const n = perDesk.get(key) ?? 0;
        perDesk.set(key, n + 1);
        dx = room.whiteboard.x - 1.6 + (n % 8) * 0.45;
        dz = room.whiteboard.z + (room.side === -1 ? 0.35 : -0.35);
        this.stacks.push({ task: t, visual: v, x: dx, y: 0.05 + Math.floor(n / 8) * 0.2, z: dz });
      }
    }
    const n = Math.max(1, this.stacks.length);
    this.stackMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 1, 0.42), materialFactory(S, 0xffffff, "skin"), n);
    this.auraMesh = new THREE.InstancedMesh(new THREE.RingGeometry(0.5, 0.7, 24), materialFactory(S, 0xff5a3c, "glow", { emissive: 0xff5a3c, transparent: true, opacity: 0.7, depthWrite: false, additive: true }), n);
    this.chainMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(0.14, 0.04, 6, 12), materialFactory(S, 0x4a4e55, "metal"), n);
    const ghostGeo = mergeParts([{ g: new THREE.CapsuleGeometry(0.24, 0.5, 4, 8), c: 0xffffff, m: partMatrix(0, 0.75, 0) }, { g: new THREE.SphereGeometry(0.2, 10, 8), c: 0xffffff, m: partMatrix(0, 1.35, 0) }]);
    const totalGhosts = Math.max(1, this.stacks.reduce((s, r) => s + r.visual.ghosts, 0));
    this.ghostMesh = new THREE.InstancedMesh(ghostGeo, materialFactory(S, 0xbfd9ff, "skin", { transparent: true, opacity: 0.38, depthWrite: false }), totalGhosts);
    const col = new THREE.Color(), d = this.dummy;
    let gi = 0, ai = 0, ci = 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.stacks.forEach((s, i) => {
      const h = 0.12 * s.visual.stackHeight;
      d.position.set(s.x, s.y + h / 2, s.z); d.rotation.set(0, 0, 0); d.scale.set(1, h, 1); d.updateMatrix();
      this.stackMesh.setMatrixAt(i, d.matrix);
      this.stackMesh.setColorAt(i, col.set(hex(s.visual.colour)));
      if (s.visual.aura) { d.position.set(s.x, s.y + 0.02, s.z); d.rotation.set(-Math.PI / 2, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); this.auraMesh.setMatrixAt(ai++, d.matrix); }
      if (s.visual.chain) { d.position.set(s.x, s.y + h + 0.08, s.z); d.rotation.set(Math.PI / 2, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); this.chainMesh.setMatrixAt(ci++, d.matrix); }
      // ghosts queue in front of the desk, away from the chair
      const desk = s.visual.target.kind === "person" ? this.deskOf.get(s.visual.target.personId) : undefined;
      for (let g = 0; g < s.visual.ghosts; g++) {
        const f = desk ? desk.slot.facing : 0;
        const qx = (desk ? desk.slot.x : s.x) + Math.sin(f) * (1.3 + g * 0.7), qz = (desk ? desk.slot.z : s.z) + Math.cos(f) * (1.3 + g * 0.7);
        d.position.set(qx, 0, qz); d.rotation.set(0, f + Math.PI, 0); d.scale.set(1, 1, 1); d.updateMatrix();
        this.ghostMesh.setMatrixAt(gi++, d.matrix);
      }
    });
    for (let i = ai; i < n; i++) this.auraMesh.setMatrixAt(i, zero);
    for (let i = ci; i < n; i++) this.chainMesh.setMatrixAt(i, zero);
    for (let i = gi; i < totalGhosts; i++) this.ghostMesh.setMatrixAt(i, zero);
    if (this.stacks.length === 0) this.stackMesh.count = 0;
    this.stackMesh.name = "tasks";
    this.stackMesh.userData.pickKind = "task";
    castShadow(this.stackMesh);
    this.scene.add(this.stackMesh, this.auraMesh, this.chainMesh, this.ghostMesh);
    this.pickables.push(this.stackMesh);
  }

  // ---- couriers: pending handoffs stand between the two rooms ---------------
  private buildCouriers(): void {
    const S = this.r.shared;
    const geo = mergeParts([
      { g: new THREE.CapsuleGeometry(0.28, 0.6, 4, 10), c: 0xf5c518, m: partMatrix(0, 0.85, 0) },
      { g: new THREE.SphereGeometry(0.22, 12, 10), c: 0xf2d3b8, m: partMatrix(0, 1.5, 0) },
      { g: new THREE.BoxGeometry(0.5, 0.4, 0.4), c: 0xb8865b, m: partMatrix(0, 0.9, 0.42) },
    ]);
    const n = Math.max(1, this.world.handoffs.length);
    this.courierMesh = new THREE.InstancedMesh(geo, materialFactory(S, 0xffffff, "skin"), n);
    const d = this.dummy;
    this.world.handoffs.forEach((h, i) => {
      const from = this.layout.rooms.find((r) => r.divisionId === h.fromDivisionId);
      const to = this.layout.rooms.find((r) => r.divisionId === h.toDivisionId);
      const a = from?.door ?? { x: this.layout.lobby.x + 2, z: 0 }, b = to?.door ?? { x: this.layout.lobby.x + this.layout.lobby.w / 2, z: 0 };
      // stand in the corridor/lobby, 35% of the way from the requesting room
      const x = a.x + (b.x - a.x) * 0.35, z = this.layout.lobby.z + this.layout.lobby.d / 2 + (i % 3) * 1.2 - 1.2;
      d.position.set(x, 0, z); d.rotation.set(0, Math.atan2(b.x - x, b.z - z), 0); d.scale.set(1, 1, 1); d.updateMatrix();
      this.courierMesh.setMatrixAt(i, d.matrix);
    });
    if (this.world.handoffs.length === 0) this.courierMesh.count = 0;
    castShadow(this.courierMesh);
    this.scene.add(this.courierMesh);
  }

  // ---- event boards on the lobby's west wall --------------------------------
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
    }
  }

  // ---- approval room: table + one envelope per waiting decision -------------
  private buildApprovalRoom(): void {
    const S = this.r.shared, A = this.layout.approvalRoom;
    const table = castShadow(new THREE.Mesh(new THREE.BoxGeometry(5, 0.1, 2.2), materialFactory(S, 0x8a5a3c, "rock")));
    table.position.set(A.x + A.w / 2, 0.9, A.z + A.d / 2);
    this.scene.add(table);
    const n = this.world.approvalsWaiting;
    if (n > 0) {
      const env = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.04, 0.34), materialFactory(S, 0xf4efe2, "skin"), n);
      const d = this.dummy;
      for (let i = 0; i < n; i++) {
        d.position.set(A.x + A.w / 2 - 2 + (i % 8) * 0.55, 0.98 + Math.floor(i / 8) * 0.05, A.z + A.d / 2 - 0.6 + Math.floor(i / 8) * 0.5);
        d.rotation.set(0, (i * 0.37) % 0.4 - 0.2, 0); d.scale.set(1, 1, 1); d.updateMatrix();
        env.setMatrixAt(i, d.matrix);
      }
      this.scene.add(env);
    }
  }

  // ---- picking ----------------------------------------------------------------
  private castFrom(x: number, y: number): Pick {
    const rect = this.r.canvas.getBoundingClientRect();
    this.ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera.cam);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const h of hits) {
      const o = h.object;
      if (o === this.stackMesh && h.instanceId != null) return { kind: "task", id: this.stacks[h.instanceId].task.id };
      if (o === this.personMesh && h.instanceId != null) return { kind: "person", id: this.people[h.instanceId].id };
      if (o.userData.pick) return o.userData.pick as Pick;
    }
    return null;
  }

  private pickAt(x: number, y: number): Pick {
    return this.castFrom(x, y);
  }

  private hoverAt(x: number, y: number): void {
    const p = this.castFrom(x, y);
    const same = p?.kind === this.hovered?.kind && p?.id === this.hovered?.id;
    if (same) return;
    this.hovered = p;
    this.r.canvas.style.cursor = p ? "pointer" : "default";
    this.handlers.onHover(p);
    if (p?.kind === "task") {
      const s = this.stacks.find((r) => r.task.id === p.id);
      if (s) { this.highlight.position.set(s.x, s.y + 0.03, s.z); this.highlight.scale.setScalar(0.45); this.highlight.visible = true; return; }
    }
    if (p?.kind === "person") {
      const q = this.people.find((r) => r.id === p.id);
      if (q) { this.highlight.position.set(q.x, 0.03, q.z); this.highlight.scale.setScalar(0.7); this.highlight.visible = true; return; }
    }
    this.highlight.visible = false;
  }

  // ---- public controls --------------------------------------------------------
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
  rotate(dir: 1 | -1): void {
    this.camera.rotateStep(dir);
  }
  get drawCalls(): number {
    return this.r.stats.calls;
  }
  get fps(): number {
    return this.loop.fps;
  }
  /** "rigged" once the glTF characters are in, "placeholder" while loading or if the model failed. */
  get characterMode(): "rigged" | "placeholder" {
    return this.characters.length ? "rigged" : "placeholder";
  }
  get characterKitFailed(): boolean {
    return this.kitFailed;
  }

  // ---- per frame ------------------------------------------------------------------
  private frame(dt: number, now: number): void {
    if (this.disposed) return;
    this.time += dt;
    this.r.beginFrame(this.time);
    this.camera.update(dt);
    this.sky.position.copy(this.camera.cam.position);
    if (this.characters.length) for (const c of this.characters) c.char.mixer.update(dt);
    else this.animatePeople();
    if (now - this.lastBoard > 1000) { this.lastBoard = now; this.redrawBoards(new Date()); }
    if (now - this.lastSmoke > 180) { this.lastSmoke = now; this.emitSmoke(); }
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

  private animatePeople(): void {
    const d = this.dummy, t = this.time;
    this.people.forEach((p, i) => {
      let bob = 0, lean = 0, jx = 0, jz = 0;
      if (p.clip === "idle") bob = Math.sin(t * 1.6 + p.phase) * 0.02;
      else if (p.clip === "work") { bob = Math.sin(t * 5 + p.phase) * 0.03; lean = 0.18; }
      else { jx = Math.sin(t * 18 + p.phase) * 0.05; jz = Math.cos(t * 15 + p.phase) * 0.05; lean = 0.08 * Math.sin(t * 9); }
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
      if (!s.visual.smoke) continue;
      const dx = s.x - cam.x, dz = s.z - cam.z;
      if (dx * dx + dz * dz > 90 * 90) continue; // out of sight: skip
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
    this.characters.forEach((c) => c.char.dispose());
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as UnifiedMaterial | UnifiedMaterial[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.boards.forEach((b) => b.tex.dispose());
    this.stats.remove();
    this.r.dispose();
  }
}
