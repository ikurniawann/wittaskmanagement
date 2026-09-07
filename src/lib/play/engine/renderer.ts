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

export const QUALITY: Record<"desktop" | "laptop" | "touch" | "performance", QualityTier> = {
  /** Discrete GPU: full MSAA, up to 2× DPR. */
  desktop: { msaa: 4, shadowSize: 2048, particles: 512, chunks: 8, ratioMax: 2 },
  /** Integrated GPU (most office laptops): 2× MSAA, DPR capped so the MRT gbuffer stays small. */
  laptop: { msaa: 2, shadowSize: 1024, particles: 384, chunks: 8, ratioMax: 1.25 },
  touch: { msaa: 0, shadowSize: 1024, particles: 256, chunks: 8, ratioMax: 1.0 },
  /** "Performance" preference: no MSAA, 1× DPR, no shadow pass at all. */
  performance: { msaa: 0, shadowSize: 0, particles: 256, chunks: 8, ratioMax: 1.0 },
};

export type QualityPref = "auto" | "performance" | "quality";
export const QUALITY_PREF_KEY = "play.quality";

export type GpuClass = "discrete" | "integrated" | "unknown";

/** Pure: classify a WEBGL_debug_renderer_info string (EPIC-027 T-270). */
export function classifyRenderer(name: string | null | undefined): GpuClass {
  if (!name) return "unknown";
  const n = name.toLowerCase();
  if (/nvidia|geforce|quadro|rtx|gtx|radeon (rx|pro|vii)|arc a\d/.test(n)) return "discrete";
  if (/intel|iris|uhd|hd graphics|mali|adreno|powervr|apple (gpu|m\d)|swiftshader|llvmpipe|softpipe|mesa|vivante|videocore|amd radeon\(tm\) graphics|radeon graphics/.test(n)) return "integrated";
  return "unknown";
}

/** Reads the unmasked renderer name from a throwaway WebGL2 context; null when unavailable. */
export function gpuName(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number } | null;
    const name = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) : (gl.getParameter(gl.RENDERER) as string);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name || null;
  } catch {
    return null;
  }
}

/** Pure: which tier a device class + preference resolve to. */
export function tierFor(pref: QualityPref, touch: boolean, gpu: GpuClass): QualityTier {
  if (pref === "performance") return QUALITY.performance;
  if (pref === "quality") return touch ? { ...QUALITY.touch, msaa: 2 } : QUALITY.desktop;
  if (touch) return QUALITY.touch;
  return gpu === "discrete" ? QUALITY.desktop : QUALITY.laptop;
}

export function readQualityPref(): QualityPref {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(QUALITY_PREF_KEY) : null;
    return v === "performance" || v === "quality" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function writeQualityPref(pref: QualityPref): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (pref === "auto") localStorage.removeItem(QUALITY_PREF_KEY);
    else localStorage.setItem(QUALITY_PREF_KEY, pref);
  } catch {
    /* private mode etc. — the choice simply does not persist */
  }
}

export function detectTier(pref: QualityPref = "auto"): QualityTier {
  if (typeof window === "undefined") return QUALITY.desktop;
  const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return tierFor(pref, touch, classifyRenderer(gpuName()));
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
