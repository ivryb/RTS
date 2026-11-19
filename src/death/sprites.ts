import * as THREE from "three";
import { seededRandom } from "../behemothAttack";

const STRIDE = 21;
/** A birth time that never arrives: the slot draws nothing. */
const UNBORN = 1e30;

/**
 * Widens `range` to cover `count` values from `start` and queues it for upload. A buffer keeps
 * one range for all the writes of a frame, so a death that emits hundreds of particles costs one
 * upload and no allocation, where `addUpdateRange` would queue an object for each. three.js
 * empties `updateRanges` after each upload; a pool that is hidden keeps its one range until then.
 */
export const markDirty = (
  buffer: { updateRanges: { start: number; count: number }[]; needsUpdate: boolean },
  range: { start: number; count: number },
  start: number,
  count: number,
) => {
  if (buffer.updateRanges.length === 0) {
    range.start = start;
    range.count = count;
    buffer.updateRanges.push(range);
  } else {
    const end = Math.max(range.start + range.count, start + count);
    range.start = Math.min(range.start, start);
    range.count = end - range.start;
  }
  buffer.needsUpdate = true;
};

export interface SpriteSpawn {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  lifetime: number;
  /** Width in metres at birth and at death; growth eases out. */
  startSize: number; endSize: number;
  /** Linear RGB at birth and death, and peak opacity. */
  r: number; g: number; b: number; alpha: number;
  endR: number; endG: number; endB: number;
  /** Vertical acceleration in m/s² (negative falls, positive rises) and velocity damping per second. */
  gravity: number; drag: number;
  rotation: number; spin: number;
}

export interface SpritePoolOptions {
  name: string;
  capacity: number;
  texture: THREE.Texture;
  blending: "additive" | "normal";
  /** Share of the lifetime spent fading in, and the point where fading out begins (0 to 1). */
  fadeIn?: number;
  fadeOutFrom?: number;
  /** Constant drift in metres per second, for smoke. */
  wind?: THREE.Vector3;
  /** False draws over everything, so the terrain never cuts a glow. */
  depthTest?: boolean;
  renderOrder: number;
}

/**
 * Camera-facing particles in one draw call, animated entirely on the GPU. Emitting writes one
 * instance; after that the only per-frame work is advancing one clock uniform. When the pool is
 * full the oldest particle is reused. Nothing allocates after construction.
 */
export class SpritePool {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  /** Scratch particle: set its fields, then call `emit`. */
  readonly next: SpriteSpawn = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifetime: 1, startSize: 1, endSize: 1,
    r: 1, g: 1, b: 1, alpha: 1, endR: 1, endG: 1, endB: 1, gravity: 0, drag: 0, rotation: 0, spin: 0,
  };

  private readonly data: Float32Array;
  private readonly buffer: THREE.InstancedInterleavedBuffer;
  private readonly dirty = { start: 0, count: 0 };
  private cursor = 0;
  private time = 0;
  /** When the last particle emitted so far dies; the pool is not drawn after that. */
  private until = 0;

  constructor(private readonly options: SpritePoolOptions) {
    this.data = new Float32Array(options.capacity * STRIDE);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geometry.setIndex(quad.index);
    geometry.setAttribute("position", quad.getAttribute("position"));
    geometry.setAttribute("uv", quad.getAttribute("uv"));
    let offset = 0;
    for (const [name, size] of [
      ["aOrigin", 3], ["aVelocity", 3], ["aTiming", 2], ["aSize", 2],
      ["aColor", 4], ["aColorEnd", 3], ["aMotion", 4],
    ] as const) {
      geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buffer, size, offset));
      offset += size;
    }
    const additive = options.blending === "additive";
    const material = new THREE.ShaderMaterial({
      name: options.name,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthTest: options.depthTest ?? true,
      depthWrite: false,
      toneMapped: !additive,
      transparent: true,
      uniforms: {
        uMap: { value: options.texture },
        uTime: { value: 0 },
        uFade: { value: new THREE.Vector2(options.fadeIn ?? 0.05, options.fadeOutFrom ?? 0.5) },
        uWind: { value: options.wind ?? new THREE.Vector3() },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOrigin;
        attribute vec3 aVelocity;
        attribute vec2 aTiming;
        attribute vec2 aSize;
        attribute vec4 aColor;
        attribute vec3 aColorEnd;
        attribute vec4 aMotion;
        uniform float uTime;
        uniform vec2 uFade;
        uniform vec3 uWind;
        varying vec4 vColor;
        varying vec2 vUv;

        void main() {
          float age = uTime - aTiming.x;
          float life = age / aTiming.y;
          float alive = step(0.0, age) * step(life, 1.0);
          float drag = max(aMotion.y, 0.0001);
          vec3 centre = aOrigin + aVelocity * ((1.0 - exp(-drag * age)) / drag)
            + vec3(0.0, 0.5 * aMotion.x * age * age, 0.0) + uWind * age;
          float size = mix(aSize.x, aSize.y, 1.0 - (1.0 - life) * (1.0 - life)) * alive;
          float angle = aMotion.z + aMotion.w * age;
          float cosine = cos(angle);
          float sine = sin(angle);
          vec2 corner = vec2(
            cosine * position.x - sine * position.y,
            sine * position.x + cosine * position.y
          ) * size;
          vec4 viewPosition = modelViewMatrix * vec4(centre, 1.0);
          viewPosition.xy += corner;
          gl_Position = projectionMatrix * viewPosition;
          float fade = smoothstep(0.0, max(uFade.x, 0.0001), life)
            * (1.0 - smoothstep(uFade.y, 1.0, life));
          vColor = vec4(mix(aColor.rgb, aColorEnd, clamp(life, 0.0, 1.0)), aColor.a * fade * alive);
          vUv = uv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec4 vColor;
        varying vec2 vUv;

        void main() {
          float alpha = texture2D(uMap, vUv).a * vColor.a;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(vColor.rgb, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = options.name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = options.renderOrder;
    this.mesh.visible = false;
    geometry.instanceCount = 0;
    for (let index = 0; index < options.capacity; index += 1) this.data[index * STRIDE + 6] = UNBORN;
  }

  /** Emits the scratch particle. With `delay`, it appears that many seconds from now. */
  emit(delay = 0) {
    const { next, data } = this;
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.options.capacity;
    const start = index * STRIDE;
    data[start] = next.x; data[start + 1] = next.y; data[start + 2] = next.z;
    data[start + 3] = next.vx; data[start + 4] = next.vy; data[start + 5] = next.vz;
    data[start + 6] = this.time + delay; data[start + 7] = next.lifetime;
    data[start + 8] = next.startSize; data[start + 9] = next.endSize;
    data[start + 10] = next.r; data[start + 11] = next.g; data[start + 12] = next.b;
    data[start + 13] = next.alpha;
    data[start + 14] = next.endR; data[start + 15] = next.endG; data[start + 16] = next.endB;
    data[start + 17] = next.gravity; data[start + 18] = next.drag;
    data[start + 19] = next.rotation; data[start + 20] = next.spin;
    markDirty(this.buffer, this.dirty, start, STRIDE);
    const geometry = this.mesh.geometry;
    if (geometry.instanceCount < index + 1) geometry.instanceCount = index + 1;
    this.until = Math.max(this.until, this.time + delay + next.lifetime);
    this.mesh.visible = true;
  }

  update(deltaSeconds: number) {
    this.time += deltaSeconds;
    this.mesh.material.uniforms.uTime!.value = this.time;
    if (this.time > this.until) this.mesh.visible = false;
  }

  /** Removes every particle, scheduled ones included. */
  clear() {
    const used = this.mesh.geometry.instanceCount;
    for (let index = 0; index < used; index += 1) this.data[index * STRIDE + 6] = UNBORN;
    if (used > 0) markDirty(this.buffer, this.dirty, 0, used * STRIDE);
    this.cursor = 0;
    this.until = 0;
    this.mesh.visible = false;
    this.mesh.geometry.instanceCount = 0;
  }

  /** Frees the pool's own buffers and shader; the texture belongs to whoever made it. */
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Procedural textures: white, shaped by alpha, tinted per particle.

const valueNoise = (x: number, y: number, seed: number) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const corner = (px: number, py: number) => seededRandom(seed + px * 1_571, py * 3_119);
  const top = corner(x0, y0) + (corner(x0 + 1, y0) - corner(x0, y0)) * sx;
  const bottom = corner(x0, y0 + 1) + (corner(x0 + 1, y0 + 1) - corner(x0, y0 + 1)) * sx;
  return top + (bottom - top) * sy;
};

const fractalNoise = (x: number, y: number, seed: number) =>
  valueNoise(x, y, seed) * 0.55 + valueNoise(x * 2, y * 2, seed + 37) * 0.28
  + valueNoise(x * 4, y * 4, seed + 74) * 0.17;

/**
 * Builds a white texture of `columns` by `rows` square cells, `cellSize` pixels each. A cell's
 * alpha is `alphaAt(u, v, cell)` with u and v running from -1 to 1 across it.
 */
const createAlphaTexture = (
  cellSize: number,
  alphaAt: (u: number, v: number, cell: number) => number,
  columns = 1,
  rows = 1,
) => {
  const width = cellSize * columns;
  const height = cellSize * rows;
  const data = new Uint8Array(width * height * 4).fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = Math.floor(y / cellSize) * columns + Math.floor(x / cellSize);
      const alpha = alphaAt((x % cellSize + 0.5) / cellSize * 2 - 1, (y % cellSize + 0.5) / cellSize * 2 - 1, cell);
      data[(y * width + x) * 4 + 3] = Math.round(THREE.MathUtils.clamp(alpha, 0, 1) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

/** Soft round glow for flashes and sparks. */
export const createGlowTexture = () =>
  createAlphaTexture(64, (u, v) => Math.max(0, 1 - Math.hypot(u, v)) ** 2);

/** Billowing puff with a ragged edge, for smoke, dust and fire. */
export const createPuffTexture = () => createAlphaTexture(128, (u, v) => {
  const distance = Math.hypot(u, v);
  const billow = fractalNoise(u * 2.6 + 9, v * 2.6 + 4, 191);
  const edge = 0.62 + billow * 0.42;
  return THREE.MathUtils.smoothstep(edge - distance, 0, 0.42) * (0.55 + billow * 0.6);
});

/** How many different blots `createBlotTexture` holds, as a square grid of cells. */
export const BLOT_GRID = 2;

/** Irregular soft blots for scorch marks and stains, each with its own outline. */
export const createBlotTexture = () => createAlphaTexture(128, (u, v, cell) => {
  const seed = 53 + cell * 211;
  const distance = Math.hypot(u, v);
  const angle = Math.atan2(v, u);
  // Sampled around a circle, so the outline closes on itself without a seam.
  const lobes = valueNoise(Math.cos(angle) * 1.7 + 7, Math.sin(angle) * 1.7 + 3, seed);
  const mottle = fractalNoise(u * 3 + 5, v * 3 + 8, seed + 11);
  const reach = 0.5 + lobes * 0.32 + mottle * 0.18;
  return THREE.MathUtils.smoothstep(reach - distance, 0, 0.4) * (0.65 + mottle * 0.45);
}, BLOT_GRID, BLOT_GRID);
