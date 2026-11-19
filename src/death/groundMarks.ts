import * as THREE from "three";
import type { GeneratedMap } from "../map";
import { BLOT_GRID, markDirty } from "./sprites";

/** Per vertex: position 3, mark-space uv 2, tint 4, timing 4 (start, fade in, hold, fade out), blot. */
const STRIDE = 14;
const UNBORN = 1e30;
/** Metres a mark floats over the terrain, with a polygon offset, so the two never fight for depth. */
const SURFACE_OFFSET = 0.035;

export interface GroundMark {
  x: number; z: number;
  /** Width in metres, no more than the pool's `largest`, and rotation about the vertical. */
  size: number; rotation: number;
  /** Which of the texture's blots to use; any whole number. */
  blot: number;
  /** Linear RGB and peak opacity. */
  r: number; g: number; b: number; alpha: number;
  /** Seconds to appear, to stay at full strength, and to fade away. */
  fadeIn: number; hold: number; fadeOut: number;
}

/**
 * Scorch marks and stains that lie on the terrain, in one draw call. Each mark is a patch of the
 * terrain's own grid, so it follows slopes and dunes instead of cutting into them. A mark is
 * written once when it is laid and fades on the GPU; when the pool is full the oldest is reused.
 */
export class GroundMarks {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Scratch mark: set its fields, then call `emit`. */
  readonly next: GroundMark = {
    x: 0, z: 0, size: 1, rotation: 0, blot: 0, r: 0, g: 0, b: 0, alpha: 1, fadeIn: 0.25, hold: 20, fadeOut: 6,
  };

  private readonly cells: number;
  private readonly verticesPerMark: number;
  private readonly data: Float32Array;
  private readonly buffer: THREE.InterleavedBuffer;
  private readonly dirty = { start: 0, count: 0 };
  private cursor = 0;
  private time = 0;
  /** When the last mark laid so far has faded; the pool is not drawn after that. */
  private until = 0;

  constructor(
    private readonly map: GeneratedMap,
    private readonly options: { name: string; capacity: number; largest: number; texture: THREE.Texture },
  ) {
    const { capacity, largest } = options;
    // A turned mark reaches its diagonal along the grid, and the patch snaps to whole cells.
    this.cells = Math.min(map.segments, Math.ceil(largest * Math.SQRT2 / (map.size / map.segments)) + 2);
    const side = this.cells + 1;
    this.verticesPerMark = side * side;
    this.data = new Float32Array(capacity * this.verticesPerMark * STRIDE);
    this.buffer = new THREE.InterleavedBuffer(this.data, STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    let offset = 0;
    for (const [name, size] of [["position", 3], ["aUv", 2], ["aTint", 4], ["aTiming", 4], ["aBlot", 1]] as const) {
      geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buffer, size, offset));
      offset += size;
    }
    const indices = new Uint32Array(capacity * this.cells * this.cells * 6);
    let index = 0;
    for (let mark = 0; mark < capacity; mark += 1) {
      for (let z = 0; z < this.cells; z += 1) {
        for (let x = 0; x < this.cells; x += 1) {
          const corner = mark * this.verticesPerMark + z * side + x;
          indices.set([corner, corner + side, corner + 1, corner + 1, corner + side, corner + side + 1], index);
          index += 6;
        }
      }
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const material = new THREE.ShaderMaterial({
      name: options.name,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      transparent: true,
      uniforms: { uMap: { value: options.texture }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec2 aUv;
        attribute vec4 aTint;
        attribute vec4 aTiming;
        attribute float aBlot;
        uniform float uTime;
        varying vec4 vColor;
        varying vec2 vUv;
        varying vec2 vCell;

        void main() {
          float age = uTime - aTiming.x;
          float fades = aTiming.y + aTiming.z;
          float fade = smoothstep(0.0, max(aTiming.y, 0.0001), age)
            * (1.0 - smoothstep(fades, fades + aTiming.w, age));
          vColor = vec4(aTint.rgb, aTint.a * fade);
          vUv = aUv;
          vCell = vec2(mod(aBlot, ${BLOT_GRID}.0), floor(aBlot / ${BLOT_GRID}.0));
          // A mark that has not appeared yet, or has faded out, is moved off screen and costs no pixels.
          gl_Position = age < 0.0 || age > fades + aTiming.w
            ? vec4(2.0, 2.0, 2.0, 1.0)
            : projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec4 vColor;
        varying vec2 vUv;
        varying vec2 vCell;

        void main() {
          if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) discard;
          float alpha = texture2D(uMap, (vUv + vCell) / ${BLOT_GRID}.0).a * vColor.a;
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
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
    for (let at = 9; at < this.data.length; at += STRIDE) this.data[at] = UNBORN;
  }

  /** Lays the scratch mark on the terrain. With `delay`, it appears that many seconds from now. */
  emit(delay = 0) {
    const { next, map, data, cells } = this;
    const mark = this.cursor;
    this.cursor = (this.cursor + 1) % this.options.capacity;
    const cosine = Math.cos(next.rotation);
    const sine = Math.sin(next.rotation);
    const { segments, size } = map;
    const startX = THREE.MathUtils.clamp(Math.floor((next.x / size + 0.5) * segments - cells / 2), 0, segments - cells);
    const startZ = THREE.MathUtils.clamp(Math.floor((next.z / size + 0.5) * segments - cells / 2), 0, segments - cells);
    const blot = Math.abs(Math.floor(next.blot)) % (BLOT_GRID * BLOT_GRID);
    const first = mark * this.verticesPerMark * STRIDE;
    let at = first;
    for (let z = 0; z <= cells; z += 1) {
      for (let x = 0; x <= cells; x += 1) {
        const gridX = startX + x;
        const gridZ = startZ + z;
        const worldX = (gridX / segments - 0.5) * size;
        const worldZ = (gridZ / segments - 0.5) * size;
        const offsetX = worldX - next.x;
        const offsetZ = worldZ - next.z;
        data[at] = worldX;
        data[at + 1] = map.heights[gridZ * (segments + 1) + gridX]! + SURFACE_OFFSET;
        data[at + 2] = worldZ;
        data[at + 3] = (offsetX * cosine - offsetZ * sine) / next.size + 0.5;
        data[at + 4] = (offsetX * sine + offsetZ * cosine) / next.size + 0.5;
        data[at + 5] = next.r; data[at + 6] = next.g; data[at + 7] = next.b; data[at + 8] = next.alpha;
        data[at + 9] = this.time + delay; data[at + 10] = next.fadeIn;
        data[at + 11] = next.hold; data[at + 12] = next.fadeOut;
        data[at + 13] = blot;
        at += STRIDE;
      }
    }
    markDirty(this.buffer, this.dirty, first, at - first);
    const drawn = (mark + 1) * cells * cells * 6;
    if (this.mesh.geometry.drawRange.count < drawn) this.mesh.geometry.setDrawRange(0, drawn);
    this.until = Math.max(this.until, this.time + delay + next.fadeIn + next.hold + next.fadeOut);
    this.mesh.visible = true;
  }

  update(deltaSeconds: number) {
    this.time += deltaSeconds;
    this.mesh.material.uniforms.uTime!.value = this.time;
    if (this.time > this.until) this.mesh.visible = false;
  }

  /** Removes every mark, scheduled ones included. */
  clear() {
    const used = this.mesh.geometry.drawRange.count / (this.cells * this.cells * 6) * this.verticesPerMark * STRIDE;
    for (let at = 9; at < used; at += STRIDE) this.data[at] = UNBORN;
    if (used > 0) markDirty(this.buffer, this.dirty, 0, used);
    this.cursor = 0;
    this.until = 0;
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  /** Frees the pool's own buffers and shader; the texture belongs to whoever made it. */
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
