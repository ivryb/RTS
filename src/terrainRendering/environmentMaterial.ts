import { createMapTerrainMaterial } from './material';

/** The approved oxide cliffs, weathered crowns and alluvial ground. */
export function createEnvironmentMaterial(size: number, seed: number) {
  return createMapTerrainMaterial(size, seed, {
    colorUrl: new URL('../../assets/textures/terrain/oxide-cliff-color.webp', import.meta.url).href,
    normalUrl: new URL('../../assets/textures/terrain/cliff-side-normal.webp', import.meta.url).href,
    roughnessUrl: new URL('../../assets/textures/terrain/cliff-side-roughness.webp', import.meta.url).href,
    meters: 12, tint: '#ffffff', normalStrength: .6,
  }, {
    oasis: {
      colorUrl: new URL('../../assets/textures/terrain/biome-oasis-color.webp', import.meta.url).href,
      normalUrl: new URL('../../assets/textures/terrain/biome-oasis-normal.webp', import.meta.url).href,
      meters: 6.8, normalStrength: .4,
    },
    caprock: {
      colorUrl: new URL('../../assets/textures/terrain/oxide-weathered-color.webp', import.meta.url).href,
      normalUrl: new URL('../../assets/textures/terrain/oxide-weathered-normal.webp', import.meta.url).href,
      meters: 7, normalStrength: .6,
    },
    talus: {
      colorUrl: new URL('../../assets/textures/terrain/oxide-scree-color.webp', import.meta.url).href,
      normalUrl: new URL('../../assets/textures/terrain/oxide-scree-normal.webp', import.meta.url).href,
      meters: 7, normalStrength: .5,
    },
  });
}
