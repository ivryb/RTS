import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * The models a death leaves behind, each one mesh with one baked material, from the Blender
 * generators `tools/assets/build_death_wreck_units.py` and `build_death_wreck_ruins.py`.
 * Vite needs each URL written out to include the file in a build.
 */
const urls = {
  "scout-drone-wreck": new URL("../../assets/models/wrecks/scout-drone-wreck.glb", import.meta.url),
  "hornet-wreck": new URL("../../assets/models/wrecks/hornet-wreck.glb", import.meta.url),
  "behemoth-wreck": new URL("../../assets/models/wrecks/behemoth-wreck.glb", import.meta.url),
  "ghostrunner-wreck": new URL("../../assets/models/wrecks/ghostrunner-wreck.glb", import.meta.url),
  "command-center-ruin": new URL("../../assets/models/wrecks/command-center-ruin.glb", import.meta.url),
  "turret-ruin": new URL("../../assets/models/wrecks/turret-ruin.glb", import.meta.url),
  "site-rubble": new URL("../../assets/models/wrecks/site-rubble.glb", import.meta.url),
  "site-rubble-small": new URL("../../assets/models/wrecks/site-rubble-small.glb", import.meta.url),
  "scrap-plate": new URL("../../assets/models/wrecks/scrap-plate.glb", import.meta.url),
  "scrap-beam": new URL("../../assets/models/wrecks/scrap-beam.glb", import.meta.url),
};

export type WreckModelName = keyof typeof urls;
export const WRECK_MODEL_NAMES = Object.keys(urls) as WreckModelName[];

export interface WreckModel {
  /** In the model's own frame, with the ground at y = 0 and its bounding box computed. */
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export type WreckKit = Record<WreckModelName, WreckModel>;
export type WreckKitLoader = () => Promise<WreckKit>;

const loadModel = async (loader: GLTFLoader, url: URL): Promise<WreckModel> => {
  const { scene } = await loader.loadAsync(url.href);
  scene.updateMatrixWorld(true);
  const mesh = scene.getObjectByProperty("isMesh", true) as THREE.Mesh<THREE.BufferGeometry, THREE.Material> | undefined;
  if (!mesh) throw new Error(`No mesh in ${url.pathname}`);
  const geometry = mesh.geometry.applyMatrix4(mesh.matrixWorld);
  geometry.computeBoundingBox();
  return { geometry, material: mesh.material };
};

export const loadWreckKit: WreckKitLoader = async () => {
  const loader = new GLTFLoader();
  const models = await Promise.all(WRECK_MODEL_NAMES.map((name) => loadModel(loader, urls[name])));
  return Object.fromEntries(WRECK_MODEL_NAMES.map((name, index) => [name, models[index]!])) as WreckKit;
};

/** Frees every geometry, material and texture of a kit. */
export const disposeWreckKit = (kit: WreckKit) => {
  for (const { geometry, material } of Object.values(kit)) {
    geometry.dispose();
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    material.dispose();
  }
};
