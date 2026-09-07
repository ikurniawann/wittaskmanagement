import * as THREE from "three";
import { PostPass } from "./post";
import { ShadowRig } from "./shadow";
import { createSharedUniforms, type SharedUniforms } from "./shared";

export type QualityTier = {
  msaa: number;
  shadowSize: number;
  particles: number;
  chunks: number;
  ratioMax: number;
};

export const QUALITY: Record<"desktop" | "touch", QualityTier> = {
  desktop: { msaa: 4, shadowSize: 1024, particles: 512, chunks: 8, ratioMax: Infinity },
  touch: { msaa: 0, shadowSize: 1024, particles: 256, chunks: 8, ratioMax: 1.0 },
};

export function detectTier(): QualityTier {
  if (typeof window === "undefined") return QUALITY.desktop;
  const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return touch ? QUALITY.touch : QUALITY.desktop;
}

export function hasWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

export type ViewRect = { x: number; y: number; w: number; h: number };

/**
 * The MRT pipeline: [shadow depth pass] → [geometry pass into a 2-attachment
 * gbuffer] → [one fullscreen post pass]. The canvas itself is created without
 * antialias; MSAA (if any) lives on the gbuffer.
 */
export class PlayRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly gbuf: THREE.WebGLRenderTarget;
  readonly shared: SharedUniforms;
  readonly shadow: ShadowRig;
  readonly post: PostPass;
  readonly tier: QualityTier;
  private readonly dbs = new THREE.Vector2();

  constructor(container: HTMLElement, tier: QualityTier = detectTier(), sharedOpts?: Parameters<typeof createSharedUniforms>[0]) {
    this.tier = tier;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // sRGB conversion is explicit in the post shader
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false; // reset once per frame by beginFrame()
    this.renderer.setClearColor(0xbfddf0, 1);
    container.appendChild(this.renderer.domElement);
    this.gbuf = new THREE.WebGLRenderTarget(2, 2, {
      count: 2,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      samples: tier.msaa,
    });
    this.shared = createSharedUniforms(sharedOpts);
    this.shadow = new ShadowRig(this.shared, { size: tier.shadowSize });
    this.post = new PostPass(this.gbuf, this.shared.uTime);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setPixelRatio(r: number): void {
    this.renderer.setPixelRatio(Math.min(r, this.tier.ratioMax));
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h);
    this.renderer.getDrawingBufferSize(this.dbs);
    this.gbuf.setSize(this.dbs.x, this.dbs.y);
    this.post.setResolution(this.dbs.x, this.dbs.y);
  }

  beginFrame(timeSeconds: number): void {
    this.renderer.info.reset();
    this.shared.uTime.value = timeSeconds;
  }

  /** Geometry pass for one camera into the gbuffer, restricted to a CSS rect. */
  renderView(scene: THREE.Scene, cam: THREE.Camera, css: ViewRect, multi: boolean): void {
    const pr = this.renderer.getPixelRatio();
    const px: ViewRect = { x: Math.round(css.x * pr), y: Math.round(css.y * pr), w: Math.round(css.w * pr), h: Math.round(css.h * pr) };
    this.gbuf.viewport.set(px.x, px.y, px.w, px.h);
    this.gbuf.scissor.set(px.x, px.y, px.w, px.h);
    this.gbuf.scissorTest = true;
    this.renderer.setRenderTarget(this.gbuf);
    this.renderer.clear(true, true, false);
    this.renderer.render(scene, cam);
    this.post.render(this.renderer, css, px, multi);
  }

  get stats(): { calls: number; triangles: number; programs: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs?.length ?? 0 };
  }

  dispose(): void {
    this.post.dispose();
    this.shadow.dispose();
    this.gbuf.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
