import * as THREE from "three";
import template from "../../index.html?raw";
import "../../src/style.css";
import { UnitInput } from "../../src/unitInput";
import { UnitSystem } from "../../src/unitSystem";
import { UNIT_CATALOG } from "../../src/unitCatalog";
import { generateMap } from "../../src/map";
import { MapCamera } from "../../src/camera";
import { TacticalMap } from "../../src/tacticalMap";
import { UI_ATTACK_COLOR } from "../../src/uiColors";
import type { MatchFrame, MatchSession } from "../../src/matchSession";
import { POSITION_SCALE, type UnitState, type BuildingState } from "../../src/sim/units";
import { states } from "./states";

const state = states.find((value) => value === new URLSearchParams(location.search).get("state")) ?? "empty";
const parsed = new DOMParser().parseFromString(template, "text/html");
parsed.querySelectorAll("script").forEach((script) => script.remove());
document.body.replaceChildren(...parsed.body.childNodes);
document.documentElement.style.setProperty("--attack-color", `#${UI_ATTACK_COLOR.toString(16)}`);
// The background is intentionally cheap; production HUD markup and styles are unchanged.
document.head.insertAdjacentHTML("beforeend", `<style>body{background:#91623a}#game{background:radial-gradient(ellipse at 65% 25%,#d5a16350,transparent 70%),repeating-linear-gradient(165deg,#ffffff03 0 2px,transparent 2px 7px)}.review-note{position:fixed;top:110px;left:22px;color:#fff9;font:12px system-ui;pointer-events:none}</style>`);
const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const world = new THREE.Group();
const map = generateMap(77);
const kinds = ["ghostrunner", "scout-drone", "hornet", "behemoth"] as const;
const units: UnitState[] = kinds.map((kind, index) => {
  const definition = UNIT_CATALOG[kind];
  return {
  id: kind, kind,
  ownerId: state === "enemy-unit" ? "enemy-player" : "local-player",
  health: Math.round(definition.maxHealth * (state === "damaged" ? .2 : 1)), maxHealth: definition.maxHealth,
  pushable: true, radius: definition.radius * POSITION_SCALE, speed: definition.speed * POSITION_SCALE,
  attackDamage: definition.attackDamage, attackRange: definition.attackRange && definition.attackRange * POSITION_SCALE,
  attackMinRange: definition.attackMinRange && definition.attackMinRange * POSITION_SCALE, attackCooldownTicks: 0,
  position: { x: index * 4000, z: 0 }, target: { x: index * 4000, z: 0 }, path: [], order: "idle", moving: false, attacking: false,
};
});
if (state === "group") {
  for (let index = 0; index < 5; index++) units.push({ ...units[0]!, id: `group-${index}` });
}
const buildings: BuildingState[] = ["command-center", "turret"].map((kind, index) => ({
  id: kind, kind: kind === "turret" ? "turret" : "command-center", lifecycle: state.startsWith("construction") ? "constructing" : "active",
  constructionProgress: state.startsWith("construction") ? .42 : 1,
  builderId: state === "construction" ? "scout-drone" : undefined,
  ownerId: state === "enemy-building" ? "enemy-player" : "local-player",
  position: { x: index * 10000, z: 10000 }, rotation: 0, radius: 2000, health: kind === "turret" ? 900 : 2500, maxHealth: kind === "turret" ? 900 : 2500,
  productionQueue: kind === "command-center" ? Array.from({ length: state === "queue-full" ? 5 : state === "training" ? 2 : 0 }, (_, i) => ({ id: `queue-${i}`, kind: "ghostrunner", progressTicks: i === 0 ? 42 : 0, totalTicks: 100 })) : undefined,
}));
const frame: MatchFrame = { version: 1, tick: 1200, full: true, units, buildings, events: [] };
const session: MatchSession = { readFrame: (after) => after < 1 ? frame : undefined, advance() {}, submit: () => ({ commandId: "preview", status: "rejected" }) };
const system = new UnitSystem(world, map, [], [], session);
world.userData.unitSystem = system;
for (const unit of units) {
  // HUD fixtures need selectable roots, not downloaded/animated 3D models.
  system.attachGhostrunner(unit.id, new THREE.Group(), [new THREE.AnimationClip("Idle", 1, [])], { terrainAlignment: 0, turnResponsiveness: 1, selectionRing: { radius: .5, offset: { x: 0, z: 0 } }, selectionHitbox: { radius: .5, height: 1, offset: { x: 0, y: .5, z: 0 } } });
}
for (const building of buildings) system.attachBuilding(building.id, new THREE.Group());
const camera = new MapCamera(canvas, map.size);
const input = new UnitInput(canvas, camera.camera, document.querySelector("#unit-panel")!, document.querySelector("#selection-box")!);
input.setWorld(world);
const buildingStates = ["command-center", "turret", "enemy-building", "training", "queue-full", "construction", "construction-paused", "rally"];
const ids = state === "empty" || state === "settings" || state === "controls" ? []
  : buildingStates.includes(state) ? [state === "turret" ? "turret" : "command-center"]
  : state === "group" || state === "mixed-army" ? units.filter((u) => state === "mixed-army" || u.kind === "ghostrunner").map((u) => u.id)
  : [state === "build-menu" ? "scout-drone" : state === "attack-ground" ? "behemoth" : units.some((u) => u.id === state) ? state : "ghostrunner"];
system.select(ids);
input.update();
const action = state === "build-menu" ? "build" : ["move", "attack", "attack-ground"].includes(state) ? state : undefined;
if (action) document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
if (state === "rally") document.querySelector<HTMLButtonElement>("[data-set-rally]")!.click();
input.update();
document.querySelector<HTMLElement>(".empty-selection")!.hidden = ids.length > 0;
const minimap = new TacticalMap(document.querySelector("#minimap")!, camera, document.querySelector("#match-clock")!, document.querySelector("#force-count")!);
minimap.setWorld(map, system);
minimap.update(0);
if (state === "settings" || state === "controls") document.querySelector<HTMLDetailsElement>(state === "settings" ? ".settings" : ".help")!.open = true;
if (state === "victory" || state === "defeat") {
  document.querySelector<HTMLElement>("#match-outcome")!.hidden = false;
  document.querySelector("#match-outcome-title")!.textContent = state === "victory" ? "Victory" : "Defeat";
  document.querySelector("#match-outcome-detail")!.textContent = state === "victory" ? "Enemy Command Center destroyed." : "Your Command Center has been destroyed.";
}
await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
document.documentElement.dataset.reviewReady = state;
