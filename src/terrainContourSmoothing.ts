import { TERRAIN_BASE_HEIGHT, TERRAIN_LEVEL_HEIGHT } from "./mapConstants";

const SMOOTHING_PASSES = 6;
const CLIFF_TRANSITION_START = 0.38;
const CLIFF_TRANSITION_END = 0.62;

const smoothstep = (start: number, end: number, value: number) => {
  const ratio = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return ratio * ratio * (3 - 2 * ratio);
};

const blurLevelMask = (
  levels: Uint8Array,
  resolution: number,
  minimumLevel: number,
  passes: number,
) => {
  let current = Float32Array.from(levels, (level) => Number(level >= minimumLevel));
  for (let pass = 0; pass < passes; pass += 1) {
    const horizontal = new Float32Array(current.length);
    const next = new Float32Array(current.length);
    for (let z = 0; z < resolution; z += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const left = current[z * resolution + Math.max(0, x - 1)]!;
        const center = current[z * resolution + x]!;
        const right = current[z * resolution + Math.min(resolution - 1, x + 1)]!;
        horizontal[z * resolution + x] = (left + center * 2 + right) / 4;
      }
    }
    for (let z = 0; z < resolution; z += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const top = horizontal[Math.max(0, z - 1) * resolution + x]!;
        const center = horizontal[z * resolution + x]!;
        const bottom = horizontal[Math.min(resolution - 1, z + 1) * resolution + x]!;
        next[z * resolution + x] = (top + center * 2 + bottom) / 4;
      }
    }
    current = next;
  }
  return current;
};

const createContourHeights = (
  levels: Uint8Array,
  resolution: number,
  smoothingPasses: number,
  transitionStart: number,
  transitionEnd: number,
) => {
  if (levels.length !== resolution * resolution) {
    throw new RangeError("Terrain level grid does not match its resolution");
  }
  const levelOne = blurLevelMask(levels, resolution, 1, smoothingPasses);
  const levelTwo = blurLevelMask(levels, resolution, 2, smoothingPasses);
  return Float32Array.from(levels, (_, index) => TERRAIN_BASE_HEIGHT
    + smoothstep(transitionStart, transitionEnd, levelOne[index]!)
      * TERRAIN_LEVEL_HEIGHT
    + smoothstep(transitionStart, transitionEnd, levelTwo[index]!)
      * TERRAIN_LEVEL_HEIGHT);
};

/** Rounds authored level contours while leaving broad plateaus at their exact heights. */
export const createSmoothedContourHeights = (
  levels: Uint8Array,
  resolution: number,
) => createContourHeights(
  levels,
  resolution,
  SMOOTHING_PASSES,
  CLIFF_TRANSITION_START,
  CLIFF_TRANSITION_END,
);

/** Uses the same contour shaping with a broad slope that units can climb from any side. */
export const createWalkableContourHeights = (
  levels: Uint8Array,
  resolution: number,
) => createContourHeights(levels, resolution, 32, 0, 1);
