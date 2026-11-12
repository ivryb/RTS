import type { ConstructionSketch } from "../sketch";

const DESTRUCTION_SECONDS = 0.8;

/** The shipped look, copied from `UnitSystem.renderBuilding` as the "before" reference. */
export const sketch: ConstructionSketch = {
  title: "Current: vertical stretch",
  createSite: ({ visualRoot }) => ({
    update(state) {
      const built = state.lifecycle === "active" ? 1 : 0.15 + state.progress * 0.85;
      const collapse = state.lifecycle === "destroyed"
        ? 1 - Math.min(1, state.sinceLifecycleChange / DESTRUCTION_SECONDS) * 0.85
        : 1;
      visualRoot.scale.y = built * collapse;
    },
    dispose() {
      visualRoot.scale.y = 1;
    },
  }),
};
