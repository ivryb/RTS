# Architecture

## Runtime flow

`index.html` loads `src/main.ts`, which creates the map, renderer, input system, and match session.

```text
mouse and keyboard
        |
        v
    unitInput
        |
        v
WorkerMatchSession ---> matchWorker ---> LocalUnitSimulation
        |                                      |
        +---------- authoritative frames <----+
        |
        v
   UnitSystem and Three.js
```

`src/sim/` owns commands, movement, construction, production, combat, and victory. It runs on fixed ticks and does not depend on Three.js or browser input. `src/matchSession.ts` is the boundary between the renderer and either a local worker or a future remote match server.

Three.js owns presentation only. Projectiles, animations, health bars, selection state, and effects visualize authoritative state and events without deciding gameplay outcomes.

## Terrain

`src/mapTopology.ts` creates the seeded gameplay graph. `src/graphTerrain.ts` assigns lowland, mesa, and blocked-mountain roles. `src/generatedTerrain.ts` validates the resulting height field and exposes the same result to rendering and navigation.

`src/terrain.ts` builds the visible terrain. `src/sim/navigation.ts` builds Recast navigation from the terrain and living building obstacles. The simulation still owns unit movement, formations, collision resolution, attack positions, and combat.

See [`terrain_generation.md`](terrain_generation.md) for the generation stages and invariants.

## Multiplayer direction

The browser currently runs authority in a Web Worker. `RemoteMatchSession` already defines the client-side boundary for a future server.

The planned backend is Cloudflare PartyServer with one Durable Object per match. The server should host the existing deterministic simulation instead of duplicating game rules. The isolated [`prototypes/cloudflare-worker/`](../prototypes/cloudflare-worker/) experiment measures Worker compatibility, navigation startup, simulation cost, and per-player state replication. It is not part of the current runtime.

## Tools and prototypes

- `tools/preview/` renders production terrain, buildings, units, and effects for visual checks.
- `tools/assets/` prepares and inspects source assets used by the game.
- `prototypes/procedural-buildings/` showcases production buildings with their shared materials and archived references, using the production model loader.
- `prototypes/terrain-topology/` inspects the production terrain generator in 2D and 3D.
- `prototypes/cloudflare-worker/` tests the planned multiplayer environment.
- `prototypes/robot-dog-rigging/` explores a reusable mechanical-quadruped rigging process.
- `prototypes/terrain-props/` assembles local concept sheets and preview composites.

Production code must not import from `prototypes/`. Prototype code may import production modules to test a proposed integration.
