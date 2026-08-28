import { canPlaceAt, sampleHeight, type GeneratedMap } from "../../src/map";
import { demoAssets as assets } from "../../src/modelAssets";

// Bushes can return here once their replacement textures and models are approved.

const terrainVariation = (map: GeneratedMap, x: number, z: number, radius: number) => {
  const heights = [sampleHeight(map, x, z)];
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * Math.PI * 2;
    heights.push(sampleHeight(map, x + Math.cos(angle) * radius, z + Math.sin(angle) * radius));
  }
  return Math.max(...heights) - Math.min(...heights);
};

export const findSceneCenter = (map: GeneratedMap) => {
  const isClear = (center: { x: number; z: number }) =>
    canPlaceAt(map, center.x, center.z, 3) && assets.every((asset) => {
      const x = center.x + asset.offset.x;
      const z = center.z + asset.offset.z;
      return canPlaceAt(map, x, z, asset.radius) &&
        terrainVariation(map, x, z, asset.radius) < 0.65;
    });
  if (isClear(map.startingLocations[0])) return map.startingLocations[0];

  for (let ring = 1; ring <= 10; ring += 1) {
    const distance = ring * 12;
    const samples = ring * 8;
    for (let index = 0; index < samples; index += 1) {
      const angle = index / samples * Math.PI * 2;
      const center = { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
      if (isClear(center)) return center;
    }
  }
  return { x: 80, z: 80 };
};
