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
 * The bias × projection × view matrix is built by hand and passed as a uniform;
 * the fragment shader does a single `step()` lookup (no PCF).
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
    const size = opts.size ?? 1024;
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
    shared.uShadowMap.value = this.depthTex;
    shared.uSunDir.value.copy(this.offset).normalize();
  }

  /** Move the sun: the camera offset and the shared direction follow (time of day, T-253). */
  setDirection(dir: THREE.Vector3): void {
    this.offset = dir.clone().normalize().multiplyScalar(240);
    this.shared.uSunDir.value.copy(dir).normalize();
  }

  /** Render the depth-only pass centred on (cx, 0, cz). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cx: number, cz: number): void {
    this.cam.position.set(cx + this.offset.x, this.offset.y, cz + this.offset.z);
    this.cam.lookAt(cx, 0, cz);
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
