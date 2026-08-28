export const mapSegmentsForSize = (size: number) => Math.round(size * 0.7);
export const TWO_PLAYER_MAP_SIZE = 240;
export const REFERENCE_MAP_SIZE = 320;
export const MAP_SIZE = TWO_PLAYER_MAP_SIZE;
export const MAP_SEGMENTS = mapSegmentsForSize(MAP_SIZE);
export const mapSizeForPlayerCount = (playerCount: number) => {
  if (playerCount === 2) return TWO_PLAYER_MAP_SIZE;
  const standardSize = 200 + playerCount * 40;
  return playerCount === 6 ? standardSize * 0.9 : standardSize;
};
export const mapScaleForSize = (size: number) => size / REFERENCE_MAP_SIZE;
export const TERRAIN_LEVEL_HEIGHT = 4.8;
export const TERRAIN_BASE_HEIGHT = 0.55;
export const TERRAIN_HILL_THRESHOLD = TERRAIN_BASE_HEIGHT + TERRAIN_LEVEL_HEIGHT * 0.4;
export const TERRAIN_MOUNTAIN_BLOCKED_THRESHOLD = 0.5;
