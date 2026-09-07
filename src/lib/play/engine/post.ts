import * as THREE from "three";

/**
 * 3D colour-grade LUT packed into a 256×16 RGBA8 DataTexture (16 slices of 16×16).
 * Pure: exported separately so it can be unit-tested without WebGL.
 */
export function buildLutData(): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(new ArrayBuffer(256 * 16 * 4));
  const c255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let b = 0; b < 16; b++) {
    for (let g = 0; g < 16; g++) {
      for (let r = 0; r < 16; r++) {
        let R = r / 15, G = g / 15, B = b / 15;
        const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        R = l + (R - l) * 1.14; G = l + (G - l) * 1.14; B = l + (B - l) * 1.14; // saturation
        R = 0.5 + (R - 0.5) * 1.08; G = 0.5 + (G - 0.5) * 1.08; B = 0.5 + (B - 0.5) * 1.08; // contrast
        R += 0.035 * l; B += 0.03 * (1 - l); // warm highlights, cool shadows
        const i = (g * 256 + b * 16 + r) * 4;
        data[i] = c255(R); data[i + 1] = c255(G); data[i + 2] = c255(B); data[i + 3] = 255;
      }
    }
  }
  return data;
}

export function makeLut(): THREE.DataTexture {
  const t = new THREE.DataTexture(buildLutData(), 256, 16, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const FS_POST = /* glsl */ `
  layout(location = 0) out vec4 outColor;
  uniform sampler2D tColor; uniform sampler2D tNormal; uniform sampler2D tLut;
  uniform vec2 uRes; uniform vec4 uViewport; uniform float uPulse; uniform float uTime; uniform float uLine; uniform float uBloom; uniform float uVignette;
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 lin2srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  vec3 lut3d(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    float b = c.b * 15.0, b0 = floor(b), b1 = min(15.0, b0 + 1.0), f = b - b0;
    float y = (c.g * 15.0 + 0.5) / 16.0, x = c.r * 15.0 + 0.5;
    return mix(texture(tLut, vec2((b0 * 16.0 + x) / 256.0, y)).rgb, texture(tLut, vec2((b1 * 16.0 + x) / 256.0, y)).rgb, f);
  }
  void main() {
    vec2 px = gl_FragCoord.xy, uv = px / uRes, tx = 1.0 / uRes;
    vec3 col = texture(tColor, uv).rgb;
    vec4 nc = texture(tNormal, uv);
    vec4 n00 = texture(tNormal, uv + tx * vec2(-1.0, -1.0)), n10 = texture(tNormal, uv + tx * vec2(0.0, -1.0)), n20 = texture(tNormal, uv + tx * vec2(1.0, -1.0));
    vec4 n01 = texture(tNormal, uv + tx * vec2(-1.0, 0.0)),                                                    n21 = texture(tNormal, uv + tx * vec2(1.0, 0.0));
    vec4 n02 = texture(tNormal, uv + tx * vec2(-1.0, 1.0)),  n12 = texture(tNormal, uv + tx * vec2(0.0, 1.0)),  n22 = texture(tNormal, uv + tx * vec2(1.0, 1.0));
    vec4 gx = (n20 + 2.0 * n21 + n22) - (n00 + 2.0 * n01 + n02);
    vec4 gy = (n02 + 2.0 * n12 + n22) - (n00 + 2.0 * n10 + n20);
    float en = length(gx.xyz) + length(gy.xyz);
    float ed = (abs(gx.w) + abs(gy.w)) * 60.0;
    float edge = max(smoothstep(0.9, 1.8, en), smoothstep(0.35, 1.2, ed));
    float fade = 1.0 - smoothstep(0.12, 0.4, nc.w);
    col *= 1.0 - edge * uLine * fade;
    vec3 bl = vec3(0.0);
    const vec2 O[8] = vec2[8](vec2(3,0), vec2(-3,0), vec2(0,3), vec2(0,-3), vec2(5,5), vec2(-5,5), vec2(5,-5), vec2(-5,-5));
    for (int i = 0; i < 8; i++) { vec3 s = texture(tColor, uv + O[i] * tx).rgb; bl += s * step(1.0, lum(s)); }
    col += bl * (uBloom / 8.0);
    // Focus pulse: a soft radial brightening around the viewport centre (replaces racing speed lines).
    vec2 luv = (px - uViewport.xy) / uViewport.zw, d = luv - 0.5; d.x *= uViewport.z / uViewport.w;
    float r = length(d);
    col += vec3(0.12) * uPulse * (1.0 - smoothstep(0.0, 0.35, r)) * (0.5 + 0.5 * sin(uTime * 4.0));
    col *= 1.0 - uVignette * smoothstep(0.45, 1.05, r);
    col = lin2srgb(clamp(col, 0.0, 1.0));
    outColor = vec4(lut3d(col), 1.0);
  }`;

export type PostUniforms = {
  tColor: { value: THREE.Texture };
  tNormal: { value: THREE.Texture };
  tLut: { value: THREE.DataTexture };
  uRes: { value: THREE.Vector2 };
  uViewport: { value: THREE.Vector4 };
  uPulse: { value: number };
  uTime: { value: number };
  uLine: { value: number };
  uBloom: { value: number };
  uVignette: { value: number };
};

/**
 * Single fullscreen pass: Sobel crease from the normal attachment, hard-threshold
 * bloom, focus pulse, vignette, explicit linear→sRGB, then the LUT grade.
 */
export class PostPass {
  readonly uniforms: PostUniforms;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: THREE.ShaderMaterial;

  constructor(gbuf: THREE.WebGLRenderTarget, timeUniform: { value: number }) {
    this.uniforms = {
      tColor: { value: gbuf.textures[0] },
      tNormal: { value: gbuf.textures[1] },
      tLut: { value: makeLut() },
      uRes: { value: new THREE.Vector2(1, 1) },
      uViewport: { value: new THREE.Vector4(0, 0, 1, 1) },
      uPulse: { value: 0 },
      uTime: timeUniform,
      uLine: { value: 0.75 },
      uBloom: { value: 0.6 },
      uVignette: { value: 0.35 },
    };
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: FS_POST,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setResolution(w: number, h: number): void {
    this.uniforms.uRes.value.set(w, h);
  }

  /** Draw to the screen inside the given CSS viewport; `px*` is the same rect in device pixels. */
  render(
    renderer: THREE.WebGLRenderer,
    css: { x: number; y: number; w: number; h: number },
    px: { x: number; y: number; w: number; h: number },
    scissor: boolean,
  ): void {
    renderer.setRenderTarget(null);
    renderer.setScissorTest(scissor);
    renderer.setViewport(css.x, css.y, css.w, css.h);
    renderer.setScissor(css.x, css.y, css.w, css.h);
    this.uniforms.uViewport.value.set(px.x, px.y, px.w, px.h);
    renderer.render(this.scene, this.cam);
  }

  dispose(): void {
    this.mat.dispose();
    this.uniforms.tLut.value.dispose();
  }
}
