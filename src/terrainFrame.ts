import { mapScaleForSize, mapSizeForPlayerCount } from "./mapConstants";

export interface TerrainPoint {
  x: number;
  z: number;
}

export interface TerrainBase extends TerrainPoint {
  player: number;
}

export interface TerrainFrame {
  seed: number;
  playerCount: number;
  size: number;
  bases: TerrainBase[];
}

export const randomFrom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
};

/** Places player starts around a square inset without constructing terrain regions. */
export const createTerrainFrame = (seed: number, playerCount: number): TerrainFrame => {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) {
    throw new RangeError("Terrain generation supports between two and six players");
  }
  const size = mapSizeForPlayerCount(playerCount);
  const scale = mapScaleForSize(size);
  const random = randomFrom(seed);
  const rotation = playerCount === 2 ? 0 : random() * Math.PI * 2;
  const angleStep = Math.PI * 2 / playerCount;
  const bases = Array.from({ length: playerCount }, (_, index) => {
    const angle = rotation + index * angleStep;
    const direction = { x: Math.cos(angle), z: Math.sin(angle) };
    const radius = 128 * scale / Math.max(Math.abs(direction.x), Math.abs(direction.z));
    return {
      x: direction.x * radius,
      z: direction.z * radius,
      player: index + 1,
    };
  });
  return { seed, playerCount, size, bases };
};
