export type UnitActionId = "move" | "stop" | "attack" | "attack-ground" | "build";
export type ActionTargetMode = Exclude<UnitActionId, "stop" | "build">;

export const UNIT_ACTIONS: Record<UnitActionId, {
  hotkey: `Key${string}`;
  target?: ActionTargetMode;
}> = {
  move: { hotkey: "KeyM", target: "move" },
  stop: { hotkey: "KeyS" },
  attack: { hotkey: "KeyA", target: "attack" },
  "attack-ground": { hotkey: "KeyA", target: "attack-ground" },
  build: { hotkey: "KeyB" },
};
