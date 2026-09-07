import * as THREE from "three";

/**
 * Isometric-style orbit camera: fixed pitch, yaw in 45° steps, pan on the
 * ground plane, zoom by distance. Mouse, keyboard and touch (one finger pan,
 * pinch zoom, two-finger rotate). Emits `onClick(x, y)` only when the pointer
 * did not drag, so picking never fires after a pan.
 */
export class IsoCamera {
  readonly cam: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  private goalTarget = new THREE.Vector3();
  private yawStep = 1; // × 45°
  private yaw = Math.PI / 4;
  private goalYaw = Math.PI / 4;
  private pitch = 0.9; // radians above the ground plane
  private dist = 42;
  private goalDist = 42;
  private dragging = false;
  private moved = false;
  private lastX = 0;
  private lastY = 0;
  private pinchDist = 0;
  private pinchAngle = 0;
  private readonly keys = new Set<string>();
  private readonly onClick: (x: number, y: number) => void;
  private readonly onMove: (x: number, y: number) => void;
  private readonly el: HTMLElement;
  private readonly handlers: Array<[string, EventListener, AddEventListenerOptions | undefined]> = [];
  minDist = 14;
  maxDist = 140;
  /** prefers-reduced-motion: every move is a cut instead of a glide. */
  snapMoves = false;

  constructor(el: HTMLElement, aspect: number, onClick: (x: number, y: number) => void, onMove: (x: number, y: number) => void) {
    this.el = el;
    this.onClick = onClick;
    this.onMove = onMove;
    this.cam = new THREE.PerspectiveCamera(38, aspect, 0.5, 1500);
    this.bind();
    this.apply(true);
  }

  private bind(): void {
    const on = <K extends keyof HTMLElementEventMap>(name: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      this.el.addEventListener(name, fn as EventListener, opts);
      this.handlers.push([name, fn as EventListener, opts]);
    };
    on("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return;
      this.dragging = true;
      this.moved = false;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.el.setPointerCapture(e.pointerId);
    });
    on("pointermove", (e) => {
      if (!this.dragging) {
        this.onMove(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.moved = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (e.buttons === 2) this.rotateBy(-dx * 0.005);
      else this.panPixels(dx, dy);
    });
    const up = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (!this.moved && e.button === 0) this.onClick(e.clientX, e.clientY);
    };
    on("pointerup", up);
    on("pointercancel", up);
    on("contextmenu", (e) => e.preventDefault());
    on("wheel", (e) => {
      e.preventDefault();
      this.goalDist = clamp(this.goalDist * (1 + Math.sign(e.deltaY) * 0.12), this.minDist, this.maxDist);
    }, { passive: false });
    on("touchstart", (e) => {
      if (e.touches.length === 2) {
        this.pinchDist = touchDist(e);
        this.pinchAngle = touchAngle(e);
      }
    }, { passive: true });
    on("touchmove", (e) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const d = touchDist(e), a = touchAngle(e);
      if (this.pinchDist > 0) this.goalDist = clamp(this.goalDist * (this.pinchDist / d), this.minDist, this.maxDist);
      this.goalYaw += a - this.pinchAngle;
      this.pinchDist = d;
      this.pinchAngle = a;
      this.moved = true;
    }, { passive: false });
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT" || (e.target as HTMLElement | null)?.tagName === "TEXTAREA") return;
      this.keys.add(e.code);
      if (e.code === "KeyQ") this.rotateStep(-1);
      if (e.code === "KeyE") this.rotateStep(1);
    };
    const ku = (e: KeyboardEvent) => { this.keys.delete(e.code); };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    this.handlers.push(["keydown", kd as unknown as EventListener, undefined], ["keyup", ku as unknown as EventListener, undefined]);
  }

  rotateStep(dir: number): void {
    this.yawStep += dir;
    this.goalYaw = (this.yawStep * Math.PI) / 4;
  }

  private rotateBy(rad: number): void {
    this.goalYaw += rad;
    this.yawStep = Math.round(this.goalYaw / (Math.PI / 4));
  }

  /** Pan by screen pixels, keeping the drag point under the pointer roughly fixed. */
  private panPixels(dx: number, dy: number): void {
    const h = this.el.clientHeight || 1;
    const worldPerPx = (2 * this.dist * Math.tan((this.cam.fov * Math.PI) / 360)) / h;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    this.goalTarget.addScaledVector(right, -dx * worldPerPx);
    this.goalTarget.addScaledVector(fwd, dy * worldPerPx / Math.sin(this.pitch));
  }

  /** Move the camera target to a world point (smoothly). */
  focus(x: number, z: number, dist?: number): void {
    this.goalTarget.set(x, 0, z);
    if (dist != null) this.goalDist = clamp(dist, this.minDist, this.maxDist);
  }

  jump(x: number, z: number, dist?: number): void {
    this.focus(x, z, dist);
    this.apply(true);
  }

  setAspect(aspect: number): void {
    this.cam.aspect = aspect;
    this.cam.updateProjectionMatrix();
  }

  update(dt: number): void {
    const speed = 22 * dt * (this.dist / 42);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) this.goalTarget.addScaledVector(fwd, speed);
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) this.goalTarget.addScaledVector(fwd, -speed);
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) this.goalTarget.addScaledVector(right, -speed);
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) this.goalTarget.addScaledVector(right, speed);
    this.apply(this.snapMoves, dt);
  }

  private apply(snap: boolean, dt = 0): void {
    const k = snap ? 1 : Math.min(1, dt * 8);
    this.target.lerp(this.goalTarget, k);
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.dist += (this.goalDist - this.dist) * k;
    const y = Math.sin(this.pitch) * this.dist, r = Math.cos(this.pitch) * this.dist;
    this.cam.position.set(this.target.x + Math.sin(this.yaw) * r, this.target.y + y, this.target.z + Math.cos(this.yaw) * r);
    this.cam.lookAt(this.target);
  }

  dispose(): void {
    for (const [name, fn, opts] of this.handlers) {
      if (name === "keydown" || name === "keyup") window.removeEventListener(name, fn);
      else this.el.removeEventListener(name, fn, opts);
    }
  }
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}
function touchDist(e: TouchEvent): number {
  const a = e.touches[0], b = e.touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
function touchAngle(e: TouchEvent): number {
  const a = e.touches[0], b = e.touches[1];
  return Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
}
