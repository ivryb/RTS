import { createTerrainBiomes } from './biomeRegions';
import { createBiomeTerrain } from './biomeTerrain';
import { createBiomeFeatures } from './biomeFeatures';
import { createBiomeGround } from './biomeGround';
import type { MapLayout } from './types';

/** The approved environment, shared by matches and the terrain hub. */
export function createTerrainEnvironment(base: MapLayout) {
  const biomes = createTerrainBiomes(base);
  const terrain = createBiomeTerrain(base);
  const features = createBiomeFeatures(terrain.layout, biomes, terrain);
  const ground = createBiomeGround(terrain.layout, features, terrain);
  const blocked = features.blocked.slice();
  const { size, cells } = terrain.layout;
  const step = size / cells;

  // Trunks are solid; grass and shrubs remain walkable. Mark the cell corners
  // as well as the trunk radius so a sub-cell trunk cannot vanish from Recast.
  for (const tree of features.trees) {
    const radius = tree.size * .06;
    const gx = (tree.x + size / 2) / step, gz = (tree.z + size / 2) / step;
    const padding = Math.ceil(radius / step);
    for (let z = Math.max(0, Math.floor(gz) - padding); z <= Math.min(cells, Math.ceil(gz) + padding); z++) {
      for (let x = Math.max(0, Math.floor(gx) - padding); x <= Math.min(cells, Math.ceil(gx) + padding); x++) {
        if (Math.hypot((x - gx) * step, (z - gz) * step) <= radius
          || x >= Math.floor(gx) && x <= Math.ceil(gx) && z >= Math.floor(gz) && z <= Math.ceil(gz)) {
          blocked[z * (cells + 1) + x] = 1;
        }
      }
    }
  }
  return { layout: { ...terrain.layout, blocked }, features, ground };
}
