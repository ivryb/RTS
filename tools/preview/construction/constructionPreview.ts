import * as THREE from "three";
import { BuilderWork } from "../../../src/construction/builderWork";
import { ConstructionSites, type ConstructionSite, type SiteState } from "../../../src/constructionSites";
import { createEnvironmentProps } from "../../../src/environmentProps";
import { generateMap, sampleHeight } from "../../../src/map";
import { LocalMatchSession } from "../../../src/matchSession";
import { createModelLibrary, demoAssets, loadDemoAsset } from "../../../src/modelAssets";
import { scanLook } from "../../../src/construction/scanLook";
import { ScoutArms } from "../../../src/construction/scoutArms";
import { drill } from "../../../src/construction/work/drill";
import { hammer } from "../../../src/construction/work/hammer";
import { scanWith } from "../../../src/construction/work/scan";
import type { WorkStyle } from "../../../src/construction/work/style";
import { weld } from "../../../src/construction/work/weld";
import { attachLaserNozzle, ScoutLasers } from "../../../src/scoutLaser";
import { BUILDING_DEFINITIONS } from "../../../src/sim/construction";
import { initializeNavigation } from "../../../src/sim/navigation";
import { createTrainedUnitState } from "../../../src/sim/production";
import { UNIT_DEFINITIONS } from "../../../src/sim/unitDefinitions";
import { LocalUnitSimulation, toSimPoint, type BuildingKind } from "../../../src/sim/units";
import { createTerrain } from "../../../src/terrain";
import { LIFT_SHORTFALL, UnitSystem } from "../../../src/unitSystem";
import { findSceneCenter } from "../demoModels";

/** The game's default framing: `VIEW_HEIGHT / DEFAULT_ZOOM` in `src/camera.ts`. */
const GAMEPLAY_VIEW_HEIGHT = 56 / 1.3;
/** The game's closest zoom: `VIEW_HEIGHT / MAX_ZOOM`. */
const CLOSE_VIEW_HEIGHT = 56 / 3.9;
/** Pixels per metre of the game at default zoom in a 900 px tall window; film shots keep it. */
const GAMEPLAY_PIXELS_PER_METRE = 900 / GAMEPLAY_VIEW_HEIGHT;
const FILM_FPS = 30;
/** A destroyed site's stump waits this long, then takes this long to sink: `demolish` in `src/deathEffects.ts`. */
const STUMP_SINK = { after: 0.2, seconds: 1 };
/** Seconds a still gives a site in its state before the picture, so its weld is fully lit or fully cold. */
const SETTLE_SECONDS = 10;
/** Long enough for a drone's work to finish coming on or going out: a still shows it settled. */
const LASER_SETTLE_SECONDS = 1;

interface Panel {
  label: string;
  state: SiteState;
}

interface Site {
  kind: BuildingKind;
  root: THREE.Group;
  visualRoot: THREE.Group;
  handle: ConstructionSite;
  ground: number;
  /** Metres from the ground to the top of the finished model. */
  height: number;
  drones: { model: THREE.Group; body: THREE.Group; ground: number; work: BuilderWork }[];
}

export interface PerfReport {
  sites: string;
  /** Draw calls and triangles of one frame, shadow pass included. */
  emptyScene: { calls: number; triangles: number };
  atRest: { calls: number; triangles: number };
  underConstruction: { calls: number; triangles: number };
  /** The same ten sites where the browser lacks `WEBGL_multi_draw`, as Firefox does. */
  underConstructionWithoutMultiDraw: { calls: number; triangles: number };
  /** Milliseconds to measure each building kind's hull, once per kind. */
  measureMs: Record<string, number>;
  /** Milliseconds of `createSite` per building, in creation order. */
  createSiteMs: number[];
  /** Mean milliseconds per frame spent in every site's `update` plus `flush`, over 600 frames. */
  updateMsPerFrame: number;
  /**
   * What working drones' arms, arcs and sparks add to a frame, by the number of drones: draw
   * calls, triangles, and the mean milliseconds spent placing them, over 600 frames. The draw
   * calls must not grow with the drones.
   */
  builders: Record<string, { calls: number; triangles: number; updateMsPerFrame: number }>;
  /** Shader programs compiled for the at-rest scene, then added by sites under construction. */
  programsAtRest: number;
  programsAddedByConstruction: number;
  /** Screen pixels at gameplay zoom where a click ray hits the site's geometry. */
  pickablePixels: Record<string, number>;
}

declare global {
  interface Window {
    __constructionReady?: boolean;
    __constructionFrameCount?: number;
    __constructionFrame?: (index: number) => void;
    __constructionPerf?: () => PerfReport;
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
const destroyed = (seconds: number): SiteState => ({
  ...constructing(0.4, false, 0),
  lifecycle: "destroyed",
  sinceLifecycleChange: seconds,
});
const percent = (value: number) => `${Number((value * 100).toFixed(1))}%`;

const progressPanels: Panel[] = [0, 0.15, 0.5, 0.85].map((progress) => ({
  label: percent(progress),
  state: constructing(progress),
})).concat({ label: "100% · complete", state: completed(10) });

const statePanels: Panel[] = [
  { label: "Just placed · 0% · drone on its way", state: constructing(0, false) },
  { label: "Drone working · 40%", state: constructing(0.4) },
  { label: "Paused · 40% · no drone", state: constructing(0.4, false) },
  { label: "Damaged · 40% · half health", state: constructing(0.4, true, 0.5) },
  { label: "Destroyed at 40% · 0.3 s later", state: destroyed(0.3) },
];

const completionPanels: Panel[] = [
  { label: "99%", state: constructing(0.99) },
  ...[0, 0.15, 0.4, 1].map((seconds) => ({ label: `Complete · +${seconds} s`, state: completed(seconds) })),
];

const destroyedPanels: Panel[] = [
  { label: "Drone working · 40%", state: constructing(0.4) },
  ...[0.1, 0.2, 0.3, 0.6].map((seconds) => ({ label: `Destroyed at 40% · +${seconds} s`, state: destroyed(seconds) })),
];

/** A site destroyed before anything was built: only the scaffold is there to drop. */
const unbuiltPanels: Panel[] = [
  { label: "Just placed · 0%", state: constructing(0, false) },
  ...[0.1, 0.2, 0.3, 0.6].map((seconds) => ({
    label: `Destroyed at 0% · +${seconds} s`,
    state: { ...destroyed(seconds), progress: 0 },
  })),
];

const damagePanels: Panel[] = [1, 0.75, 0.5, 0.25, 0.05].map((health) => ({
  label: `Paused · 40% · ${percent(health)} health`,
  state: constructing(0.4, false, health),
}));

/** The first moments of work, as a share of the Turret's 10 s build. */
const firstLayerPanels: Panel[] = [0.005, 0.02, 0.045, 0.09, 0.14].map((progress) => ({
  label: `${percent(progress)} · first layer`,
  state: constructing(progress),
}));

/** Heights at which the cut crosses the Command Center's shoulders and the Turret's barrels. */
const cutPanels: Panel[] = [0.3, 0.4, 0.62, 0.74, 0.92].map((progress) => ({
  label: percent(progress),
  state: constructing(progress),
}));

/** The cut climbing past the Command Center's shoulders, where faint grid patches once showed. */
const shoulderPanels: Panel[] = [0.37, 0.39, 0.4, 0.41, 0.43].map((progress) => ({
  label: percent(progress),
  state: constructing(progress),
}));

/** The last moments of the scaffold's drop, a sixtieth of a second apart. */
const dropPanels: Panel[] = [26, 27, 28, 29, 30].map((frame) => ({
  label: `Complete · +${(frame / 60).toFixed(3)} s`,
  state: completed(frame / 60),
}));

/** One build from placement to completion, with the drone leaving for 1.5 s on the way. */
const filmState = (seconds: number): SiteState => {
  if (seconds < 1) return constructing(0, false);
  if (seconds < 5) return constructing((seconds - 1) / 4 * 0.4);
  if (seconds < 6.5) return constructing(0.4, false);
  if (seconds < 12.5) return constructing(0.4 + (seconds - 6.5) / 6 * 0.6);
  return completed(seconds - 12.5);
};
const FILM_SECONDS = 14.5;

/** Twelve seconds of a Command Center build at its real pace: 60 s for the whole building. */
const excerptState = (seconds: number): SiteState => constructing(0.3 + seconds / 60);
const EXCERPT_SECONDS = 12;

/** The first three seconds of a Command Center build at its real pace: placed, then the first layer. */
const openingState = (seconds: number): SiteState =>
  seconds < 0.5 ? constructing(0, false) : constructing((seconds - 0.5) / 60);
const OPENING_SECONDS = 3;

/** A site shot at while it is built, then destroyed at 40%. */
const lossState = (seconds: number): SiteState => {
  if (seconds < 3) return constructing(0.25 + seconds * 0.05, true, 1 - seconds * 0.3);
  return destroyed(seconds - 3);
};
const LOSS_SECONDS = 4.5;

/**
 * The drone leaves for 2 s, long enough for the weld to go cold, then for 0.4 s, which catches
 * the glow half cooled, then for 0.1 s, which catches the arcs half out.
 */
const PAUSES = [[1.5, 3.5], [5, 5.4], [6.4, 6.5]] as const;
/** A build at the Command Center's pace that the drone leaves twice. */
const pauseState = (seconds: number): SiteState => {
  const idle = PAUSES.reduce((sum, [from, to]) => sum + THREE.MathUtils.clamp(seconds - from, 0, to - from), 0);
  return constructing(0.4 + (seconds - idle) / 60, !PAUSES.some(([from, to]) => seconds >= from && seconds < to));
};
const PAUSE_SECONDS = 7.5;

const params = new URLSearchParams(location.search);
const shot = params.get("shot") ?? "gameplay";
const time = Number(params.get("time")) || 2.4;

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

const construction = new ConstructionSites(scene);
await construction.load();
const lasers = new ScoutLasers(scene, scanLook);
const arms = new ScoutArms(scene);
// The game builds with `weld`. `?work=scan`, `hammer` or `drill` poses this scene's own drones in
// one of the styles kept for other uses. The builder films run the game, so they always weld.
const kept: Record<string, WorkStyle> = { scan: scanWith(lasers), hammer, drill };
const workStyle = kept[params.get("work") ?? ""] ?? weld;
/** Before each frame's drones are posed: nothing is left of the last frame's lasers and arms. */
const beginWork = (deltaSeconds: number) => {
  lasers.begin(deltaSeconds);
  arms.begin();
};

// As in the game, every building of a kind is a clone of one loaded model.
const models = createModelLibrary();
const scoutDrone = await loadDemoAsset(demoAssets.find((asset) => asset.unitKind === "scout-drone")!);
scoutDrone.model.traverse((object) => {
  if (object instanceof THREE.Mesh) object.castShadow = true;
});
const groundAt = (x: number, z: number) => sampleHeight(map, x, z);

/** `droneCount` Scout Drones stand evenly around the site, the first toward the camera's right. */
const createSite = async (kind: BuildingKind, x: number, z: number, rotation: number, droneCount = 1): Promise<Site> => {
  const root = await models.building(kind);
  const visualRoot = new THREE.Group();
  visualRoot.name = "Building visual";
  for (const child of [...root.children]) visualRoot.add(child);
  root.add(visualRoot);
  const ground = groundAt(x, z);
  root.position.set(x, ground, z);
  root.rotation.y = rotation;
  scene.add(root);
  root.updateWorldMatrix(true, true);
  const height = new THREE.Box3().setFromObject(root).max.y - ground;

  // Where the simulation lets a drone work from: just clear of the footprint.
  const reach = BUILDING_DEFINITIONS[kind].radius + UNIT_DEFINITIONS["scout-drone"].radius + 0.55;
  const drones = Array.from({ length: droneCount }, (_, index) => {
    const angle = Math.PI / 6 + index / droneCount * Math.PI * 2;
    const droneX = x + reach * Math.sin(angle);
    const droneZ = z + reach * Math.cos(angle);
    const model = new THREE.Group();
    // As in the game, the drone's model hangs in a group of its own, which its work may lean or shake.
    const body = scoutDrone.instance.clone(true);
    model.add(body);
    model.position.set(droneX, groundAt(droneX, droneZ), droneZ);
    model.rotation.y = Math.atan2(x - droneX, z - droneZ);
    scene.add(model);
    const work = new BuilderWork(
      attachLaserNozzle(body.children[0]!), construction.effects.createList(24), arms, `${kind}-${x}-${z}-${index}`, workStyle,
    );
    return { model, body, ground: model.position.y, work };
  });

  return { kind, root, visualRoot, handle: construction.createSite(kind, root, visualRoot)!, ground, height, drones };
};

/**
 * Shows `site` in `state`. Call `beginWork` first, once per frame. `deltaSeconds` is the time
 * since the last frame in a film; a still leaves it out and gets the drones' work settled.
 */
const applyState = (site: Site, state: SiteState, seconds: number, deltaSeconds = LASER_SETTLE_SECONDS) => {
  // The game's death effects sink what a destroyed site leaves standing, under dust this scene does not draw.
  const sunk = state.lifecycle === "destroyed"
    ? THREE.MathUtils.clamp((state.sinceLifecycleChange - STUMP_SINK.after) / STUMP_SINK.seconds, 0, 1) : 0;
  const depth = sunk * sunk * (1.4 - 0.4 * sunk) * (site.height * state.progress + 0.6);
  site.root.position.y = site.ground - depth;
  site.handle.sinkStump(depth);
  site.handle.update(state, seconds);
  // Once it is under, the game removes the building.
  site.root.visible = sunk < 1;
  const working = state.working && state.lifecycle === "constructing";
  for (const drone of site.drones) {
    drone.model.visible = working;
    // As in the game, a working drone hovers over the height built so far. Here it stands
    // there from the first frame; the builder films show it rise and sink.
    drone.model.position.y = drone.ground
      + Math.max(0, drone.work.workHeight(site.handle, drone.model.position) - LIFT_SHORTFALL - drone.ground);
    drone.work.update(working ? site.handle : undefined, drone.model.position, seconds, deltaSeconds, drone.body);
  }
};

/** For a strip, whose panels share their sites: the site once it has been in `state` for a while, not caught mid-fade. */
const applySettled = (site: Site, state: SiteState, seconds: number) => {
  site.handle.update(state, seconds - SETTLE_SECONDS);
  applyState(site, state, seconds);
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
const showLabels = (texts: readonly string[]) => {
  labels.replaceChildren();
  texts.forEach((text, index) => {
    const label = document.createElement("div");
    label.className = "preview-label";
    label.style.left = `${(index + 0.5) / texts.length * 100}%`;
    label.textContent = text;
    labels.append(label);
    if (!index) return;
    const divider = document.createElement("div");
    divider.className = "preview-divider";
    divider.style.left = `${index / texts.length * 100}%`;
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
    beginWork(index ? 0 : time);
    for (const site of sites) applySettled(site, panel.state, time);
    construction.flush(time);
    const x = Math.round(index * panelWidth);
    const width = Math.round((index + 1) * panelWidth) - x;
    renderer.setViewport(x, 0, width, innerHeight);
    renderer.setScissor(x, 0, width, innerHeight);
    renderer.render(scene, camera);
  });
  showLabels(panels.map((panel) => panel.label));
};

type Focus = "both" | "turret" | "command-center";
const stripShots: Record<string, { panels: Panel[]; focus: Focus; viewHeight: number }> = {
  gameplay: { panels: progressPanels, focus: "both", viewHeight: GAMEPLAY_VIEW_HEIGHT },
  "turret-close": { panels: progressPanels, focus: "turret", viewHeight: CLOSE_VIEW_HEIGHT },
  "command-center-close": { panels: progressPanels, focus: "command-center", viewHeight: CLOSE_VIEW_HEIGHT },
  states: { panels: statePanels, focus: "both", viewHeight: GAMEPLAY_VIEW_HEIGHT },
  "states-turret": { panels: statePanels, focus: "turret", viewHeight: CLOSE_VIEW_HEIGHT },
  "states-command-center": { panels: statePanels, focus: "command-center", viewHeight: CLOSE_VIEW_HEIGHT },
  completion: { panels: completionPanels, focus: "both", viewHeight: GAMEPLAY_VIEW_HEIGHT },
  "completion-command-center": { panels: completionPanels, focus: "command-center", viewHeight: CLOSE_VIEW_HEIGHT },
  "destroyed-command-center": { panels: destroyedPanels, focus: "command-center", viewHeight: CLOSE_VIEW_HEIGHT },
  "damage-command-center": { panels: damagePanels, focus: "command-center", viewHeight: CLOSE_VIEW_HEIGHT },
  "completion-turret": { panels: completionPanels, focus: "turret", viewHeight: CLOSE_VIEW_HEIGHT },
  destroyed: { panels: destroyedPanels, focus: "both", viewHeight: GAMEPLAY_VIEW_HEIGHT },
  "destroyed-turret": { panels: destroyedPanels, focus: "turret", viewHeight: CLOSE_VIEW_HEIGHT },
  "destroyed-unbuilt": { panels: unbuiltPanels, focus: "both", viewHeight: GAMEPLAY_VIEW_HEIGHT },
  damage: { panels: damagePanels, focus: "both", viewHeight: GAMEPLAY_VIEW_HEIGHT },
  "damage-turret": { panels: damagePanels, focus: "turret", viewHeight: CLOSE_VIEW_HEIGHT },
  "first-layer": { panels: firstLayerPanels, focus: "both", viewHeight: GAMEPLAY_VIEW_HEIGHT },
  "first-layer-turret": { panels: firstLayerPanels, focus: "turret", viewHeight: CLOSE_VIEW_HEIGHT },
  "cuts-turret": { panels: cutPanels, focus: "turret", viewHeight: CLOSE_VIEW_HEIGHT },
  "cuts-command-center": { panels: cutPanels, focus: "command-center", viewHeight: CLOSE_VIEW_HEIGHT },
  shoulders: { panels: shoulderPanels, focus: "command-center", viewHeight: CLOSE_VIEW_HEIGHT },
  "drop-turret": { panels: dropPanels, focus: "turret", viewHeight: CLOSE_VIEW_HEIGHT },
  drop: { panels: dropPanels, focus: "both", viewHeight: GAMEPLAY_VIEW_HEIGHT },
};

const focusPoint = (which: Focus) => which === "turret"
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
  const camera = cameraFor(site.root.position, GAMEPLAY_VIEW_HEIGHT, 1);
  const raycaster = new THREE.Raycaster();
  const reach = BUILDING_DEFINITIONS[site.kind].radius * 2.2 * GAMEPLAY_PIXELS_PER_METRE;
  const step = 6;
  let hits = 0;
  for (let x = -reach; x <= reach; x += step) {
    for (let y = -reach; y <= reach; y += step) {
      raycaster.setFromCamera(new THREE.Vector2(x / 450, y / 450), camera);
      if (raycaster.intersectObject(site.root, true).length) hits += 1;
    }
  }
  return hits * step * step;
};

const standardSites = async () => [
  await createSite("command-center", commandCenterAt.x, commandCenterAt.z, Math.PI / 4),
  await createSite("turret", turretAt.x, turretAt.z, 0),
];

if (shot in stripShots) {
  const { panels, focus: which, viewHeight } = stripShots[shot]!;
  sceneName.textContent = `Construction · ${shot} · ${viewHeight.toFixed(1)} m view`;
  renderStrip(await standardSites(), panels, focusPoint(which), viewHeight);
} else if (shot === "barrels") {
  // The Turret turned to face the camera, cut at the heights of its two barrels: the deck
  // must leave the air between them open.
  const site = await createSite("turret", turretAt.x, turretAt.z, Math.PI);
  sceneName.textContent = "Construction · the cut between the Turret's barrels";
  renderStrip(
    [site],
    [0.72, 0.78, 0.83, 0.88, 0.93].map((progress) => ({ label: percent(progress), state: constructing(progress, false) })),
    { x: turretAt.x + 0.5, z: turretAt.z + 0.9 },
    CLOSE_VIEW_HEIGHT * 0.5,
  );
} else if (shot === "fit") {
  // What nobody authors per building: other turns of the building, a slope, a neighbour.
  const turns = [0, 30, 45, 77, 180];
  const spacing = 16;
  const row = (index: number) => ({ x: focus.x - 34 + index * spacing * 0.7, z: focus.z + 26 - index * spacing * 0.7 });
  const sites: Site[] = [];
  for (const [index, turn] of turns.entries()) {
    const at = row(index);
    sites.push(await createSite("command-center", at.x, at.z, THREE.MathUtils.degToRad(turn)));
    sites.push(await createSite("turret", at.x + 7.2, at.z + 7.2, THREE.MathUtils.degToRad(turn)));
  }
  const target = row(2);
  const camera = cameraFor({ x: target.x + 3, z: target.z + 3 }, 40, innerWidth / innerHeight);
  aimSun(target);
  beginWork(time);
  sites.forEach((site, index) => applyState(site, constructing(0.45, index % 4 < 2), time));
  construction.flush(time);
  renderer.render(scene, camera);
  sceneName.textContent = `Construction · buildings turned ${turns.join(", ")} degrees, standing side by side`;
} else if (shot === "slope") {
  // Placement allows 0.75 m of height difference across a footprint; find the steepest such spot.
  const radius = BUILDING_DEFINITIONS["command-center"].radius;
  let steepest = { x: focus.x, z: focus.z, variation: 0 };
  for (let x = -map.size / 2 + 20; x < map.size / 2 - 20; x += 3) {
    for (let z = -map.size / 2 + 20; z < map.size / 2 - 20; z += 3) {
      const heights = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => groundAt(
        x + Math.cos(index * Math.PI / 4) * radius,
        z + Math.sin(index * Math.PI / 4) * radius,
      ));
      const variation = Math.max(...heights) - Math.min(...heights);
      if (variation <= 0.75 && variation > steepest.variation) steepest = { x, z, variation };
    }
  }
  const site = await createSite("command-center", steepest.x, steepest.z, Math.PI / 4);
  const panels = [constructing(0, false), constructing(0.3), completed(0.3)];
  sceneName.textContent = `Construction · Command Center on a ${steepest.variation.toFixed(2)} m slope`;
  renderStrip(
    [site],
    panels.map((state, index) => ({ label: ["Just placed", "30%", "Complete · +0.3 s"][index]!, state })),
    steepest,
    CLOSE_VIEW_HEIGHT * 1.5,
  );
} else if (shot.startsWith("film")) {
  const which: Focus = shot.endsWith("turret") ? "turret" : shot.endsWith("command-center") ? "command-center" : "both";
  // The Command Center does not fit a 720 px frame at the closest zoom, so its film stands back a little.
  const viewHeight = which === "both"
    ? innerHeight / GAMEPLAY_PIXELS_PER_METRE
    : which === "command-center" ? 16 : CLOSE_VIEW_HEIGHT * innerHeight / 900;
  const sites = await standardSites();
  const target = focusPoint(which);
  const camera = cameraFor(target, viewHeight, innerWidth / innerHeight);
  aimSun(target);
  sceneName.textContent = "Construction";
  const [stateAt, length] = shot.startsWith("film-loss")
    ? [lossState, LOSS_SECONDS]
    : shot.startsWith("film-pause")
      ? [pauseState, PAUSE_SECONDS]
      : shot === "film-opening-command-center"
        ? [openingState, OPENING_SECONDS]
        : shot === "film-command-center" ? [excerptState, EXCERPT_SECONDS] : [filmState, FILM_SECONDS];
  window.__constructionFrameCount = Math.round(length * FILM_FPS);
  window.__constructionFrame = (index) => {
    const seconds = index / FILM_FPS;
    const state = stateAt(seconds);
    beginWork(1 / FILM_FPS);
    for (const site of sites) applyState(site, state, seconds, 1 / FILM_FPS);
    construction.flush(seconds);
    renderer.render(scene, camera);
    showLabels([state.lifecycle === "active"
      ? "Complete"
      : state.lifecycle === "destroyed"
        ? "Destroyed"
        : `${percent(state.progress)} · ${state.working ? "drone working" : state.progress ? "paused, no drone" : "just placed"}${state.health < 1 ? ` · ${percent(state.health)} health` : ""}`]);
  };
  window.__constructionFrame(0);
} else if (shot === "crowd") {
  // Several drones on one site, each at work on its own side of it.
  const sites = [
    await createSite("command-center", commandCenterAt.x, commandCenterAt.z, Math.PI / 4, 6),
    await createSite("turret", turretAt.x, turretAt.z, 0, 3),
  ];
  sceneName.textContent = "Construction · 6 drones on a Command Center, 3 on a Turret";
  renderStrip(
    sites,
    [0.15, 0.5, 0.85].map((progress) => ({ label: percent(progress), state: constructing(progress) })),
    focusPoint("both"),
    30,
  );
} else if (shot.startsWith("builder")) {
  // The game's own UnitSystem and simulation, given the orders a player gives: a Scout Drone is
  // told to build, flies in, turns to its site, rises with it and welds it, is sent away and
  // called back. Nothing here poses the drone or its tools. In `builder-team` three drones are
  // told to build one Command Center together.
  const team = shot === "builder-team";
  const kind: BuildingKind = team || shot.endsWith("command-center") ? "command-center" : "turret";
  const at = kind === "turret" ? turretAt : commandCenterAt;
  const world = new THREE.Group();
  scene.add(world);
  // The game runs its simulation in a worker. Here it runs in step with the film's frames.
  await initializeNavigation();
  const starts = team ? [[10, 5], [-5, 13], [13, -7]] as const : [[10, 5]] as const;
  const scouts = starts.map(([x, z], index) => createTrainedUnitState({
    id: `scout-drone-${index + 1}`, kind: "scout-drone", ownerId: "local-player", position: toSimPoint(at.x + x, at.z + z), facing: 0,
  }));
  const scoutIds = scouts.map((scout) => scout.id);
  const system = new UnitSystem(
    world,
    map,
    [],
    [],
    new LocalMatchSession("local-player", new LocalUnitSimulation(scouts, [], map)),
    ({ kind: building }) => models.building(building),
    models.unit,
  );
  await system.prepareRendering(renderer, scene, new THREE.OrthographicCamera());
  const site = () => system.inspect().buildings[0];
  /** Gives the drones an order as a player does, with them selected for just that moment. */
  const order = (give: () => boolean) => () => {
    system.select(scoutIds);
    if (!give()) throw new Error(`The simulation refused an order in "${shot}"`);
    system.select();
  };
  // Simulation seconds at which the player's orders are given.
  const orders: [number, () => void][] = team
    ? [[0.5, order(() => system.buildSelected(kind, at.x, at.z))]]
    : kind === "turret" ? [
      [0.5, order(() => system.buildSelected(kind, at.x, at.z))],
      [5.5, order(() => system.stopSelected())],
      // A short hop along the site's edge leaves the drone facing away, so resuming shows it turn.
      [6.2, order(() => {
        const drone = system.inspect().units[0]!;
        return system.moveSelected(drone.x - (drone.z - at.z) * 0.6, drone.z + (drone.x - at.x) * 0.6);
      })],
      [7.4, order(() => system.resumeConstructionSelected(site()!.id))],
    ]
    : [
      [0.5, order(() => system.buildSelected(kind, at.x, at.z))],
      [26.5, order(() => system.moveSelected(at.x + 13, at.z + 2))],
      [28, order(() => system.resumeConstructionSelected(site()!.id))],
    ];
  // The Turret's 10 s build is filmed whole. The Command Center's build, 60 s for one drone and
  // 36 s for three, is cut twice: film seconds at which the simulation runs on unseen for a while.
  const cuts: [number, number][] = team ? [[7, 12], [13, 9]] : kind === "turret" ? [] : [[5, 20], [11.5, 28]];
  const length = team ? 19 : kind === "turret" ? 15.5 : 18;
  const panels = [
    { label: "Default zoom", viewHeight: innerHeight / GAMEPLAY_PIXELS_PER_METRE },
    { label: "Close", viewHeight: kind === "turret" ? CLOSE_VIEW_HEIGHT * innerHeight / 900 : 19 },
  ];
  const panelWidth = innerWidth / panels.length;
  const target = { x: at.x + 1.6, z: at.z + 1.6 };
  const cameras = panels.map((panel) => cameraFor(target, panel.viewHeight, panelWidth / innerHeight));
  aimSun(target);
  sceneName.textContent = "Construction · a Scout Drone builds, in the game's own simulation";
  let simulated = 0;
  window.__constructionFrameCount = Math.round(length * FILM_FPS);
  window.__constructionFrame = (index) => {
    const seconds = index / FILM_FPS;
    const until = seconds + cuts.reduce((skipped, [from, skip]) => skipped + (seconds >= from ? skip : 0), 0);
    while (simulated < until - 1e-9) {
      while (orders[0] && orders[0][0] <= simulated) orders.shift()![1]();
      system.update(1 / 60);
      simulated += 1 / 60;
    }
    renderer.setScissorTest(true);
    cameras.forEach((camera, panel) => {
      const x = Math.round(panel * panelWidth);
      renderer.setViewport(x, 0, Math.round(panelWidth), innerHeight);
      renderer.setScissor(x, 0, Math.round(panelWidth), innerHeight);
      renderer.render(scene, camera);
    });
    const [scout, ...others] = system.inspect().units;
    const building = site();
    const welding = [scout!, ...others].filter((unit) => unit.buildingWork).length;
    const doing = team
      ? `${welding} of ${scouts.length} welding`
      : welding ? "welding" : scout!.moving ? "flying" : scout!.order === "build" ? "arriving" : "stopped";
    const progress = building ? building.lifecycle === "active" ? "complete" : percent(building.constructionProgress) : "no site yet";
    const cut = cuts.find(([from]) => seconds >= from && seconds < from + 1);
    showLabels(panels.map((panel, panelIndex) => panelIndex
      ? `${panel.label} · ${progress} · ${team ? "drones" : "drone"} ${doing}`
      : `${panel.label}${cut ? ` · ${cut[1]} s later` : ""}`));
  };
  window.__constructionFrame(0);
} else if (shot === "perf") {
  const target = { x: focus.x - 4, z: focus.z + 4 };
  const camera = cameraFor(target, 110, innerWidth / innerHeight);
  aimSun(target);
  renderer.render(scene, camera);
  const emptyScene = measureFrame(camera);
  const sites: Site[] = [];
  const createSiteMs: number[] = [];
  const measureMs: Record<string, number> = {};
  // Five Command Centers and five Turrets: ten sites under construction at once.
  for (let index = 0; index < 10; index += 1) {
    const kind: BuildingKind = index < 5 ? "command-center" : "turret";
    const column = index % 5;
    const x = target.x - 32 + column * 16;
    const z = target.z + (index < 5 ? -9 : 9);
    if (!(kind in measureMs)) {
      const model = await models.building(kind);
      model.updateWorldMatrix(true, true);
      const started = performance.now();
      new ConstructionSites(new THREE.Group()).measure(kind, model, model);
      measureMs[kind] = Number((performance.now() - started).toFixed(1));
    }
    const site = await createSite(kind, x, z, index < 5 ? Math.PI / 4 : 0);
    const started = performance.now();
    site.handle.dispose();
    site.handle = construction.createSite(kind, site.root, site.visualRoot)!;
    createSiteMs.push(Number((performance.now() - started).toFixed(2)));
    sites.push(site);
  }
  const frame = (state: (index: number) => SiteState, seconds: number) => {
    beginWork(1 / 60);
    sites.forEach((site, index) => applyState(site, state(index), seconds));
    construction.flush(seconds);
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
  // three.js asks for the extension on every batch draw, so hiding it shows the fallback's cost.
  const { get } = renderer.extensions;
  renderer.extensions.get = (name: string) => name === "WEBGL_multi_draw" ? null : get(name);
  const underConstructionWithoutMultiDraw = measureFrame(camera);
  renderer.extensions.get = get;
  sceneName.textContent = "Construction · 10 sites under construction";
  // A builder's work needs no drone model, only the frame its nose sits in: 40 of them, four to a
  // site, each standing where the simulation lets a drone work from and facing its site.
  const crowd = Array.from({ length: 40 }, (_, index) => {
    const site = sites[index % sites.length]!;
    const angle = Math.PI / 6 + Math.floor(index / sites.length) * Math.PI / 2;
    const distance = BUILDING_DEFINITIONS[site.kind].radius + UNIT_DEFINITIONS["scout-drone"].radius + 0.55;
    const root = new THREE.Group();
    root.position.set(site.root.position.x + distance * Math.sin(angle), site.ground, site.root.position.z + distance * Math.cos(angle));
    root.rotation.y = angle + Math.PI;
    const body = new THREE.Group();
    // The drone's model has its nose along its own -x, so it stands a quarter turn round in its group.
    const hull = new THREE.Group();
    hull.rotation.y = Math.PI / 2;
    body.add(hull);
    root.add(body);
    scene.add(root);
    const work = new BuilderWork(attachLaserNozzle(hull), construction.effects.createList(24), arms, `crowd-${index}`);
    return { site, root, body, hull, work };
  });
  /** Puts `count` of the crowd to work and no others, for one frame `deltaSeconds` after the last. */
  const workCrowd = (count: number, seconds: number, deltaSeconds: number) => {
    for (const { site, root, body, hull, work } of crowd.slice(0, count)) {
      // As in the game, the nose hovers half a metre above the edge it works on.
      hull.position.y = work.workHeight(site.handle, root.position) + 0.5 - site.ground;
      work.update(site.handle, root.position, seconds, deltaSeconds, body);
    }
  };

  window.__constructionPerf = () => {
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
        construction.flush(1);
        site.root.updateWorldMatrix(true, true);
        picks[`${site.kind} ${Math.round(progress * 100)}%`] = pickablePixels(site);
      }
    }
    const builderCosts: PerfReport["builders"] = {};
    for (const count of [4, 40]) {
      const started = performance.now();
      for (let index = 0; index < frames; index += 1) {
        beginWork(1 / 60);
        workCrowd(count, 1 + index / 60, 1 / 60);
      }
      const updateMsPerFrame = Number(((performance.now() - started) / frames).toFixed(4));
      // What they add to the drawing: the same frame of ten welding sites, counted with and without them.
      const drawn = (builders: number) => {
        frame(() => constructing(0.5), 1);
        workCrowd(builders, 1, LASER_SETTLE_SECONDS);
        construction.flush(1);
        return measureFrame(camera);
      };
      const lit = drawn(count);
      for (const { work } of crowd) work.hide();
      const dark = drawn(0);
      builderCosts[`${count} drones`] = { calls: lit.calls - dark.calls, triangles: lit.triangles - dark.triangles, updateMsPerFrame };
    }
    frame(building, 1);
    renderer.render(scene, camera);
    return {
      sites: "5 Command Centers + 5 Turrets",
      emptyScene,
      atRest,
      underConstruction,
      underConstructionWithoutMultiDraw,
      measureMs,
      createSiteMs,
      updateMsPerFrame,
      builders: builderCosts,
      programsAtRest,
      programsAddedByConstruction,
      pickablePixels: picks,
    };
  };
} else {
  throw new Error(`Unknown shot "${shot}"`);
}

requestAnimationFrame(() => {
  window.__constructionReady = true;
});
