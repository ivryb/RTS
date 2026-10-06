export interface TerrainPoint {
  x: number;
  z: number;
}

export interface TerrainSurface {
  size: number;
  segments: number;
  heights: Float32Array;
  trianglePattern?: "alternating" | "fixed";
  /** Excludes authored rock obstacles in addition to slope constraints. */
  mountainMask?: Float32Array;
}

const cellIndexAt = (terrain: TerrainSurface, { x, z }: TerrainPoint) => {
  const column = Math.max(0, Math.min(
    terrain.segments - 1,
    Math.floor((x / terrain.size + 0.5) * terrain.segments),
  ));
  const row = Math.max(0, Math.min(
    terrain.segments - 1,
    Math.floor((z / terrain.size + 0.5) * terrain.segments),
  ));
  return row * terrain.segments + column;
};

/** Builds one connected walkable component so many terrain points can be checked cheaply. */
export const createTerrainReachability = (
  terrain: TerrainSurface,
  start: TerrainPoint,
  maximumSlopeDegrees = 40,
  clearance = 0,
) => {
  const vertexRow = terrain.segments + 1;
  const cellSize = terrain.size / terrain.segments;
  const maximumGradient = Math.tan(maximumSlopeDegrees * Math.PI / 180);
  const walkable = new Uint8Array(terrain.segments * terrain.segments);
  const heightAt = (x: number, z: number) => terrain.heights[z * vertexRow + x]!;
  const gradientIsWalkable = (riseX: number, riseZ: number) =>
    Math.hypot(riseX / cellSize, riseZ / cellSize) <= maximumGradient;

  for (let z = 0; z < terrain.segments; z += 1) {
    for (let x = 0; x < terrain.segments; x += 1) {
      const topLeft = heightAt(x, z);
      const topRight = heightAt(x + 1, z);
      const bottomLeft = heightAt(x, z + 1);
      const bottomRight = heightAt(x + 1, z + 1);
      const firstWalkable = terrain.trianglePattern !== "fixed" && (x + z) % 2 === 0
        ? gradientIsWalkable(bottomRight - bottomLeft, bottomLeft - topLeft)
        : gradientIsWalkable(topRight - topLeft, bottomLeft - topLeft);
      const secondWalkable = terrain.trianglePattern !== "fixed" && (x + z) % 2 === 0
        ? gradientIsWalkable(topRight - topLeft, bottomRight - topRight)
        : gradientIsWalkable(bottomRight - bottomLeft, bottomRight - topRight);
      const mask = terrain.mountainMask;
      const corner = z * vertexRow + x;
      if (mask && [corner, corner + 1, corner + vertexRow, corner + vertexRow + 1]
        .some(i => mask[i] >= .5)) continue;
      if (firstWalkable && secondWalkable) walkable[z * terrain.segments + x] = 1;
    }
  }

  if (clearance > 0) {
    const unexpanded = walkable.slice();
    const radius = Math.ceil(clearance / cellSize);
    for (let z = 0; z < terrain.segments; z += 1) {
      for (let x = 0; x < terrain.segments; x += 1) {
        const index = z * terrain.segments + x;
        if (!unexpanded[index]) continue;
        const centerX = (x + 0.5) * cellSize;
        const centerZ = (z + 0.5) * cellSize;
        if (Math.min(centerX, centerZ, terrain.size - centerX, terrain.size - centerZ) < clearance) {
          walkable[index] = 0;
          continue;
        }
        for (let offsetZ = -radius; offsetZ <= radius && walkable[index]; offsetZ += 1) {
          for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
            if (Math.hypot(offsetX, offsetZ) * cellSize > clearance) continue;
            const neighborX = x + offsetX;
            const neighborZ = z + offsetZ;
            if (neighborX < 0 || neighborX >= terrain.segments
              || neighborZ < 0 || neighborZ >= terrain.segments
              || !unexpanded[neighborZ * terrain.segments + neighborX]) {
              walkable[index] = 0;
              break;
            }
          }
        }
      }
    }
  }

  const visited = new Uint8Array(walkable.length);
  const startIndex = cellIndexAt(terrain, start);
  if (walkable[startIndex]) {
    const queue = new Int32Array(walkable.length);
    let read = 0;
    let write = 1;
    queue[0] = startIndex;
    visited[startIndex] = 1;
    while (read < write) {
      const current = queue[read++]!;
      const x = current % terrain.segments;
      const z = Math.floor(current / terrain.segments);
      const neighbors = [
        x > 0 ? current - 1 : -1,
        x + 1 < terrain.segments ? current + 1 : -1,
        z > 0 ? current - terrain.segments : -1,
        z + 1 < terrain.segments ? current + terrain.segments : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || visited[neighbor] || !walkable[neighbor]) continue;
        visited[neighbor] = 1;
        queue[write++] = neighbor;
      }
    }
  }
  return (point: TerrainPoint) => visited[cellIndexAt(terrain, point)] === 1;
};

export const terrainPathExists = (
  terrain: TerrainSurface,
  start: TerrainPoint,
  goal: TerrainPoint,
  maximumSlopeDegrees = 40,
  clearance = 0,
) => terrain.segments >= 1 && createTerrainReachability(
  terrain,
  start,
  maximumSlopeDegrees,
  clearance,
)(goal);
