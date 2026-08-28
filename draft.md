# Dune77

This is the living game-design document. It separates the playable build from the next intended slice and ideas that may never ship.

## Status key

- **Implemented now** describes behavior in the repository.
- **Planned next** describes the direction for the first complete skirmish.
- **Possible later** records ideas worth keeping without treating them as commitments.

`README.md` explains how to run the game. `docs/architecture.md` describes the runtime boundaries. `docs/terrain_generation.md` is the detailed source of truth for terrain generation.

## Game direction

Dune77 is a fast browser RTS set in a sun-scorched futuristic wasteland. Players build and defend bases, contest terrain and resources, produce individual units, and destroy every enemy Command Center.

The combat takes inspiration from *Age of Empires II: Definitive Edition*. The atmosphere draws from *Warhammer 40,000: Dawn of War*, *Dune*, *Cyberpunk 2077*, and classic desert RTS games. The goal is familiar strategic depth with fewer chores and a shorter path to meaningful combat.

One shared faction is enough for the first playable version. Asymmetry should come from map position, army composition, and upgrades before we add another faction.

### Design principles

- Make strategic choices matter more than repetitive economy actions.
- Give every strong unit or position readable counterplay.
- Let terrain create routes, flanks, chokepoints, and defensible ground.
- Keep reinforcement and control-group management quick.
- Preserve deterministic gameplay so tests, replays, and future multiplayer agree.

## Implemented now

### Combat proof

The repository contains a deterministic 1v1 combat proof. It is playable, but it is not yet a complete skirmish.

- The player starts with one Command Center and three Ghostrunners.
- The enemy has one Command Center, two Turrets, two Ghostrunners, and one Hornet.
- Enemy guards hold position and attack targets that enter range. There is no strategic AI.
- Command Centers train all four current unit types through independent five-slot queues.
- Scout Drones construct Turrets and additional Command Centers on valid terrain.
- Units can move, attack, and stop. Command Centers have selectable rally points.
- Combat, construction, production, deaths, and match results are authoritative simulation events.
- Destroying the enemy's final active or unfinished Command Center wins. Simultaneous elimination is a draw.
- The same seeded encounter can restart after resolution.

There are no resource costs, fog of war, roads, water, deposits, or strategic AI yet. Training time temporarily replaces unit cost.

### Current units

| Unit | Role | Health | Speed | Weapon |
| --- | --- | ---: | ---: | --- |
| Ghostrunner | Fast melee attacker | 140 | 9 | 20 damage every 1.1 seconds |
| Scout Drone | Unarmed flying scout and builder | 45 | 10 | None |
| Hornet | Flying ranged attacker | 180 | 8.5 | 30 damage every 0.8 seconds, range 14 |
| Behemoth | Heavy tracked siege unit | 900 | 5 | 140 area damage every 2 seconds, range 7 to 22, radius 4 |

The Behemoth uses attack-ground and damages friendly units and buildings inside its blast. The Hornet fires directly at units and buildings. The Ghostrunner uses model animations for idle, movement, attack, and death.

Current training times are 8 seconds for a Scout Drone, 12 for a Ghostrunner, 20 for a Hornet, and 35 for a Behemoth. A player may have at most three Scout Drones alive or queued.

### Current buildings

| Building | Role | Health | Construction | Weapon |
| --- | --- | ---: | ---: | --- |
| Command Center | Produces every current unit and anchors defeat | 2,500 | 60 seconds | None |
| Turret | Simple defensive structure | 900 | 10 seconds | 25 damage every 0.6 seconds, range 18 |

A Scout Drone creates a vulnerable construction site and travels to its edge. Construction pauses if the assigned drone moves, stops, or dies. Any friendly Scout Drone can resume the site. A completed Turret automatically attacks the nearest hostile unit in range. Direct-fire projectile damage resolves on the deterministic impact tick, when the rendered projectile reaches its target. Turret projectiles use the Hornet's glow treatment at a heavier scale.

This is ground construction. Buildings do not arrive from orbit in the current game.

### Current controls and presentation

- Left click or drag to select. Shift adds to the selection.
- Right click moves, attacks, resumes construction, or sets a rally point.
- `A`, `B`, `M`, and `S` select attack, build, move, and stop actions.
- Selection rings, range boundaries, health bars, projectiles, and animations present authoritative state without deciding outcomes.

See `README.md` for the complete controls.

### Current graph-driven terrain

The current map is not assembled from random hill blobs. It starts from a seeded gameplay graph and compiles that plan into one shared height field.

1. `src/mapTopology.ts` places player starts and builds hidden Voronoi regions and adjacency edges.
2. The graph selects elevated regions, route loops, access points, and chokepoints before visual shaping.
3. `src/graphTerrain.ts` assigns each region to lowland, a walkable mesa, or a blocked mountain.
4. Seeded warping turns straight region borders into organic contours without inventing detached terrain islands.
5. Mesas receive broad walkable slopes and flat tops. Mountains receive taller rocky profiles and remain blocked.
6. The generator validates two routes between player bases, connected walkable regions, reachable mesa access, and physically blocked mountains.
7. Rendering and Recast navigation consume the same height field and mountain mask.

The current match uses a 396 by 396 world-unit, six-start terrain layout. The game encounter remains a local 1v1 proof and places the enemy on the nearest connected terrain node instead of another player start, bypassing the normal base separator for faster combat testing. Normal multiplayer starts keep their separator regions. Each start has a flat construction area. Validation uses the largest current ground-unit clearance and the production slope limit.

Roads, water, Titanium Deposits, ruins, vegetation, and neutral sites are planned layers. They are not part of the current generator.

### Current technical shape

- TypeScript, Vite, and Three.js render the browser game with an orthographic camera and WebGL 2.
- A Web Worker runs the authoritative simulation at fixed 0.1-second ticks.
- `src/sim/` owns movement, construction, production, combat, and victory.
- Recast provides static terrain routes and updates local tiles when buildings appear or disappear.
- Game-owned movement preserves deterministic formations, collision resolution, and attack positions.
- `MatchSession` separates the renderer from local authority and a future remote server.

Production code lives under `src/`. Maintained visual and asset utilities live under `tools/`. Experiments live under `prototypes/` and are not production dependencies.

## Planned next

### First complete skirmish

The next goal is a repeatable match against a basic strategic AI. It should add:

- Energy and Titanium economy
- Titanium Deposits and automated mines
- Solar Arrays and at least one military production building
- Fog of war and exploration
- Roads, water, and resource-driven expansion
- Strategic AI that can build, produce, defend, scout, and attack
- Six to eight combat units introduced in small batches
- Persistent control groups and production rallying
- One clear victory condition based on Command Centers

The slice succeeds when fighting the AI for ten to fifteen minutes produces meaningful scouting, expansion, army composition, and attack decisions.

### Economy direction

The economy has two resources.

**Titanium** pays for units, buildings, repairs, and upgrades. Automated Titanium Mines sit directly on finite deposits. Deposits should last long enough to avoid constant rebuilding but eventually force expansion.

**Energy** comes from the Command Center and power structures. The preferred model is capacity rather than a second stockpile: advanced buildings and units reserve power while active. This needs a prototype before it becomes final.

The Command Center must always provide enough power to recover. Scout Drones and basic units should remain available during a power shortage.

### Scouting and fog of war

Fog of war is central to the intended match.

- Every unit provides vision; Scout Drones are the main explorers.
- Explored terrain remains visible after vision is lost.
- Enemy units require current vision.
- The treatment of previously seen enemy buildings remains open.
- A Scout Drone may start construction only on visible, valid ground.
- Finished buildings continue to operate after local vision is lost.

There is no territory or relay requirement in the current direction. Expansion depends on reaching and protecting valuable locations.

### Planned map layers

- Roads create predictable fast routes for reinforcement and raids.
- Water blocks or slows movement and creates explicit crossings.
- Titanium Deposits draw players away from their starting bases.
- Traversable ruins provide directional cover without blocking their whole footprint.
- Solid ruins and mountains shape larger lanes.
- Sparse palms, rocks, cracks, and debris add identity after gameplay space is fixed.

The graph remains authoritative. New layers must preserve its routes, starting areas, and chokepoints rather than cover them with independent noise.

### Planned core loop

1. Establish power and mine the safe starting Titanium Deposit.
2. Scout routes, crossings, deposits, and enemy movement.
3. Expand toward additional resources and defensible ground.
4. Build an army that answers the opponent's composition.
5. Attack production, power, mines, and Command Centers.
6. Establish another Command Center when the economy can support it.
7. Destroy every enemy Command Center.

## Possible later

These ideas are not commitments. Promote them into the planned section only after a prototype or playtest justifies them.

### Wider unit roster

| Unit | Possible role |
| --- | --- |
| Rifleman | Cheap general-purpose infantry |
| Arc Archer | Fragile long-range electromagnetic marksman |
| Juggernaut | Slow armored infantry with sustained fire |
| Rocket Trooper | Long-range anti-building and anti-vehicle infantry |
| Heavy Tank | Durable armored frontline unit |
| Artillery | Long-range area pressure with poor close defense |

The intended counter structure is readable rather than perfectly circular. Range, speed, line of sight, formation, and production cost should do most of the balancing before hidden damage bonuses are added.

### Wider building roster

- Solar Array for cheap exposed power
- Generator or Reactor for compact higher-output power
- Titanium Mine for automated extraction
- Barracks for infantry
- Vehicle Bay for vehicles and siege units
- Mercenary Camp as a neutral capturable or usable site
- Orbital Navigation Array for late-game survey and strike systems

### Technology progression

A possible three-stage structure replaces historical ages:

1. **Stranded:** basic infantry, mines, solar power, and defenses
2. **Connected:** vehicles, better power, advanced weapons, and additional Command Centers
3. **Dominance:** heavy armor, siege systems, and late-game technology

Each stage should unlock new decisions instead of only increasing numbers.

### Orbital deployment is postponed

The original concept had buildings dropped from orbit in the style of *Dawn of War*. The current Scout Drone construction system replaced it for now because a convincing landing and unfolding sequence is expensive to animate and integrate.

Orbital deployment may return later as presentation for selected structures or abilities. It should not change the placement and construction rules until the animation proves worth the work.

### Late-game systems

An Orbital Navigation Array could unlock a one-time Planetary Survey and an expensive orbital strike. A strike should require current vision, warn every player, allow counterplay during its charge, cause friendly fire, and destroy a compact fortified base on a direct hit.

Periodic upgrade choices are another possible source of match variety. Each offer would present a few focused improvements to units or defenses. The pool, interval, stacking, and fairness rules all need playtesting.

### Multiplayer direction

Cloudflare Workers with PartyServer is the current candidate. One Durable Object would own one match and host the existing deterministic simulation. The server adapter should remain thin and keep Cloudflare code out of `src/sim/`.

Before adoption, the prototype under `prototypes/cloudflare-worker/` must validate simulation cost, Recast WASM startup, reconnect behavior, persistence, and per-player fog-filtered updates. SpacetimeDB remains a fallback, not a parallel implementation.

## Art direction

The game uses stylized low-detail 3D models with strong silhouettes and a fixed high-isometric camera. The accepted images under `art/` are references for concept and model generation, not runtime sprites.

The current palette combines pale sand, warm bone or ivory armor, charcoal machinery and undersuits, muted rust, and restrained cyan lights. Unit design should read clearly at gameplay distance.

The models do not have player-color materials yet. Ownership is shown through selection, range, command, and health UI. Model-level player-color accents remain an open art task.

Meshy creates the initial models. Blender handles repairs, rigging, animation work, texture preparation, and export. See `docs/assets.md` for the active workflow and license boundaries.

## Open decisions

1. Should energy be capacity, a stockpile, or a hybrid?
2. How quickly should Titanium Deposits deplete?
3. What information remains visible for enemy buildings under fog?
4. How should roads and water change movement without making pathfinding brittle?
5. Which two additional units make the first skirmish strategically complete?
6. Which military production buildings belong in the first skirmish?
7. What player-color treatment works with the current models?
8. When, if ever, is orbital building deployment worth its animation cost?
9. What terrain checks are required before generated maps are fair enough for competitive play?
10. When should the Cloudflare prototype become a real multiplayer adapter?

## Naming

Dune77 is a working title and requires a trademark check before public commercial release.
