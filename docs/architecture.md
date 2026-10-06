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

`src/map.ts` requests Shifting Frontiers from `src/mapGenerators/`, then calls the pure `createTerrainEnvironment` pipeline for the approved New terrain. It returns the revised `MapLayout`, deterministic rock/plant placements and ground-cover fields. The main game and terrain hub share that result, `src/environmentProps.ts` for instanced models, and `src/terrainRendering/environmentMaterial.ts` for the scanned material. `src/terrain.ts` adds the game surface and skirt. Production code loads the six environment GLBs and nine textures from `assets/`, with no workbench or prototype dependency.

The final heightfield and obstacle mask feed rendering, Recast and construction placement. Mountains, substantial rubble and tree trunks block movement and building footprints; grass and low shrubs remain walkable. Grass beds follow the local ground normal while preserving their root spread.

`src/sim/navigation.ts` builds Recast navigation from the actual elevation mesh, excluding blocked-rock triangles, and updates building obstacles. All current units use this ground navigation, including Scout Drones and Hornets. Simulation still owns movement and combat.

The local combat proof uses six-player terrain but places the enemy at the nearest expansion to the player for quick combat testing. It does not use the remote enemy player start. For terrain experiments, shared changes and validation, read [terrain generation](terrain_generation.md).

## Multiplayer direction

The browser currently runs authority in a Web Worker. `RemoteMatchSession` already defines the client-side boundary for a future server.

The planned backend is Cloudflare PartyServer with one Durable Object per match. The server should host the existing deterministic simulation instead of duplicating game rules. The isolated [`prototypes/cloudflare-worker/`](../prototypes/cloudflare-worker/) experiment measures Worker compatibility, navigation startup, simulation cost, and per-player state replication. It is not part of the current runtime.

## Tools and prototypes

- `tools/preview/` renders production terrain, buildings, units, and effects for visual checks.
- `tools/assets/` prepares and inspects source assets used by the game.
- `prototypes/terrain-playground/` is the terrain experiment hub, using `src/mapGenerators/` and `src/terrainRendering/`.
- `prototypes/procedural-buildings/` showcases production buildings with their shared materials and archived references, using the production model loader.
- `prototypes/cloudflare-worker/` tests the planned multiplayer environment.
- `prototypes/robot-dog-rigging/` explores a reusable mechanical-quadruped rigging process.

Production code must not import from `prototypes/`. Prototype code may import production modules to test a proposed integration.
