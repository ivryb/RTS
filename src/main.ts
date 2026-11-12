import * as THREE from "three";
import { DEFAULT_ZOOM, MapCamera } from "./camera";
import { replaceCombatProofWorld } from "./combatProofRuntime";
import { generateMap, MAP_SIZE, sampleHeight, type GeneratedMap } from "./map";
import {
  applyGroundStyle,
  BASE_GROUND_TEXTURES,
  getGroundStyle,
  PATCH_GROUND_TEXTURES,
  type GroundTextureId,
} from "./materials";
import "./style.css";
import { UI_ATTACK_COLOR } from "./uiColors";
import { TacticalMap } from "./tacticalMap";
import { UnitInput } from "./unitInput";
import type { MatchOutcome, UnitSystem } from "./unitSystem";
import { createWorld, disposeWorld, updateWorld } from "./world";

const attackColor = `#${UI_ATTACK_COLOR.toString(16).padStart(6, "0")}`;
document.documentElement.style.setProperty("--attack-color", attackColor);
const attackCursor = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M16 2v8m0 12v8M2 16h8m12 0h8" stroke="black" stroke-width="4"/><path d="M16 2v8m0 12v8M2 16h8m12 0h8" stroke="${attackColor}" stroke-width="2"/><circle cx="16" cy="16" r="6" fill="none" stroke="${attackColor}"/></svg>`;
document.documentElement.style.setProperty("--attack-cursor", `url('data:image/svg+xml,${encodeURIComponent(attackCursor)}') 16 16`);

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const seedLabel = document.querySelector<HTMLElement>("#seed")!;
const zoomLevel = document.querySelector<HTMLOutputElement>("#zoom-level")!;
const titaniumCount = document.querySelector<HTMLElement>("#titanium-count")!;
const newMapButton = document.querySelector<HTMLButtonElement>("#new-map")!;
const unitPanel = document.querySelector<HTMLElement>("#unit-panel")!;
const selectionBox = document.querySelector<HTMLElement>("#selection-box")!;
const matchOutcome = document.querySelector<HTMLElement>("#match-outcome")!;
const matchOutcomeTitle = document.querySelector<HTMLElement>("#match-outcome-title")!;
const matchOutcomeDetail = document.querySelector<HTMLElement>("#match-outcome-detail")!;
const restartMatchButton = document.querySelector<HTMLButtonElement>("#restart-match")!;
const groundTexture =
  document.querySelector<HTMLSelectElement>("#ground-texture")!;
const groundSecondaryTexture = document.querySelector<HTMLSelectElement>(
  "#ground-secondary-texture"
)!;
const groundSmoothBorders = document.querySelector<HTMLInputElement>(
  "#ground-smooth-borders"
)!;
const groundTint = document.querySelector<HTMLInputElement>("#ground-tint")!;
const groundTintValue =
  document.querySelector<HTMLOutputElement>("#ground-tint-value")!;

for (const option of BASE_GROUND_TEXTURES)
  groundTexture.add(
    new Option(
      `${"favoriteBase" in option ? "★ " : ""}${option.label}`,
      option.id
    )
  );
for (const option of PATCH_GROUND_TEXTURES)
  groundSecondaryTexture.add(new Option(option.label, option.id));
const groundStyle = getGroundStyle();
groundTexture.value = groundStyle.texture;
groundSecondaryTexture.value = groundStyle.secondaryTexture;
groundSmoothBorders.checked = groundStyle.smoothBorders;
groundTint.value = `#${new THREE.Color(groundStyle.tint).getHexString(
  THREE.SRGBColorSpace
)}`;
groundTintValue.value = groundTint.value;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

scene.add(new THREE.HemisphereLight(0xfff4e4, 0x8b765d, 1.25));
const sun = new THREE.DirectionalLight(0xffedda, 2.65);
const SUN_OFFSET = new THREE.Vector3(-38, 58, 24);
const SHADOW_HALF_SIZE = 80;
sun.position.copy(SUN_OFFSET);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -SHADOW_HALF_SIZE;
sun.shadow.camera.right = SHADOW_HALF_SIZE;
sun.shadow.camera.top = SHADOW_HALF_SIZE;
sun.shadow.camera.bottom = -SHADOW_HALF_SIZE;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 180;
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.035;
sun.shadow.intensity = 0.72;
scene.add(sun, sun.target);

const mapCamera = new MapCamera(canvas, MAP_SIZE);
const unitInput = new UnitInput(
  canvas,
  mapCamera.camera,
  unitPanel,
  selectionBox
);
const tacticalMap = new TacticalMap(
  document.querySelector<HTMLCanvasElement>("#minimap")!, mapCamera,
  document.querySelector<HTMLElement>("#match-clock")!,
  document.querySelector<HTMLElement>("#force-count")!,
);
let world: THREE.Group | undefined;
let activeMap: GeneratedMap | undefined;
let currentSeed =
  Number(new URLSearchParams(location.search).get("seed")) || 77;
let visibleOutcome: MatchOutcome | undefined;
let renderingReady = Promise.resolve();

const updateSunFocus = () => {
  sun.target.position.copy(mapCamera.focusPoint);
  sun.position.copy(mapCamera.focusPoint).add(SUN_OFFSET);
  sun.target.updateMatrixWorld();
};

const updateGroundStyle = () => {
  if (!world) return;
  const terrain = world.userData.terrain as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  >;
  applyGroundStyle(
    terrain.material,
    groundTexture.value as GroundTextureId,
    groundSecondaryTexture.value as GroundTextureId,
    groundSmoothBorders.checked,
    groundTint.value
  );
  groundTintValue.value = groundTint.value;
};

groundTexture.addEventListener("change", updateGroundStyle);
groundSecondaryTexture.addEventListener("change", updateGroundStyle);
groundSmoothBorders.addEventListener("change", updateGroundStyle);
groundTint.addEventListener("input", updateGroundStyle);

const loadMap = (seed: number) => {
  const loaded = replaceCombatProofWorld(world, seed, {
    remove: (current) => scene.remove(current),
    dispose: disposeWorld,
    create: (nextSeed) => {
      const map = generateMap(nextSeed, 6);
      return { map, world: createWorld(map) };
    },
    add: (next) => scene.add(next),
    bindInput: (next) => unitInput.setWorld(next),
    resetOutcome: () => {
      visibleOutcome = undefined;
      matchOutcome.hidden = true;
    },
  });
  const { map } = loaded;
  world = loaded.world;
  activeMap = map;
  tacticalMap.setWorld(map, world.userData.unitSystem as UnitSystem);
  mapCamera.setTerrain(map);
  updateGroundStyle();
  mapCamera.focus(world.userData.focus);
  updateSunFocus();
  const loadingWorld = world;
  renderingReady = loadingWorld.userData.environment.ready.then(() =>
    (loadingWorld.userData.unitSystem as UnitSystem).prepareRendering(renderer, scene, mapCamera.camera));
  seedLabel.textContent = `Seed ${map.seed} · Shifting Frontiers`;
  history.replaceState(null, "", `?seed=${map.seed}`);
};

const newMap = () => {
  currentSeed = Math.floor(Math.random() * 2_147_483_647);
  loadMap(currentSeed);
};

const restartMatch = () => loadMap(currentSeed);

const updateMatchOutcome = () => {
  const outcome = (world?.userData.unitSystem as UnitSystem | undefined)?.matchOutcome;
  if (outcome === visibleOutcome) return;
  visibleOutcome = outcome;
  matchOutcome.hidden = !outcome;
  if (!outcome) return;
  const copy: Record<MatchOutcome, { title: string; detail: string }> = {
    victory: {
      title: "Victory",
      detail: "The enemy's final Command Center has been destroyed.",
    },
    defeat: {
      title: "Defeat",
      detail: "Your final Command Center has been destroyed.",
    },
    draw: {
      title: "Draw",
      detail: "Both sides lost their final Command Center on the same tick.",
    },
  };
  matchOutcomeTitle.textContent = copy[outcome].title;
  matchOutcomeDetail.textContent = copy[outcome].detail;
  restartMatchButton.focus();
};

newMapButton.addEventListener("click", newMap);
restartMatchButton.addEventListener("click", restartMatch);
window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLElement && event.target.closest("input, select, textarea")) return;
  if (event.key === "?") {
    const help = document.querySelector<HTMLDetailsElement>(".help")!;
    help.open = !help.open;
  }
  if (event.code === "KeyR" && !event.repeat) restartMatch();
});
window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});

// Read-only diagnostics for verification tooling; inert without ?verify=1.
// Checked before loadMap: it rewrites the URL and drops the verify param.
const verifyEnabled = new URLSearchParams(location.search).has("verify");
loadMap(currentSeed);

if (verifyEnabled) {
  (window as unknown as Record<string, unknown>).__dune77 = {
    ready: () => renderingReady,
    inspect: () => (world?.userData.unitSystem as UnitSystem | undefined)?.inspect() ?? null,
    view: (x: number, z: number, zoom = 1) => {
      // Focus is on y=0; slide along the view ray so the elevated ground point lands centered.
      mapCamera.focus({ x, z });
      const toCamera = mapCamera.camera.position.clone().sub(mapCamera.focusPoint);
      const lift = (activeMap ? sampleHeight(activeMap, x, z) : 0) / toCamera.y;
      mapCamera.focus({ x: x - toCamera.x * lift, z: z - toCamera.z * lift });
      mapCamera.camera.zoom = DEFAULT_ZOOM * zoom;
      mapCamera.camera.updateProjectionMatrix();
    },
    project: (x: number, z: number, y = 0) => {
      const elevation = activeMap ? sampleHeight(activeMap, x, z) : 0;
      const point = new THREE.Vector3(x, elevation + y, z).project(mapCamera.camera);
      return {
        x: Math.round((point.x * 0.5 + 0.5) * window.innerWidth),
        y: Math.round((-point.y * 0.5 + 0.5) * window.innerHeight),
        behind: point.z > 1,
      };
    },
  };
}

let previousFrame = performance.now();
renderer.setAnimationLoop((frame) => {
  const delta = Math.min((frame - previousFrame) / 1000, 0.05);
  mapCamera.update(delta);
  updateSunFocus();
  if (world) {
    updateWorld(world, delta);
    unitInput.update();
    const titanium = (world.userData.unitSystem as UnitSystem).titanium.toLocaleString();
    if (titaniumCount.textContent !== titanium) titaniumCount.textContent = titanium;
    updateMatchOutcome();
  }
  const zoomLabel = `${(mapCamera.camera.zoom / DEFAULT_ZOOM).toFixed(2)}×`;
  if (zoomLevel.value !== zoomLabel) zoomLevel.value = zoomLabel;
  tacticalMap.update(frame);
  previousFrame = frame;
  renderer.render(scene, mapCamera.camera);
});
