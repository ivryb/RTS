import * as THREE from "three";
import { BUILDING_DEFINITIONS } from "../../../src/sim/construction";
import type { ConstructionSketch, SiteModel, SiteState, SketchContext } from "../sketch";
import { deriveParts, type BuildingParts } from "./assembly/parts";
import { createUniforms, IMPACT, partPath, patchMaterial } from "./assembly/shader";

/** Real seconds a part takes to set off and settle, plus this many per metre of its path. */
const PART_SECONDS = 0.6;
const PART_SECONDS_PER_METRE = 0.35;
/**
 * How long the completed building keeps its construction material: the last part locks at the
 * moment of completion and settles during this time.
 */
const SETTLE_SECONDS = 0.9;
/** The plan of the unbuilt parts is gone this long after the site is destroyed. */
const PLAN_VANISH_SECONDS = 0.25;

interface SiteMesh {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  finished: { geometry: THREE.BufferGeometry; material: THREE.Material };
  construction: { geometry: THREE.BufferGeometry; material: THREE.Material };
  /** True when the construction geometry reuses the finished geometry's own buffers. */
  sharesBuffers: boolean;
}

const isSiteMesh = (object: THREE.Object3D): object is SiteMesh["mesh"] =>
  object instanceof THREE.Mesh && !Array.isArray(object.material);

/** Triangle corners and positions of a mesh in the building's own space: metres, y up. */
const readSource = (mesh: SiteMesh["mesh"], toBuilding: THREE.Matrix4) => {
  const attribute = mesh.geometry.getAttribute("position");
  const positions = new Float32Array(attribute.count * 3);
  const point = new THREE.Vector3();
  for (let vertex = 0; vertex < attribute.count; vertex += 1) {
    point.fromBufferAttribute(attribute, vertex).applyMatrix4(toBuilding).toArray(positions, vertex * 3);
  }
  const index = mesh.geometry.index?.array
    ?? Uint32Array.from({ length: attribute.count }, (_, corner) => corner);
  return { positions, index };
};

/**
 * When each part sets off, as construction progress: larger parts get a longer turn. The last
 * part meets its seat exactly at 100%, so the site never looks finished before it is, and no
 * part sets off before the one ahead of it is seated, so the drone carries one at a time.
 */
const scheduleParts = ({ parts }: BuildingParts, constructionSeconds: number, pathLength: number) => {
  const largest = Math.max(...parts.map((part) => part.area));
  const turns = parts.map((part) => 0.7 + 0.3 * Math.sqrt(part.area / largest));
  // The last part's own turn is the closing settle, so only the turns before it share the build.
  const earlier = turns.slice(0, -1);
  const total = earlier.reduce((sum, turn) => sum + turn, 0) || 1;
  const shortestTurn = Math.min(...earlier, total) / total;
  const span = Math.min(
    (PART_SECONDS + PART_SECONDS_PER_METRE * pathLength) / constructionSeconds,
    shortestTurn / (IMPACT * (1 + shortestTurn)),
  );
  const lastStart = 1 - IMPACT * span;
  let elapsed = 0;
  const starts = turns.map((turn, order) => {
    const start = order === turns.length - 1 ? lastStart : elapsed / total * lastStart;
    elapsed += turn;
    return start;
  });
  return { span, starts };
};

/** Metres a part travels to its seat: further on a taller building, within readable limits. */
const pathLength = ({ min, max }: BuildingParts) =>
  THREE.MathUtils.clamp((max[1] - min[1]) * 0.35 + 0.6, 0.9, 2.6);

/**
 * Where each part starts its path, relative to its seat. Parts near the building's axis drop
 * in from above; parts further out also come in from the side they sit on.
 */
const partTravel = ({ parts, min, max }: BuildingParts, distance: number) => {
  const centreX = (min[0] + max[0]) / 2;
  const centreZ = (min[2] + max[2]) / 2;
  const reach = Math.hypot(max[0] - min[0], max[2] - min[2]) / 2 || 1;
  return parts.map((part) => {
    const x = part.centroid[0] - centreX;
    const z = part.centroid[2] - centreZ;
    const radius = Math.hypot(x, z);
    const outward = THREE.MathUtils.smoothstep(radius / reach, 0.15, 0.6);
    const sideways = radius ? distance * 0.8 * outward / radius : 0;
    return new THREE.Vector3(x * sideways, distance * (1 - 0.35 * outward), z * sideways);
  });
};

const partCentre = ({ min, max }: BuildingParts["parts"][number]) =>
  new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);

/**
 * A copy of the mesh's geometry that also tells every vertex which part it belongs to. It
 * reuses the finished geometry's buffers unless a part boundary cuts through shared vertices.
 */
const buildConstructionGeometry = (
  finished: THREE.BufferGeometry,
  source: ReturnType<typeof readSource>,
  partOfTriangle: Uint16Array,
  building: BuildingParts,
  starts: readonly number[],
  travels: readonly THREE.Vector3[],
  toBuilding: THREE.Matrix4,
) => {
  const sourceCount = source.positions.length / 3;
  const partOfVertex = new Int32Array(sourceCount).fill(-1);
  const index = new Uint32Array(source.index.length);
  // A vertex used by two parts is given a twin, so each part can move on its own.
  const twins = new Map<number, number>();
  const twinSources: number[] = [];
  const twinParts: number[] = [];
  for (let corner = 0; corner < index.length; corner += 1) {
    const vertex = source.index[corner]!;
    const part = partOfTriangle[Math.floor(corner / 3)]!;
    if (partOfVertex[vertex] === -1) partOfVertex[vertex] = part;
    if (partOfVertex[vertex] === part) {
      index[corner] = vertex;
      continue;
    }
    const key = vertex * 65536 + part;
    let twin = twins.get(key);
    if (twin === undefined) {
      twin = sourceCount + twinSources.length;
      twins.set(key, twin);
      twinSources.push(vertex);
      twinParts.push(part);
    }
    index[corner] = twin;
  }

  const count = sourceCount + twinSources.length;
  const sharesBuffers = twinSources.length === 0 && finished.index !== null;
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(finished.attributes)) {
    if (sharesBuffers) {
      geometry.setAttribute(name, attribute);
      continue;
    }
    const { itemSize } = attribute;
    const values = new Float32Array(count * itemSize);
    for (let vertex = 0; vertex < count; vertex += 1) {
      const from = vertex < sourceCount ? vertex : twinSources[vertex - sourceCount]!;
      for (let item = 0; item < itemSize; item += 1) {
        values[vertex * itemSize + item] = attribute.getComponent(from, item);
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, itemSize));
  }
  geometry.setIndex(sharesBuffers ? finished.index : new THREE.BufferAttribute(index, 1));

  const toLocal = toBuilding.clone().invert();
  const localTurn = new THREE.Matrix3().setFromMatrix4(toLocal);
  const pivots = building.parts.map((part) => partCentre(part).applyMatrix4(toLocal));
  const localTravels = travels.map((travel) => travel.clone().applyMatrix3(localTurn));
  // A flat plate would flash all over as it locks, so its seam flash is held back.
  const seams = building.parts.map((part) =>
    0.25 + 0.75 * THREE.MathUtils.smoothstep(part.max[1] - part.min[1], 0.08, 0.5));
  const buildingBase = building.min[1];
  const buildingHeight = building.max[1] - building.min[1] || 1;

  const pivot = new Float32Array(count * 3);
  const travel = new Float32Array(count * 3);
  const timing = new Float32Array(count * 4);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const from = vertex < sourceCount ? vertex : twinSources[vertex - sourceCount]!;
    // A vertex no triangle uses is never drawn; it rides with the first part.
    const order = Math.max(0, vertex < sourceCount ? partOfVertex[vertex]! : twinParts[vertex - sourceCount]!);
    const part = building.parts[order]!;
    const y = source.positions[from * 3 + 1]!;
    pivots[order]!.toArray(pivot, vertex * 3);
    localTravels[order]!.toArray(travel, vertex * 3);
    timing[vertex * 4] = starts[order]!;
    timing[vertex * 4 + 1] = (y - part.min[1]) / (part.max[1] - part.min[1] || 1);
    timing[vertex * 4 + 2] = (y - buildingBase) / buildingHeight;
    timing[vertex * 4 + 3] = seams[order]!;
  }
  geometry.setAttribute("aPartPivot", new THREE.BufferAttribute(pivot, 3));
  geometry.setAttribute("aPartTravel", new THREE.BufferAttribute(travel, 3));
  geometry.setAttribute("aPartTiming", new THREE.BufferAttribute(timing, 4));

  // Parts in flight leave the finished bounds, so culling uses a sphere that includes them.
  geometry.computeBoundingSphere();
  geometry.boundingSphere!.radius += Math.max(...localTravels.map((vector) => vector.length()));
  return { geometry, sharesBuffers };
};

const createSite = ({ kind, root, visualRoot }: SiteModel, { renderer }: SketchContext) => {
  root.updateWorldMatrix(true, true);
  const fromWorld = visualRoot.matrixWorld.clone().invert();
  const meshes: SiteMesh["mesh"][] = [];
  visualRoot.traverse((object) => {
    if (isSiteMesh(object)) meshes.push(object);
  });
  const toBuilding = meshes.map((mesh) => fromWorld.clone().multiply(mesh.matrixWorld));
  const sources = meshes.map((mesh, order) => readSource(mesh, toBuilding[order]!));

  const { constructionSeconds } = BUILDING_DEFINITIONS[kind];
  const bounds = new THREE.Box3().setFromObject(visualRoot);
  const size = bounds.getSize(new THREE.Vector3()).length();
  const building = deriveParts(sources, {
    minSize: size * 0.16,
    maxSize: size * 0.6,
    maxParts: Math.round(constructionSeconds / 0.45),
  });
  const distance = pathLength(building);
  const { span, starts } = scheduleParts(building, constructionSeconds, distance);
  const travels = partTravel(building, distance);

  const uniforms = createUniforms();
  uniforms.uSpan.value = span;
  const gl = renderer.getContext();
  uniforms.uScreenDoor.value = gl.getParameter(gl.SAMPLES) < 4 ? 1 : 0;
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patchMaterial(depthMaterial, uniforms, "depth");
  const constructionMaterials = new Map<THREE.Material, THREE.Material>();
  const siteMeshes = meshes.map((mesh, order): SiteMesh => {
    let material = constructionMaterials.get(mesh.material);
    if (!material) {
      material = mesh.material.clone();
      patchMaterial(material, uniforms, "colour");
      constructionMaterials.set(mesh.material, material);
    }
    const { geometry, sharesBuffers } = buildConstructionGeometry(
      mesh.geometry,
      sources[order]!,
      building.trianglePart[order]!,
      building,
      starts,
      travels,
      toBuilding[order]!,
    );
    return {
      mesh,
      finished: { geometry: mesh.geometry, material: mesh.material },
      construction: { geometry, material },
      sharesBuffers,
    };
  });

  // The beam ends on the part being set: the last one that has set off, wherever it is on its path.
  const centres = building.parts.map(partCentre);
  const beamTarget = new THREE.Vector3();
  const aimBeam = (progress: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle]! <= progress) low = middle;
      else high = middle - 1;
    }
    beamTarget.copy(centres[low]!)
      .addScaledVector(travels[low]!, partPath((progress - starts[low]!) / span))
      .applyMatrix4(visualRoot.matrixWorld);
  };
  aimBeam(0);

  let underConstruction = false;
  const show = (construction: boolean) => {
    if (construction === underConstruction) return;
    underConstruction = construction;
    for (const site of siteMeshes) {
      const { geometry, material } = construction ? site.construction : site.finished;
      site.mesh.geometry = geometry;
      site.mesh.material = material;
      site.mesh.customDepthMaterial = construction ? depthMaterial : undefined;
    }
  };

  return {
    beamTarget,
    update(state: SiteState, time: number) {
      const settling = state.lifecycle === "active" && state.sinceLifecycleChange < SETTLE_SECONDS;
      // A finished building is the plain model again: its own geometry, material and shadow.
      show(state.lifecycle !== "active" || settling);
      // The closing settle: one quick, damped breath of the whole building.
      const settle = settling ? state.sinceLifecycleChange : 0;
      visualRoot.scale.setScalar(1 + 0.022 * Math.exp(-settle * 7) * Math.sin(settle * 21));
      if (!underConstruction) return;
      // The last part locks at 100%, so its settle plays on through the closing settle.
      uniforms.uProgress.value = state.lifecycle === "active"
        ? 1 + state.sinceLifecycleChange / constructionSeconds
        : state.progress;
      uniforms.uTime.value = time;
      const working = state.working && state.lifecycle === "constructing";
      // The settle counts as work, so the last part finishes its path and flashes as it locks.
      uniforms.uWorking.value = working || settling ? 1 : 0;
      uniforms.uStandby.value = state.lifecycle === "constructing" && !working && state.progress > 0 ? 1 : 0;
      uniforms.uHealth.value = state.lifecycle === "destroyed" ? 1 : state.health;
      uniforms.uSettle.value = settling ? state.sinceLifecycleChange : -1;
      uniforms.uPlan.value = state.lifecycle === "destroyed"
        ? Math.max(0, 1 - state.sinceLifecycleChange / PLAN_VANISH_SECONDS)
        : 1;
      aimBeam(state.progress);
    },
    dispose() {
      show(false);
      visualRoot.scale.setScalar(1);
      for (const { construction, finished, sharesBuffers } of siteMeshes) {
        if (sharesBuffers) {
          // Disposing would free the finished model's buffers too, so let go of them first.
          for (const name of Object.keys(finished.geometry.attributes)) construction.geometry.deleteAttribute(name);
          construction.geometry.setIndex(null);
        }
        construction.geometry.dispose();
      }
      for (const material of constructionMaterials.values()) material.dispose();
      depthMaterial.dispose();
    },
  };
};

/**
 * The building arrives as a kit of parts set in place from the ground up, over a projected
 * plan of the parts still to come. Picking needs no special case: the construction geometry
 * keeps every triangle in its seat, so a click ray hits the finished shape at any progress,
 * which is the shape the built parts and the plan show together.
 */
export const sketch: ConstructionSketch = {
  title: "Assembly: set in place piece by piece",
  createSite,
};
