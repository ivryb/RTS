# Prototypes

These experiments answer technical or art-pipeline questions without becoming production dependencies.

- `terrain-playground/` compares Old terrain and New terrain using reusable generation and rendering modules from `src/`; see its README for captures and limitations.
- [`procedural-buildings/`](procedural-buildings/README.md) is the shared building showcase: production models, common procedural materials, and optional archived Meshy comparisons.
- `cloudflare-worker/` tests the planned multiplayer runtime and replication approach.
- `robot-dog-rigging/` explores rigid mechanical-quadruped rigging in Blender.

Production code under `src/` must not import from this directory. Keep a prototype only while it remains useful or records an unfinished technical direction.
