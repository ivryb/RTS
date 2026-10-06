# Development tools

`preview/` is the maintained visual check for production terrain, buildings, units, and effects. Run `pnpm dev` first, then use the `preview:capture` scripts from the root package.

`assets/` contains Blender, Python, and Node scripts used to inspect source files and prepare runtime models and textures. These scripts are intentionally outside `src/`; the browser does not load them.

For interactive procedural material and shape reviews, use the [building showcase](../prototypes/procedural-buildings/README.md). Building generators, style guidance, and assembly checks live under `assets/`.
