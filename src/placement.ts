export const enum CellFlag {
  Hill = 1 << 0,
  Palm = 1 << 1,
  Reserved = 1 << 2,
}

export interface PlacementGrid {
  size: number;
  resolution: number;
  flags: Uint8Array;
}

export const createPlacementGrid = (size: number, resolution = 84): PlacementGrid => ({
  size,
  resolution,
  flags: new Uint8Array(resolution * resolution),
});

const cellAt = (grid: PlacementGrid, x: number, z: number) => {
  const column = Math.floor((x / grid.size + 0.5) * grid.resolution);
  const row = Math.floor((z / grid.size + 0.5) * grid.resolution);
  if (column < 0 || row < 0 || column >= grid.resolution || row >= grid.resolution) return -1;
  return row * grid.resolution + column;
};

export const flagsAt = (grid: PlacementGrid, x: number, z: number) => {
  const index = cellAt(grid, x, z);
  return index < 0 ? CellFlag.Reserved : grid.flags[index];
};

export const markDisc = (grid: PlacementGrid, x: number, z: number, radius: number, flag: CellFlag) => {
  const cellSize = grid.size / grid.resolution;
  const cells = Math.ceil(radius / cellSize);
  const centerColumn = Math.floor((x / grid.size + 0.5) * grid.resolution);
  const centerRow = Math.floor((z / grid.size + 0.5) * grid.resolution);

  for (let row = centerRow - cells; row <= centerRow + cells; row += 1) {
    for (let column = centerColumn - cells; column <= centerColumn + cells; column += 1) {
      if (column < 0 || row < 0 || column >= grid.resolution || row >= grid.resolution) continue;
      const worldX = ((column + 0.5) / grid.resolution - 0.5) * grid.size;
      const worldZ = ((row + 0.5) / grid.resolution - 0.5) * grid.size;
      if ((worldX - x) ** 2 + (worldZ - z) ** 2 <= radius ** 2) {
        grid.flags[row * grid.resolution + column] |= flag;
      }
    }
  }
};

export const intersects = (grid: PlacementGrid, x: number, z: number, radius: number, flags: number) => {
  const cellSize = grid.size / grid.resolution;
  const samples = Math.max(1, Math.ceil(radius / cellSize));
  for (let row = -samples; row <= samples; row += 1) {
    for (let column = -samples; column <= samples; column += 1) {
      if ((column * cellSize) ** 2 + (row * cellSize) ** 2 > (radius + cellSize / 2) ** 2) continue;
      if (flagsAt(grid, x + column * cellSize, z + row * cellSize) & flags) return true;
    }
  }
  return false;
};
