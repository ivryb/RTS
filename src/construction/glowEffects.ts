import * as THREE from "three";

/** Floats per glow: position and size, velocity and seed, then kind, strength and age. */
const STRIDE = 12;
/** A lamp's glow never draws smaller than this many pixels across, so it reads at any zoom. */
const LAMP_PIXELS = 15;

export const Glow = {
  /** A welding arc: a flickering hot point. */
  Flare: 0,
  /** A falling spark thrown from an arc; it loops on its own from the clock. */
  Spark: 1,
  /** A slow cyan blink on a scaffold lamp: the site is waiting for a drone. */
  Lamp: 2,
  /** A puff of sand kicked up as something drops; `age` runs it from 0 to 1. */
  Dust: 3,
  /** Dark smoke rising from a broken part; it loops on its own from the clock. */
  Smoke: 4,
} as const;

/** One owner's glows for the current frame. Refill it from scratch on every update. */
export interface GlowList {
  clear(): void;
  add(
    kind: typeof Glow[keyof typeof Glow],
    position: THREE.Vector3,
    size: number,
    strength: number,
    seed: number,
    velocity?: THREE.Vector3,
    age?: number,
  ): void;
  dispose(): void;
}

const vertexShader = /* glsl */ `
attribute vec4 aPlace;
attribute vec4 aMotion;
attribute vec4 aState;
uniform float uTime;
uniform float uViewportHeight;
varying vec2 vCorner;
varying float vKind;
varying float vStrength;

void main() {
  float seed = aMotion.w;
  vec3 center = aPlace.xyz;
  vec2 extent = vec2(aPlace.w);
  vec2 axis = vec2(0.0, 1.0);
  // Glows sit on a surface; drawing them a little nearer keeps the wall from cutting them in half.
  float lift = 0.5;
  vKind = aState.x;
  vStrength = aState.y;
  if (vKind < 0.5) {
    extent *= 0.74 + 0.26 * sin(uTime * 61.0 + seed * 40.0) * sin(uTime * 37.0 + seed * 13.0);
  } else if (vKind < 1.5) {
    float life = 0.34 + 0.3 * fract(seed * 7.13);
    float age = fract(uTime / life + seed * 3.7);
    float elapsed = age * life;
    center += aMotion.xyz * elapsed + vec3(0.0, -4.9 * elapsed * elapsed, 0.0);
    vec2 heading = (viewMatrix * vec4(aMotion.xyz + vec3(0.0, -9.8 * elapsed, 0.0), 0.0)).xy;
    axis = normalize(heading + vec2(0.0, 0.0001));
    extent = aPlace.w * vec2(0.2, 0.55 + 0.16 * length(heading));
    vStrength *= (1.0 - age) * smoothstep(0.0, 0.1, age);
    lift = 0.2;
  } else if (vKind < 2.5) {
    // A lamp never goes fully dark, so a waiting site reads as waiting in any single frame.
    vStrength *= 0.3 + 0.7 * pow(0.5 + 0.5 * sin(uTime * 4.2 + seed), 5.0);
    // The game's camera is orthographic, so one pixel is the same size everywhere on screen.
    extent = max(extent, vec2(${(LAMP_PIXELS / 2).toFixed(1)} * 2.0 / (projectionMatrix[1][1] * uViewportHeight)));
  } else if (vKind < 3.5) {
    float age = aState.z;
    center += aMotion.xyz * (1.0 - (1.0 - age) * (1.0 - age));
    extent *= 0.55 + 1.1 * age;
    vStrength *= (1.0 - age) * (1.0 - age) * smoothstep(0.0, 0.12, age);
    // A puff is a camera-facing disc resting on the ground; far enough forward, the terrain
    // no longer slices its lower half off in a straight line.
    lift = extent.y * 1.1;
  } else {
    float life = 1.5 + 0.9 * fract(seed * 5.31);
    float age = fract(uTime / life + seed * 3.7);
    center += aMotion.xyz * age * life + vec3(sin(age * 5.0 + seed * 9.0), 0.0, cos(age * 4.0 + seed * 7.0)) * 0.12 * age;
    extent *= 0.45 + 1.25 * age;
    vStrength *= (1.0 - age) * smoothstep(0.0, 0.18, age);
  }
  vec4 view = viewMatrix * vec4(center, 1.0);
  view.xy += vec2(axis.y, -axis.x) * position.x * extent.x + axis * position.y * extent.y;
  view.z += lift;
  vCorner = position.xy;
  gl_Position = projectionMatrix * view;
}
`;

// Premultiplied output: light adds (alpha 0) and dust or smoke covers (alpha above 0) in one
// material. A cover is tone mapped as a plain colour and only then weighted, or its thin
// edges would come out of the display curve brighter than its core and glow.
const fragmentShader = /* glsl */ `
varying vec2 vCorner;
varying float vKind;
varying float vStrength;

void main() {
  float reach = length(vCorner);
  float edge = 1.0 - smoothstep(0.7, 1.0, reach);
  vec3 light = vec3(0.0);
  float cover = 0.0;
  if (vKind < 0.5) {
    light = vec3(3.2, 2.9, 2.4) * exp(-reach * reach * 26.0)
      + vec3(1.0, 0.56, 0.2) * exp(-reach * reach * 4.5) * 0.6;
  } else if (vKind < 1.5) {
    float body = (1.0 - abs(vCorner.x)) * (1.0 - vCorner.y * vCorner.y);
    light = mix(vec3(1.3, 0.55, 0.14), vec3(3.0, 2.5, 1.8), body) * body;
  } else if (vKind < 2.5) {
    light = vec3(0.55, 2.3, 2.5) * exp(-reach * reach * 22.0)
      + vec3(0.12, 0.6, 0.68) * exp(-reach * reach * 4.0) * 0.55;
  } else if (vKind < 3.5) {
    cover = exp(-reach * reach * 3.0) * edge * 0.68 * vStrength;
    light = vec3(0.6, 0.41, 0.26);
  } else {
    cover = exp(-reach * reach * 2.2) * edge * 0.78 * vStrength;
    light = vec3(0.05, 0.043, 0.038);
  }
  gl_FragColor = vec4(vKind < 2.5 ? light * edge * vStrength : light, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor = vKind < 2.5 ? vec4(gl_FragColor.rgb, 0.0) : vec4(gl_FragColor.rgb * cover, cover);
}
`;

const viewport = new THREE.Vector4();

/**
 * Sparks, arcs, lamp blinks, dust and smoke for the whole world, drawn as one instanced set of
 * quads in one draw call. Each owner fills its own `GlowList` every frame; `flush` gathers
 * them once all owners have updated.
 */
export class GlowEffects {
  private readonly lists = new Set<{ data: Float32Array; count: number }>();
  private readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(1024 * STRIDE), STRIDE);

  constructor(parent: THREE.Object3D) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      name: "Construction glow",
      uniforms: { uTime: { value: 0 }, uViewportHeight: { value: 900 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    this.mesh.name = "Glow effects";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.mesh.onBeforeRender = (renderer) => {
      this.mesh.material.uniforms.uViewportHeight!.value = renderer.getCurrentViewport(viewport).w;
    };
    this.bind();
    parent.add(this.mesh);
  }

  private bind() {
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    const { geometry } = this.mesh;
    geometry.setAttribute("aPlace", new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    geometry.setAttribute("aMotion", new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    geometry.setAttribute("aState", new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
  }

  /** Reserves room for up to `capacity` glows belonging to one owner. */
  createList(capacity: number): GlowList {
    const list = { data: new Float32Array(capacity * STRIDE), count: 0 };
    this.lists.add(list);
    return {
      clear() {
        list.count = 0;
      },
      add(kind, position, size, strength, seed, velocity, age = 0) {
        if (list.count === capacity) return;
        const at = list.count * STRIDE;
        list.count += 1;
        list.data[at] = position.x;
        list.data[at + 1] = position.y;
        list.data[at + 2] = position.z;
        list.data[at + 3] = size;
        list.data[at + 4] = velocity?.x ?? 0;
        list.data[at + 5] = velocity?.y ?? 0;
        list.data[at + 6] = velocity?.z ?? 0;
        list.data[at + 7] = seed;
        list.data[at + 8] = kind;
        list.data[at + 9] = strength;
        list.data[at + 10] = age;
      },
      dispose: () => this.lists.delete(list),
    };
  }

  /** Gathers every owner's glows into the shared buffer; call once per rendered frame. */
  flush(time: number) {
    let total = 0;
    for (const list of this.lists) total += list.count;
    this.mesh.visible = total > 0;
    if (!total) return;
    if (total * STRIDE > this.buffer.array.length) {
      this.mesh.geometry.dispose();
      this.buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(total * 2 * STRIDE), STRIDE);
      this.bind();
    }
    const { array } = this.buffer;
    let at = 0;
    for (const { data, count } of this.lists) {
      array.set(count * STRIDE === data.length ? data : data.subarray(0, count * STRIDE), at);
      at += count * STRIDE;
    }
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, at);
    this.buffer.needsUpdate = true;
    this.mesh.geometry.instanceCount = total;
    this.mesh.material.uniforms.uTime!.value = time;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
