import { AttackAreaMarker } from "./attackAreaMarker";
import { placeGroundGeometry, prepareGroundOverlay } from "./groundOverlay";
import * as THREE from "three";
import { OrderMarker } from "./orderMarker";
import { OrePresentation, ScoutHarvestPresentation, type OreModelLoader } from "./orePresentation";
import { SCOUT_TITANIUM_CAPACITY, type TitaniumDepositState } from "./sim/harvesting";
import {
  BehemothBarrage,
  BEHEMOTH_LAUNCH_OFFSETS,
  BEHEMOTH_ROCKET_COUNT,
} from "./behemothBarrage";
import { BEHEMOTH_DAMAGE_DELAY_SECONDS, behemothVolleySeed } from "./behemothAttack";
import { BUILDING_CATALOG } from "./buildingCatalog";
import { sampleHeight, type GeneratedMap } from "./map";
import { createLocalMatchSession, type MatchFrame, type MatchSession } from "./matchSession";
import {
  UNIT_CATALOG,
  type UnitKind,
  type UnitPresentationDefinition,
} from "./unitCatalog";
import { UI_ATTACK_COLOR, UI_SELECTION_COLOR } from "./uiColors";
import {
  BUILDING_DEFINITIONS,
  TURRET_TURN_RESPONSIVENESS,
  constructionPlacementIsValid,
} from "./sim/construction";
import {
  canQueueTraining,
  defaultRallyPoint,
} from "./sim/production";
import {
  ATTACK_FACING_TOLERANCE,
  POSITION_SCALE,
  SIMULATION_TICK_SECONDS,
  toSimPoint,
  type BuildingKind,
  type BuildingState,
  type MatchResult,
  type PlayerCommand,
  type SimulationEvent,
  type UnitState,
} from "./sim/units";

const LOCAL_PLAYER_ID = "local-player";
const BEHEMOTH_TRACK_SCROLL_SCALE = 0.75;
const MAX_TERRAIN_TILT = THREE.MathUtils.degToRad(20);
const TERRAIN_TILT_RESPONSIVENESS = 10;
const TURRET_IDLE_SWEEP_ANGLE = THREE.MathUtils.degToRad(32);
const TURRET_IDLE_SWEEP_SPEED = 0.55;
const TURRET_IDLE_TURN_RESPONSIVENESS = 4.5;
// The authored TurretHead mesh points its barrel down the local -X axis.
const TURRET_HEAD_FORWARD_YAW = Math.PI / 2;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const terrainNormal = new THREE.Vector3();
const localTerrainNormal = new THREE.Vector3();
const targetTilt = new THREE.Quaternion();

export interface UnitPresentationOptions {
  attackTimeScale?: number;
  moveTimeScale?: number;
  terrainAlignment: number;
  turnResponsiveness: number;
  selectionRing: {
    radius: number;
    offset: { x: number; z: number };
  };
  selectionHitbox: {
    radius: number;
    height: number;
    offset: { x: number; y: number; z: number };
  };
}

export interface WorldBuilding {
  id: string;
  kind: BuildingKind;
  ownerId: string;
  x: number;
  z: number;
  rotation: number;
  radius: number;
  attackRadius: number;
  health: number;
}

export type BuildingPresentationFactory = (
  building: BuildingState,
) => THREE.Group | Promise<THREE.Group>;

export type MatchOutcome = "victory" | "defeat" | "draw";

export interface LoadedUnitPresentation {
  root: THREE.Group;
  visual: THREE.Object3D;
  animations: readonly THREE.AnimationClip[];
  options: UnitPresentationOptions;
}

export type UnitPresentationFactory = (
  unit: UnitState,
) => LoadedUnitPresentation | Promise<LoadedUnitPresentation>;

export interface UnitSpawn {
  id: string;
  kind: UnitKind;
  ownerId?: string;
  x: number;
  z: number;
  health: number;
  pushable?: boolean;
  radius: number;
  speed: number;
  facing?: number;
  attackMinRange?: number;
  attackRange?: number;
  attackGroundRadius?: number;
  attackDamage?: number;
  attackInterval?: number;
  guardMode?: UnitState["guardMode"];
}

interface UnitFrame {
  kind: UnitKind;
  ownerId: string;
  order: UnitState["order"];
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  health: number;
  maxHealth: number;
  radius: number;
  speed: number;
  facing?: number;
  attackDamage?: number;
  attackMinRange?: number;
  attackRange?: number;
  moving: boolean;
  attacking: boolean;
  attackTargetId?: string;
  attackGroundTarget?: UnitState["attackGroundTarget"];
  constructionTargetId?: string;
  cargoTitanium: number;
  harvest?: UnitState["harvest"];
}

type SelectedUnitGroup = UnitPresentationDefinition & {
  kind: UnitKind;
  count: number;
  health: number;
  attackMinRange?: number;
  attackRange?: number;
  cargoTitanium: number;
  cargoCapacity: number;
};

export type SelectedBuilding = BuildingState & {
  name: string;
  friendly: boolean;
};

interface HealthBarPresentation {
  root: THREE.Group;
  fill: THREE.Sprite;
}

interface UnitPresentation {
  root: THREE.Group;
  visualRoot: THREE.Group;
  mixer?: THREE.AnimationMixer;
  actions?: Record<"idle" | "move" | "attack", THREE.AnimationAction> & {
    death?: THREE.AnimationAction;
  };
  hover?: {
    visual: THREE.Object3D;
    baseX: number;
    baseY: number;
    baseZ: number;
    baseRotationX: number;
    baseRotationZ: number;
    time: number;
    moveWobble?: { offset: number; tilt: number };
  };
  tracks?: {
    maps: THREE.Texture[];
    offset: number;
    distancePerRepeat: number;
    lastX?: number;
    lastZ?: number;
  };
  laser?: { muzzle: THREE.Object3D };
  barrage?: { launchers: THREE.Object3D[] };
  attack: "none" | "direct" | "ground";
  rangeIndicator?: THREE.Group;
  selectionRing: THREE.Mesh;
  selectionHitbox: THREE.Mesh;
  healthBar: HealthBarPresentation;
  constructionBeam?: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  harvesting?: ScoutHarvestPresentation;
  miningContact?: { depositId: string; x: number; z: number; point: THREE.Vector3 };
  state: "idle" | "move" | "attack" | "death";
  death?: {
    elapsed: number;
    fadeStart: number;
    hideAt: number;
    materials?: { material: THREE.Material; opacity: number }[];
  };
  turnResponsiveness: number;
  terrainAlignment: number;
  terrainRadius: number;
  ground?: {
    x: number;
    z: number;
    y: number;
    normal: THREE.Vector3;
  };
  selectionGround?: { x: number; z: number; rotation: number };
  rangeGround?: { x: number; z: number };
}

interface BuildingPresentation {
  root: THREE.Group;
  visualRoot: THREE.Group;
  selectionRing: THREE.Mesh;
  selectionHitbox: THREE.Mesh;
  healthBar: HealthBarPresentation;
  rangeIndicator?: THREE.Group;
  muzzle?: THREE.Object3D;
  turretHead?: {
    object: THREE.Object3D;
    idleRotation: number;
    elapsed: number;
  };
  destruction?: {
    elapsed: number;
    initialScaleY: number;
    materials: { material: THREE.Material; opacity: number }[];
  };
}

interface PendingDirectShot {
  targetId: string;
  targetX: number;
  targetZ: number;
  launchTick: number;
  impactTick: number;
}

interface PendingGroundShot {
  targetX: number;
  targetZ: number;
  seed: number;
}

const DEATH_ANIMATION_TIME_SCALE = 1.3;
const CORPSE_LINGER_SECONDS = 4;
const CORPSE_FADE_SECONDS = 2;
const CORPSE_START_OPACITY = 0.95;
const BUILDING_DESTRUCTION_SECONDS = 0.8;
const RECENT_COMBAT_TICKS = Math.round(3 / SIMULATION_TICK_SECONDS);

const toFrame = (unit: UnitState): UnitFrame => ({
  kind: unit.kind,
  ownerId: unit.ownerId,
  order: unit.order,
  x: unit.position.x / POSITION_SCALE,
  z: unit.position.z / POSITION_SCALE,
  targetX: unit.target.x / POSITION_SCALE,
  targetZ: unit.target.z / POSITION_SCALE,
  health: unit.health,
  maxHealth: unit.maxHealth,
  radius: unit.radius / POSITION_SCALE,
  speed: unit.speed / POSITION_SCALE,
  facing: unit.facing,
  attackDamage: unit.attackDamage,
  attackMinRange: unit.attackMinRange && unit.attackMinRange / POSITION_SCALE,
  attackRange: unit.attackRange && unit.attackRange / POSITION_SCALE,
  moving: unit.moving,
  attacking: unit.attacking,
  attackTargetId: unit.attackTargetId,
  attackGroundTarget: unit.attackGroundTarget && { ...unit.attackGroundTarget },
  constructionTargetId: unit.constructionTargetId,
  cargoTitanium: unit.cargoTitanium ?? 0,
  harvest: unit.harvest,
});

interface LaserProjectile {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  end: THREE.Vector3;
  launchTick: number;
  impactTick: number;
  targetId?: string;
}

interface MuzzleFlash {
  sprite: THREE.Sprite;
  light?: THREE.PointLight;
  remaining: number;
  scale: number;
}

const createGlowTexture = () => {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - (size - 1) / 2, y - (size - 1) / 2) / (size / 2);
      const alpha = Math.max(0, 1 - distance) ** 2;
      const index = (y * size + x) * 4;
      data.set([255, 92, 112, Math.round(alpha * 255)], index);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
};

export const createSelectionRing = ({ radius, offset }: UnitPresentationOptions["selectionRing"], color = UI_SELECTION_COLOR) => {
  const geometry = new THREE.RingGeometry(radius, radius + 0.10, 48);
  geometry.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
      depthWrite: false,
      opacity: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );
  ring.position.set(offset.x, 0, offset.z);
  ring.name = "Selection ring";
  ring.userData.selectionOverlay = true;
  prepareGroundOverlay(ring);
  ring.visible = false;
  return ring;
};

const healthBarMaterial = (color: number) => new THREE.SpriteMaterial({
  color,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
});

export const createHealthBar = (height: number, width = 1) => {
  const root = new THREE.Group();
  root.name = "Health bar";
  root.userData.selectionOverlay = true;
  root.position.y = height;
  root.scale.x = width;
  root.renderOrder = 10;

  const background = new THREE.Sprite(healthBarMaterial(0x101010));
  background.name = "Health bar background";
  background.renderOrder = 10;
  // Keep all four borders equally thin; horizontal padding must not grow with bar width.
  background.scale.set(1 + 0.06 / width, 0.16, 1);
  const fill = new THREE.Sprite(healthBarMaterial(0xf1f1ef));
  fill.name = "Health bar fill";
  fill.renderOrder = 11;
  fill.scale.set(1, 0.1, 1);
  root.add(background, fill);
  root.visible = false;
  return { root, fill };
};

export const updateHealthBar = (
  presentation: HealthBarPresentation,
  health: number,
  maxHealth: number,
  visible: boolean,
  friendly = true,
) => {
  const fraction = THREE.MathUtils.clamp(health / maxHealth, 0, 1);
  presentation.root.visible = visible && health > 0;
  presentation.fill.scale.x = fraction;
  // Sprite anchors are camera-aligned; a local X offset rotates with the unit
  // and pulls a damaged bar's fill away from its backing.
  presentation.fill.center.x = fraction > 0 ? .5 / fraction : .5;
  presentation.fill.material.color.setHex(
    friendly ? (fraction > 0.3 ? 0xf1f1ef : 0x909090) : UI_ATTACK_COLOR,
  );
};

const disposeEntityOverlays = ({
  selectionRing,
  selectionHitbox,
  healthBar,
  rangeIndicator,
}: Pick<BuildingPresentation, "selectionRing" | "selectionHitbox" | "healthBar" | "rangeIndicator">) => {
  selectionRing.geometry.dispose();
  (selectionRing.material as THREE.Material).dispose();
  selectionHitbox.geometry.dispose();
  (selectionHitbox.material as THREE.Material).dispose();
  for (const child of healthBar.root.children) {
    if (child instanceof THREE.Sprite) child.material.dispose();
  }
  for (const child of rangeIndicator?.children ?? []) {
    if (!(child instanceof THREE.Mesh)) continue;
    child.geometry.dispose();
    (child.material as THREE.Material).dispose();
  }
};

const disposeModel = (root: THREE.Object3D) => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    material.dispose();
  }
};

const sampleTerrainNormal = (
  map: GeneratedMap,
  x: number,
  z: number,
  radius: number,
  alignment: number,
) => {
  if (alignment <= 0) return terrainNormal.copy(WORLD_UP);
  const distance = Math.max(map.size / map.segments / 2, radius);
  terrainNormal.set(
    sampleHeight(map, x - distance, z) - sampleHeight(map, x + distance, z),
    distance * 2,
    sampleHeight(map, x, z - distance) - sampleHeight(map, x, z + distance),
  ).normalize();
  const angle = Math.acos(THREE.MathUtils.clamp(terrainNormal.y, -1, 1));
  if (angle > MAX_TERRAIN_TILT) {
    const horizontalScale = Math.sin(MAX_TERRAIN_TILT)
      / Math.hypot(terrainNormal.x, terrainNormal.z);
    terrainNormal.set(
      terrainNormal.x * horizontalScale,
      Math.cos(MAX_TERRAIN_TILT),
      terrainNormal.z * horizontalScale,
    );
  }
  return terrainNormal.lerp(WORLD_UP, 1 - alignment).normalize();
};

const createSelectionHitbox = ({
  radius,
  height,
  offset,
}: UnitPresentationOptions["selectionHitbox"]) => {
  const hitbox = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hitbox.userData.selectionProxy = true;
  hitbox.position.set(offset.x, offset.y, offset.z);
  return hitbox;
};

const createConstructionBeam = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0,
    0, 0, 0,
  ], 3).setUsage(THREE.DynamicDrawUsage));
  const beam = new THREE.Line(
    geometry,
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
  beam.visible = false;
  return beam;
};

const dashedRingAngles = (radius: number, dashLength: number, gapLength: number) => {
  const count = Math.max(8, Math.floor(Math.PI * 2 * radius / (dashLength + gapLength)));
  const step = Math.PI * 2 / count;
  const length = Math.min(dashLength / radius, step * 0.6);
  return Array.from({ length: count }, (_, index) => ({
    start: index * step,
    end: index * step + length,
  }));
};

const ringQuad = (
  center: { x: number; z: number },
  radius: number,
  halfWidth: number,
  start: number,
  end: number,
) => {
  const inner = radius - halfWidth;
  const outer = radius + halfWidth;
  return [
    [center.x + Math.cos(start) * inner, center.z + Math.sin(start) * inner],
    [center.x + Math.cos(start) * outer, center.z + Math.sin(start) * outer],
    [center.x + Math.cos(end) * outer, center.z + Math.sin(end) * outer],
    [center.x + Math.cos(end) * inner, center.z + Math.sin(end) * inner],
  ];
};

const createDashedRingGeometry = (
  radius: number,
  halfWidth: number,
  dashLength: number,
  gapLength: number,
) => {
  const dashes = dashedRingAngles(radius, dashLength, gapLength);
  const values = new Float32Array(dashes.length * 18);
  let offset = 0;
  for (const { start, end } of dashes) {
    const points = ringQuad({ x: 0, z: 0 }, radius, halfWidth, start, end);
    for (const index of [0, 1, 2, 0, 2, 3]) {
      values[offset++] = points[index]![0]!;
      values[offset++] = 0;
      values[offset++] = points[index]![1]!;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(values, 3));
  return geometry;
};

const createGroundDisc = (
  radius: number,
  fillOpacity: number,
  outlineOpacity: number,
  color = UI_ATTACK_COLOR,
) => {
  const marker = new THREE.Group();
  const material = (opacity: number) => new THREE.MeshBasicMaterial({
      color,
      depthWrite: false,
      opacity,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
      toneMapped: false,
      transparent: true,
    });
  const fillGeometry = new THREE.CircleGeometry(radius, 64);
  fillGeometry.rotateX(-Math.PI / 2);
  const fill = new THREE.Mesh(fillGeometry, material(fillOpacity));
  const outlineGeometry = new THREE.RingGeometry(radius - 0.08, radius + 0.08, 64);
  outlineGeometry.rotateX(-Math.PI / 2);
  const outline = new THREE.Mesh(
    outlineGeometry,
    material(outlineOpacity),
  );
  prepareGroundOverlay(fill);
  prepareGroundOverlay(outline);
  marker.add(fill, outline);
  marker.visible = false;
  marker.renderOrder = 0;
  return marker;
};

export const createAttackGroundIndicator = () => {
  const marker = createGroundDisc(4, .045, .65);
  marker.name = "Ground attack target";
  for (const rotation of [0, Math.PI / 2]) {
    const geometry = new THREE.PlaneGeometry(.085, .85);
    geometry.rotateX(-Math.PI / 2);
    geometry.rotateY(rotation);
    marker.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: UI_ATTACK_COLOR, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    })));
  }
  return marker;
};

const createConstructionPreview = () => {
  const preview = createGroundDisc(1, 0.08, 0.8, UI_SELECTION_COLOR);
  const blocked = new THREE.Group();
  blocked.name = "Blocked placement";
  for (const angle of [-Math.PI / 4, Math.PI / 4]) {
    const geometry = new THREE.PlaneGeometry(.1, 1.3);
    geometry.rotateX(-Math.PI / 2);
    geometry.rotateY(angle);
    const stroke = new THREE.Mesh(geometry, createRangeMaterial());
    blocked.add(stroke);
  }
  preview.add(blocked);
  return preview;
};

const RANGE_HALF_WIDTH = 0.075;
const RANGE_DASH_LENGTH = 0.15;
const RANGE_GAP_LENGTH = 1.05;
const createRangeMaterial = (color = UI_SELECTION_COLOR) => new THREE.MeshBasicMaterial({
  color,
  depthWrite: false,
  opacity: 0.4,
  toneMapped: false,
  side: THREE.DoubleSide,
  transparent: true,
});

const rangeDashes = (radius: number) => dashedRingAngles(
  radius,
  RANGE_DASH_LENGTH,
  RANGE_GAP_LENGTH,
);

const rangeQuad = (
  center: { x: number; z: number },
  radius: number,
  start: number,
  end: number,
) => ringQuad(center, radius, RANGE_HALF_WIDTH, start, end);

const createDashedRangeGeometry = (radius: number) => {
  return createDashedRingGeometry(
    radius,
    RANGE_HALF_WIDTH,
    RANGE_DASH_LENGTH,
    RANGE_GAP_LENGTH,
  );
};

export const createRangeIndicator = (minRange: number, maxRange: number, color = UI_SELECTION_COLOR) => {
  const group = new THREE.Group();
  group.name = "Attack range";
  group.userData.rangeIndicator = true;
  group.userData.selectionOverlay = true;
  const circle = (radius: number) => {
    const result = new THREE.Mesh(createDashedRangeGeometry(radius), createRangeMaterial(color));
    prepareGroundOverlay(result);
    return result;
  };
  if (minRange > 0) group.add(circle(minRange));
  group.add(circle(maxRange));
  group.visible = false;
  return group;
};

const updateUnionRange = (
  mesh: THREE.Mesh,
  centers: readonly THREE.Vector3[],
  radius: number,
  map: GeneratedMap,
) => {
  const dashes = rangeDashes(radius);
  const capacity = centers.length * dashes.length * 18;
  let position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position || position.array.length !== capacity) {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BufferGeometry();
    position = new THREE.BufferAttribute(new Float32Array(capacity), 3)
      .setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute("position", position);
  }

  const values = position.array as Float32Array;
  let offset = 0;
  const write = (point: readonly [number, number, number]) => {
    for (const value of point) values[offset++] = value;
  };
  for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
    const center = centers[centerIndex]!;
    for (const { start, end } of dashes) {
      const middle = (start + end) / 2;
      const boundaryX = center.x + Math.cos(middle) * radius;
      const boundaryZ = center.z + Math.sin(middle) * radius;
      const covered = centers.some((other, otherIndex) => otherIndex !== centerIndex
        && Math.hypot(boundaryX - other.x, boundaryZ - other.z) < radius - 0.001);
      if (covered) continue;

      const height = sampleHeight(map, center.x, center.z) + .1;
      const points = rangeQuad(center, radius, start, end).map(([x, z]) => [x, height, z] as const);
      for (const index of [0, 1, 2, 0, 2, 3]) write(points[index]!);
    }
  }
  position.needsUpdate = true;
  mesh.geometry.setDrawRange(0, offset / 3);
  mesh.geometry.computeBoundingSphere();
};

const placeGroundOverlay = (
  overlay: THREE.Group,
  map: GeneratedMap,
  origin: { x: number; y: number; z: number },
) => {
  for (const child of overlay.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    prepareGroundOverlay(child);
    placeGroundGeometry(child.geometry, sampleHeight(map, origin.x, origin.z) - origin.y);
  }
};

export class UnitSystem {
  readonly selectables: THREE.Object3D[] = [];
  readonly attackables: THREE.Object3D[] = [];

  private readonly session: MatchSession;
  private readonly ore: OrePresentation;
  private readonly oreReady: Promise<void>;
  private readonly currentDeposits = new Map<string, TitaniumDepositState>();
  private playerTitanium: Readonly<Record<string, number>> = {};
  private readonly buildingById = new Map<string, BuildingPresentation>();
  private readonly currentBuildings = new Map<string, BuildingState>();
  private readonly pendingBuildings = new Map<string, Promise<THREE.Group>>();
  private readonly pendingUnits = new Map<string, Promise<LoadedUnitPresentation>>();
  private readonly pendingCommandResults = new Map<string, (accepted: boolean) => void>();
  private readonly presentations = new Map<string, UnitPresentation>();
  private readonly previous = new Map<string, UnitFrame>();
  private readonly current = new Map<string, UnitFrame>();
  private readonly marker = new OrderMarker("destination", (x, z) => sampleHeight(this.map, x, z));
  private readonly attackFeedback = new OrderMarker("attack", (x, z) => sampleHeight(this.map, x, z));
  private feedbackTargetId?: string;
  private feedbackAge = 0;
  private readonly rallyMarker = new OrderMarker("destination", (x, z) => sampleHeight(this.map, x, z));
  private readonly attackGroundPreview = createAttackGroundIndicator();
  private readonly attackGroundMarker = new AttackAreaMarker();
  private groundFeedbackGrace = 0;
  private readonly constructionPreview = createConstructionPreview();
  private readonly combinedRangeIndicator = new THREE.Group();
  private readonly selectedIds = new Set<string>();
  private selectedUnitFrames: readonly UnitFrame[] = [];
  private selectedUnitGroups: readonly SelectedUnitGroup[] = [];
  private selectedBuildingFrames: readonly SelectedBuilding[] = [];
  private selectionRevision = 0;
  private readonly recentCombatUntil = new Map<string, number>();
  private selectedRangeIds: readonly string[] = [];
  private combinedRangePositions: readonly { x: number; z: number }[] = [];
  private combinedRangeKey = "";
  private readonly laserGeometry = new THREE.CylinderGeometry(0.0585, 0.0585, 1.105, 8);
  private readonly laserMaterial = new THREE.MeshBasicMaterial({
    blending: THREE.AdditiveBlending,
    color: 0xff304c,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
  });
  private readonly glowTexture = createGlowTexture();
  private readonly laserProjectiles: LaserProjectile[] = [];
  private readonly laserPool: LaserProjectile[] = [];
  // Reuse a bounded set of lights, but hide inactive ones to avoid per-pixel work.
  // prepareRendering warms every light-count variant before combat starts.
  private readonly muzzleLights = Array.from({ length: 8 }, () => {
    const light = new THREE.PointLight(0xff4058, 0, 3.5, 2);
    light.name = "Muzzle flash light";
    light.visible = false;
    return light;
  });
  private readonly availableMuzzleLights = [...this.muzzleLights];
  private readonly muzzleFlashes: MuzzleFlash[] = [];
  private readonly muzzleFlashPool: MuzzleFlash[] = [];
  private readonly pendingDirectShots = new Map<string, PendingDirectShot>();
  private readonly pendingGroundShots = new Map<string, PendingGroundShot>();
  private readonly groundShotsInFlight = new Set<string>();
  private readonly deferredGroundDeaths = new Map<string, {
    attackerId: string;
    delay?: number;
  }>();
  private readonly behemothBarrage: BehemothBarrage;
  private readonly behemothLaunchPoints = Array.from(
    { length: BEHEMOTH_ROCKET_COUNT },
    () => new THREE.Vector3(),
  );
  private readonly laserStart = new THREE.Vector3();
  private readonly laserEnd = new THREE.Vector3();
  private readonly laserDirection = new THREE.Vector3();
  private readonly turretOrigin = new THREE.Vector3();
  private readonly turretTarget = new THREE.Vector3();
  private readonly targetBounds = new THREE.Box3();
  private readonly preparedFadeMaterials = new Set<THREE.Material>();
  private frameVersion = 0;
  private frameTick = 0;
  private interpolationAge = SIMULATION_TICK_SECONDS;
  private markerTime = 0;
  private result?: MatchResult;
  private disposed = false;

  constructor(
    private readonly world: THREE.Group,
    private readonly map: GeneratedMap,
    spawns: readonly UnitSpawn[],
    buildings: readonly WorldBuilding[] = [],
    session?: MatchSession,
    private readonly createBuildingPresentation?: BuildingPresentationFactory,
    private readonly createUnitPresentation?: UnitPresentationFactory,
    loadOreModels?: OreModelLoader,
  ) {
    this.behemothBarrage = new BehemothBarrage(world, map);
    for (const deposit of map.titaniumDeposits ?? []) this.currentDeposits.set(deposit.id, deposit);
    this.ore = new OrePresentation(world, map, [...this.currentDeposits.values()], loadOreModels);
    this.oreReady = this.ore.ready.then(() => {
      if (this.disposed) return;
      this.selectables.push(...this.ore.selectables);
      this.ore.update([...this.currentDeposits.values()], this.selectedIds);
    });
    this.world.add(...this.muzzleLights);
    const buildingStates: BuildingState[] = buildings.map((building) => {
      const position = toSimPoint(building.x, building.z);
      const radius = Math.round(building.radius * POSITION_SCALE);
      return {
        id: building.id,
        kind: building.kind,
        lifecycle: "active",
        constructionProgress: 1,
        ownerId: building.ownerId,
        position,
        rotation: building.rotation,
        radius,
        attackRadius: Math.round(building.attackRadius * POSITION_SCALE),
        health: building.health,
        maxHealth: building.health,
        ...(building.kind === "command-center" ? {
          productionQueue: [],
          rallyPoint: defaultRallyPoint(position, radius, building.rotation, map.size),
        } : {}),
      };
    });
    const unitStates: UnitState[] = spawns.map((spawn) => {
        const position = toSimPoint(spawn.x, spawn.z);
        return {
          id: spawn.id,
          kind: spawn.kind,
          ownerId: spawn.ownerId ?? LOCAL_PLAYER_ID,
          health: spawn.health,
          maxHealth: spawn.health,
          pushable: spawn.pushable ?? true,
          radius: spawn.radius * POSITION_SCALE,
          speed: spawn.speed * POSITION_SCALE,
          facing: spawn.facing,
          attackMinRange: spawn.attackMinRange && spawn.attackMinRange * POSITION_SCALE,
          attackRange: spawn.attackRange && spawn.attackRange * POSITION_SCALE,
          attackGroundRadius: spawn.attackGroundRadius && spawn.attackGroundRadius * POSITION_SCALE,
          attackDamage: spawn.attackDamage,
          attackIntervalTicks: spawn.attackInterval
            ? Math.round(spawn.attackInterval / SIMULATION_TICK_SECONDS)
            : undefined,
          attackCooldownTicks: 0,
          position,
          target: { ...position },
          path: [],
          order: "idle" as const,
          moving: false,
          attacking: false,
          guardMode: spawn.guardMode,
        };
      });
    const commandCenterPlayers = [...new Set(buildingStates.flatMap((building) =>
      building.kind === "command-center" ? [building.ownerId] : []))];
    this.session = session ?? createLocalMatchSession(
      LOCAL_PLAYER_ID,
      unitStates,
      buildingStates,
      {
        size: map.size,
        segments: map.segments,
        heights: map.heights,
        mountainMask: map.mountainMask,
        trianglePattern: map.trianglePattern,
        placement: map.placement,
      },
      {
        titaniumDeposits: [...this.currentDeposits.values()],
        ...(commandCenterPlayers.length > 1 ? { commandCenterElimination: commandCenterPlayers } : {}),
      },
    );
    this.combinedRangeIndicator.name = "Combined attack range";
    this.combinedRangeIndicator.visible = false;
    this.constructionPreview.name = "Construction placement";
    this.attackGroundPreview.name = "Ground attack preview";
    this.rallyMarker.name = "Rally point";
    this.world.add(
      this.marker,
      this.attackFeedback,
      this.rallyMarker,
      this.attackGroundPreview,
      this.attackGroundMarker,
      this.constructionPreview,
      this.combinedRangeIndicator,
    );
    this.syncSessionFrame();
  }

  /** Compile hidden effects and fade variants during loading, before the first fight. */
  async prepareRendering(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    await this.oreReady;
    await Promise.allSettled([...this.pendingUnits.values(), ...this.pendingBuildings.values()]);
    if (this.disposed) return;
    const warmup = new THREE.Group();
    warmup.name = "Prepared combat materials";
    warmup.visible = false;
    const flash = this.createMuzzleFlash();
    this.muzzleFlashPool.push(flash);
    warmup.add(new THREE.Mesh(this.laserGeometry, this.laserMaterial), flash.sprite);
    warmup.add(this.behemothBarrage.prepareRendering());
    const presentation = this.presentations.values().next().value;
    if (presentation) {
      const healthBar = presentation.healthBar.root.clone(true);
      healthBar.visible = true;
      warmup.add(healthBar);
    }
    // Keep these material variants alive for later deaths. They share geometry
    // and textures with the models; only the fading material is different.
    for (const presentation of [...this.presentations.values(), ...this.buildingById.values()]) {
      warmup.add(presentation.visualRoot.clone(true));
      const faded = presentation.visualRoot.clone(true);
      faded.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const fade = (material: THREE.Material) => {
          const copy = material.clone();
          copy.transparent = true;
          copy.depthWrite = false;
          this.preparedFadeMaterials.add(copy);
          return copy;
        };
        object.material = Array.isArray(object.material)
          ? object.material.map(fade) : fade(object.material);
      });
      warmup.add(faded);
    }
    this.world.add(warmup);
    // Drivers can defer pipeline setup until the first draw. Prepare each light
    // count in one startup task, submitting effect/model variants below the terrain.
    // No animation frame can observe a partially prepared lighting configuration.
    warmup.position.y = -10_000;
    warmup.visible = true;
    const culling = new Map<THREE.Object3D, boolean>();
    warmup.traverse((object) => {
      culling.set(object, object.frustumCulled);
      object.frustumCulled = false;
    });
    try {
      for (let count = 0; count <= this.muzzleLights.length; count += 1) {
        for (let index = 0; index < this.muzzleLights.length; index += 1) {
          this.muzzleLights[index]!.visible = index < count;
        }
        renderer.compile(scene, camera);
        renderer.render(scene, camera);
      }
    } finally {
      for (const light of this.muzzleLights) light.visible = light.intensity > 0;
      for (const [object, frustumCulled] of culling) object.frustumCulled = frustumCulled;
      warmup.removeFromParent();
    }
  }

  attachGhostrunner(
    id: string,
    root: THREE.Group,
    clips: THREE.AnimationClip[],
    options: UnitPresentationOptions = {
      attackTimeScale: 2.04,
      moveTimeScale: 1,
      terrainAlignment: 0.45,
      turnResponsiveness: 14,
      selectionRing: { radius: 0.56, offset: { x: 0, z: 0 } },
      selectionHitbox: {
        radius: 0.55,
        height: 2.5,
        offset: { x: 0, y: 1.25, z: 0 },
      },
    },
  ) {
    const idleClip = clips.find((clip) => /idle/i.test(clip.name)) ?? clips[0];
    const moveClip = clips.find((clip) => clip.name === "Female_Throwing_Stance_Charge_inplace")
      ?? clips[0];
    const attackClip = clips.find((clip) => clip.name === "Attack") ?? clips[0];
    const deathClip = clips.find((clip) => /^dead$/i.test(clip.name));
    if (!idleClip || !moveClip || !attackClip) return;

    const mixer = new THREE.AnimationMixer(root);
    const idle = mixer.clipAction(idleClip);
    const move = mixer.clipAction(moveClip);
    const attack = mixer.clipAction(attackClip);
    const death = deathClip ? mixer.clipAction(deathClip) : undefined;
    move.setEffectiveTimeScale(options.moveTimeScale ?? 1);
    attack.setEffectiveTimeScale(options.attackTimeScale ?? 2.04);
    if (death) {
      death.setLoop(THREE.LoopOnce, 1);
      death.clampWhenFinished = true;
      death.setEffectiveTimeScale(DEATH_ANIMATION_TIME_SCALE);
    }
    idle.play();
    this.attachUnit(id, root, options, {
      mixer,
      actions: { idle, move, attack, ...(death ? { death } : {}) },
      attack: "direct",
    });
  }

  attachScoutDrone(
    id: string,
    root: THREE.Group,
    visual: THREE.Object3D,
    options: UnitPresentationOptions,
  ) {
    const constructionBeam = createConstructionBeam();
    this.world.add(constructionBeam);
    this.attachUnit(id, root, options, {
      hover: {
        visual,
        baseX: visual.position.x,
        baseY: visual.position.y,
        baseZ: visual.position.z,
        baseRotationX: visual.rotation.x,
        baseRotationZ: visual.rotation.z,
        time: 0,
      },
      attack: "none",
      constructionBeam,
      harvesting: new ScoutHarvestPresentation(root, this.world),
    });
  }

  attachHornet(
    id: string,
    root: THREE.Group,
    visual: THREE.Object3D,
    options: UnitPresentationOptions,
  ) {
    const muzzle = new THREE.Object3D();
    muzzle.name = "HornetMuzzle";
    muzzle.position.set(-0.5, -0.0625, 0);
    visual.add(muzzle);
    this.attachUnit(id, root, options, {
      hover: {
        visual,
        baseX: visual.position.x,
        baseY: visual.position.y,
        baseZ: visual.position.z,
        baseRotationX: visual.rotation.x,
        baseRotationZ: visual.rotation.z,
        time: 0,
        moveWobble: { offset: 0.045, tilt: THREE.MathUtils.degToRad(1.4) },
      },
      laser: { muzzle },
      attack: "direct",
    });
  }

  attachBehemoth(
    id: string,
    root: THREE.Group,
    visual: THREE.Object3D,
    options: UnitPresentationOptions,
  ) {
    const launchers = BEHEMOTH_LAUNCH_OFFSETS.map(([x, y, z], index) => {
      const launcher = new THREE.Object3D();
      launcher.name = `Behemoth launcher ${index + 1}`;
      launcher.position.set(x, y, z);
      root.add(launcher);
      return launcher;
    });
    const maps = ["TrackBeltXNegative", "TrackBeltXPositive"].map((name) => {
      const belt = visual.getObjectByName(name);
      if (!(belt instanceof THREE.Mesh) || !(belt.material instanceof THREE.MeshStandardMaterial) || !belt.material.map) {
        throw new Error(`Missing scrollable track material on ${name}`);
      }
      belt.material = belt.material.clone();
      belt.material.map = belt.material.map.clone();
      belt.material.map.wrapS = THREE.RepeatWrapping;
      belt.material.map.needsUpdate = true;
      return belt.material.map;
    });
    this.attachUnit(id, root, options, {
      tracks: {
        maps,
        offset: 0,
        distancePerRepeat: 0.105 * visual.scale.x,
      },
      barrage: { launchers },
      attack: "ground",
    });
  }

  private attachUnit(
    id: string,
    root: THREE.Group,
    options: UnitPresentationOptions,
    behavior: Pick<
      UnitPresentation,
      "mixer" | "actions" | "hover" | "tracks" | "laser" | "barrage" | "attack"
        | "constructionBeam" | "harvesting"
    >,
  ) {
    const visualRoot = new THREE.Group();
    visualRoot.name = `${root.name || id} Terrain Tilt`;
    for (const child of [...root.children]) visualRoot.add(child);
    root.add(visualRoot);
    const unit = this.current.get(id);
    const color = unit?.ownerId === LOCAL_PLAYER_ID ? UI_SELECTION_COLOR : UI_ATTACK_COLOR;
    const selectionRing = createSelectionRing(options.selectionRing, color);
    const healthBar = createHealthBar(
      options.selectionHitbox.offset.y + options.selectionHitbox.height / 2 + 0.3,
      Math.max(1, options.selectionRing.radius * 1.5),
    );
    const selectionHitbox = createSelectionHitbox(options.selectionHitbox);
    const rangeIndicator = unit?.attackRange
      ? createRangeIndicator(unit.attackMinRange ?? 0, unit.attackRange, color)
      : undefined;
    root.add(
      selectionRing,
      healthBar.root,
      selectionHitbox,
      ...(rangeIndicator ? [rangeIndicator] : []),
    );
    root.userData.unitId = id;
    root.userData.selectionCenterY = options.selectionHitbox.offset.y;
    if (unit?.facing !== undefined) root.rotation.y = unit.facing;
    this.selectables.push(root);
    this.presentations.set(id, {
      root,
      visualRoot,
      ...behavior,
      rangeIndicator,
      selectionRing,
      selectionHitbox,
      healthBar,
      state: "idle",
      turnResponsiveness: options.turnResponsiveness,
      terrainAlignment: options.terrainAlignment,
      terrainRadius: options.selectionRing.radius,
    });
    if (unit && unit.ownerId !== LOCAL_PLAYER_ID) this.attackables.push(root);
    if (unit?.health === 0) this.presentUnitDeath(id);
    this.renderUnit(id, 1, 0);
    this.refreshEntityOverlays(id);
  }

  attachBuilding(id: string, root: THREE.Group) {
    const building = this.currentBuildings.get(id);
    if (!building) return;
    root.userData.buildingId = id;
    if (!root.parent) this.world.add(root);
    this.renderBuilding(root, building);
    root.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    const height = Number.isFinite(size.y) && size.y > 0 ? size.y : 2.5;
    const visualRoot = new THREE.Group();
    visualRoot.name = "Building visual";
    for (const child of [...root.children]) visualRoot.add(child);
    root.add(visualRoot);
    const color = building.ownerId === LOCAL_PLAYER_ID ? UI_SELECTION_COLOR : UI_ATTACK_COLOR;
    const selectionRadius = (building.attackRadius ?? building.radius) / POSITION_SCALE;
    const selectionRing = createSelectionRing({
      radius: selectionRadius,
      offset: { x: 0, z: 0 },
    }, color);
    const healthBar = createHealthBar(height + 0.65, Math.max(1.8, selectionRadius * 1.25));
    const selectionHitbox = createSelectionHitbox({
      radius: selectionRadius,
      height,
      offset: { x: 0, y: height / 2, z: 0 },
    });
    const weaponDefinition = BUILDING_DEFINITIONS[building.kind].weapon;
    const weaponRange = building.weapon?.range
      ?? (weaponDefinition ? weaponDefinition.range * POSITION_SCALE : undefined);
    const rangeIndicator = weaponRange
      ? createRangeIndicator(0, weaponRange / POSITION_SCALE, color)
      : undefined;
    if (rangeIndicator) rangeIndicator.name = "Turret attack range";
    const turretHead = building.kind === "turret"
      ? root.getObjectByName("TurretHead")
      : undefined;
    const turretIdleRotation = turretHead?.rotation.y ?? 0;
    // A model may finish loading after the simulation has already aimed and fired.
    // Start at the replicated facing so presentation does not delay shot one into shot two.
    if (turretHead && building.weapon?.targetId && building.weapon.facing !== undefined) {
      turretHead.rotation.y = building.weapon.facing
        - building.rotation + TURRET_HEAD_FORWARD_YAW;
    }
    // The worker's initial frame can arrive before it initializes weapon state.
    // The model owns its barrel tip so rescaling or replacing the gun cannot leave
    // projectiles firing from the old mesh's coordinates. Placeholders use a center flash.
    const muzzle = weaponDefinition
      ? root.getObjectByName("TurretMuzzle") ?? new THREE.Object3D()
      : undefined;
    if (muzzle && !muzzle.parent) {
      muzzle.name = "TurretMuzzle";
      muzzle.position.y = height * 0.72;
      visualRoot.add(muzzle);
    }
    root.add(
      selectionRing,
      healthBar.root,
      selectionHitbox,
      ...(rangeIndicator ? [rangeIndicator] : []),
    );
    root.userData.selectionCenterY = height / 2;
    this.buildingById.set(id, {
      root,
      visualRoot,
      selectionRing,
      selectionHitbox,
      healthBar,
      rangeIndicator,
      muzzle,
      ...(turretHead ? {
        turretHead: {
          object: turretHead,
          idleRotation: turretIdleRotation,
          elapsed: 0,
        },
      } : {}),
    });
    this.selectables.push(root);
    this.renderBuilding(root, building);
    this.updateTurretHead(id, this.buildingById.get(id)!, 0);
    this.refreshEntityOverlays(id);
  }

  select(
    ids: readonly string[] = [],
    mode: "replace" | "add" | "toggle" = "replace",
  ) {
    if (this.result) ids = [];
    const previousIds = new Set(this.selectedIds);
    if (mode === "replace") this.selectedIds.clear();
    for (const id of ids) {
      const resource = this.currentDeposits.has(id) && this.ore.has(id);
      if (!resource && (this.current.get(id)?.health ?? this.currentBuildings.get(id)?.health ?? 0) <= 0) continue;
      if (!resource && !this.presentations.has(id) && !this.buildingById.has(id)) continue;
      if (mode === "toggle" && this.selectedIds.has(id)) this.selectedIds.delete(id);
      else this.selectedIds.add(id);
    }
    const changed = previousIds.size !== this.selectedIds.size
      || [...previousIds].some((id) => !this.selectedIds.has(id));
    if (!changed) return this.selectedIds.size;
    for (const [unitId, presentation] of this.presentations) {
      const selected = this.selectedIds.has(unitId);
      presentation.selectionRing.visible = selected;
    }
    for (const [buildingId, presentation] of this.buildingById) {
      presentation.selectionRing.visible = this.selectedIds.has(buildingId);
    }
    this.ore.update([...this.currentDeposits.values()], this.selectedIds);
    this.refreshSelectionCache();
    this.refreshRangeSelection();
    this.refreshHealthBars();
    return this.selectedIds.size;
  }

  moveSelected(x: number, z: number) {
    const unitIds = this.selectedCommandableUnits().map((unit) => unit.id);
    if (!unitIds.length) return false;
    const accepted = this.submit({
      type: "move",
      unitIds,
      target: toSimPoint(x, z),
    });
    if (!accepted) return false;
    this.feedbackTargetId = undefined;
    this.attackFeedback.visible = false;
    this.attackGroundMarker.visible = false;
    this.groundFeedbackGrace = 0;
    this.marker.show(x, sampleHeight(this.map, x, z), z);
    this.markerTime = 0;
    return true;
  }

  gatherSelected(depositId: string) {
    const deposit = this.currentDeposits.get(depositId);
    if (!deposit) return false;
    const scouts = this.selectedCommandableUnits().filter(unit => unit.kind === "scout-drone");
    if (deposit.amount <= 0 && !scouts.some(unit => unit.cargoTitanium > 0)) return false;
    const unitIds = scouts.map(unit => unit.id);
    if (!unitIds.length || !this.submit({ type: "gather", unitIds, depositId })) return false;
    const x = deposit.position.x / POSITION_SCALE;
    const z = deposit.position.z / POSITION_SCALE;
    this.marker.show(x, sampleHeight(this.map, x, z), z);
    this.markerTime = 0;
    this.feedbackTargetId = undefined;
    this.attackFeedback.visible = false;
    return true;
  }

  selectedDeposits() {
    return [...this.selectedIds].flatMap(id => {
      const deposit = this.currentDeposits.get(id);
      return deposit ? [deposit] : [];
    });
  }

  get titanium() {
    return this.playerTitanium[LOCAL_PLAYER_ID] ?? 0;
  }

  previewConstruction(kind: BuildingKind, x: number, z: number) {
    if (this.result) {
      this.hideConstructionPreview();
      return false;
    }
    const valid = this.constructionPlacementValid(kind, x, z);
    const definition = BUILDING_DEFINITIONS[kind];
    this.constructionPreview.position.set(x, 0, z);
    this.constructionPreview.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        prepareGroundOverlay(child);
        placeGroundGeometry(child.geometry, sampleHeight(this.map, x, z), definition.radius);
      }
    });
    for (const child of this.constructionPreview.children) {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        child.material.color.setHex(valid ? UI_SELECTION_COLOR : UI_ATTACK_COLOR);
      }
    }
    this.constructionPreview.getObjectByName("Blocked placement")!.visible = !valid;
    this.constructionPreview.visible = true;
    return valid;
  }

  hideConstructionPreview() {
    this.constructionPreview.visible = false;
  }

  buildSelected(
    kind: BuildingKind,
    x: number,
    z: number,
    onResolved?: (accepted: boolean) => void,
  ) {
    if (this.result) return false;
    const unitIds = [...this.selectedIds].filter((id) => {
      const unit = this.current.get(id);
      return unit?.ownerId === LOCAL_PLAYER_ID && unit.kind === "scout-drone";
    });
    if (!unitIds.length || !this.constructionPlacementValid(kind, x, z)) return false;
    const submission = this.session.submit({
      type: "build",
      unitIds,
      kind,
      target: toSimPoint(x, z),
      rotation: BUILDING_CATALOG[kind].defaultRotation,
    });
    if (submission.status === "rejected") {
      onResolved?.(false);
      return false;
    }
    this.syncSessionFrame();
    if (submission.status === "accepted") {
      this.hideConstructionPreview();
      onResolved?.(true);
    } else {
      this.pendingCommandResults.set(submission.commandId, (accepted) => {
        if (accepted) this.hideConstructionPreview();
        onResolved?.(accepted);
      });
    }
    return true;
  }

  resumeConstructionSelected(buildingId: string) {
    const building = this.currentBuildings.get(buildingId);
    if (!building || building.ownerId !== LOCAL_PLAYER_ID
      || building.lifecycle !== "constructing") return false;
    const unitIds = [...this.selectedIds].filter((id) => {
      const unit = this.current.get(id);
      return unit?.ownerId === LOCAL_PLAYER_ID && unit.kind === "scout-drone";
    });
    if (!unitIds.length) return false;
    return this.submit({ type: "resume-construction", unitIds, buildingId });
  }

  attackSelected(targetId: string) {
    const attackers = this.selectedCommandableUnits()
      .filter((unit) => this.presentations.get(unit.id)?.attack === "direct")
      .map((unit) => unit.id);
    if (!attackers.length) return false;
    const accepted = this.submit({
      type: "attack",
      unitIds: attackers,
      targetId,
    });
    if (!accepted) return false;
    this.marker.visible = false;
    const target = this.current.get(targetId);
    const building = this.currentBuildings.get(targetId);
    const x = target?.x ?? (building ? building.position.x / POSITION_SCALE : undefined);
    const z = target?.z ?? (building ? building.position.z / POSITION_SCALE : undefined);
    this.feedbackTargetId = targetId;
    this.feedbackAge = 0;
    const radius = target ? target.radius + .35 : building ? building.radius / POSITION_SCALE + .35 : 1;
    if (x !== undefined && z !== undefined) this.attackFeedback.show(x, sampleHeight(this.map, x, z), z, radius);
    return true;
  }

  attackGroundSelected(x: number, z: number) {
    const attackers = this.selectedCommandableUnits()
      .filter((unit) => this.presentations.get(unit.id)?.attack === "ground")
      .map((unit) => unit.id);
    if (!attackers.length) return false;
    const accepted = this.submit({
      type: "attack-ground",
      unitIds: attackers,
      target: toSimPoint(x, z),
    });
    if (!accepted) return false;
    this.marker.visible = false;
    this.attackGroundPreview.visible = false;
    this.feedbackTargetId = undefined;
    this.feedbackAge = 0;
    this.attackFeedback.visible = false;
    this.groundFeedbackGrace = .7;
    this.attackGroundMarker.position.set(x, 0, z);
    placeGroundOverlay(this.attackGroundMarker, this.map, { x, y: 0, z });
    this.attackGroundMarker.visible = true;
    return true;
  }

  previewAttackGround(x: number, z: number) {
    this.attackGroundPreview.position.set(x, 0, z);
    placeGroundOverlay(this.attackGroundPreview, this.map, { x, y: 0, z });
    this.attackGroundPreview.visible = true;
  }

  hideAttackGroundPreview() {
    this.attackGroundPreview.visible = false;
  }

  stopSelected() {
    const unitIds = this.selectedCommandableUnits().map((unit) => unit.id);
    if (!unitIds.length) return false;
    const accepted = this.submit({
      type: "stop",
      unitIds,
    });
    if (!accepted) return false;
    this.marker.visible = false;
    this.attackGroundPreview.visible = false;
    this.attackGroundMarker.visible = false;
    this.groundFeedbackGrace = 0;
    this.feedbackTargetId = undefined;
    this.attackFeedback.visible = false;
    return true;
  }

  selectedUnits() {
    return this.selectedUnitFrames;
  }

  selectedCommandableUnits() {
    return [...this.selectedIds].flatMap((id) => {
      const unit = this.current.get(id);
      return unit && unit.ownerId === LOCAL_PLAYER_ID && unit.health > 0
        ? [{ id, ...unit }] : [];
    });
  }

  selectedGroups() {
    return this.selectedUnitGroups;
  }

  selectedBuildings() {
    return this.selectedBuildingFrames;
  }

  selectedCommandCenter() {
    if (this.selectedIds.size !== 1) return undefined;
    const building = this.selectedBuildingFrames[0];
    return building?.friendly && building.kind === "command-center"
      && building.lifecycle === "active" ? building : undefined;
  }

  trainSelected(kind: UnitKind) {
    const commandCenter = this.selectedCommandCenter();
    if (!commandCenter || !this.canTrainSelected(kind)) return false;
    return this.submit({ type: "train", buildingId: commandCenter.id, kind });
  }

  canTrainSelected(kind: UnitKind) {
    const commandCenter = this.selectedCommandCenter();
    return Boolean(commandCenter && canQueueTraining(
      LOCAL_PLAYER_ID,
      kind,
      commandCenter.productionQueue ?? [],
      this.current.values(),
      this.currentBuildings.values(),
    ));
  }

  cancelTrainingSelected(itemId: string) {
    const commandCenter = this.selectedCommandCenter();
    if (!commandCenter) return false;
    return this.submit({
      type: "cancel-training",
      buildingId: commandCenter.id,
      itemId,
    });
  }

  setRallyPointSelected(x: number, z: number) {
    const commandCenter = this.selectedCommandCenter();
    if (!commandCenter) return false;
    return this.submit({
      type: "set-rally-point",
      buildingId: commandCenter.id,
      target: toSimPoint(x, z),
    });
  }

  canSelectedBuild() {
    return this.selectedUnitFrames.some((unit) => unit.ownerId === LOCAL_PLAYER_ID
      && unit.kind === "scout-drone" && unit.health > 0);
  }

  private constructionPlacementValid(kind: BuildingKind, x: number, z: number) {
    return constructionPlacementIsValid(
      this.map,
      kind,
      toSimPoint(x, z),
      [...this.currentBuildings.values()],
      [...this.current.values()].map((unit) => ({
        position: toSimPoint(unit.x, unit.z),
        radius: Math.round(unit.radius * POSITION_SCALE),
        health: unit.health,
      })),
      [...this.currentDeposits.values()],
    );
  }

  get hudRevision() {
    return this.selectionRevision;
  }

  get matchResult() {
    return this.result;
  }

  get matchOutcome(): MatchOutcome | undefined {
    if (!this.result) return undefined;
    if (!this.result.winnerId) return "draw";
    return this.result.winnerId === LOCAL_PLAYER_ID ? "victory" : "defeat";
  }

  tacticalState() {
    return {
      seconds: this.frameTick * SIMULATION_TICK_SECONDS,
      entities: [
        ...[...this.current].filter(([, unit]) => unit.health > 0).map(([id, unit]) => ({
          x: unit.x, z: unit.z, building: false,
          friendly: unit.ownerId === LOCAL_PLAYER_ID, selected: this.selectedIds.has(id),
        })),
        ...[...this.currentBuildings.values()].filter((building) => building.health > 0).map((building) => ({
          x: building.position.x / POSITION_SCALE, z: building.position.z / POSITION_SCALE,
          building: true, friendly: building.ownerId === LOCAL_PLAYER_ID,
          selected: this.selectedIds.has(building.id),
        })),
      ],
    };
  }

  /** Read-only diagnostics snapshot for verification tooling; gameplay never reads it. */
  inspect() {
    return {
      tick: this.frameTick,
      outcome: this.matchOutcome,
      titanium: this.titanium,
      titaniumDeposits: [...this.currentDeposits.values()].map(deposit => ({
        ...deposit, x: deposit.position.x / POSITION_SCALE, z: deposit.position.z / POSITION_SCALE,
      })),
      units: [...this.current].map(([id, frame]) => ({ id, ...frame })),
      buildings: [...this.currentBuildings.values()].map((building) => ({
        id: building.id,
        kind: building.kind,
        ownerId: building.ownerId,
        lifecycle: building.lifecycle,
        x: building.position.x / POSITION_SCALE,
        z: building.position.z / POSITION_SCALE,
        health: building.health,
        maxHealth: building.maxHealth,
        productionQueue: building.productionQueue
          ? [...building.productionQueue]
          : undefined,
      })),
      selected: {
        unitIds: [...this.selectedIds].filter((id) => this.current.has(id)),
        buildingIds: this.selectedBuildingFrames.map((building) => building.id),
        depositIds: this.selectedDeposits().map(deposit => deposit.id),
      },
    };
  }

  private buildSelectedGroups() {
    const groups = new Map<UnitKind, UnitFrame[]>();
    for (const unit of this.selectedUnitFrames) {
      const group = groups.get(unit.kind);
      if (group) group.push(unit);
      else groups.set(unit.kind, [unit]);
    }
    return [...groups].map(([kind, units]) => ({
      kind,
      ...UNIT_CATALOG[kind],
      count: units.length,
      health: Math.round(units.reduce((total, unit) => total + unit.health, 0) / units.length),
      maxHealth: units[0]!.maxHealth,
      speed: units[0]!.speed,
      attackDamage: units[0]!.attackDamage ?? UNIT_CATALOG[kind].attackDamage,
      attackMinRange: units[0]!.attackMinRange,
      attackRange: units[0]!.attackRange,
      cargoTitanium: units.reduce((total, unit) => total + unit.cargoTitanium, 0),
      cargoCapacity: kind === "scout-drone" ? units.length * SCOUT_TITANIUM_CAPACITY : 0,
    }));
  }

  update(deltaSeconds: number) {
    this.interpolationAge += deltaSeconds;
    this.session.advance(deltaSeconds);
    this.syncSessionFrame();
    this.resolvePendingCommandResults();
    const alpha = Math.min(1, this.interpolationAge / SIMULATION_TICK_SECONDS);
    for (const [id, presentation] of this.presentations) {
      if (!presentation.root.visible) continue;
      this.renderUnit(id, alpha, deltaSeconds);
      presentation.mixer?.update(deltaSeconds);
      this.updateUnitDeath(presentation, deltaSeconds);
    }
    for (const [id, presentation] of this.buildingById) {
      if (presentation.destruction) {
        this.updateBuildingDestruction(id, presentation, deltaSeconds);
      } else {
        this.updateTurretHead(id, presentation, deltaSeconds);
      }
    }
    for (const [id, death] of this.deferredGroundDeaths) {
      if (death.delay === undefined) continue;
      death.delay -= deltaSeconds;
      if (death.delay > 0) continue;
      this.deferredGroundDeaths.delete(id);
      this.presentUnitDeath(id);
    }
    this.updateCombinedRangeGeometry();
    this.updateLaserProjectiles();
    this.updateMuzzleFlashes(deltaSeconds);
    this.behemothBarrage.update(deltaSeconds);

    if (this.marker.visible) {
      this.markerTime += deltaSeconds;
      this.marker.animate(deltaSeconds);
      // Worker acknowledgement can arrive after the first rendered frame.
      if (this.markerTime > .7 && !this.selectedUnits().some((unit) => unit.moving)) this.marker.visible = false;
    }
    this.rallyMarker.animate(deltaSeconds);
    this.feedbackAge += deltaSeconds;
    if (this.feedbackTargetId) {
      const target = this.current.get(this.feedbackTargetId);
      const building = this.currentBuildings.get(this.feedbackTargetId);
      const living = (target?.health ?? building?.health ?? 0) > 0;
      const ordered = this.selectedUnits().some((unit) => unit.attackTargetId === this.feedbackTargetId);
      if (!living || this.feedbackAge > .7 && !ordered) {
        this.attackFeedback.visible = false;
        this.feedbackTargetId = undefined;
      } else if (target) {
        const position = this.presentations.get(this.feedbackTargetId)?.root.position;
        const x = position?.x ?? target.x;
        const z = position?.z ?? target.z;
        this.attackFeedback.place(x, sampleHeight(this.map, x, z), z);
      }
    } else if (this.feedbackAge > .8) {
      this.attackFeedback.visible = false;
    }
    this.attackFeedback.animate(deltaSeconds);
    this.updateGroundAttackIndicator(deltaSeconds);
    this.attackGroundMarker.animate(deltaSeconds);
  }

  private updateGroundAttackIndicator(deltaSeconds: number) {
    if (this.result) {
      this.groundFeedbackGrace = 0;
      this.attackGroundMarker.visible = false;
      return;
    }
    const order = this.selectedCommandableUnits().find((unit) =>
      unit.order === "attack-ground" && unit.attackGroundTarget);
    if (order?.attackGroundTarget) {
      this.groundFeedbackGrace = 0;
      const x = order.attackGroundTarget.x / POSITION_SCALE;
      const z = order.attackGroundTarget.z / POSITION_SCALE;
      if (!this.attackGroundMarker.visible || this.attackGroundMarker.position.x !== x
        || this.attackGroundMarker.position.z !== z) {
        this.attackGroundMarker.position.set(x, 0, z);
        placeGroundOverlay(this.attackGroundMarker, this.map, { x, y: 0, z });
      }
      this.attackGroundMarker.visible = true;
    } else if (this.groundFeedbackGrace > 0) {
      this.groundFeedbackGrace = Math.max(0, this.groundFeedbackGrace - deltaSeconds);
      this.attackGroundMarker.visible = this.groundFeedbackGrace > 0;
    } else {
      this.attackGroundMarker.visible = false;
    }
  }

  dispose() {
    this.disposed = true;
    this.session.dispose?.();
    this.ore.dispose();
    for (const presentation of this.presentations.values()) {
      presentation.mixer?.stopAllAction();
      presentation.harvesting?.dispose();
      disposeEntityOverlays(presentation);
      if (presentation.constructionBeam) {
        presentation.constructionBeam.geometry.dispose();
        presentation.constructionBeam.material.dispose();
        presentation.constructionBeam.removeFromParent();
      }
    }
    for (const presentation of this.buildingById.values()) {
      if (!presentation.destruction) disposeEntityOverlays(presentation);
    }
    for (const projectile of this.laserProjectiles) projectile.mesh.removeFromParent();
    this.laserProjectiles.length = 0;
    for (const flash of this.muzzleFlashes) {
      flash.sprite.removeFromParent();
      flash.sprite.material.dispose();
    }
    this.muzzleFlashes.length = 0;
    for (const light of this.muzzleLights) light.removeFromParent();
    for (const flash of this.muzzleFlashPool) flash.sprite.material.dispose();
    this.muzzleFlashPool.length = 0;
    this.laserPool.length = 0;
    this.laserGeometry.dispose();
    this.laserMaterial.dispose();
    this.glowTexture.dispose();
    for (const material of this.preparedFadeMaterials) material.dispose();
    this.preparedFadeMaterials.clear();
    this.behemothBarrage.dispose();
  }

  private refreshSelectionCache() {
    this.selectedUnitFrames = [...this.selectedIds].flatMap((id) => {
      const unit = this.current.get(id);
      return unit ? [unit] : [];
    });
    this.selectedUnitGroups = this.buildSelectedGroups();
    this.selectedBuildingFrames = [...this.selectedIds].flatMap((id) => {
      const building = this.currentBuildings.get(id);
      return building ? [{
        ...structuredClone(building),
        name: BUILDING_CATALOG[building.kind].name,
        friendly: building.ownerId === LOCAL_PLAYER_ID,
      }] : [];
    });
    this.selectionRevision += 1;
    const commandCenter = this.selectedCommandCenter();
    const rallyPoint = commandCenter?.rallyPoint;
    this.rallyMarker.visible = Boolean(rallyPoint);
    if (rallyPoint) {
      const x = rallyPoint.x / POSITION_SCALE;
      const z = rallyPoint.z / POSITION_SCALE;
      if (this.rallyMarker.position.x !== x || this.rallyMarker.position.z !== z) {
        this.rallyMarker.show(x, sampleHeight(this.map, x, z), z);
      }
    }
  }

  private refreshEntityOverlays(id: string) {
    const unit = this.current.get(id);
    const unitPresentation = this.presentations.get(id);
    if (unit && unitPresentation) {
      updateHealthBar(
        unitPresentation.healthBar,
        unit.health,
        unit.maxHealth,
        this.shouldShowHealth(id, unit.health, unit.maxHealth),
        unit.ownerId === LOCAL_PLAYER_ID,
      );
    }
    const building = this.currentBuildings.get(id);
    const buildingPresentation = this.buildingById.get(id);
    if (building && buildingPresentation) {
      updateHealthBar(
        buildingPresentation.healthBar,
        building.health,
        building.maxHealth,
        this.shouldShowHealth(id, building.health, building.maxHealth),
        building.ownerId === LOCAL_PLAYER_ID,
      );
    }
  }

  private refreshHealthBars() {
    for (const id of this.presentations.keys()) this.refreshEntityOverlays(id);
    for (const id of this.buildingById.keys()) this.refreshEntityOverlays(id);
  }

  private shouldShowHealth(id: string, health: number, maxHealth: number) {
    return this.selectedIds.has(id)
      || health < maxHealth
      || (this.recentCombatUntil.get(id) ?? -1) > this.frameTick;
  }

  private refreshRangeSelection() {
    for (const presentation of this.presentations.values()) {
      if (presentation.rangeIndicator) presentation.rangeIndicator.visible = false;
    }
    for (const presentation of this.buildingById.values()) {
      if (presentation.rangeIndicator) presentation.rangeIndicator.visible = false;
    }
    const rangedBuildings = [...this.selectedIds].flatMap((id) => {
      const building = this.currentBuildings.get(id);
      const presentation = this.buildingById.get(id);
      return building?.lifecycle === "active" && building.weapon
        && presentation?.rangeIndicator ? [presentation] : [];
    });
    if (rangedBuildings.length) {
      for (const presentation of rangedBuildings) presentation.rangeIndicator!.visible = true;
      this.combinedRangeIndicator.visible = false;
      this.selectedRangeIds = [];
      return;
    }
    const ranged = [...this.selectedIds].flatMap((id) => {
      const unit = this.current.get(id);
      const presentation = this.presentations.get(id);
      return unit?.attackRange && presentation ? [{ id, unit, presentation }] : [];
    });
    if (new Set(ranged.map(({ unit }) => `${unit.ownerId}:${unit.kind}`)).size !== 1) {
      this.combinedRangeIndicator.visible = false;
      this.selectedRangeIds = [];
      return;
    }
    if (ranged.length === 1) {
      ranged[0]!.presentation.rangeIndicator!.visible = true;
      this.combinedRangeIndicator.visible = false;
      this.selectedRangeIds = [];
      return;
    }

    const unit = ranged[0]!.unit;
    const ranges = [unit.attackMinRange, unit.attackRange]
      .filter((range): range is number => Boolean(range));
    const key = `${unit.ownerId}:${unit.kind}:${ranges.join(",")}`;
    if (key !== this.combinedRangeKey) {
      for (const child of [...this.combinedRangeIndicator.children]) {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      }
      this.combinedRangeIndicator.clear();
      for (const range of ranges) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), createRangeMaterial(unit.ownerId === LOCAL_PLAYER_ID ? UI_SELECTION_COLOR : UI_ATTACK_COLOR));
        mesh.frustumCulled = false;
        prepareGroundOverlay(mesh);
        mesh.userData.range = range;
        this.combinedRangeIndicator.add(mesh);
      }
      this.combinedRangeKey = key;
    }
    this.selectedRangeIds = ranged.map(({ id }) => id);
    this.combinedRangePositions = [];
    this.combinedRangeIndicator.visible = true;
    this.updateCombinedRangeGeometry(true);
  }

  private updateCombinedRangeGeometry(force = false) {
    if (!this.combinedRangeIndicator.visible) return;
    const centers = this.selectedRangeIds.flatMap((id) => {
      const position = this.presentations.get(id)?.root.position;
      return position ? [position] : [];
    });
    const moved = force || centers.length !== this.combinedRangePositions.length
      || centers.some((center, index) => {
        const previous = this.combinedRangePositions[index];
        return !previous || Math.hypot(center.x - previous.x, center.z - previous.z) >= 0.01;
      });
    if (!moved) return;
    for (const child of this.combinedRangeIndicator.children) {
      if (child instanceof THREE.Mesh) {
        updateUnionRange(child, centers, child.userData.range as number, this.map);
      }
    }
    this.combinedRangePositions = centers.map(({ x, z }) => ({ x, z }));
  }

  private submit(command: PlayerCommand) {
    if (this.result) return false;
    const result = this.session.submit(command);
    if (result.status === "rejected") return false;
    this.syncSessionFrame();
    return true;
  }

  private resolvePendingCommandResults() {
    if (!this.session.commandResult) return;
    for (const [commandId, resolve] of this.pendingCommandResults) {
      const result = this.session.commandResult(commandId);
      if (!result) continue;
      this.pendingCommandResults.delete(commandId);
      resolve(result.accepted);
    }
  }

  private syncSessionFrame() {
    let synced = false;
    for (let frame = this.session.readFrame(this.frameVersion); frame;
      frame = this.session.readFrame(this.frameVersion)) {
      const advancePrevious = frame.tick > this.frameTick;
      if (advancePrevious) this.interpolationAge = 0;
      this.frameVersion = frame.version;
      this.frameTick = frame.tick;
      this.applyFrame(frame, advancePrevious);
      for (const event of frame.events) this.presentEvent(event);
      this.refreshHealthBars();
      synced = true;
    }
    return synced;
  }

  private applyFrame(frame: MatchFrame, advancePrevious: boolean) {
    const matchResolved = Boolean(frame.matchResult && !this.result);
    if (frame.matchResult) this.result = structuredClone(frame.matchResult);
    let selectionChanged = false;
    let rangeChanged = false;
    if (frame.playerTitanium) this.playerTitanium = frame.playerTitanium;
    if (frame.titaniumDeposits) {
      for (const deposit of frame.titaniumDeposits) {
        selectionChanged ||= this.selectedIds.has(deposit.id)
          && this.currentDeposits.get(deposit.id)?.amount !== deposit.amount;
        this.currentDeposits.set(deposit.id, deposit);
      }
      this.ore.update([...this.currentDeposits.values()], this.selectedIds);
    }
    const unitDeaths = new Map(frame.events.flatMap((event) =>
      event.type === "unit-died" ? [[event.id, event.attackerId] as const] : []
    ));
    const buildingDeaths = new Set(frame.events.flatMap((event) =>
      event.type === "building-died" ? [event.id] : []
    ));
    const visibleIds = new Set(frame.units.map((unit) => unit.id));
    const hiddenIds = frame.full
      ? [...this.current.keys()].filter((id) => !visibleIds.has(id))
      : frame.removedUnitIds ?? [];
    for (const id of hiddenIds) {
      const wasSelected = this.selectedIds.delete(id);
      selectionChanged ||= wasSelected;
      rangeChanged ||= wasSelected;
      this.current.delete(id);
      this.previous.delete(id);
      this.pendingDirectShots.delete(id);
      this.pendingGroundShots.delete(id);
      this.recentCombatUntil.delete(id);
      this.setUnitVisible(id, false);
    }
    for (const unit of frame.units) {
      const next = toFrame(unit);
      const current = this.current.get(unit.id);
      if (this.selectedIds.has(unit.id)) {
        selectionChanged = true;
        rangeChanged ||= current?.kind !== next.kind
          || current?.attackMinRange !== next.attackMinRange
          || current?.attackRange !== next.attackRange;
      }
      if (advancePrevious || !current) this.previous.set(unit.id, current ?? next);
      this.current.set(unit.id, next);
      if (unit.health > 0 && !this.presentations.has(unit.id)) this.ensureUnitPresentation(unit);
      if (!unit.attacking) {
        this.pendingDirectShots.delete(unit.id);
        this.pendingGroundShots.delete(unit.id);
      }
      if (unit.health <= 0) {
        // Corpse animation keeps the model visible, never its living-unit overlays.
        const presentation = this.presentations.get(unit.id);
        if (presentation) {
          presentation.selectionRing.visible = false;
          presentation.healthBar.root.visible = false;
          if (presentation.rangeIndicator) presentation.rangeIndicator.visible = false;
        }
        const wasSelected = this.selectedIds.delete(unit.id);
        selectionChanged ||= wasSelected;
        rangeChanged ||= wasSelected;
        this.pendingDirectShots.delete(unit.id);
        this.pendingGroundShots.delete(unit.id);
        this.recentCombatUntil.delete(unit.id);
        const attackerId = unitDeaths.get(unit.id);
        if (attackerId && (this.pendingGroundShots.has(attackerId)
          || this.groundShotsInFlight.has(attackerId))) {
          this.deferGroundDeath(unit.id, attackerId);
        } else if (!this.deferredGroundDeaths.has(unit.id)) {
          this.presentUnitDeath(unit.id);
        }
      } else {
        this.setUnitVisible(unit.id, true);
      }
    }
    if (frame.full) {
      const buildingIds = new Set(frame.buildings.map((building) => building.id));
      for (const id of this.currentBuildings.keys()) {
        if (!buildingIds.has(id)) {
          selectionChanged ||= this.removeBuildingPresentation(id, buildingDeaths.has(id));
        }
      }
    }
    for (const id of frame.removedBuildingIds ?? []) {
      selectionChanged ||= this.removeBuildingPresentation(id, buildingDeaths.has(id));
    }
    for (const building of frame.buildings) {
      if (this.selectedIds.has(building.id)) {
        selectionChanged = true;
        rangeChanged ||= this.currentBuildings.get(building.id)?.weapon?.range
          !== building.weapon?.range
          || this.currentBuildings.get(building.id)?.lifecycle !== building.lifecycle;
      }
      this.currentBuildings.set(building.id, structuredClone(building));
      const presentation = this.buildingById.get(building.id);
      if (presentation) this.renderBuilding(presentation.root, building);
      else this.ensureBuildingPresentation(building);
    }
    if (selectionChanged) this.refreshSelectionCache();
    if (rangeChanged) this.refreshRangeSelection();
    if (matchResolved) {
      this.select();
      this.marker.visible = false;
      this.rallyMarker.visible = false;
      this.attackFeedback.visible = false;
      this.attackGroundPreview.visible = false;
      this.attackGroundMarker.visible = false;
      this.constructionPreview.visible = false;
      for (const resolve of this.pendingCommandResults.values()) resolve(false);
      this.pendingCommandResults.clear();
    }
  }

  private presentEvent(event: SimulationEvent) {
    if (event.type === "weapon-fired") {
      this.markRecentCombat(event.attackerId, event.tick);
      if (event.attack === "direct") this.markRecentCombat(event.targetId, event.tick);
    }
    if (event.type === "damage") {
      this.markRecentCombat(event.attackerId, event.tick);
      this.markRecentCombat(event.targetId, event.tick);
    }
    if (event.type === "weapon-fired" && event.attack === "direct"
      && (this.current.get(event.attackerId)?.kind === "hornet"
        || this.presentations.get(event.attackerId)?.laser
        || this.currentBuildings.get(event.attackerId)?.kind === "turret")) {
      if (event.impactTick <= this.frameTick) return;
      this.pendingDirectShots.set(event.attackerId, {
        targetId: event.targetId,
        targetX: event.target.x / POSITION_SCALE,
        targetZ: event.target.z / POSITION_SCALE,
        launchTick: event.tick,
        impactTick: event.impactTick,
      });
    }
    if (event.type === "weapon-fired" && event.attack === "ground"
      && (this.current.get(event.attackerId)?.kind === "behemoth"
        || this.presentations.get(event.attackerId)?.barrage)) {
      this.pendingGroundShots.set(event.attackerId, {
        targetX: event.target.x / POSITION_SCALE,
        targetZ: event.target.z / POSITION_SCALE,
        seed: behemothVolleySeed(event.attackerId, event.tick),
      });
    }
  }

  private markRecentCombat(id: string, tick: number) {
    const living = (this.current.get(id)?.health ?? this.currentBuildings.get(id)?.health ?? 0) > 0;
    if (living) this.recentCombatUntil.set(id, tick + RECENT_COMBAT_TICKS);
  }

  private ensureUnitPresentation(unit: UnitState) {
    if (!this.createUnitPresentation || this.pendingUnits.has(unit.id)) return;
    let created: ReturnType<UnitPresentationFactory>;
    try {
      created = this.createUnitPresentation(structuredClone(unit));
    } catch {
      this.attachUnitFallback(unit.id);
      return;
    }
    const pending = Promise.resolve(created);
    this.pendingUnits.set(unit.id, pending);
    void pending.then(
      (loaded) => {
        this.pendingUnits.delete(unit.id);
        if (this.disposed || !this.current.has(unit.id)) {
          loaded.root.removeFromParent();
          return;
        }
        try {
          this.attachLoadedUnit(unit.id, loaded);
        } catch {
          loaded.root.removeFromParent();
          this.attachUnitFallback(unit.id);
        }
      },
      () => {
        this.pendingUnits.delete(unit.id);
        this.attachUnitFallback(unit.id);
      },
    );
  }

  private attachLoadedUnit(id: string, loaded: LoadedUnitPresentation) {
    loaded.root.name ||= `${this.current.get(id)?.kind ?? "Unit"} model`;
    if (!loaded.root.parent) this.world.add(loaded.root);
    const kind = this.current.get(id)?.kind;
    if (!kind) throw new Error(`Missing authoritative unit ${id}`);
    const attach = {
      ghostrunner: () => this.attachGhostrunner(
        id,
        loaded.root,
        [...loaded.animations],
        loaded.options,
      ),
      "scout-drone": () => this.attachScoutDrone(id, loaded.root, loaded.visual, loaded.options),
      hornet: () => this.attachHornet(id, loaded.root, loaded.visual, loaded.options),
      behemoth: () => this.attachBehemoth(id, loaded.root, loaded.visual, loaded.options),
    } satisfies Record<UnitKind, () => void>;
    attach[kind]();
  }

  private attachUnitFallback(id: string) {
    const unit = this.current.get(id);
    if (this.disposed || !unit || this.presentations.has(id)) return;
    const root = new THREE.Group();
    root.name = "Unit fallback";
    const visual = new THREE.Mesh(
      new THREE.CapsuleGeometry(Math.max(0.2, unit.radius * 0.45), Math.max(0.3, unit.radius), 4, 8),
      new THREE.MeshBasicMaterial({
        color: unit.ownerId === LOCAL_PLAYER_ID ? UI_SELECTION_COLOR : UI_ATTACK_COLOR,
        opacity: 0.55,
        transparent: true,
      }),
    );
    visual.position.y = Math.max(0.4, unit.radius);
    root.add(visual);
    this.world.add(root);
    this.attachUnit(id, root, {
      terrainAlignment: 0,
      turnResponsiveness: 12,
      selectionRing: { radius: unit.radius, offset: { x: 0, z: 0 } },
      selectionHitbox: {
        radius: unit.radius,
        height: Math.max(0.8, unit.radius * 2),
        offset: { x: 0, y: Math.max(0.4, unit.radius), z: 0 },
      },
    }, { attack: UNIT_CATALOG[unit.kind].attack });
  }

  private ensureBuildingPresentation(building: BuildingState) {
    if (!this.createBuildingPresentation || this.pendingBuildings.has(building.id)) return;
    let created: ReturnType<BuildingPresentationFactory>;
    try {
      created = this.createBuildingPresentation(structuredClone(building));
    } catch {
      this.attachBuildingFallback(building.id);
      return;
    }
    if (created instanceof THREE.Group) {
      this.attachBuilding(building.id, created);
      return;
    }
    const pending = Promise.resolve(created);
    this.pendingBuildings.set(building.id, pending);
    void pending.then(
      (root) => {
        this.pendingBuildings.delete(building.id);
        if (this.disposed || !this.currentBuildings.has(building.id)) {
          disposeModel(root);
          return;
        }
        this.attachBuilding(building.id, root);
      },
      () => {
        this.pendingBuildings.delete(building.id);
        this.attachBuildingFallback(building.id);
      },
    );
  }

  private attachBuildingFallback(id: string) {
    const building = this.currentBuildings.get(id);
    if (this.disposed || !building || this.buildingById.has(id)) return;
    const fallback = new THREE.Group();
    fallback.name = "Building fallback";
    const radius = building.radius / POSITION_SCALE;
    const height = building.kind === "command-center" ? 2.5 : 1.5;
    const placeholder = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 8),
      new THREE.MeshBasicMaterial({
        color: building.ownerId === LOCAL_PLAYER_ID ? UI_SELECTION_COLOR : UI_ATTACK_COLOR,
        opacity: 0.45,
        transparent: true,
      }),
    );
    placeholder.name = "Building fallback footprint";
    placeholder.position.y = height / 2;
    fallback.add(placeholder);
    this.attachBuilding(id, fallback);
  }

  private renderBuilding(root: THREE.Object3D, building: BuildingState) {
    root.userData.buildingId = building.id;
    root.userData.buildingKind = building.kind;
    root.userData.ownerId = building.ownerId;
    root.userData.lifecycle = building.lifecycle;
    root.position.set(
      building.position.x / POSITION_SCALE,
      sampleHeight(
        this.map,
        building.position.x / POSITION_SCALE,
        building.position.z / POSITION_SCALE,
      ),
      building.position.z / POSITION_SCALE,
    );
    root.rotation.y = building.rotation;
    root.visible = building.health > 0;
    const presentation = this.buildingById.get(building.id);
    if (presentation) {
      presentation.visualRoot.scale.y = building.lifecycle === "active"
        ? 1
        : 0.15 + building.constructionProgress * 0.85;
      placeGroundGeometry(presentation.selectionRing.geometry, 0);
      if (presentation.rangeIndicator) {
        placeGroundOverlay(
          presentation.rangeIndicator,
          this.map,
          root.position,
        );
      }
    }
    const attackableIndex = this.attackables.indexOf(root);
    const attackable = root.visible && building.ownerId !== LOCAL_PLAYER_ID;
    if (attackable && attackableIndex < 0) this.attackables.push(root);
    if (!attackable && attackableIndex >= 0) this.attackables.splice(attackableIndex, 1);
  }

  /** Animates every render frame; the simulation independently gates the authoritative shot. */
  private updateTurretHead(
    id: string,
    presentation: BuildingPresentation,
    deltaSeconds: number,
  ) {
    const turret = presentation.turretHead;
    const building = this.currentBuildings.get(id);
    if (!building || building.lifecycle !== "active" || building.health <= 0) return;
    if (!turret) {
      this.fireBuildingLaser(id);
      return;
    }

    let pendingShot = this.pendingDirectShots.get(id);
    if (pendingShot && pendingShot.impactTick <= this.frameTick) {
      this.pendingDirectShots.delete(id);
      pendingShot = undefined;
    }
    const targetId = pendingShot?.targetId ?? building.weapon?.targetId;
    const unitTarget = targetId ? this.current.get(targetId) : undefined;
    const targetX = pendingShot?.targetX ?? unitTarget?.x;
    const targetZ = pendingShot?.targetZ ?? unitTarget?.z;
    if (targetX !== undefined && targetZ !== undefined && turret.object.parent) {
      turret.object.getWorldPosition(this.turretOrigin);
      this.turretTarget.set(targetX, this.turretOrigin.y, targetZ);
      turret.object.parent.worldToLocal(this.turretTarget);
      const desired = Math.atan2(
        this.turretTarget.x - turret.object.position.x,
        this.turretTarget.z - turret.object.position.z,
      ) + TURRET_HEAD_FORWARD_YAW;
      const difference = Math.atan2(
        Math.sin(desired - turret.object.rotation.y),
        Math.cos(desired - turret.object.rotation.y),
      );
      turret.object.rotation.y += difference
        * (1 - Math.exp(-deltaSeconds * TURRET_TURN_RESPONSIVENESS));
      const remainingTurn = Math.atan2(
        Math.sin(desired - turret.object.rotation.y),
        Math.cos(desired - turret.object.rotation.y),
      );
      if (pendingShot && Math.abs(remainingTurn) <= ATTACK_FACING_TOLERANCE) {
        this.fireBuildingLaser(id);
      }
      return;
    }

    const weaponFacing = building.weapon?.facing;
    if (weaponFacing !== undefined && building.weapon?.targetId) {
      const desired = weaponFacing - building.rotation + TURRET_HEAD_FORWARD_YAW;
      const difference = Math.atan2(
        Math.sin(desired - turret.object.rotation.y),
        Math.cos(desired - turret.object.rotation.y),
      );
      turret.object.rotation.y += difference
        * (1 - Math.exp(-deltaSeconds * TURRET_TURN_RESPONSIVENESS));
      return;
    }

    this.updateIdleTurretSweep(turret, deltaSeconds);
  }

  private updateIdleTurretSweep(
    turret: NonNullable<BuildingPresentation["turretHead"]>,
    deltaSeconds: number,
  ) {
    turret.elapsed += deltaSeconds;
    const desired = turret.idleRotation
      + Math.sin(turret.elapsed * TURRET_IDLE_SWEEP_SPEED) * TURRET_IDLE_SWEEP_ANGLE;
    const difference = Math.atan2(
      Math.sin(desired - turret.object.rotation.y),
      Math.cos(desired - turret.object.rotation.y),
    );
    turret.object.rotation.y += difference
      * (1 - Math.exp(-deltaSeconds * TURRET_IDLE_TURN_RESPONSIVENESS));
  }

  private removeBuildingPresentation(id: string, animate = false) {
    this.currentBuildings.delete(id);
    this.pendingDirectShots.delete(id);
    this.recentCombatUntil.delete(id);
    const wasSelected = this.selectedIds.delete(id);
    const presentation = this.buildingById.get(id);
    if (!presentation) return wasSelected;
    const { root } = presentation;
    const attackableIndex = this.attackables.indexOf(root);
    if (attackableIndex >= 0) this.attackables.splice(attackableIndex, 1);
    const selectableIndex = this.selectables.indexOf(root);
    if (selectableIndex >= 0) this.selectables.splice(selectableIndex, 1);
    if (animate) {
      disposeEntityOverlays(presentation);
      presentation.selectionRing.visible = false;
      presentation.healthBar.root.visible = false;
      if (presentation.rangeIndicator) presentation.rangeIndicator.visible = false;
      const materials = new Set<THREE.Material>();
      presentation.visualRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Sprite)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
        }
      });
      presentation.destruction = {
        elapsed: 0,
        initialScaleY: presentation.visualRoot.scale.y,
        materials: [...materials].map((material) => {
          const opacity = material.opacity;
          material.transparent = true;
          material.depthWrite = false;
          return { material, opacity };
        }),
      };
      return wasSelected;
    }
    disposeEntityOverlays(presentation);
    disposeModel(presentation.visualRoot);
    root.removeFromParent();
    this.buildingById.delete(id);
    return wasSelected;
  }

  private updateBuildingDestruction(
    id: string,
    presentation: BuildingPresentation,
    deltaSeconds: number,
  ) {
    const destruction = presentation.destruction;
    if (!destruction) return;
    destruction.elapsed += deltaSeconds;
    const progress = Math.min(1, destruction.elapsed / BUILDING_DESTRUCTION_SECONDS);
    presentation.visualRoot.scale.y = destruction.initialScaleY * (1 - progress * 0.85);
    for (const entry of destruction.materials) {
      entry.material.opacity = entry.opacity * (1 - progress);
    }
    if (progress < 1) return;
    disposeModel(presentation.visualRoot);
    presentation.root.removeFromParent();
    this.buildingById.delete(id);
  }

  private setUnitVisible(id: string, visible: boolean) {
    const presentation = this.presentations.get(id);
    if (!presentation) return;
    presentation.root.visible = visible;
    if (!visible && presentation.constructionBeam) presentation.constructionBeam.visible = false;
    if (!visible) presentation.harvesting?.hide();
    const frame = this.current.get(id);
    if (frame?.ownerId === LOCAL_PLAYER_ID) return;
    const index = this.attackables.indexOf(presentation.root);
    if (visible && index < 0) this.attackables.push(presentation.root);
    if (!visible && index >= 0) this.attackables.splice(index, 1);
  }

  private presentUnitDeath(id: string) {
    const presentation = this.presentations.get(id);
    if (!presentation) return;
    if (presentation.state === "death") return;
    this.setUnitVisible(id, false);
    const selectableIndex = this.selectables.indexOf(presentation.root);
    if (selectableIndex >= 0) this.selectables.splice(selectableIndex, 1);
    const actions = presentation.actions;
    const death = actions?.death;
    if (!actions || !death) return;
    const old = actions[presentation.state];
    old.fadeOut(0.1);
    death.reset().fadeIn(0.1).play();
    presentation.state = "death";
    const fadeStart = death.getClip().duration / DEATH_ANIMATION_TIME_SCALE
      + CORPSE_LINGER_SECONDS;
    presentation.death = {
      elapsed: 0,
      fadeStart,
      hideAt: fadeStart + CORPSE_FADE_SECONDS,
      materials: this.prepareCorpseMaterials(presentation),
    };
    presentation.root.visible = true;
  }

  private deferGroundDeath(id: string, attackerId: string) {
    if (this.deferredGroundDeaths.has(id)) return;
    const presentation = this.presentations.get(id);
    if (!presentation) return;
    this.setUnitVisible(id, false);
    const selectableIndex = this.selectables.indexOf(presentation.root);
    if (selectableIndex >= 0) this.selectables.splice(selectableIndex, 1);
    presentation.root.visible = true;
    this.deferredGroundDeaths.set(id, { attackerId });
  }

  private presentGroundImpact(attackerId: string) {
    this.groundShotsInFlight.delete(attackerId);
    for (const death of this.deferredGroundDeaths.values()) {
      if (death.attackerId === attackerId && death.delay === undefined) {
        death.delay = BEHEMOTH_DAMAGE_DELAY_SECONDS;
      }
    }
  }

  private updateUnitDeath(presentation: UnitPresentation, deltaSeconds: number) {
    const death = presentation.death;
    if (!death) return;
    death.elapsed += deltaSeconds;
    if (death.elapsed < death.fadeStart) return;
    const opacity = Math.max(0, 1 - (death.elapsed - death.fadeStart) / CORPSE_FADE_SECONDS);
    for (const entry of death.materials ?? []) entry.material.opacity = entry.opacity * opacity;
    if (death.elapsed < death.hideAt) return;
    presentation.root.visible = false;
    for (const entry of death.materials ?? []) entry.material.dispose();
    presentation.death = undefined;
  }

  private prepareCorpseMaterials(presentation: UnitPresentation) {
    const clones = new Map<THREE.Material, THREE.Material>();
    presentation.visualRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const clone = (material: THREE.Material) => {
        let copy = clones.get(material);
        if (!copy) {
          copy = material.clone();
          copy.transparent = true;
          copy.depthWrite = false;
          copy.opacity *= CORPSE_START_OPACITY;
          clones.set(material, copy);
        }
        return copy;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(clone)
        : clone(object.material);
    });
    return [...clones.values()].map((material) => ({
      material,
      opacity: material.opacity,
    }));
  }

  private renderUnit(id: string, alpha: number, deltaSeconds: number) {
    const presentation = this.presentations.get(id);
    const current = this.current.get(id);
    const previous = this.previous.get(id) ?? current;
    if (!presentation || !current || !previous) return;

    const x = THREE.MathUtils.lerp(previous.x, current.x, alpha);
    const z = THREE.MathUtils.lerp(previous.z, current.z, alpha);
    let pendingDirectShot = this.pendingDirectShots.get(id);
    if (pendingDirectShot && pendingDirectShot.impactTick <= this.frameTick) {
      this.pendingDirectShots.delete(id);
      pendingDirectShot = undefined;
    }
    const pendingGroundShot = this.pendingGroundShots.get(id);
    const pendingShot = pendingDirectShot ?? pendingGroundShot;
    const turningToAttack = current.attacking || pendingShot !== undefined;
    const miningDeposit = current.harvest?.phase === "extracting"
      ? this.currentDeposits.get(current.harvest.depositId) : undefined;
    let facingTarget = !turningToAttack;
    if (current.moving || turningToAttack || miningDeposit) {
      const targetX = miningDeposit ? miningDeposit.position.x / POSITION_SCALE : pendingShot?.targetX ?? current.targetX;
      const targetZ = miningDeposit ? miningDeposit.position.z / POSITION_SCALE : pendingShot?.targetZ ?? current.targetZ;
      const desired = Math.atan2(targetX - x, targetZ - z);
      const difference = Math.atan2(
        Math.sin(desired - presentation.root.rotation.y),
        Math.cos(desired - presentation.root.rotation.y),
      );
      presentation.root.rotation.y += difference
        * (1 - Math.exp(-deltaSeconds * presentation.turnResponsiveness));
      const remainingTurn = Math.atan2(
        Math.sin(desired - presentation.root.rotation.y),
        Math.cos(desired - presentation.root.rotation.y),
      );
      facingTarget = Math.abs(remainingTurn) <= ATTACK_FACING_TOLERANCE;
    }
    if (!presentation.ground || presentation.ground.x !== x || presentation.ground.z !== z) {
      presentation.ground = {
        x,
        z,
        y: sampleHeight(this.map, x, z),
        normal: sampleTerrainNormal(
          this.map,
          x,
          z,
          presentation.terrainRadius,
          presentation.terrainAlignment,
        ).clone(),
      };
    }
    const { y, normal } = presentation.ground;
    presentation.root.position.set(x, y, z);
    if (miningDeposit) {
      const contact = presentation.miningContact;
      if (!contact || contact.depositId !== miningDeposit.id || contact.x !== x || contact.z !== z) {
        const point = this.ore.workface(miningDeposit.id, new THREE.Vector3(x, y + 0.95, z));
        presentation.miningContact = point ? { depositId: miningDeposit.id, x, z, point } : undefined;
      }
    } else presentation.miningContact = undefined;
    presentation.harvesting?.update(current.health > 0 ? current.cargoTitanium : 0, current.health > 0 && Boolean(miningDeposit),
      x, y, z, presentation.miningContact?.point, deltaSeconds);
    const constructionSite = current.constructionTargetId
      ? this.currentBuildings.get(current.constructionTargetId)
      : undefined;
    if (presentation.constructionBeam) {
      const beam = presentation.constructionBeam;
      beam.visible = current.order === "build" && !current.moving
        && constructionSite?.lifecycle === "constructing";
      if (beam.visible && constructionSite) {
        const positions = beam.geometry.getAttribute("position");
        const siteX = constructionSite.position.x / POSITION_SCALE;
        const siteZ = constructionSite.position.z / POSITION_SCALE;
        positions.setXYZ(0, x, y + 1.05, z);
        positions.setXYZ(1, siteX, sampleHeight(this.map, siteX, siteZ) + 0.8, siteZ);
        positions.needsUpdate = true;
      }
    }
    localTerrainNormal.copy(normal).applyAxisAngle(WORLD_UP, -presentation.root.rotation.y);
    targetTilt.setFromUnitVectors(WORLD_UP, localTerrainNormal);
    presentation.visualRoot.quaternion.slerp(
      targetTilt,
      deltaSeconds > 0
        ? 1 - Math.exp(-deltaSeconds * TERRAIN_TILT_RESPONSIVENESS)
        : 1,
    );
    if (presentation.selectionRing.visible) {
      const rotation = presentation.root.rotation.y;
      const previous = presentation.selectionGround;
      if (!previous || previous.x !== x || previous.z !== z || previous.rotation !== rotation) {
        placeGroundGeometry(presentation.selectionRing.geometry, 0);
        presentation.selectionGround = { x, z, rotation };
      }
    }
    if (presentation.rangeIndicator?.visible) {
      presentation.rangeIndicator.rotation.y = -presentation.root.rotation.y;
      const previous = presentation.rangeGround;
      if (!previous || previous.x !== x || previous.z !== z) {
        placeGroundOverlay(
          presentation.rangeIndicator,
          this.map,
          { x, y, z },
        );
        presentation.rangeGround = { x, z };
      }
    }
    if (presentation.hover) {
      const hover = presentation.hover;
      hover.time += deltaSeconds;
      hover.visual.position.y = hover.baseY + Math.sin(hover.time * 3.2) * 0.07;
      const wobble = current.moving ? hover.moveWobble : undefined;
      const offset = wobble?.offset ?? 0;
      const tilt = wobble?.tilt ?? 0;
      hover.visual.position.x = THREE.MathUtils.damp(
        hover.visual.position.x,
        hover.baseX + Math.sin(hover.time * 2.7) * offset,
        8,
        deltaSeconds,
      );
      hover.visual.position.z = THREE.MathUtils.damp(
        hover.visual.position.z,
        hover.baseZ + Math.sin(hover.time * 2.1 + 1.4) * offset * 0.45,
        8,
        deltaSeconds,
      );
      hover.visual.rotation.x = THREE.MathUtils.damp(
        hover.visual.rotation.x,
        hover.baseRotationX + Math.sin(hover.time * 2.1 + 1.4) * tilt * 0.5,
        8,
        deltaSeconds,
      );
      hover.visual.rotation.z = THREE.MathUtils.damp(
        hover.visual.rotation.z,
        hover.baseRotationZ + Math.sin(hover.time * 2.7) * tilt,
        8,
        deltaSeconds,
      );
    }
    if (presentation.tracks) {
      const tracks = presentation.tracks;
      if (current.moving && tracks.lastX !== undefined && tracks.lastZ !== undefined) {
        const distance = Math.hypot(x - tracks.lastX, z - tracks.lastZ);
        tracks.offset = (
          tracks.offset + distance / tracks.distancePerRepeat * BEHEMOTH_TRACK_SCROLL_SCALE
        ) % 1;
        for (const map of tracks.maps) map.offset.x = tracks.offset;
      }
      tracks.lastX = x;
      tracks.lastZ = z;
    }
    if (current.health <= 0) return;
    const state = turningToAttack && facingTarget ? "attack" : current.moving ? "move" : "idle";
    if (presentation.state !== state) {
      if (presentation.actions) {
        const next = presentation.actions[state];
        const old = presentation.actions[presentation.state] ?? presentation.actions.idle;
        next.reset().fadeIn(0.16).play();
        old.fadeOut(0.16);
      }
      presentation.state = state;
    }
    if (pendingDirectShot && facingTarget
      && this.fireLaser(presentation, pendingDirectShot)) {
      this.pendingDirectShots.delete(id);
    }
    if (pendingGroundShot && facingTarget && presentation.barrage) {
      for (let index = 0; index < presentation.barrage.launchers.length; index += 1) {
        presentation.barrage.launchers[index]!.getWorldPosition(this.behemothLaunchPoints[index]!);
      }
      if (this.behemothBarrage.fire(
        this.behemothLaunchPoints,
        pendingGroundShot.targetX,
        pendingGroundShot.targetZ,
        pendingGroundShot.seed,
        Math.hypot(
          pendingGroundShot.targetX - current.x,
          pendingGroundShot.targetZ - current.z,
        ),
        () => this.presentGroundImpact(id),
      )) {
        this.groundShotsInFlight.add(id);
        this.pendingGroundShots.delete(id);
      }
    }
  }

  private fireLaser(presentation: UnitPresentation, shot: PendingDirectShot) {
    if (!presentation.laser) return false;
    return this.fireLaserFrom(
      presentation.laser.muzzle,
      shot.targetId,
      "Hornet projectile",
      { x: shot.targetX, z: shot.targetZ },
      shot.launchTick,
      shot.impactTick,
    );
  }

  private fireBuildingLaser(id: string) {
    const shot = this.pendingDirectShots.get(id);
    const muzzle = this.buildingById.get(id)?.muzzle;
    if (!shot || !muzzle) return false;
    // Replaying a delayed launch shortens the visible gap before the next
    // authoritative shot and looks like a startup double-fire.
    if (shot.launchTick < this.frameTick) {
      this.pendingDirectShots.delete(id);
      return false;
    }
    if (!this.fireLaserFrom(
      muzzle,
      shot.targetId,
      "Turret projectile",
      { x: shot.targetX, z: shot.targetZ },
      shot.launchTick,
      shot.impactTick,
      { radius: 1, length: 1.35 },
      1.35,
    )) {
      return false;
    }
    this.pendingDirectShots.delete(id);
    return true;
  }

  private fireLaserFrom(
    muzzle: THREE.Object3D,
    targetId: string | undefined,
    name: string,
    fixedTarget: { x: number; z: number },
    launchTick: number,
    impactTick: number,
    scale = { radius: 1, length: 1 },
    muzzleScale = 1,
  ) {
    const target = targetId
      ? this.buildingById.get(targetId)?.root ?? this.presentations.get(targetId)?.root
      : undefined;

    const start = muzzle.getWorldPosition(this.laserStart);
    this.flashMuzzle(start, muzzleScale);
    const end = target
      ? this.targetBounds.setFromObject(target).getCenter(this.laserEnd)
      : this.laserEnd.copy(start);
    end.set(fixedTarget.x, end.y, fixedTarget.z);
    const projectile: LaserProjectile = this.laserPool.pop() ?? (() => {
      const mesh = new THREE.Mesh(this.laserGeometry, this.laserMaterial);
      mesh.name = name;
      return {
        mesh,
        start: new THREE.Vector3(),
        end: new THREE.Vector3(),
        launchTick: 0,
        impactTick: 0,
      };
    })();
    const { mesh } = projectile;
    mesh.name = name;
    mesh.scale.set(scale.radius, scale.length, scale.radius);
    mesh.position.copy(start);
    this.laserDirection.copy(end).sub(start).normalize();
    mesh.quaternion.setFromUnitVectors(WORLD_UP, this.laserDirection);
    mesh.renderOrder = 3;
    this.world.add(mesh);
    projectile.start.copy(start);
    projectile.end.copy(end);
    projectile.launchTick = launchTick;
    projectile.impactTick = impactTick;
    projectile.targetId = targetId;
    this.laserProjectiles.push(projectile);
    return true;
  }

  private createMuzzleFlash(): MuzzleFlash {
    const material = new THREE.SpriteMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xff4058,
      depthWrite: false,
      map: this.glowTexture,
      opacity: 0.95,
      toneMapped: false,
      transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    return { sprite, remaining: 0, scale: 1 };
  }

  private flashMuzzle(position: THREE.Vector3, scale: number) {
    const flash = this.muzzleFlashPool.pop() ?? this.createMuzzleFlash();
    const { sprite } = flash;
    flash.light = this.availableMuzzleLights.pop();
    flash.scale = scale;
    sprite.position.copy(position);
    sprite.scale.setScalar(0.55 * scale);
    sprite.material.opacity = 0.95;
    sprite.renderOrder = 4;
    if (flash.light) {
      flash.light.visible = true;
      flash.light.position.copy(position);
      flash.light.intensity = 3.5 * scale;
    }
    this.world.add(sprite);
    flash.remaining = 0.13;
    this.muzzleFlashes.push(flash);
  }

  private updateLaserProjectiles() {
    const presentationTick = this.frameTick
      + Math.min(1, this.interpolationAge / SIMULATION_TICK_SECONDS);
    for (let index = this.laserProjectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.laserProjectiles[index];
      const target = projectile.targetId
        ? this.buildingById.get(projectile.targetId)?.root
          ?? this.presentations.get(projectile.targetId)?.root
        : undefined;
      if (target) this.targetBounds.setFromObject(target).getCenter(projectile.end);
      const durationTicks = Math.max(1, projectile.impactTick - projectile.launchTick);
      const progress = Math.max(0, Math.min(
        1,
        (presentationTick - projectile.launchTick) / durationTicks,
      ));
      projectile.mesh.position.lerpVectors(projectile.start, projectile.end, progress);
      if (progress < 1) {
        this.laserDirection.copy(projectile.end).sub(projectile.mesh.position).normalize();
        projectile.mesh.quaternion.setFromUnitVectors(WORLD_UP, this.laserDirection);
      }
      if (progress < 1) continue;
      projectile.mesh.removeFromParent();
      projectile.targetId = undefined;
      this.laserProjectiles.splice(index, 1);
      this.laserPool.push(projectile);
    }
  }

  private updateMuzzleFlashes(deltaSeconds: number) {
    for (let index = this.muzzleFlashes.length - 1; index >= 0; index -= 1) {
      const flash = this.muzzleFlashes[index];
      flash.remaining -= deltaSeconds;
      const strength = Math.max(0, flash.remaining / 0.13);
      flash.sprite.material.opacity = strength * 0.95;
      flash.sprite.scale.setScalar((0.55 + (1 - strength) * 0.45) * flash.scale);
      if (flash.light) flash.light.intensity = strength * 3.5 * flash.scale;
      if (flash.remaining > 0) continue;
      flash.sprite.removeFromParent();
      if (flash.light) {
        flash.light.visible = false;
        this.availableMuzzleLights.push(flash.light);
        flash.light = undefined;
      }
      this.muzzleFlashes.splice(index, 1);
      this.muzzleFlashPool.push(flash);
    }
  }
}
