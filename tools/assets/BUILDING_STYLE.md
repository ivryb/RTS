# Procedural building style

The target is the compact, worn, ivory-and-graphite character of the original Meshy command center and turret. Use their proportions and structural relationships as references; do not import their geometry or texture pixels.

## Accepted buildings

**Field station with ivory shoulders** is the production command center. Its uninterrupted ivory shoulders keep contrast in the glazing, recessed hatches, service trench, and weathering. **Compact foundation revision 09** is the production turret. Both share the Aged desert materials and geometry primitives.

New buildings should keep their compact proportions, softened armor corners, purposeful recesses, and quiet broad ivory surfaces. Add detail where a part has a clear mechanical role.

## Shape rules

Alternate protective armor with recessed equipment. A continuous rounded wall reads as a bell-shaped shell; narrow isolated pillars read as a fortress. Keep rounded corners, but distinguish lower wall plates from shoulder caps with an actual seam. Recesses contain recognizable service hatches, hinges, catches, cooling covers, or louvers.

Keep the cabin nested into the equipment deck. Separate ledges connect it to the shoulders; a broad continuous white terrace makes the cabin look stacked on another building. The cabin keeps sloped glazing, ivory corner posts, a thin cornice, and a shallow roof crown.

Make the entrance part of the hull: a short projecting canopy, recessed door leaves, and a compact ramp. Four shallow landing shoes spread the load near ground level. Most of each shoe sits under the hull; exposed ankles and large sloping paddles change the silhouette too much.

The dish has a low azimuth housing, elevation fork, concave reflector, narrow rolled rim, and tapered receiver. Its polar finish uses radial panel joints, a concentric seam, restrained grain, and rim aging. A rectangular wall tile is inappropriate for this surface.

The turret foundation alternates compact rectangular feet with rounded service pods. Feet have parallel sides and small corner bevels; narrow dark gaskets separate modules. Pods meet the straight foot walls without wavy cutouts. Plain ivory bands sit below the bearing without a shiny inset. Keep the head connected through its full rotation using an overlapping spindle and socket.

## Materials and joins

Use the shared Aged desert palette. Weathering concentrates at seams, rims, fasteners, and lower wall edges. Keep broad ivory centers quiet, but retain the roof and shoulder color textures: removing them made the previous study look uniformly clean. Cyan stays concentrated at the entrance.

Map plates along their physical surfaces. Height-only UVs collapse horizontal caps to a single texture row, producing flat brown patches in a bake even when the draft looks acceptable. The curved armor follows cumulative surface distance, with independent tiles above and below the horizontal seam.

Adjoining geometry shares definitions. Cooling covers and their borders use one shoulder profile. Ledges start at that shoulder's transformed inner edge and end at the cabin sill. Apply the same hull transform to armor, equipment, feet, and entrance. Lower the cabin and antenna together when the compact hull gets shorter.

Armor returns stop at the side opening; they must not cross its center. Shoulder vent cavities follow the surface normal, with concealed diagonal deck trays below the opening and clear gaps between the louvers.

## Review

Compare actual GLB exports in the game terrain and lighting, at fixed world scale. Inspect close front, rear, low-angle, and gameplay views. Use plain materials to judge geometry separately. A correct build or successful geometry check does not establish art-direction acceptance.

The [building showcase](../../prototypes/procedural-buildings/README.md) keeps the archived Meshy models available as an optional comparison. Regular framing and crisp service hatches still differ from the irregular Meshy surface. Inspect future changes beside the accepted procedural models and those references before adopting a new direction.
