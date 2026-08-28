# How terrain generation works

The game and `prototypes/terrain-topology/` use the same deterministic terrain layout from `src/generatedTerrain.ts`.

```text
Seed and player count
        ↓
Build the gameplay topology
        ↓
Assign lowland, walkable mesa, and blocked mountain roles
        ↓
Warp the hidden region borders into organic contours
        ↓
Shape smooth mesa slopes and rocky mountain profiles
        ↓
Validate routes and physical reachability
        ↓
Render the height field and navigate from the same landform mask
```

## 1. Build gameplay structure first

`src/mapTopology.ts` creates seeded region nodes and their hidden Voronoi adjacency. The graph chooses player starts, elevated regions, route loops, and chokepoints before visual shaping begins.

The graph is construction data. Its straight cell borders are not rendered.

## 2. Assign landform roles

`src/graphTerrain.ts` classifies graph regions as:

- Lowland, which forms the main movement space.
- Mesa, which has a broad sandy top and walkable slopes around its perimeter.
- Mountain, which is taller, rocky, and blocked to ground units.

Wide level-1 regions become mesas. Narrow or higher elevated regions become mountains. Mountain footprints expand locally while protecting graph nodes and access near walkable terrain.

## 3. Make the graph organic

The compiler blurs the region fields and applies seeded multi-scale noise near shared borders. This moves the boundary without letting noise invent detached terrain islands.

Walkable mesas use the same smoothed contour profile as the earlier hill generator. Their slopes are broad and continuous rather than grid-distance bands or isolated ramps. Large interiors remain flat.

Mountains use a separate depth-based ridge profile with seeded height variation. They rise directly as one steep mass rather than sitting on a level-one shelf. A wider foundation mask blends darker dirt and scattered rock color into the surrounding sand before the mountain face begins.

## 4. Protect starting areas

Each player starts on level-1 terrain. The generator preserves a flat 28-unit radius for the initial Command Center and nearby buildings, then blends it into the surrounding mesa over the next eight units.

## 5. Validate the physical result

The generator rejects a candidate unless:

- The walkable graph stays connected and provides two base routes.
- Every non-mountain graph node is physically reachable.
- Mountain nodes remain unreachable to ground units.
- Graph-authored ascent crossings remain reachable.

Validation uses the largest current ground-unit clearance and the production slope limit.

## 6. Share one runtime result

`src/generatedTerrain.ts` is the public generator. `src/map.ts` passes its height field, blocked mountain mask, and visual foundation mask into gameplay. `src/terrain.ts` renders the height field and applies both material masks. Navigation builds its terrain polygons from the blocked mask: sandy lowland and mesas are traversable, while rocky mountain triangles are omitted. Unit-radius erosion still keeps large units out of genuinely narrow gaps. The unified preview calls the same public generator and renderer.

The 2D view exposes graph intent. The rendered view and game show the resulting physical terrain.
