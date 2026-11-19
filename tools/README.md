# Development tools

`preview/` is the maintained visual check for production terrain, buildings, units, and effects. Run `bun run dev` first, then use the `preview:capture` scripts from the root package. `preview/construction/` shows buildings under construction in every state; [Construction animation](../docs/construction_animation.md) lists its shots. `preview/death-effects/` plays units dying and buildings being destroyed through the game's own presentation; [Destruction and death effects](../docs/death_effects.md) lists its scenes.

`assets/` contains Blender, Python, and Node scripts used to inspect source files and prepare runtime models and textures. These scripts are intentionally outside `src/`; the browser does not load them.

For interactive procedural material and shape reviews, use the [building showcase](../prototypes/procedural-buildings/README.md). Building generators, style guidance, and assembly checks live under `assets/`.
