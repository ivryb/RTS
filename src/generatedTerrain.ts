import {
  generateGraphTerrainLayout,
  type GraphTerrainLayout,
} from "./graphTerrain";

export type GeneratedTerrainLayout = GraphTerrainLayout;

/** The shared terrain layout consumed by the game and standalone preview. */
export const generateTerrainLayout = (
  seed: number,
  playerCount = 2,
): GeneratedTerrainLayout => generateGraphTerrainLayout(seed, playerCount);
