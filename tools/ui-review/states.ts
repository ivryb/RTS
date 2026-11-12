export const states = [
  "empty", "ghostrunner", "scout-drone", "hornet", "behemoth", "group", "mixed-army",
  "damaged", "enemy-unit", "command-center", "turret", "enemy-building",
  "training", "queue-full", "construction", "construction-paused",
  "build-menu", "move", "attack", "attack-ground", "rally", "settings", "controls",
  "victory", "defeat",
] as const;
export type ReviewState = typeof states[number];
