import * as THREE from "three";
import { createMapTerrainGeometry } from "./terrainRendering";
import { createEnvironmentMaterial } from "./terrainRendering/environmentMaterial";
import { type GeneratedMap } from "./map";
import { TERRAIN_BASE_HEIGHT } from "./mapConstants";
import type { TerrainSurface } from "./terrainWalkability";

const TERRAIN_SKIRT_BOTTOM = TERRAIN_BASE_HEIGHT - 0.3;

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

export const createTerrain = (map: GeneratedMap) => {
  const { geometry, walkGeometry } = createMapTerrainGeometry(map.layout, map.environment.ground);
  walkGeometry.dispose();
  const material = createEnvironmentMaterial(map.size, map.seed);
  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  terrain.renderOrder = -100;
  const skirt = new THREE.Mesh(
    createTerrainSkirtGeometry(map, map.segments),
    new THREE.MeshStandardMaterial({ color: 0x86684b, roughness: 1 }),
  );
  skirt.name = "terrain-skirt";
  skirt.receiveShadow = true;
  terrain.add(skirt);
  return terrain;
};
