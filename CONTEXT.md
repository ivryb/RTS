# Dune77

Dune77 is a fast browser RTS whose gameplay is developed through focused playable slices before the complete match loop.

## Language

**Combat proof**:
A short playable encounter that proves selection, Scout Drone construction, time-based unit production, and combat against a preconfigured enemy force and base. It does not require a resource economy or a strategic AI opponent.
_Avoid_: MVP match, full game loop

**Scout Drone**:
The player's unarmed scout and builder. It creates and works on construction sites and is produced by the Command Center.
_Avoid_: Villager, orbital designator

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
