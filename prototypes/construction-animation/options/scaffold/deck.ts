import * as THREE from "three";
import { DIRECTIONS, SLICES } from "./outline";
import { structureGlsl } from "./reveal";

/** Floats per deck: the site's ground position and turn, then height, table row, work and spread. */
const STRIDE = 8;
/** Metres of hot seam around a deck's rim while it is being welded. */
const SEAM = 0.09;

/** The flat structural deck that closes one site's hull at the height built so far. */
export interface Deck {
  /**
   * `progress` (0 to 1) picks the hull section and `height` is the deck's world height.
   * `work` runs from 0 (cold, nobody building) to 1 (ribs and rim glowing), and `spread`
   * from 0 (a point on the axis) to 1 (out to the hull).
   */
  set(progress: number, height: number, work: number, spread: number): void;
  hide(): void;
}

// Each deck is a fan around the building's axis whose rim reads its radius, per direction,
// from the hull table at the cut height, blended between the two nearest rows.
const vertexShader = /* glsl */ `
attribute vec4 aSite;
attribute vec4 aCut;
uniform sampler2D uHulls;
varying vec2 vLocal;
varying float vRim;
varying float vReach;
varying float vWork;

void main() {
  float angle = position.x / ${DIRECTIONS}.0 * 6.283185307 - 3.141592654;
  float reach = aCut.w * texture2D(uHulls, vec2((mod(position.x, ${DIRECTIONS}.0) + 0.5) / ${DIRECTIONS}.0, aCut.y)).r;
  vLocal = position.y * reach * vec2(cos(angle), sin(angle));
  vRim = position.y;
  vReach = reach;
  vWork = aCut.z;
  vec3 world = vec3(
    aSite.x + aSite.z * vLocal.x + aSite.w * vLocal.y,
    aCut.x,
    aSite.y - aSite.w * vLocal.x + aSite.z * vLocal.y
  );
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying vec2 vLocal;
varying float vRim;
varying float vReach;
varying float vWork;
${structureGlsl}

void main() {
  float seam = 1.0 - smoothstep(${(SEAM * 0.4).toFixed(3)}, ${SEAM.toFixed(3)}, (1.0 - vRim) * vReach);
  gl_FragColor = vec4(siteDeck(vLocal, vWork) + vWork * seam * SITE_HOT_SEAM, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Every site's deck, drawn as one instanced fan. Hull tables are shared per building kind. */
export class Decks {
  private readonly shown = new Set<Float32Array>();
  private readonly hulls: THREE.DataTexture;
  private readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(32 * STRIDE), STRIDE);
  private tables = 0;

  /** `kinds` is the number of building kinds, each of which may add one hull table. */
  constructor(scene: THREE.Scene, private readonly kinds: number) {
    // Half floats, because every WebGL 2 device can blend between their rows.
    this.hulls = new THREE.DataTexture(
      new Uint16Array(DIRECTIONS * SLICES * kinds),
      DIRECTIONS,
      SLICES * kinds,
      THREE.RedFormat,
      THREE.HalfFloatType,
    );
    this.hulls.minFilter = this.hulls.magFilter = THREE.LinearFilter;
    // Each triangle of the fan carries its own centre, so the centre knows that triangle's reach.
    const corners: number[] = [];
    for (let direction = 0; direction < DIRECTIONS; direction += 1) {
      corners.push(direction, 0, 0, direction + 1, 1, 0, direction, 1, 0);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(corners, 3));
    this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      uniforms: { uHulls: { value: this.hulls } },
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
    }));
    this.mesh.name = "Construction decks";
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.bind();
    scene.add(this.mesh);
  }

  private bind() {
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    const { geometry } = this.mesh;
    geometry.setAttribute("aSite", new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    geometry.setAttribute("aCut", new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
  }

  /** Stores one building kind's `Outline.decks` and returns its table number for `createDeck`. */
  addHull(decks: Float32Array) {
    if (this.tables === this.kinds) throw new Error("More hull tables than building kinds");
    const halves = Uint16Array.from(decks, (radius) => THREE.DataUtils.toHalfFloat(radius));
    (this.hulls.image.data as Uint16Array).set(halves, this.tables * DIRECTIONS * SLICES);
    this.hulls.needsUpdate = true;
    this.tables += 1;
    return this.tables - 1;
  }

  /** `root` is the building's root, turned only about its vertical axis. */
  createDeck(root: THREE.Object3D, table: number): Deck {
    const data = new Float32Array(STRIDE);
    data[0] = root.position.x;
    data[1] = root.position.z;
    data[2] = Math.cos(root.rotation.y);
    data[3] = Math.sin(root.rotation.y);
    const rows = SLICES * this.kinds;
    return {
      set: (progress, height, work, spread) => {
        // Kept half a row inside the table, so a deck never blends into another kind's hull.
        const row = THREE.MathUtils.clamp(progress * SLICES, 0.5, SLICES - 0.5);
        data[4] = height;
        data[5] = (table * SLICES + row) / rows;
        data[6] = work;
        data[7] = spread;
        this.shown.add(data);
      },
      hide: () => this.shown.delete(data),
    };
  }

  /** Gathers the decks being shown into the shared buffer; call once per rendered frame. */
  flush() {
    const total = this.shown.size;
    this.mesh.visible = total > 0;
    if (!total) return;
    if (total * STRIDE > this.buffer.array.length) {
      this.mesh.geometry.dispose();
      this.buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(total * 2 * STRIDE), STRIDE);
      this.bind();
    }
    let at = 0;
    for (const data of this.shown) {
      this.buffer.array.set(data, at);
      at += STRIDE;
    }
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, at);
    this.buffer.needsUpdate = true;
    this.mesh.geometry.instanceCount = total;
  }
}
