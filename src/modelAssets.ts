import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import type { BuildingKind } from "./sim/units";
import type { UnitKind } from "./sim/unitDefinitions";
import type {
  LoadedUnitPresentation,
  UnitPresentationFactory,
  UnitPresentationOptions,
} from "./unitSystem";

export interface DemoAsset {
  name: string;
  url: URL;
  unitKind?: UnitKind;
  building?: {
    id: string;
    kind: BuildingKind;
    ownerId: string;
  };
  height: number;
  elevation?: number;
  facingOffset?: number;
  originOffset?: { x: number; z: number };
  radius: number;
  offset: { x: number; z: number };
  rotation: number;
  presentation?: UnitPresentationOptions;
}

export const demoAssets: DemoAsset[] = [
  {
    name: "Command Center",
    building: {
      id: "command-center-1",
      kind: "command-center",
      ownerId: "local-player",
    },
    url: new URL("../assets/models/command-center.glb", import.meta.url),
    height: 6.51,
    radius: 10.695,
    offset: { x: -17, z: 3 },
    rotation: Math.PI / 4,
  },
  {
    name: "Ghostrunner",
    url: new URL("../assets/models/ghostrunner.glb", import.meta.url),
    unitKind: "ghostrunner",
    originOffset: { x: 0, z: 0.102 },
    height: 2.35,
    radius: 8,
    offset: { x: 2.2, z: 6.7 },
    rotation: Math.PI / 4,
    presentation: {
      attackTimeScale: 2.04,
      moveTimeScale: 0.9,
      terrainAlignment: 0.45,
      turnResponsiveness: 14,
      selectionRing: { radius: 0.56, offset: { x: 0, z: -0.02 } },
      selectionHitbox: {
        radius: 0.58,
        height: 2.5,
        offset: { x: 0, y: 1.15, z: 0.05 },
      },
    },
  },
  {
    name: "Scout Drone",
    url: new URL("../assets/models/scout-drone.glb", import.meta.url),
    unitKind: "scout-drone",
    height: 0.6615,
    elevation: 0.75,
    facingOffset: Math.PI / 2,
    radius: 0.504,
    offset: { x: -9, z: 6.5 },
    rotation: -Math.PI / 4,
    presentation: {
      terrainAlignment: 0,
      turnResponsiveness: 18,
      selectionRing: { radius: 0.468, offset: { x: 0, z: 0 } },
      selectionHitbox: {
        radius: 0.45,
        height: 1.17,
        offset: { x: 0, y: 1.05, z: 0 },
      },
    },
  },
  {
    name: "Behemoth",
    url: new URL("../assets/models/behemoth.glb", import.meta.url),
    unitKind: "behemoth",
    height: 2.375568,
    radius: 1.583712,
    offset: { x: -5.5, z: 10.5 },
    rotation: -Math.PI / 4,
    presentation: {
      terrainAlignment: 1,
      turnResponsiveness: 6,
      selectionRing: { radius: 1.5969096, offset: { x: 0, z: 0 } },
      selectionHitbox: {
        radius: 1.5243228,
        height: 2.63952,
        offset: { x: 0, y: 1.187784, z: 0 },
      },
    },
  },
  {
    name: "Hornet",
    url: new URL("../assets/models/hornet.glb", import.meta.url),
    unitKind: "hornet",
    height: 1.1088,
    elevation: 1.375,
    facingOffset: Math.PI / 2,
    radius: 1.848,
    offset: { x: 10.5, z: 3 },
    rotation: -Math.PI / 4,
    presentation: {
      terrainAlignment: 0,
      turnResponsiveness: 16,
      selectionRing: { radius: 0.966, offset: { x: 0, z: 0 } },
      selectionHitbox: {
        radius: 1.694,
        height: 2.002,
        offset: { x: 0, y: 1.93, z: 0 },
      },
    },
  },
  {
    name: "Turret",
    building: {
      id: "turret-1",
      kind: "turret",
      ownerId: "enemy-player",
    },
    url: new URL("../assets/models/turret.glb", import.meta.url),
    height: 1.8,
    radius: 3.4,
    offset: { x: -10, z: -13 },
    rotation: 0,
  },
];

const loader = new GLTFLoader();

export const loadDemoAsset = async (asset: DemoAsset) => {
  const source = await loader.loadAsync(asset.url.href);
  const model = source.scene;
  model.rotation.y = asset.facingOffset ?? 0;
  const initialBounds = new THREE.Box3().setFromObject(model);
  model.scale.setScalar(asset.height / initialBounds.getSize(new THREE.Vector3()).y);

  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.set(
    -center.x + (asset.originOffset?.x ?? 0),
    (asset.elevation ?? 0) - bounds.min.y,
    -center.z + (asset.originOffset?.z ?? 0),
  );
  const instance = new THREE.Group();
  instance.add(model);

  return { animations: source.animations, instance, model };
};

export const loadBuildingModel = async (kind: BuildingKind) => {
  const asset = demoAssets.find((candidate) => candidate.building?.kind === kind);
  if (!asset) throw new Error(`Missing building model for ${kind}`);
  const { instance, model } = await loadDemoAsset(asset);
  instance.name = asset.name;
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return instance;
};

const findUnitAsset = (kind: UnitKind) => {
  const asset = demoAssets.find((candidate) => candidate.unitKind === kind);
  if (!asset) throw new Error(`Missing unit asset for ${kind}`);
  return asset;
};

const unitAssets = {
  ghostrunner: findUnitAsset("ghostrunner"),
  "scout-drone": findUnitAsset("scout-drone"),
  hornet: findUnitAsset("hornet"),
  behemoth: findUnitAsset("behemoth"),
} satisfies Record<UnitKind, DemoAsset>;

/** One factory owns one world's shared model sources and clones them for trained units. */
export const createUnitModelFactory = (): UnitPresentationFactory => {
  const sources = new Map<UnitKind, Promise<Awaited<ReturnType<typeof loadDemoAsset>>>>();
  return async ({ kind }): Promise<LoadedUnitPresentation> => {
    const asset = unitAssets[kind];
    if (!asset.presentation) throw new Error(`Missing unit presentation for ${kind}`);
    let source = sources.get(kind);
    if (!source) {
      source = loadDemoAsset(asset);
      sources.set(kind, source);
    }
    const loaded = await source;
    const root = kind === "ghostrunner"
      ? cloneSkeleton(loaded.instance) as THREE.Group
      : loaded.instance.clone(true);
    root.name = asset.name;
    const visual = root.children[0];
    if (!visual) throw new Error(`Missing visual root for ${kind}`);
    visual.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = loaded.animations.length === 0;
    });
    return {
      root,
      visual,
      animations: loaded.animations,
      options: asset.presentation,
    };
  };
};
