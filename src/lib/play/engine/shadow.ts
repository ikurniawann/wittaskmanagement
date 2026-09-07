import * as THREE from "three";
import { SHADOW_LAYER, type SharedUniforms } from "./shared";

const BIAS_MAT = new THREE.Matrix4().set(
  0.5, 0, 0, 0.5,
  0, 0.5, 0, 0.5,
  0, 0, 0.5, 0.5,
  0, 0, 0, 1,
);

/**
 * One shadow map, depth only. The scene is rendered with
 * `scene.overrideMaterial = MeshDepthMaterial` (colour writes off) from an
 * orthographic camera that only sees layer 1, so transparent / non-caster
 * objects are hidden from the shadow pass without toggling `visible`.
 * The bias × projection × view matrix is built by hand and passed as a uniform.
 * The fragment shader does manual bilinear PCF (three.js does not put a compare
 * function on render-target depth textures). The ortho window follows the camera
 * zoom (tight when close, wide when far) and its position snaps to whole texels
 * so edges never crawl while panning. `size` 0 = shadows off.
 */
export class ShadowRig {
  readonly cam: THREE.OrthographicCamera;
  readonly rt: THREE.WebGLRenderTarget;
  readonly depthTex: THREE.DepthTexture;
  private readonly depthMat = new THREE.MeshDepthMaterial({ colorWrite: false });
  private offset: THREE.Vector3;

  constructor(
    private readonly shared: SharedUniforms,
    opts: { size?: number; extent?: number; near?: number; far?: number; offset?: THREE.Vector3 } = {},
  ) {
    const size = opts.size || 16;
    this.enabled = (opts.size ?? 1024) > 0;
    this.size = size;
    const e = opts.extent ?? 95;
    this.depthTex = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      depthTexture: this.depthTex,
      depthBuffer: true,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    this.cam = new THREE.OrthographicCamera(-e, e, e, -e, opts.near ?? 20, opts.far ?? 600);
    this.cam.layers.set(SHADOW_LAYER);
    this.cam.updateProjectionMatrix();
    this.offset = opts.offset ?? new THREE.Vector3(110, 200, 70);
    this.extent = e;
    shared.uShadowMap.value = this.depthTex;
    shared.uShadowTexel.value = 1 / size;
    shared.uShadowStrength.value = this.enabled ? 1 : 0;
    shared.uSunDir.value.copy(this.offset).normalize();
  }

  readonly enabled: boolean;
  readonly size: number;
  private extent: number;
  private readonly tmp = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  /** Move the sun: the camera offset and the shared direction follow (time of day, T-253). */
  setDirection(dir: THREE.Vector3): void {
    this.offset = dir.clone().normalize().multiplyScalar(240);
    this.shared.uSunDir.value.copy(dir).normalize();
  }

  /** Render the depth-only pass centred on (cx, 0, cz); `extent` = half-width of the lit window in metres. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cx: number, cz: number, extent = this.extent): void {
    if (!this.enabled) return;
    if (extent !== this.extent) {
      this.extent = extent;
      this.cam.left = -extent; this.cam.right = extent; this.cam.top = extent; this.cam.bottom = -extent;
      this.cam.updateProjectionMatrix();
    }
    this.cam.position.set(cx + this.offset.x, this.offset.y, cz + this.offset.z);
    this.cam.lookAt(cx, 0, cz);
    this.cam.updateMatrixWorld(true);
    // texel snapping: move the camera so the target lands on a whole shadow texel
    const worldPerTexel = (2 * extent) / this.size;
    this.right.setFromMatrixColumn(this.cam.matrixWorld, 0);
    this.up.setFromMatrixColumn(this.cam.matrixWorld, 1);
    this.tmp.set(cx, 0, cz).applyMatrix4(this.cam.matrixWorldInverse);
    const dx = this.tmp.x - Math.round(this.tmp.x / worldPerTexel) * worldPerTexel;
    const dy = this.tmp.y - Math.round(this.tmp.y / worldPerTexel) * worldPerTexel;
    this.cam.position.addScaledVector(this.right, dx).addScaledVector(this.up, dy);
    this.cam.updateMatrixWorld(true);
    this.shared.uShadowMatrix.value
      .copy(BIAS_MAT)
      .multiply(this.cam.projectionMatrix)
      .multiply(this.cam.matrixWorldInverse);
    const prev = scene.overrideMaterial;
    scene.overrideMaterial = this.depthMat;
    renderer.setRenderTarget(this.rt);
    renderer.clear(false, true, false);
    renderer.render(scene, this.cam);
    scene.overrideMaterial = prev;
  }

  dispose(): void {
    this.rt.dispose();
    this.depthTex.dispose();
    this.depthMat.dispose();
  }
}
