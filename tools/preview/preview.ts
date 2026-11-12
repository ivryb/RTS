import { AttackAreaMarker } from "../../src/attackAreaMarker";
import { placeGroundGeometry } from "../../src/groundOverlay";
import * as THREE from "three";
import { createHealthBar, updateHealthBar, createRangeIndicator, createSelectionRing } from "../../src/unitSystem";
import { OrderMarker } from "../../src/orderMarker";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import type { UnitKind } from "../../src/sim/unitDefinitions";
import { BehemothBarrage, BEHEMOTH_LAUNCH_OFFSETS } from "../../src/behemothBarrage";
import { findSceneCenter } from "./demoModels";
import { generateMap, sampleHeight } from "../../src/map";
import { demoAssets, loadDemoAsset } from "../../src/modelAssets";
import { createTerrain } from "../../src/terrain";
import { createEnvironmentProps } from "../../src/environmentProps";
import "./preview.css";

type PreviewScene = "terrain" | "buildings" | "units";

declare global {
  interface Window {
    __previewReady?: boolean;
    __previewStepEffect?: (seconds: number) => void;
  }
}

const params = new URLSearchParams(location.search);
const requestedScene = params.get("scene");
const requestedEffect = params.get("effect");
const previewScene: PreviewScene = requestedScene === "buildings" || requestedScene === "units"
  ? requestedScene
  : "terrain";
const map = generateMap(Number(params.get("seed")) || 77);
const canvas = document.querySelector<HTMLCanvasElement>("#preview")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.add(createTerrain(map));
const environment = createEnvironmentProps(map.environment);
scene.add(environment.group);
await environment.ready;
scene.add(new THREE.HemisphereLight(0xfff4e4, 0x8b765d, 1.25));
const sun = new THREE.DirectionalLight(0xffedda, 2.65);
sun.position.set(-38, 58, 24);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 120 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.035;
sun.shadow.intensity = 0.72;
scene.add(sun, sun.target);

const prepareModel = (model: THREE.Object3D) => model.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  object.castShadow = true;
  object.receiveShadow = true;
});

const addBuildings = async (focus: { x: number; z: number }) => {
  const buildings = demoAssets.filter((asset) => asset.building);
  await Promise.all(buildings.map(async (asset) => {
    const { instance, model } = await loadDemoAsset(asset);
    const x = focus.x + asset.offset.x;
    const z = focus.z + asset.offset.z;
    instance.name = asset.name;
    instance.rotation.y = asset.rotation;
    instance.position.set(x, sampleHeight(map, x, z), z);
    prepareModel(model);
    scene.add(instance);
  }));
};

const addUnits = async (focus: { x: number; z: number }) => {
  const assets = demoAssets.filter((asset) => asset.unitKind);
  await Promise.all(assets.map(async (asset) => {
    if (!asset.unitKind) return;
    const { animations, instance, model } = await loadDemoAsset(asset);
    prepareModel(model);
    const idle = animations.find((clip) => /idle/i.test(clip.name)) ?? animations[0];
    const layout = {
      behemoth: { count: 1, x: -6, z: 0 },
      "scout-drone": { count: 2, x: -2.4, z: 0 },
      hornet: { count: 2, x: 6.4, z: 2 },
      ghostrunner: { count: 3, x: 2.2, z: 0 },
    } satisfies Record<UnitKind, { count: number; x: number; z: number }>;
    const { count } = layout[asset.unitKind];
    const centerX = focus.x + layout[asset.unitKind].x;
    for (let index = 0; index < count; index += 1) {
      const unit = index === 0 ? instance : cloneSkeleton(instance) as THREE.Group;
      unit.name = `${asset.name} preview ${index + 1}`;
      const x = centerX + (index - (count - 1) / 2) * 1.8;
      const z = focus.z + layout[asset.unitKind].z
        + Math.abs(index - (count - 1) / 2) * 0.7;
      unit.position.set(x, sampleHeight(map, x, z), z);
      unit.rotation.y = Math.PI / 4;
      if (idle) {
        const mixer = new THREE.AnimationMixer(unit);
        mixer.clipAction(idle).play();
        mixer.update(0.35 + index * 0.11);
      }
      scene.add(unit);
    }
  }));
};

const focus = findSceneCenter(map);
const terrainFocus = (() => {
  const row = map.segments + 1;
  let highest = 0;
  let highestHeight = -Infinity;
  for (let index = 0; index < map.heights.length; index += 1) {
    const x = (index % row / map.segments - 0.5) * map.size;
    const z = (Math.floor(index / row) / map.segments - 0.5) * map.size;
    if (Math.abs(x) > map.size * 0.22 || Math.abs(z) > map.size * 0.22) continue;
    if (map.heights[index]! <= highestHeight) continue;
    highest = index;
    highestHeight = map.heights[index]!;
  }
  return {
    x: (highest % row / map.segments - 0.5) * map.size,
    z: (Math.floor(highest / row) / map.segments - 0.5) * map.size,
  };
})();
if (previewScene === "terrain" || previewScene === "buildings") await addBuildings(focus);
if (previewScene === "units") await addUnits(focus);

let effectFocus: { x: number; z: number } | undefined;
let effectOrigin: { x: number; z: number } | undefined;
let effectMidpoint: { x: number; z: number } | undefined;
let previewBarrage: BehemothBarrage | undefined;
let previewEffectTime = 0;
if (previewScene === "units" && requestedEffect === "behemoth-barrage") {
  const behemoth = scene.getObjectByName("Behemoth preview 1");
  if (!behemoth) throw new Error("Missing Behemoth preview model");
  behemoth.updateWorldMatrix(true, true);
  const launchPoints = BEHEMOTH_LAUNCH_OFFSETS.map(([x, y, z]) =>
    behemoth.localToWorld(new THREE.Vector3(x, y, z))
  );
  const forward = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(behemoth.getWorldQuaternion(new THREE.Quaternion()));
  const target = behemoth.position.clone().addScaledVector(forward, 12);
  previewBarrage = new BehemothBarrage(scene, map);
  previewBarrage.fire(launchPoints, target.x, target.z, 77, 12);
  const effectTime = Math.min(1.5, Math.max(0, Number(params.get("effectTime")) || 0.08));
  for (let elapsed = 0; elapsed < effectTime; elapsed += 1 / 60) previewBarrage.update(1 / 60);
  previewEffectTime = effectTime;
  effectOrigin = { x: behemoth.position.x, z: behemoth.position.z };
  effectMidpoint = {
    x: (behemoth.position.x + target.x) / 2,
    z: (behemoth.position.z + target.z) / 2,
  };
  effectFocus = effectTime < 0.3 ? effectOrigin : effectMidpoint;
}

const orderMarkers: OrderMarker[] = [];
if (previewScene === "units" && requestedEffect === "orders") {
  for (const [index, kind] of (["destination", "attack"] as const).entries()) {
    const marker = new OrderMarker(kind, (x, z) => sampleHeight(map, x, z));
    const x = focus.x + index * 3;
    const z = focus.z + 4;
    marker.show(x, sampleHeight(map, x, z), z);
    marker.animate(.2);
    scene.add(marker);
    orderMarkers.push(marker);
  }
  previewEffectTime = .2;
}

if (previewScene === "units" && (requestedEffect === "orders-hill" || requestedEffect === "orders-mountain")) {
  let slope = 0;
  let hillside = { ...focus };
  for (let x = -80; x <= 80; x += 2) {
    for (let z = -80; z <= 80; z += 2) {
      const difference = sampleHeight(map, x - 1, z - 1) - sampleHeight(map, x + 1, z + 1);
      if (difference > slope && (requestedEffect === "orders-mountain" || (difference < 1 && sampleHeight(map, x, z) < 4))) {
        slope = difference;
        hillside = { x, z };
      }
    }
  }
  if (requestedEffect === "orders-mountain") {
    const scout = scene.getObjectByName("Scout Drone preview 1")!;
    scout.position.set(hillside.x, sampleHeight(map, hillside.x, hillside.z), hillside.z);
    const ring = createSelectionRing({ radius: 1, offset: { x: 0, z: 0 } });
    placeGroundGeometry(ring.geometry, 0);
    ring.visible = true;
    scout.add(ring);
  }
  const marker = new OrderMarker("destination", (x, z) => sampleHeight(map, x, z));
  marker.show(hillside.x, sampleHeight(map, hillside.x, hillside.z), hillside.z);
  marker.animate(.3);
  scene.add(marker);
  orderMarkers.push(marker);
  effectFocus = hillside;
  previewEffectTime = .3;
}
if (previewScene === "units" && requestedEffect === "attack-target") {
  const target = scene.getObjectByName("Ghostrunner preview 2")!;
  const marker = new OrderMarker("attack", (x, z) => sampleHeight(map, x, z));
  marker.show(target.position.x, target.position.y, target.position.z, .9);
  marker.animate(.2);
  scene.add(marker);
  orderMarkers.push(marker);
  effectFocus = { x: target.position.x, z: target.position.z };
  previewEffectTime = .2;
}

if (previewScene === "units" && requestedEffect === "health-bars") {
  for (const [index, name] of ["Behemoth preview 1", "Ghostrunner preview 2", "Hornet preview 1"].entries()) {
    const target = scene.getObjectByName(name)!;
    const health = createHealthBar(index === 0 ? 3.5 : 2.8, 1.8);
    updateHealthBar(health, [65, 25, 90][index]!, 100, true);
    target.add(health.root);
    target.rotation.y += index * .8;
  }
}
if (previewScene === "units" && requestedEffect === "ground-target") {
  const target = new AttackAreaMarker();
  const x = focus.x + 2;
  const z = focus.z + 5;
  target.position.set(x, 0, z);
  for (const child of target.children) {
    if (child instanceof THREE.Mesh) placeGroundGeometry(child.geometry, sampleHeight(map, x, z));
  }
  target.visible = true;
  scene.add(target);
  effectFocus = { x, z };
}

if (previewScene === "units" && requestedEffect === "range-terrain") {
  const target = createRangeIndicator(7, 22);
  const x = terrainFocus.x + 15;
  const z = terrainFocus.z + 8;
  target.position.set(x, 0, z);
  for (const child of target.children) {
    if (child instanceof THREE.Mesh) placeGroundGeometry(child.geometry, sampleHeight(map, x, z));
  }
  target.visible = true;
  scene.add(target);
  effectFocus = { x, z };
}

const viewHeights = previewScene === "terrain"
  ? [300, 80, 24]
  : previewScene === "buildings"
    ? [76, 40, 32]
    : requestedEffect === "range-terrain" ? [70, 42, 20] : requestedEffect === "behemoth-barrage" ? [28, 14, 7] : [34, 17, 10];
const cameraFocus = previewScene === "buildings"
  ? { x: focus.x - 13.5, z: focus.z - 5 }
  : previewScene === "units"
    ? effectFocus ?? { x: focus.x, z: focus.z + 0.8 }
    : terrainFocus;
sun.target.position.set(cameraFocus.x, 0, cameraFocus.z);
sun.position.set(cameraFocus.x - 38, 58, cameraFocus.z + 24);
sun.target.updateMatrixWorld();
const panelWidth = innerWidth / 3;
const cameras = viewHeights.map((viewHeight, index) => {
  const target = previewScene === "buildings" && index === 2
    ? { x: focus.x - 17, z: focus.z + 3 }
    : previewScene === "terrain" && index === 0
      ? { x: 0, z: 0 }
    : cameraFocus;
  const camera = new THREE.OrthographicCamera(
    -viewHeight * panelWidth / innerHeight / 2,
    viewHeight * panelWidth / innerHeight / 2,
    viewHeight / 2,
    -viewHeight / 2,
    0.1,
    360,
  );
  const elevation = requestedEffect === "orders-hill" || requestedEffect === "attack-target"
    ? sampleHeight(map, target.x, target.z) + 1 : 0;
  camera.position.set(target.x + 46, 58 + elevation, target.z + 46);
  camera.lookAt(target.x, elevation, target.z);
  return camera;
});

const render = () => {
  renderer.setScissorTest(true);
  cameras.forEach((panelCamera, panelIndex) => {
    const x = Math.round(panelIndex * panelWidth);
    const width = Math.round((panelIndex + 1) * panelWidth) - x;
    renderer.setViewport(x, 0, width, innerHeight);
    renderer.setScissor(x, 0, width, innerHeight);
    renderer.render(scene, panelCamera);
  });
};

window.__previewStepEffect = (seconds: number) => {
  if (orderMarkers.length && seconds > previewEffectTime) {
    for (const marker of orderMarkers) marker.animate(seconds - previewEffectTime);
    previewEffectTime = seconds;
    render();
    return;
  }
  if (!previewBarrage || !effectOrigin || !effectMidpoint || seconds <= previewEffectTime) return;
  for (let elapsed = previewEffectTime; elapsed < seconds; elapsed += 1 / 60) {
    previewBarrage.update(1 / 60);
  }
  previewEffectTime = seconds;
  const target = seconds < 0.3 ? effectOrigin : effectMidpoint;
  sun.target.position.set(target.x, 0, target.z);
  sun.position.set(target.x - 38, 58, target.z + 24);
  sun.target.updateMatrixWorld();
  cameras.forEach((camera) => {
    camera.position.set(target.x + 46, 58, target.z + 46);
    camera.lookAt(target.x, 0, target.z);
  });
  renderer.shadowMap.needsUpdate = true;
  render();
};

const labels = document.querySelector("#labels")!;
viewHeights.forEach((height, index) => {
  const label = document.createElement("div");
  label.className = "preview-label";
  label.style.left = `${(index + 0.5) / 3 * 100}%`;
  label.textContent = `${["Overview", "Gameplay", "Close"][index]} · ${height} m`;
  labels.append(label);
  if (index) {
    const divider = document.createElement("div");
    divider.className = "preview-divider";
    divider.style.left = `${index / 3 * 100}%`;
    labels.append(divider);
  }
});
document.querySelector("#scene-name")!.textContent = `${previewScene} · seed ${map.seed}`;

renderer.compile(scene, cameras[0]);
renderer.shadowMap.needsUpdate = true;
render();
requestAnimationFrame(() => {
  render();
  window.__previewReady = true;
});
