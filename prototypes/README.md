# Prototypes

These experiments answer technical or art-pipeline questions without becoming production dependencies.

- [`procedural-buildings/`](procedural-buildings/README.md) is the shared building showcase: production models, common procedural materials, and optional archived Meshy comparisons.
- `terrain-topology/` shows the production terrain graph and rendered height field.
- `cloudflare-worker/` tests the planned multiplayer runtime and replication approach.
- `robot-dog-rigging/` explores rigid mechanical-quadruped rigging in Blender.
- `terrain-props/` assembles local terrain-prop concepts into reference sheets and previews.

Production code under `src/` must not import from this directory. Keep a prototype only while it remains useful or records an unfinished technical direction.
