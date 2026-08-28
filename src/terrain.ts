import * as THREE from "three";
import { createTerrainIndices, type GeneratedMap } from "./map";
import { TERRAIN_BASE_HEIGHT } from "./mapConstants";
import { createSandMaterial } from "./materials";
import type { TerrainSurface } from "./terrainWalkability";

export type TerrainRenderMap = Pick<
  GeneratedMap,
  | "seed"
  | "size"
  | "segments"
  | "heights"
  | "mountainMask"
  | "mountainFoundationMask"
>;

const TERRAIN_SKIRT_BOTTOM = TERRAIN_BASE_HEIGHT - 0.3;

const smoothstep = (start: number, end: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

const noiseHash = (seed: number, x: number, z: number) => {
  let value = seed ^ Math.imul(x, 374_761_393) ^ Math.imul(z, 668_265_263);
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295;
};

const valueNoise = (seed: number, x: number, z: number, scale: number) => {
  const gridX = x / scale;
  const gridZ = z / scale;
  const x0 = Math.floor(gridX);
  const z0 = Math.floor(gridZ);
  const tx = smoothstep(0, 1, gridX - x0);
  const tz = smoothstep(0, 1, gridZ - z0);
  const top = THREE.MathUtils.lerp(noiseHash(seed, x0, z0), noiseHash(seed, x0 + 1, z0), tx);
  const bottom = THREE.MathUtils.lerp(noiseHash(seed, x0, z0 + 1), noiseHash(seed, x0 + 1, z0 + 1), tx);
  return THREE.MathUtils.lerp(top, bottom, tz);
};

const createPatchWeights = (
  map: TerrainRenderMap,
  positions: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
) => {
  const weights = new Float32Array(positions.count);

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const warpX = (valueNoise(map.seed + 11, x, z, 72) - 0.5) * 28;
    const warpZ = (valueNoise(map.seed + 23, x, z, 72) - 0.5) * 28;
    const broad = valueNoise(map.seed + 37, x + warpX, z + warpZ, 46);
    const detail = valueNoise(map.seed + 53, x + warpX, z + warpZ, 21);
    const region = smoothstep(0.44, 0.72, broad * 0.72 + detail * 0.28);

    const lowland = 1 - smoothstep(1.25, 2.15, positions.getY(index));
    weights[index] = region * lowland;
  }

  return new THREE.Float32BufferAttribute(weights, 1);
};

/** Adds the authored mountain and foundation weights consumed by the ground material. */
const applyMountainWeights = (
  terrain: THREE.Mesh,
  map: TerrainRenderMap,
) => {
  const resolution = map.segments + 1;
  terrain.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.attributes.position;
    const weights = new Float32Array(positions.count);
    const foundationWeights = new Float32Array(positions.count);
    for (let index = 0; index < positions.count; index += 1) {
      const gridX = THREE.MathUtils.clamp(
        Math.round((positions.getX(index) / map.size + 0.5) * (resolution - 1)),
        0,
        resolution - 1,
      );
      const gridZ = THREE.MathUtils.clamp(
        Math.round((positions.getZ(index) / map.size + 0.5) * (resolution - 1)),
        0,
        resolution - 1,
      );
      const gridIndex = gridZ * resolution + gridX;
      weights[index] = map.mountainMask[gridIndex]!;
      foundationWeights[index] = map.mountainFoundationMask[gridIndex]!;
    }
    object.geometry.setAttribute(
      "mountainWeight",
      new THREE.Float32BufferAttribute(weights, 1),
    );
    object.geometry.setAttribute(
      "mountainFoundationWeight",
      new THREE.Float32BufferAttribute(foundationWeights, 1),
    );
  });
};

const sampleSmoothedHeight = (map: TerrainSurface, x: number, z: number) => {
  const gridX = Math.max(0, Math.min(map.segments, (x / map.size + 0.5) * map.segments));
  const gridZ = Math.max(0, Math.min(map.segments, (z / map.size + 0.5) * map.segments));
  const x0 = Math.floor(gridX);
  const z0 = Math.floor(gridZ);
  const x1 = Math.min(map.segments, x0 + 1);
  const z1 = Math.min(map.segments, z0 + 1);
  const row = map.segments + 1;
  const localX = gridX - x0;
  const localZ = gridZ - z0;
  const top = THREE.MathUtils.lerp(
    map.heights[z0 * row + x0]!,
    map.heights[z0 * row + x1]!,
    localX,
  );
  const bottom = THREE.MathUtils.lerp(
    map.heights[z1 * row + x0]!,
    map.heights[z1 * row + x1]!,
    localX,
  );
  return THREE.MathUtils.lerp(top, bottom, localZ);
};

/** Closes the height field at the map boundary so raised edges meet the low ground. */
export const createTerrainSkirtGeometry = (
  map: TerrainSurface,
  segments: number,
) => {
  const half = map.size / 2;
  const sides = [
    (ratio: number) => ({ x: -half + ratio * map.size, z: -half }),
    (ratio: number) => ({ x: half, z: -half + ratio * map.size }),
    (ratio: number) => ({ x: half - ratio * map.size, z: half }),
    (ratio: number) => ({ x: -half, z: half - ratio * map.size }),
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const pointAt of sides) {
    for (let index = 0; index < segments; index += 1) {
      const first = pointAt(index / segments);
      const second = pointAt((index + 1) / segments);
      const firstHeight = sampleSmoothedHeight(map, first.x, first.z);
      const secondHeight = sampleSmoothedHeight(map, second.x, second.z);
      const offset = positions.length / 3;
      positions.push(
        first.x, firstHeight, first.z,
        second.x, secondHeight, second.z,
        first.x, TERRAIN_SKIRT_BOTTOM, first.z,
        second.x, TERRAIN_SKIRT_BOTTOM, second.z,
        first.x, firstHeight, first.z,
        second.x, secondHeight, second.z,
        first.x, TERRAIN_SKIRT_BOTTOM, first.z,
        second.x, TERRAIN_SKIRT_BOTTOM, second.z,
      );
      uvs.push(0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0);
      indices.push(
        offset, offset + 1, offset + 2,
        offset + 1, offset + 3, offset + 2,
        offset + 4, offset + 6, offset + 5,
        offset + 5, offset + 6, offset + 7,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("patchWeight", new THREE.Float32BufferAttribute(positions.length / 3, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

export const createTerrain = (map: TerrainRenderMap) => {
  const renderSegments = Math.round(map.size);
  const geometry = new THREE.PlaneGeometry(
    map.size,
    map.size,
    renderSegments,
    renderSegments,
  );
  geometry.rotateX(-Math.PI / 2);
  geometry.setIndex(new THREE.Uint32BufferAttribute(createTerrainIndices(renderSegments), 1));

  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(
      index,
      sampleSmoothedHeight(map, positions.getX(index), positions.getZ(index)),
    );
  }
  positions.needsUpdate = true;
  geometry.setAttribute("patchWeight", createPatchWeights(map, positions));
  geometry.computeVertexNormals();

  const material = createSandMaterial(map.size, map.seed);
  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  const skirt = new THREE.Mesh(createTerrainSkirtGeometry(map, renderSegments), material);
  skirt.name = "terrain-skirt";
  skirt.receiveShadow = true;
  terrain.add(skirt);
  applyMountainWeights(terrain, map);
  return terrain;
};
