export const TERRAINS = {
  old: {
    name: 'Old terrain',
    description: 'The original desert terrain, with open sand and rocky mountain passes.',
  },
  new: {
    name: 'New terrain',
    description: 'Weathered oxide mountains, sheltered olive groves and dry washes, connected by open sand.',
  },
};

export type TerrainVersion = keyof typeof TERRAINS;
