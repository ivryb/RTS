import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { generateMap, sampleHeight } from "../../src/map";
import { demoAssets, loadDemoAsset } from "../../src/modelAssets";
import type { BuildingKind } from "../../src/sim/units";
import { createTerrain } from "../../src/terrain";
import { findSceneCenter } from "../../tools/preview/demoModels";

declare global {
  interface Window {
    __previewReady?: boolean;
    __buildingShowcase?: { models: THREE.Group[]; render: () => void };
  }
}

// Production buildings appear automatically. References are optional history.
const archives = new Map<BuildingKind, URL>([
  ["command-center", new URL("../../assets/source/meshy/archive/command-center.glb", import.meta.url)],
  ["turret", new URL("../../assets/source/meshy/archive/turret.glb", import.meta.url)],
]);
const buildings = demoAssets.flatMap((asset) => asset.building
  ? [{ asset, kind: asset.building.kind, archive: archives.get(asset.building.kind) }]
  : []);
const ui = {
  building: document.querySelector<HTMLSelectElement>("#building")!,
  references: document.querySelector<HTMLButtonElement>("#references")!,
  rear: document.querySelector<HTMLButtonElement>("#rear")!,
  low: document.querySelector<HTMLButtonElement>("#low")!,
  surface: document.querySelector<HTMLSelectElement>("#surface")!,
  frame: document.querySelector<HTMLButtonElement>("#frame")!,
  turret: document.querySelector<HTMLLabelElement>("#turret-controls")!,
  yaw: document.querySelector<HTMLInputElement>("#yaw")!,
  status: document.querySelector<HTMLParagraphElement>("#status")!,
};
for (const { kind, asset } of buildings) ui.building.add(new Option(asset.name, kind));
const params = new URLSearchParams(location.search);
const requested = params.get("building");
ui.building.value = buildings.some(({ kind }) => kind === requested) ? requested ?? "all" : "all";
for (const key of ["references", "rear", "low"] as const) {
  ui[key].setAttribute("aria-pressed", String(params.get(key) === "1"));
}
if (["form", "wire"].includes(params.get("surface") ?? "")) ui.surface.value = params.get("surface")!;
const yaw = Number(params.get("yaw") ?? 90);
ui.yaw.value = String(Number.isFinite(yaw) ? THREE.MathUtils.clamp(yaw, 0, 360) : 90);
const pressed = (button: HTMLButtonElement) => button.getAttribute("aria-pressed") === "true";

const map = generateMap(77);
const center = findSceneCenter(map);
const focus = new THREE.Vector3(center.x + buildings[0].asset.offset.x, 0, center.z + buildings[0].asset.offset.z);
focus.y = sampleHeight(map, focus.x, focus.z);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
// Keep initial and later renders on the same shadow sampler type.
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.domElement.setAttribute("aria-label", "Procedural building showcase");
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#282820");
scene.add(createTerrain(map));
scene.add(new THREE.HemisphereLight(0xfff4e4, 0x8b765d, 1.25));
const sun = new THREE.DirectionalLight(0xffedda, 2.65);
sun.position.copy(focus).add(new THREE.Vector3(-38, 58, 24));
sun.target.position.copy(focus);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 140 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -.00015;
sun.shadow.normalBias = .035;
sun.shadow.intensity = .72;
scene.add(sun, sun.target);
const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.maxPolarAngle = Math.PI * .49;
controls.minZoom = .2;
controls.maxZoom = 8;
const front = new THREE.Vector3(13, 0, 16).normalize();
const row = new THREE.Vector3(16, 0, -13).normalize();
const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
const formMaterial = new THREE.MeshStandardMaterial({ color: 0xb7b0a2, roughness: .8 });
const wireMaterial = new THREE.MeshBasicMaterial({ color: 0xe4d4af, wireframe: true });

const models = await Promise.all(buildings.flatMap((building) => [
  { ...building, url: building.asset.url, reference: false },
  ...(building.archive ? [{ ...building, url: building.archive, reference: true }] : []),
]).map(async (building) => {
  const { instance } = await loadDemoAsset({ ...building.asset, url: building.url });
  instance.name = `${building.kind}${building.reference ? "-reference" : ""}`;
  instance.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    part.castShadow = true;
    part.receiveShadow = true;
    originalMaterials.set(part, part.material);
  });
  const head = instance.getObjectByName("TurretHead");
  if (head) head.rotation.y = Number(ui.yaw.value) * Math.PI / 180;
  scene.add(instance);
  const label = document.createElement("div");
  label.className = "model-label";
  label.textContent = building.asset.name;
  const source = document.createElement("span");
  source.textContent = building.reference ? "Meshy archive" : "Production";
  label.append(source);
  document.body.append(label);
  return { ...building, instance, label, head };
})).catch((error: unknown) => {
  ui.status.textContent = `Could not load buildings: ${error instanceof Error ? error.message : String(error)}`;
  throw error;
});

let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderer.render(scene, camera);
    for (const { instance, label } of models) {
      const bounds = new THREE.Box3().setFromObject(instance);
      const anchor = bounds.getCenter(new THREE.Vector3());
      anchor.y = bounds.max.y + .45;
      anchor.project(camera);
      label.hidden = !instance.visible || anchor.z < -1 || anchor.z > 1;
      label.style.left = `${(anchor.x * .5 + .5) * innerWidth}px`;
      label.style.top = `${(-anchor.y * .5 + .5) * innerHeight}px`;
    }
  });
}

function frameBuildings() {
  const bounds = new THREE.Box3();
  for (const { instance } of models) if (instance.visible) bounds.expandByObject(instance);
  controls.target.copy(bounds.getCenter(new THREE.Vector3()));
  camera.position.copy(controls.target).addScaledVector(front, 60);
  camera.position.y += pressed(ui.low) ? 10 : 45;
  camera.lookAt(controls.target);
  camera.updateMatrixWorld(true);
  const viewBounds = new THREE.Box3();
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
    for (const z of [bounds.min.z, bounds.max.z]) viewBounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
  }
  const size = viewBounds.getSize(new THREE.Vector3());
  const aspect = innerWidth / innerHeight;
  const halfHeight = Math.max(size.y, size.x / aspect) * .72 + .6;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  controls.update();
  requestRender();
}

function arrangeBuildings() {
  for (const model of models) {
    model.instance.visible = (ui.building.value === "all" || ui.building.value === model.kind)
      && (!model.reference || pressed(ui.references));
    model.instance.rotation.y = model.asset.rotation + (pressed(ui.rear) ? Math.PI : 0);
  }
  const visible = models.filter(({ instance }) => instance.visible);
  const widths = visible.map(({ instance }) => {
    const size = new THREE.Box3().setFromObject(instance).getSize(new THREE.Vector3());
    return Math.abs(row.x) * size.x + Math.abs(row.z) * size.z;
  });
  let offset = -(widths.reduce((sum, width) => sum + width, 0) + (visible.length - 1) * 2) / 2;
  visible.forEach(({ instance }, index) => {
    instance.position.copy(focus).addScaledVector(row, offset + widths[index] / 2);
    instance.position.y = sampleHeight(map, instance.position.x, instance.position.z);
    offset += widths[index] + 2;
  });
  ui.turret.hidden = !visible.some(({ head }) => head);
  renderer.shadowMap.needsUpdate = true;
  frameBuildings();
}

function setSurface() {
  for (const [mesh, material] of originalMaterials) {
    mesh.material = ui.surface.value === "form" ? formMaterial : ui.surface.value === "wire" ? wireMaterial : material;
  }
  requestRender();
}

function saveView() {
  const url = new URL(location.href);
  url.search = "";
  if (ui.building.value !== "all") url.searchParams.set("building", ui.building.value);
  for (const key of ["references", "rear", "low"] as const) if (pressed(ui[key])) url.searchParams.set(key, "1");
  if (ui.surface.value !== "materials") url.searchParams.set("surface", ui.surface.value);
  if (ui.yaw.value !== "90") url.searchParams.set("yaw", ui.yaw.value);
  history.replaceState(null, "", url);
}

ui.building.addEventListener("change", () => { arrangeBuildings(); saveView(); });
for (const button of [ui.references, ui.rear, ui.low]) button.addEventListener("click", () => {
  button.setAttribute("aria-pressed", String(!pressed(button)));
  arrangeBuildings();
  saveView();
});
ui.surface.addEventListener("change", () => { setSurface(); saveView(); });
ui.frame.addEventListener("click", frameBuildings);
ui.yaw.addEventListener("input", () => {
  for (const { head } of models) if (head) head.rotation.y = Number(ui.yaw.value) * Math.PI / 180;
  renderer.shadowMap.needsUpdate = true;
  requestRender();
  saveView();
});
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.left = -camera.top * innerWidth / innerHeight;
  camera.right = -camera.left;
  camera.updateProjectionMatrix();
  requestRender();
});
// Static inspection tabs redraw only when their view or controls change.
controls.addEventListener("change", requestRender);
THREE.DefaultLoadingManager.onLoad = requestRender;
arrangeBuildings();
setSurface();
ui.status.textContent = "Game terrain · seed 77 · production scale";
window.__buildingShowcase = { models: models.map(({ instance }) => instance), render: requestRender };
window.__previewReady = true;
