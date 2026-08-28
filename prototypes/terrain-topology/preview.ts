import * as THREE from "three";
import { sampleHeight } from "../../src/map";
import {
  TERRAIN_BASE_HEIGHT,
  TERRAIN_LEVEL_HEIGHT,
  TERRAIN_MOUNTAIN_BLOCKED_THRESHOLD,
} from "../../src/mapConstants";
import { createTerrain } from "../../src/terrain";
import {
  generateTerrainLayout,
  type GeneratedTerrainLayout,
} from "../../src/generatedTerrain";

type PreviewMode = "plan" | "rendered";
type TerrainLayout = GeneratedTerrainLayout;

declare global {
  interface Window {
    __terrainPreviewReady?: boolean;
  }
}

const params = new URLSearchParams(location.search);
const requestedMode = params.get("view");
const requestedSeed = params.get("seed");
let mode: PreviewMode = requestedMode === "rendered" ? "rendered" : "plan";
let seed = requestedSeed !== null && Number.isFinite(Number(requestedSeed))
  ? Math.trunc(Number(requestedSeed))
  : 77;
let playerCount = Math.max(2, Math.min(6, Math.trunc(Number(params.get("players")) || 2)));

const terrainCanvas = document.querySelector<HTMLCanvasElement>("#terrain-2d")!;
const renderedCanvas = document.querySelector<HTMLCanvasElement>("#terrain-rendered")!;
const planOverlay = document.querySelector<SVGSVGElement>("#terrain-plan")!;
const seedInput = document.querySelector<HTMLInputElement>("#seed")!;
const playerSelect = document.querySelector<HTMLSelectElement>("#players")!;
const status = document.querySelector<HTMLElement>("#status")!;
const mapSummary = document.querySelector<HTMLElement>("#map-summary")!;
const lastChange = document.querySelector<HTMLElement>("#last-change")!;
const note = document.querySelector<HTMLElement>("#preview-note")!;
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-preview-mode]")];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x17120e);
scene.add(new THREE.HemisphereLight(0xfff1dc, 0x5f5144, 1.45));
const sun = new THREE.DirectionalLight(0xffe6c7, 2.75);
sun.position.set(-80, 110, 55);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);

const terrainRoot = new THREE.Group();
scene.add(terrainRoot);
let renderer: THREE.WebGLRenderer | undefined;
let camera: THREE.OrthographicCamera;
let currentLayout: TerrainLayout;
let renderedKey = "";

const escapeHtml = (value: unknown) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const disposeRenderedTerrain = () => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  terrainRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => {
    if (material instanceof THREE.MeshStandardMaterial) {
      material.map?.dispose();
    }
    material.dispose();
  });
  terrainRoot.clear();
};

const drawHeightField = (layout: TerrainLayout) => {
  const context = terrainCanvas.getContext("2d")!;
  const row = layout.segments + 1;
  terrainCanvas.width = row;
  terrainCanvas.height = row;
  const image = context.createImageData(row, row);
  const colors = [[198, 154, 104], [158, 103, 67], [96, 61, 47]] as const;
  for (let z = 0; z < row; z += 1) {
    for (let x = 0; x < row; x += 1) {
      const index = z * row + x;
      const height = layout.heights[index]!;
      const level = height > TERRAIN_BASE_HEIGHT + TERRAIN_LEVEL_HEIGHT * 1.5
        ? 2
        : height > TERRAIN_BASE_HEIGHT + TERRAIN_LEVEL_HEIGHT * 0.5
          ? 1
          : 0;
      const right = layout.heights[z * row + Math.min(row - 1, x + 1)]!;
      const down = layout.heights[Math.min(row - 1, z + 1) * row + x]!;
      const shade = 1 - Math.min(0.52, Math.hypot(right - height, down - height) * 0.18);
      const mountain = layout.mountainMask[index]!;
      const foundation = layout.mountainFoundationMask[index]!;
      const rockBlend = mountain >= TERRAIN_MOUNTAIN_BLOCKED_THRESHOLD
        ? 1
        : THREE.MathUtils.smoothstep(foundation, 0.02, 0.42) * 0.45;
      image.data[index * 4] = THREE.MathUtils.lerp(colors[level][0], colors[2][0], rockBlend)
        * shade;
      image.data[index * 4 + 1] = THREE.MathUtils.lerp(colors[level][1], colors[2][1], rockBlend)
        * shade;
      image.data[index * 4 + 2] = THREE.MathUtils.lerp(colors[level][2], colors[2][2], rockBlend)
        * shade;
      image.data[index * 4 + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
};

const drawPlan = (layout: TerrainLayout) => {
  const { topology } = layout;
  planOverlay.setAttribute(
    "viewBox",
    `${-layout.size / 2} ${-layout.size / 2} ${layout.size} ${layout.size}`,
  );
  planOverlay.innerHTML = [
    ...layout.openEdges.map((edge) => {
      const start = topology.nodes[edge.a]!;
      const end = topology.nodes[edge.b]!;
      const classes = [
        "plan-route",
        edge.kind === "ramp" ? "ramp" : "",
        topology.chokeEdgeIds.has(edge.id) ? "choke" : "",
      ].filter(Boolean).join(" ");
      return `<line class="${classes}" x1="${start.x}" y1="${start.z}" x2="${end.x}" y2="${end.z}" />`;
    }),
    ...topology.nodes.map((node) =>
      `<circle class="node ${layout.regionKinds[node.id]}" cx="${node.x}" cy="${node.z}" r="${node.purpose === "base" ? 3.6 : 2.1}" />`
    ),
    ...topology.nodes.filter((node) => node.purpose === "base").flatMap((base) => [
      `<text class="node-label" x="${base.x}" y="${base.z - 6}" text-anchor="middle">P${base.player} BASE · MESA</text>`,
    ]),
  ].join("");
};

const addBaseMarkers = (layout: TerrainLayout) => {
  const colors = [0xf5d77a, 0x76d7ff, 0xff786c, 0x9ced77, 0xd598ff, 0xffa45f];
  layout.startingLocations.forEach((base, index) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.1, 48),
      new THREE.MeshBasicMaterial({
        color: colors[index % colors.length],
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      }),
    );
    ring.renderOrder = 10;
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(base.x, sampleHeight(layout, base.x, base.z) + 0.12, base.z);
    terrainRoot.add(ring);
  });
};

const drawRenderedTerrain = (layout: TerrainLayout) => {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas: renderedCanvas, antialias: true });
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  }
  disposeRenderedTerrain();
  const terrain = createTerrain(layout);
  terrainRoot.add(terrain);
  addBaseMarkers(layout);
  renderedKey = `${layout.seed}:${layout.playerCount}`;

  const viewHeight = layout.size * 1.42;
  const aspect = Math.max(1, renderedCanvas.clientWidth) / Math.max(1, renderedCanvas.clientHeight);
  camera = new THREE.OrthographicCamera(
    -viewHeight * aspect / 2,
    viewHeight * aspect / 2,
    viewHeight / 2,
    -viewHeight / 2,
    0.1,
    layout.size * 3,
  );
  camera.position.set(layout.size * 0.38, layout.size * 0.48, layout.size * 0.38);
  camera.lookAt(0, 0, 0);
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();
};

const renderThreeScene = () => {
  if (!renderer || !camera || mode !== "rendered") return;
  const width = Math.max(1, renderedCanvas.clientWidth);
  const height = Math.max(1, renderedCanvas.clientHeight);
  renderer.setSize(width, height, false);
  const viewHeight = camera.top - camera.bottom;
  const aspect = width / height;
  camera.left = -viewHeight * aspect / 2;
  camera.right = viewHeight * aspect / 2;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
};

const ensureRenderedTerrain = () => {
  if (renderedKey !== `${currentLayout.seed}:${currentLayout.playerCount}`) {
    drawRenderedTerrain(currentLayout);
  }
};

const updateLocation = () => {
  const next = new URLSearchParams();
  next.set("view", mode === "plan" ? "2d" : "rendered");
  next.set("seed", String(seed));
  next.set("players", String(playerCount));
  history.replaceState(null, "", `${location.pathname}?${next}`);
};

const applyMode = () => {
  const planVisible = mode === "plan";
  terrainCanvas.hidden = !planVisible;
  planOverlay.toggleAttribute("hidden", !planVisible);
  renderedCanvas.hidden = planVisible;
  modeButtons.forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.previewMode === mode));
  });
  note.textContent = planVisible
    ? "The graph authors routes, ramps, chokepoints, walkable mesas, and blocked mountain regions."
    : "The rendered view uses the exact same hybrid height field as the 2D plan.";
  updateLocation();
  if (planVisible) {
    window.__terrainPreviewReady = true;
  } else {
    ensureRenderedTerrain();
    scheduleTextureRenders();
  }
};

const scheduleTextureRenders = () => {
  window.__terrainPreviewReady = false;
  [0, 100, 350].forEach((delay) => window.setTimeout(renderThreeScene, delay));
  window.setTimeout(() => {
    renderThreeScene();
    window.__terrainPreviewReady = true;
  }, 1_000);
};

const renderTerrain = () => {
  const layout = generateTerrainLayout(seed, playerCount);
  currentLayout = layout;
  drawHeightField(layout);
  drawPlan(layout);

  const rows: Array<[string, string | number]> = [
    ["Seed", seed],
    ["Players", playerCount],
    ["Graph regions", layout.topology.nodes.length],
    ["Walkable mesas", layout.counts.walkableMesas],
    ["Mountain ranges", layout.counts.mountainRanges],
    ["Authored ramps", layout.counts.ramps],
    ["Base routes", layout.counts.minimumBaseRoutes],
    ["Chokepoints", layout.counts.chokepoints],
  ];
  status.innerHTML = rows.map(([label, value]) =>
    `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`
  ).join("");
  mapSummary.textContent = `Seed ${seed} · ${playerCount} players · graph + organic prototype`;
  lastChange.textContent = "Graph regions decide gameplay. Organic shaping changes their contours and mountain profiles.";
  seedInput.value = String(seed);
  playerSelect.value = String(playerCount);
  applyMode();
};

const setSeed = (value: number) => {
  seed = Number.isFinite(value) ? Math.trunc(value) : 77;
  renderTerrain();
};

seedInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") setSeed(Number(seedInput.value));
});
document.querySelector("#previous-seed")!.addEventListener("click", () => setSeed(seed - 1));
document.querySelector("#next-seed")!.addEventListener("click", () => setSeed(seed + 1));
document.querySelector("#random-seed")!.addEventListener("click", () =>
  setSeed(Math.floor(Math.random() * 2_147_483_647))
);
playerSelect.addEventListener("change", () => {
  playerCount = Number(playerSelect.value);
  renderTerrain();
});
modeButtons.forEach((button) => button.addEventListener("click", () => {
  mode = button.dataset.previewMode === "rendered" ? "rendered" : "plan";
  applyMode();
}));
window.addEventListener("resize", renderThreeScene);

renderTerrain();
