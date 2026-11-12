# Dune77

Dune77 is a fast browser RTS whose gameplay is developed through focused playable slices before the complete match loop.

## Language

**Combat proof**:
A short playable encounter that proves selection, Scout Drone harvesting and construction, time-based unit production, and combat against a preconfigured enemy force and base. It collects Titanium but does not yet price construction or training, or include a strategic AI opponent.
_Avoid_: MVP match, full game loop

**Scout Drone**:
The player's unarmed scout, builder, and miner. Its current movement follows ground navigation, despite its hovering appearance. It creates and works on construction sites, harvests Titanium Deposits, and carries ore to completed friendly Command Centers. It is produced by the Command Center.
_Avoid_: Villager, orbital designator

**Titanium Deposit**:
A finite, neutral ore outcrop. Scouts extract Titanium from accessible positions outside its blocked footprint. Depletion leaves the rock in place.

**Titanium cargo**:
Ore carried by a Scout. It enters the player stockpile only after delivery to a completed friendly Command Center. Destroying a loaded Scout loses its cargo.

**Construction site**:
A vulnerable, incomplete building created by a Scout Drone's build order. It becomes operational only after a Scout Drone finishes constructing it.
_Avoid_: Orbital drop, instant building

**Time-based production**:
The combat proof's temporary production model: the Command Center can train every currently playable unit, with stronger units occupying its production queue for longer. Time substitutes for resource costs until the economy is introduced.
_Avoid_: Free production, final economy

**Orbital deployment**:
A deferred alternative in which buildings arrive from orbit instead of being built on the ground. It is not part of the combat proof.

**Elevated mass**:
A major connected area above the surrounding ground. Its height, landform type, walkability, and material are separate properties.
_Avoid_: Blob, hill dot

**Elevation level**:
An authored gameplay height used by walkable ground. A landform may span several levels without creating a walkable shelf at every intermediate level.
_Avoid_: Hill layer, visual step

**Plateau**:
A walkable elevated top at one authored elevation level. A plateau may sit several levels above low ground and connect through an authored ascent without requiring intermediate terraces around its border.
_Avoid_: Mountain, stacked hill

**Mountain**:
An elevated mass with a blocked rocky body rather than a sandy walkable top. It may rise across several elevation levels as one continuous form.
_Avoid_: Plateau, pyramid

**Terrace**:
An explicitly authored walkable shelf between elevation levels. Nested elevation contours do not imply a terrace.
_Avoid_: Automatic level step

**Terrain channel**:
Walkable low ground between elevated masses. A terrain channel may later receive a visible road or track, but it is not itself a road.
_Avoid_: Road, graph edge

**Cliff border**:
The unwalkable transition between authored elevation levels. Its visual rocks, broken edge, and debris may be irregular without introducing additional gameplay elevations.

**Map family**:
A seeded set of layout rules, such as Frontier strongholds or Shifting frontiers. Changing the seed produces a new layout within those rules; changing the family changes the rules themselves.

**Map layout**:
The deterministic data produced by a map generator: terrain fields, sites and entrances. It is separate from rendering and from a running match.

**Terrain hub**:
The shared playground for comparing map families and terrain appearance. Its base and supply markers describe intended roles; they are not match entities. For implementation and validation, read [terrain generation](docs/terrain_generation.md).

**Embedded outcrop**:
Rock relief formed within the terrain height field, with a buried shoulder and exposed core. Textured dust and fragments around its contact are presentation; they do not by themselves create a movement obstacle.
