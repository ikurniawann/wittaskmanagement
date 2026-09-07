/**
 * Fixed-timestep loop (120 Hz) with an accumulator, a catch-up cap and a max
 * step count per frame, plus adaptive resolution measured every 2 s.
 * Framework-free: the owner passes `step` / `render` / `applyPixelRatio`.
 */
export type LoopOptions = {
  fixedHz?: number;
  maxAccumulator?: number;
  maxSteps?: number;
  step?: (dt: number) => void;
  render: (dt: number, now: number) => void;
  /** Called with the new pixel ratio when adaptive resolution changes it. */
  applyPixelRatio: (ratio: number) => void;
  /** Lower/upper clamp for the pixel ratio; defaults to [min(1, dpr), dpr]. */
  ratioMin?: number;
  ratioMax?: number;
  ratioStart?: number;
  adaptive?: boolean;
};

/**
 * Pure: next pixel ratio given the measured fps (exposed for tests).
 * Hysteresis: drop fast below 45 fps, climb slowly above 57 fps, hold in
 * between — so a machine that sits at 50–57 fps never "breathes" resolution.
 * `ceiling` (optional) is a ratio that recently caused a drop; the climb
 * stops just under it instead of re-trying the same failing resolution.
 */
export function nextPixelRatio(current: number, fps: number, min: number, max: number, ceiling = Infinity): number {
  let t = current;
  if (fps < 45) t -= 0.15;
  else if (fps > 57) t = Math.min(t + 0.05, Math.max(current, ceiling - 0.05));
  t = Math.round(t * 100) / 100;
  return Math.max(min, Math.min(max, t));
}

export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private frames = 0;
  private t0 = 0;
  fps = 60;
  pixelRatio: number;
  /** Ratio that last caused a drop, remembered for CEILING_MS so we do not oscillate. */
  private ceiling = Infinity;
  private ceilingAt = 0;
  private static readonly CEILING_MS = 30000;
  readonly fixed: number;
  private readonly maxAcc: number;
  private readonly maxSteps: number;
  private readonly ratioMin: number;
  private readonly ratioMax: number;
  adaptive: boolean;

  constructor(private readonly o: LoopOptions) {
    this.fixed = 1 / (o.fixedHz ?? 120);
    this.maxAcc = o.maxAccumulator ?? 0.2;
    this.maxSteps = o.maxSteps ?? 24;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    this.ratioMin = o.ratioMin ?? Math.min(1, dpr);
    this.ratioMax = o.ratioMax ?? dpr;
    this.pixelRatio = o.ratioStart ?? Math.min(dpr, 1.5);
    this.adaptive = o.adaptive ?? true;
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.t0 = this.last;
    this.frames = 0;
    this.o.applyPixelRatio(this.pixelRatio);
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.25) dt = 0.25;
      if (this.o.step) {
        this.acc = Math.min(this.acc + dt, this.maxAcc);
        let n = 0;
        while (this.acc >= this.fixed && n < this.maxSteps) {
          this.o.step(this.fixed);
          this.acc -= this.fixed;
          n++;
        }
        if (n >= this.maxSteps) this.acc = 0;
      }
      this.o.render(dt, now);
      this.measure(now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private measure(now: number): void {
    this.frames++;
    const el = now - this.t0;
    if (el < 2000) return;
    this.fps = (this.frames * 1000) / el;
    this.frames = 0;
    this.t0 = now;
    if (!this.adaptive) return;
    if (now - this.ceilingAt > GameLoop.CEILING_MS) this.ceiling = Infinity;
    const t = nextPixelRatio(this.pixelRatio, this.fps, this.ratioMin, this.ratioMax, this.ceiling);
    if (Math.abs(t - this.pixelRatio) > 0.001) {
      if (t < this.pixelRatio) { this.ceiling = this.pixelRatio; this.ceilingAt = now; }
      this.pixelRatio = t;
      this.o.applyPixelRatio(t);
    }
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
