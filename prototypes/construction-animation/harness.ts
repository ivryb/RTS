import * as THREE from "three";
import { createEnvironmentProps } from "../../src/environmentProps";
import { generateMap, sampleHeight } from "../../src/map";
import { demoAssets, loadBuildingModel, loadDemoAsset } from "../../src/modelAssets";
import { BUILDING_DEFINITIONS } from "../../src/sim/construction";
import type { BuildingKind } from "../../src/sim/units";
import { createTerrain } from "../../src/terrain";
import { UI_SELECTION_COLOR } from "../../src/uiColors";
import { findSceneCenter } from "../../tools/preview/demoModels";
import type { ConstructionSite, ConstructionSketch, SiteModel, SiteState } from "./sketch";

/** The game's default framing: `VIEW_HEIGHT / DEFAULT_ZOOM` in `src/camera.ts`. */
const GAMEPLAY_VIEW_HEIGHT = 56 / 1.3;
/** The game's closest zoom: `VIEW_HEIGHT / MAX_ZOOM`. */
const CLOSE_VIEW_HEIGHT = 56 / 3.9;
/** Pixels per metre of the game at default zoom in a 900 px tall window; film shots keep it. */
const GAMEPLAY_PIXELS_PER_METRE = 900 / GAMEPLAY_VIEW_HEIGHT;
const FILM_FPS = 30;

interface Panel {
  label: string;
  state: SiteState;
}

interface Site {
  model: SiteModel;
  handle: ConstructionSite;
  ground: number;
  drone: THREE.Group;
  beam: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

export interface PerfReport {
  option: string;
  sites: string;
  /** Draw calls and triangles of one frame, shadow pass included. */
  emptyScene: { calls: number; triangles: number };
  atRest: { calls: number; triangles: number };
  underConstruction: { calls: number; triangles: number };
  /** Milliseconds of `createSite` per building, in creation order. */
  createSiteMs: number[];
  /** Mean milliseconds per frame spent in every site's `update` plus `flush`, over 600 frames. */
  updateMsPerFrame: number;
  /** Shader programs compiled for the at-rest scene, then added by sites under construction. */
  programsAtRest: number;
  programsAddedByConstruction: number;
  /** Screen pixels at gameplay zoom where a click ray hits the site's geometry. */
  pickablePixels: Record<string, number>;
}

declare global {
  interface Window {
    __sketchReady?: boolean;
    __sketchFrameCount?: number;
    __sketchFrame?: (index: number) => void;
    __sketchPerf?: () => PerfReport;
  }
}

const constructing = (progress: number, working = true, health = 1): SiteState => ({
  progress,
  working,
  health,
  lifecycle: "constructing",
  sinceLifecycleChange: 0,
});
const completed = (seconds: number): SiteState => ({
  progress: 1,
  working: false,
  health: 1,
  lifecycle: "active",
  sinceLifecycleChange: seconds,
});

const progressPanels: Panel[] = [0, 0.15, 0.5, 0.85].map((progress) => ({
  label: `${Math.round(progress * 100)}%`,
  state: constructing(progress),
})).concat({ label: "100% · complete", state: completed(10) });

const statePanels: Panel[] = [
  { label: "Just placed · 0% · drone on its way", state: constructing(0, false) },
  { label: "Drone working · 40%", state: constructing(0.4) },
  { label: "Paused · 40% · no drone", state: constructing(0.4, false) },
  { label: "Damaged · 40% · half health", state: constructing(0.4, true, 0.5) },
  {
    label: "Destroyed at 40% · 0.3 s later",
    state: { ...constructing(0.4, false, 0), lifecycle: "destroyed", sinceLifecycleChange: 0.3 },
  },
];

const completionPanels: Panel[] = [
  { label: "99%", state: constructing(0.99) },
  ...[0, 0.15, 0.4, 1].map((seconds) => ({
    label: `Complete · +${seconds} s`,
    state: completed(seconds),
  })),
];

/** One build from placement to completion, with the drone leaving for 1.5 s on the way. */
const filmState = (seconds: number): SiteState => {
  if (seconds < 1) return constructing(0, false);
  if (seconds < 5) return constructing((seconds - 1) / 4 * 0.4);
  if (seconds < 6.5) return constructing(0.4, false);
  if (seconds < 12.5) return constructing(0.4 + (seconds - 6.5) / 6 * 0.6);
  return completed(seconds - 12.5);
};
const FILM_SECONDS = 14.5;

const params = new URLSearchParams(location.search);
const optionName = params.get("option") ?? "current";
const shot = params.get("shot") ?? "gameplay";
const time = Number(params.get("time")) || 2.4;

const options = import.meta.glob<{ sketch: ConstructionSketch }>("./options/*.ts");
const loadOption = options[`./options/${optionName}.ts`];
if (!loadOption) throw new Error(`Unknown option "${optionName}"`);
const { sketch } = await loadOption();

const map = generateMap(77);
const canvas = document.querySelector<HTMLCanvasElement>("#preview")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.add(createTerrain(map));
const environment = createEnvironmentProps(map.environment);
scene.add(environment.group);
await environment.ready;
scene.add(new THREE.HemisphereLight(0xfff4e4, 0x8b765d, 1.25));
const sun = new THREE.DirectionalLight(0xffedda, 2.65);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 120 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.035;
sun.shadow.intensity = 0.72;
scene.add(sun, sun.target);

const context = { scene, map, renderer };
await sketch.prepare?.(context);

const scoutDrone = demoAssets.find((asset) => asset.unitKind === "scout-drone")!;
const groundAt = (x: number, z: number) => sampleHeight(map, x, z);

const createSite = async (kind: BuildingKind, x: number, z: number, rotation: number): Promise<Site> => {
  const root = await loadBuildingModel(kind);
  const visualRoot = new THREE.Group();
  visualRoot.name = "Building visual";
  for (const child of [...root.children]) visualRoot.add(child);
  root.add(visualRoot);
  const ground = groundAt(x, z);
  root.position.set(x, ground, z);
  root.rotation.y = rotation;
  scene.add(root);
  root.updateWorldMatrix(true, true);

  // The drone hovers toward the camera's right so its beam is never hidden behind the site.
  const reach = BUILDING_DEFINITIONS[kind].radius + 1.4;
  const droneX = x + reach * 0.5;
  const droneZ = z + reach * 0.87;
  const { instance: drone, model: droneModel } = await loadDemoAsset(scoutDrone);
  droneModel.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
  drone.position.set(droneX, groundAt(droneX, droneZ), droneZ);
  drone.rotation.y = Math.atan2(x - droneX, z - droneZ);
  scene.add(drone);

  const beam = new THREE.Line(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(6, 3)),
    new THREE.LineBasicMaterial({
      color: UI_SELECTION_COLOR,
      depthWrite: false,
      opacity: 0.85,
      transparent: true,
    }),
  );
  beam.name = "Construction beam";
  beam.frustumCulled = false;
  beam.renderOrder = 4;
  scene.add(beam);

  const model = { kind, root, visualRoot };
  return { model, handle: sketch.createSite(model, context), ground, drone, beam };
};

const applyState = (site: Site, state: SiteState, seconds: number) => {
  site.handle.update(state, seconds);
  site.beam.visible = state.working && state.lifecycle === "constructing";
  site.drone.visible = site.beam.visible;
  if (!site.beam.visible) return;
  const positions = site.beam.geometry.getAttribute("position");
  const { x, z } = site.model.root.position;
  positions.setXYZ(0, site.drone.position.x, site.drone.position.y + 1.05, site.drone.position.z);
  positions.setXYZ(1, x, site.handle.beamTargetY ?? site.ground + 0.8, z);
  positions.needsUpdate = true;
};

const cameraFor = (target: { x: number; z: number }, viewHeight: number, aspect: number) => {
  const camera = new THREE.OrthographicCamera(
    -viewHeight * aspect / 2,
    viewHeight * aspect / 2,
    viewHeight / 2,
    -viewHeight / 2,
    0.1,
    360,
  );
  const elevation = groundAt(target.x, target.z);
  camera.position.set(target.x + 46, 58 + elevation, target.z + 46);
  camera.lookAt(target.x, elevation, target.z);
  camera.updateMatrixWorld();
  return camera;
};

const aimSun = (target: { x: number; z: number }) => {
  sun.target.position.set(target.x, 0, target.z);
  sun.position.set(target.x - 38, 58, target.z + 24);
  sun.target.updateMatrixWorld();
};

const labels = document.querySelector("#labels")!;
const showLabels = (panels: readonly Panel[]) => {
  labels.replaceChildren();
  panels.forEach((panel, index) => {
    const label = document.createElement("div");
    label.className = "preview-label";
    label.style.left = `${(index + 0.5) / panels.length * 100}%`;
    label.textContent = panel.label;
    labels.append(label);
    if (!index) return;
    const divider = document.createElement("div");
    divider.className = "preview-divider";
    divider.style.left = `${index / panels.length * 100}%`;
    labels.append(divider);
  });
};

const focus = findSceneCenter(map);
// Screen-right on the game's fixed diagonal camera is world (+x, -z).
const commandCenterAt = { x: focus.x - 17, z: focus.z + 3 };
const turretAt = { x: commandCenterAt.x + 8.4, z: commandCenterAt.z - 8.4 };
const sceneName = document.querySelector("#scene-name")!;

const renderStrip = (
  sites: readonly Site[],
  panels: readonly Panel[],
  target: { x: number; z: number },
  viewHeight: number,
) => {
  const panelWidth = innerWidth / panels.length;
  const camera = cameraFor(target, viewHeight, panelWidth / innerHeight);
  aimSun(target);
  renderer.setScissorTest(true);
  panels.forEach((panel, index) => {
    for (const site of sites) applyState(site, panel.state, time);
    sketch.flush?.(time);
    const x = Math.round(index * panelWidth);
    const width = Math.round((index + 1) * panelWidth) - x;
    renderer.setViewport(x, 0, width, innerHeight);
    renderer.setScissor(x, 0, width, innerHeight);
    renderer.render(scene, camera);
  });
  showLabels(panels);
};

const stripShots: Record<string, { panels: Panel[]; focus: "both" | "turret" | "command-center"; viewHeight: number }> = {
  gameplay: { panels: progressPanels, focus: "both", viewHeight: GAMEPLAY_VIEW_HEIGHT },
  "turret-close": { panels: progressPanels, focus: "turret", viewHeight: CLOSE_VIEW_HEIGHT },
  "command-center-close": { panels: progressPanels, focus: "command-center", viewHeight: CLOSE_VIEW_HEIGHT },
  states: { panels: statePanels, focus: "both", viewHeight: GAMEPLAY_VIEW_HEIGHT },
  "states-turret": { panels: statePanels, focus: "turret", viewHeight: CLOSE_VIEW_HEIGHT },
  completion: { panels: completionPanels, focus: "both", viewHeight: GAMEPLAY_VIEW_HEIGHT },
  "completion-turret": { panels: completionPanels, focus: "turret", viewHeight: CLOSE_VIEW_HEIGHT },
};

const focusPoint = (which: "both" | "turret" | "command-center") => which === "turret"
  ? { x: turretAt.x + 0.5, z: turretAt.z + 0.9 }
  : which === "command-center"
    ? { x: commandCenterAt.x + 0.3, z: commandCenterAt.z + 1.1 }
    : { x: (commandCenterAt.x + turretAt.x) / 2 + 1.2, z: (commandCenterAt.z + turretAt.z) / 2 + 1.2 };

const measureFrame = (camera: THREE.Camera) => {
  renderer.info.reset();
  renderer.render(scene, camera);
  return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
};

/** Counts screen pixels, on a 6 px grid at gameplay zoom, where a click ray hits the site. */
const pickablePixels = (site: Site) => {
  const camera = cameraFor(site.model.root.position, GAMEPLAY_VIEW_HEIGHT, 1);
  const raycaster = new THREE.Raycaster();
  const reach = BUILDING_DEFINITIONS[site.model.kind].radius * 2.2 * GAMEPLAY_PIXELS_PER_METRE;
  const step = 6;
  let hits = 0;
  for (let x = -reach; x <= reach; x += step) {
    for (let y = -reach; y <= reach; y += step) {
      raycaster.setFromCamera(new THREE.Vector2(x / 450, y / 450), camera);
      if (raycaster.intersectObject(site.model.root, true).length) hits += 1;
    }
  }
  return hits * step * step;
};

if (shot in stripShots) {
  const { panels, focus: which, viewHeight } = stripShots[shot]!;
  const sites = [
    await createSite("command-center", commandCenterAt.x, commandCenterAt.z, Math.PI / 4),
    await createSite("turret", turretAt.x, turretAt.z, 0),
  ];
  sceneName.textContent = `${sketch.title} · ${shot} · ${viewHeight.toFixed(1)} m view`;
  renderStrip(sites, panels, focusPoint(which), viewHeight);
} else if (shot.startsWith("film")) {
  const which = shot === "film-turret" ? "turret" : shot === "film-command-center" ? "command-center" : "both";
  const viewHeight = which === "both"
    ? innerHeight / GAMEPLAY_PIXELS_PER_METRE
    : CLOSE_VIEW_HEIGHT * innerHeight / 900;
  const sites = [
    await createSite("command-center", commandCenterAt.x, commandCenterAt.z, Math.PI / 4),
    await createSite("turret", turretAt.x, turretAt.z, 0),
  ];
  const target = focusPoint(which);
  const camera = cameraFor(target, viewHeight, innerWidth / innerHeight);
  aimSun(target);
  sceneName.textContent = sketch.title;
  window.__sketchFrameCount = Math.round(FILM_SECONDS * FILM_FPS);
  window.__sketchFrame = (index) => {
    const seconds = index / FILM_FPS;
    const state = filmState(seconds);
    for (const site of sites) applyState(site, state, seconds);
    sketch.flush?.(seconds);
    renderer.render(scene, camera);
    labels.replaceChildren();
    const label = document.createElement("div");
    label.className = "preview-label";
    label.style.left = "50%";
    label.textContent = state.lifecycle === "active"
      ? "Complete"
      : `${Math.round(state.progress * 100)}% · ${state.working ? "drone working" : state.progress ? "paused, no drone" : "just placed"}`;
    labels.append(label);
  };
  window.__sketchFrame(0);
} else if (shot === "perf") {
  const target = { x: focus.x - 4, z: focus.z + 4 };
  const camera = cameraFor(target, 110, innerWidth / innerHeight);
  aimSun(target);
  renderer.render(scene, camera);
  const emptyScene = measureFrame(camera);
  const sites: Site[] = [];
  const createSiteMs: number[] = [];
  // Five Command Centers and five Turrets: ten sites under construction at once.
  for (let index = 0; index < 10; index += 1) {
    const kind: BuildingKind = index < 5 ? "command-center" : "turret";
    const column = index % 5;
    const x = target.x - 32 + column * 16;
    const z = target.z + (index < 5 ? -9 : 9);
    const site = await createSite(kind, x, z, index < 5 ? Math.PI / 4 : 0);
    const started = performance.now();
    site.handle.dispose();
    site.handle = sketch.createSite(site.model, context);
    createSiteMs.push(Number((performance.now() - started).toFixed(2)));
    sites.push(site);
  }
  const frame = (state: (index: number) => SiteState, seconds: number) => {
    sites.forEach((site, index) => applyState(site, state(index), seconds));
    sketch.flush?.(seconds);
  };
  frame(() => completed(30), 0);
  renderer.render(scene, camera);
  const programsAtRest = renderer.info.programs?.length ?? 0;
  const atRest = measureFrame(camera);
  const building = (index: number) => constructing(0.08 + index * 0.095, index % 3 !== 2);
  frame(building, 1);
  renderer.render(scene, camera);
  const underConstruction = measureFrame(camera);
  const programsAddedByConstruction = (renderer.info.programs?.length ?? 0) - programsAtRest;
  sceneName.textContent = `${sketch.title} · 10 sites under construction`;

  window.__sketchPerf = () => {
    const frames = 600;
    for (let index = 0; index < 60; index += 1) frame(building, index / 60);
    const started = performance.now();
    for (let index = 0; index < frames; index += 1) {
      const seconds = 1 + index / 60;
      frame((site) => constructing((0.05 + site * 0.09 + index / frames * 0.4) % 1, site % 3 !== 2), seconds);
    }
    const updateMsPerFrame = Number(((performance.now() - started) / frames).toFixed(4));
    const picks: Record<string, number> = {};
    for (const site of [sites[0]!, sites[5]!]) {
      for (const progress of [0, 0.15, 0.5, 1]) {
        applyState(site, progress === 1 ? completed(30) : constructing(progress), 1);
        sketch.flush?.(1);
        site.model.root.updateWorldMatrix(true, true);
        picks[`${site.model.kind} ${Math.round(progress * 100)}%`] = pickablePixels(site);
      }
    }
    frame(building, 1);
    renderer.render(scene, camera);
    return {
      option: optionName,
      sites: "5 Command Centers + 5 Turrets",
      emptyScene,
      atRest,
      underConstruction,
      createSiteMs,
      updateMsPerFrame,
      programsAtRest,
      programsAddedByConstruction,
      pickablePixels: picks,
    };
  };
} else {
  throw new Error(`Unknown shot "${shot}"`);
}

requestAnimationFrame(() => {
  window.__sketchReady = true;
});
