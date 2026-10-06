import type { MapLayout } from './types';
import type { TerrainBiomes } from './biomeRegions';
import type { createBiomeFeatures } from './biomeFeatures';
import type { createBiomeTerrain } from './biomeTerrain';

export type BiomeGround = Pick<TerrainBiomes, 'oasis'>
  & Pick<ReturnType<typeof createBiomeTerrain>, 'talus'>;

function smooth(start: number, end: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function noise(seed: number, x: number, z: number) {
  const hash = (a: number, b: number) => {
    let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const ix = Math.floor(x), iz = Math.floor(z), u = smooth(0, 1, x - ix), v = smooth(0, 1, z - iz);
  return (hash(ix, iz) * (1 - u) + hash(ix + 1, iz) * u) * (1 - v)
    + (hash(ix, iz + 1) * (1 - u) + hash(ix + 1, iz + 1) * u) * v;
}

/** Territories permit a biome; its rocks and drainage determine the actual ground cover. */
export function createBiomeGround(layout: MapLayout, features: ReturnType<typeof createBiomeFeatures>, terrain: ReturnType<typeof createBiomeTerrain>): BiomeGround {
  const oasis = new Float32Array(layout.heights.length);
  const row = layout.cells + 1, step = layout.size / layout.cells;
  for (let i = 0; i < oasis.length; i++) {
    const x = i % row * step - layout.size / 2, z = Math.floor(i / row) * step - layout.size / 2;
    const broad = noise(layout.seed + 601, x / 14, z / 14);
    const detail = noise(layout.seed + 617, x / 3.8, z / 3.8);
    const exposedFloor = 1 - smooth(-.6, 1.2, layout.rockEdges[i]);
    // Soil stays translucent beneath and between groves; dry open sand remains
    // the common surface even in the most vegetated territory.
    oasis[i] = smooth(.06,.57,features.oasisMoisture[i]) * (.68 + .16 * broad + .12 * detail) * exposedFloor;
  }
  return { oasis, talus:terrain.talus };
}
