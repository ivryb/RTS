import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { placeGroundGeometry, prepareGroundOverlay } from "./groundOverlay";
import { sampleHeight } from "./map";
import type { TerrainSurface } from "./terrainWalkability";
import type { TitaniumDepositState } from "./sim/harvesting";
import { POSITION_SCALE } from "./sim/simulationConstants";
import { UI_SELECTION_COLOR } from "./uiColors";

const modelUrls = [
  new URL("../assets/models/titanium-three-knuckles.glb", import.meta.url),
  new URL("../assets/models/titanium-split-lens.glb", import.meta.url),
  new URL("../assets/models/titanium-eroded-window.glb", import.meta.url),
];

export type OreModelLoader = () => Promise<readonly THREE.Group[]>;


const loadOreModels: OreModelLoader = async () => {
  const loader = new GLTFLoader();
  return Promise.all(modelUrls.map(async url => (await loader.loadAsync(url.href)).scene));
};

/** Owns ore models and selection overlays; amounts always come from the simulation. */
export class OrePresentation {
  readonly selectables: THREE.Object3D[] = [];
  readonly ready: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly models: THREE.Group[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly aim = new THREE.Vector3();
  private readonly deposits = new Map<string, {
    root: THREE.Group;
    visual: THREE.Object3D;
    ring: THREE.Mesh;
  }>();
  private disposed = false;

  constructor(world: THREE.Group, map: TerrainSurface, deposits: readonly TitaniumDepositState[],
    loadModels: OreModelLoader = loadOreModels) {
    this.root.name = "Titanium deposits";
    world.add(this.root);
    this.ready = deposits.length ? this.load(map, deposits, loadModels) : Promise.resolve();
  }

  private async load(map: TerrainSurface, deposits: readonly TitaniumDepositState[], loadModels: OreModelLoader) {
    const sources = await loadModels();
    this.models.push(...sources);
    if (this.disposed) {
      this.disposeModels();
      return;
    }
    const normalizations = sources.map(source => {
      source.updateMatrixWorld(true);
      const point = new THREE.Vector3();
      let radius = 0;
      source.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
        const positions = object.geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
          radius = Math.max(radius, Math.hypot(point.x, point.z));
        }
      });
      return radius;
    });
    deposits.forEach((deposit, index) => {
      const variant = index % sources.length;
      const visual = sources[variant]!.clone(true);
      const radius = deposit.radius / POSITION_SCALE;
      const scale = radius / normalizations[variant]!;
      visual.scale.setScalar(scale);
      visual.position.y = -0.05;
      const root = new THREE.Group();
      root.name = "Titanium deposit";
      root.userData.resourceId = deposit.id;
      const x = deposit.position.x / POSITION_SCALE;
      const z = deposit.position.z / POSITION_SCALE;
      const y = sampleHeight(map, x, z);
      root.position.set(x, y, z);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius + 0.15, radius + 0.24, 64).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: UI_SELECTION_COLOR, depthWrite: false, transparent: true, opacity: 0.85 }),
      );
      ring.userData.selectionOverlay = true;
      ring.visible = false;
      prepareGroundOverlay(ring);
      root.add(visual, ring);
      this.root.add(root);
      root.updateMatrixWorld(true);
      placeGroundGeometry(ring.geometry, 0);
      this.deposits.set(deposit.id, { root, visual, ring });
      this.selectables.push(root);
    });
  }

  update(deposits: readonly TitaniumDepositState[], selected: ReadonlySet<string>) {
    for (const deposit of deposits) {
      const presentation = this.deposits.get(deposit.id);
      if (!presentation) continue;
      presentation.ring.visible = selected.has(deposit.id);
    }
  }

  /** Contact follows the actual irregular mineral surface, not its circular navigation footprint. */
  workface(id: string, origin: THREE.Vector3) {
    const presentation = this.deposits.get(id);
    if (!presentation) return;
    presentation.root.updateWorldMatrix(true, true);
    for (const height of [0.65, 0.35, 1.1]) {
      this.aim.copy(presentation.root.position);
      this.aim.y += height;
      this.aim.sub(origin).normalize();
      this.raycaster.set(origin, this.aim);
      const hit = this.raycaster.intersectObject(presentation.visual, true)[0];
      if (hit) return hit.point;
    }
  }

  has(id: string) {
    return this.deposits.has(id);
  }

  dispose() {
    this.disposed = true;
    this.root.removeFromParent();
    for (const { ring } of this.deposits.values()) {
      ring.geometry.dispose();
      if (ring.material instanceof THREE.Material) ring.material.dispose();
    }
    this.disposeModels();
    this.deposits.clear();
    this.selectables.length = 0;
  }

  private disposeModels() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    for (const source of this.models) source.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    this.models.length = 0;
  }
}

/** A short mechanical cutter and a physical cargo bin make the two work phases visible. */
export class ScoutHarvestPresentation {
  readonly cargo = new THREE.Group();
  readonly tool = new THREE.Group();
  private readonly shaft: THREE.Mesh;
  private readonly cutter: THREE.Mesh;
  private readonly dust: THREE.Points;
  private readonly end = new THREE.Vector3();
  private readonly start = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private time = 0;

  constructor(root: THREE.Group, world: THREE.Group) {
    const ivory = new THREE.MeshStandardMaterial({ color: 0xc9baa0, roughness: 0.72, metalness: 0.08 });
    const graphite = new THREE.MeshStandardMaterial({ color: 0x323a3c, roughness: 0.7, metalness: 0.2 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x77817f, roughness: 0.46, metalness: 0.45 });
    const bin = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.24, 0.36, 2, 0.045), ivory);
    const contents = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.13, 0.27, 2, 0.025), graphite);
    contents.position.y = 0.15;
    this.cargo.add(bin, contents);
    this.cargo.position.set(0, 0.75, -0.57);
    this.cargo.visible = false;
    this.cargo.name = "Titanium cargo";
    root.add(this.cargo);
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 1, 8), graphite);
    this.cutter = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.23, 10), metal);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.2, 10), ivory);
    collar.position.y = -0.32;
    this.shaft.add(collar);
    this.tool.add(this.shaft, this.cutter);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(36), 3));
    this.dust = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xbaa18b, size: 0.13, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    this.dust.frustumCulled = false;
    this.tool.add(this.dust);
    this.tool.name = "Scout mineral cutter";
    this.tool.visible = false;
    this.tool.frustumCulled = false;
    world.add(this.tool);
  }

  update(amount: number, working: boolean, x: number, y: number, z: number,
    contact: THREE.Vector3 | undefined, deltaSeconds: number) {
    this.cargo.visible = amount > 0;
    this.tool.visible = working && contact !== undefined;
    if (!this.tool.visible || !contact) return;
    this.time += deltaSeconds;
    this.direction.set(contact.x - x, 0, contact.z - z).normalize();
    this.start.set(x, y + 0.95, z).addScaledVector(this.direction, 0.44);
    this.end.copy(contact);
    this.direction.subVectors(this.end, this.start);
    this.shaft.position.copy(this.start).add(this.end).multiplyScalar(0.5);
    this.shaft.scale.y = this.direction.length();
    this.shaft.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, this.direction.normalize());
    this.cutter.position.copy(this.end);
    this.cutter.quaternion.copy(this.shaft.quaternion);
    this.cutter.rotateY(this.time * 15);
    const positions = this.dust.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const life = (this.time * 1.8 + i / positions.count) % 1;
      positions.setXYZ(i, this.end.x + Math.sin(i * 2.4) * life * 0.32,
        this.end.y + life * 0.42, this.end.z + Math.cos(i * 2.4) * life * 0.32);
    }
    positions.needsUpdate = true;
  }

  hide() {
    this.tool.visible = false;
    this.cargo.visible = false;
  }

  dispose() {
    this.tool.removeFromParent();
    this.cargo.removeFromParent();
    const materials = new Set<THREE.Material>();
    for (const root of [this.tool, this.cargo]) root.traverse(object => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const material of materials) material.dispose();
  }
}
