import * as THREE from "three";
import { createEnvironmentProps } from "../../../src/environmentProps";
import { canPlaceAt, generateMap, sampleHeight, type GeneratedMap } from "../../../src/map";
import { createTerrain } from "../../../src/terrain";
import { SCENARIOS, type CastBuilding, type CastUnit, type ScenarioName } from "./scenarios";
import { createScriptedMatch } from "./scriptedMatch";

/**
 * Plays a scenario of units dying and buildings being destroyed through the game's own
 * presentation, at the game's default zoom on the left and close on the right. Time only moves
 * when the page is stepped, so every capture is repeatable:
 *   /tools/preview/death-effects/?scenario=behemoth, then `__stage.advanceTo(1.2)`.
 * `capture.mjs` records clips, frame strips and cost from it.
 */

export type PlacedUnit = CastUnit & { x: number; z: number; vx: number; vz: number };
export type PlacedBuilding = CastBuilding & { x: number; z: number };

interface FrameCost {
  time: number;
  /** Milliseconds of main-thread time the presentation update took in this step. */
  updateMs: number;
  /** Draw calls and triangles of the gameplay view, shadow pass included. */
  drawCalls: number;
  triangles: number;
}

declare global {
  interface Window {
    __stage?: {
      scenario: (typeof SCENARIOS)[ScenarioName];
      /** Step to `seconds` on the scenario clock at 60 steps per second, then draw both views. */
      advanceTo(seconds: number): FrameCost;
      /** Step and draw only the gameplay view every 60th of a second, returning each frame's cost. */
      measure(untilSeconds: number): FrameCost[];
    };
  }
}

const STEP_SECONDS = 1 / 60;
/** The game's camera: `VIEW_HEIGHT / DEFAULT_ZOOM` metres tall, looking down this offset. */
const GAMEPLAY_HEIGHT = 56 / 1.3;
const CAMERA_OFFSET = new THREE.Vector3(46, 58, 46);
const SUN_OFFSET = new THREE.Vector3(-38, 58, 24);
const SCREEN_RIGHT = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
const SCREEN_AWAY = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };

const scenarioName = (new URLSearchParams(location.search).get("scenario") ?? "scout-drone") as ScenarioName;
const scenario: (typeof SCENARIOS)[ScenarioName] | undefined = SCENARIOS[scenarioName];
if (!scenario) throw new Error(`Unknown scenario ${scenarioName}`);

const terrainVariation = (map: GeneratedMap, x: number, z: number, radius: number) => {
  let lowest = Infinity;
  let highest = -Infinity;
  for (let index = 0; index < 16; index += 1) {
    const angle = index / 16 * Math.PI * 2;
    const reach = index % 2 ? radius : radius / 2;
    const height = sampleHeight(map, x + Math.cos(angle) * reach, z + Math.sin(angle) * reach);
    lowest = Math.min(lowest, height);
    highest = Math.max(highest, height);
  }
  return highest - lowest;
};

/**
 * The unobstructed spot near the first base that fits the scenario's cast: the first level one,
 * or with `sloped` the steepest.
 */
const findCentre = (map: GeneratedMap, radius: number, sloped: boolean) => {
  const origin = map.startingLocations[0]!;
  let best = { x: origin.x, z: origin.z };
  let bestScore = -Infinity;
  for (let ring = 0; ring <= 14; ring += 1) {
    const samples = Math.max(1, ring * 8);
    for (let index = 0; index < samples; index += 1) {
      const angle = index / samples * Math.PI * 2;
      const x = origin.x + Math.cos(angle) * ring * 8;
      const z = origin.z + Math.sin(angle) * ring * 8;
      if (Math.abs(x) > map.size / 2 - radius || Math.abs(z) > map.size / 2 - radius) continue;
      if (!canPlaceAt(map, x, z, radius)) continue;
      const variation = terrainVariation(map, x, z, radius);
      if (!sloped && variation < 0.5) return { x, z };
      const score = sloped ? variation : -variation;
      if (score > bestScore) {
        best = { x, z };
        bestScore = score;
      }
    }
  }
  return best;
};

const map = generateMap(77, 6);
const centre = findCentre(map, scenario.clearRadius, "sloped" in scenario);
const toWorld = (right: number, away: number) => ({
  x: centre.x + SCREEN_RIGHT.x * right + SCREEN_AWAY.x * away,
  z: centre.z + SCREEN_RIGHT.z * right + SCREEN_AWAY.z * away,
});
const units: PlacedUnit[] = scenario.units.map((unit) => ({
  ...unit,
  ...toWorld(unit.right, unit.away),
  vx: SCREEN_RIGHT.x * unit.velocityRight + SCREEN_AWAY.x * unit.velocityAway,
  vz: SCREEN_RIGHT.z * unit.velocityRight + SCREEN_AWAY.z * unit.velocityAway,
}));
const buildings: PlacedBuilding[] = scenario.buildings.map((building) => ({
  ...building,
  ...toWorld(building.right, building.away),
}));

// Renderer, lights and shadows match src/main.ts.
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
scene.background = new THREE.Color(0x000000);
scene.add(createTerrain(map));
const environment = createEnvironmentProps(map.environment);
scene.add(environment.group);
scene.add(new THREE.HemisphereLight(0xfff4e4, 0x8b765d, 1.25));
const sun = new THREE.DirectionalLight(0xffedda, 2.65);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 180 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.035;
sun.shadow.intensity = 0.72;
sun.target.position.set(centre.x, 0, centre.z);
sun.position.copy(sun.target.position).add(SUN_OFFSET);
scene.add(sun, sun.target);

const panelWidth = innerWidth / 2;
const createCamera = (viewHeight: number, focus: { x: number; z: number }) => {
  const halfWidth = viewHeight * panelWidth / innerHeight / 2;
  const camera = new THREE.OrthographicCamera(
    -halfWidth, halfWidth, viewHeight / 2, -viewHeight / 2, 0.1, 400,
  );
  const target = new THREE.Vector3(focus.x, sampleHeight(map, focus.x, focus.z), focus.z);
  camera.position.copy(target).add(CAMERA_OFFSET);
  camera.lookAt(target);
  return camera;
};
const gameplayCamera = createCamera(GAMEPLAY_HEIGHT, centre);
const closeCamera = createCamera(
  scenario.closeHeight,
  toWorld(scenario.closeFocus.right, scenario.closeFocus.away),
);

const match = createScriptedMatch(scene, map, units, buildings, renderer, gameplayCamera);

let time = 0;
const gameplayLabel = document.querySelector<HTMLElement>("#gameplay-label")!;
const closeLabel = document.querySelector<HTMLElement>("#close-label")!;
const step = () => {
  time += STEP_SECONDS;
  const started = performance.now();
  match.update(STEP_SECONDS, time);
  return performance.now() - started;
};

const drawPanel = (camera: THREE.Camera, index: number) => {
  renderer.setViewport(index * panelWidth, 0, panelWidth, innerHeight);
  renderer.setScissor(index * panelWidth, 0, panelWidth, innerHeight);
  renderer.render(scene, camera);
};

const drawGameplay = (updateMs: number): FrameCost => {
  renderer.info.reset();
  renderer.setScissorTest(true);
  drawPanel(gameplayCamera, 0);
  const clock = `${scenario.title} · ${time.toFixed(2)} s`;
  gameplayLabel.textContent = `${clock} · gameplay zoom, ${GAMEPLAY_HEIGHT.toFixed(0)} m tall`;
  closeLabel.textContent = `${clock} · close, ${scenario.closeHeight.toFixed(0)} m tall`;
  return {
    time,
    updateMs,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  };
};

await Promise.all([environment.ready, match.ready]);
drawGameplay(0);
drawPanel(closeCamera, 1);

window.__stage = {
  scenario,
  advanceTo(seconds) {
    let updateMs = 0;
    while (time + STEP_SECONDS / 2 < seconds) updateMs = Math.max(updateMs, step());
    const cost = drawGameplay(updateMs);
    drawPanel(closeCamera, 1);
    return cost;
  },
  measure(untilSeconds) {
    const frames: FrameCost[] = [];
    while (time + STEP_SECONDS / 2 < untilSeconds) frames.push(drawGameplay(step()));
    return frames;
  },
};
