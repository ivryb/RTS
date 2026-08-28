# Dune77

Working game-design draft. Nothing here is sacred yet; decisions marked **Current direction** are the ideas we presently want to build around, while **Open** items still need to be tested or decided.

## High concept

Dune77 is a fast, browser-based RTS set in a sun-scorched cyberpunk wasteland. Players establish an orbital-supported base, generate energy, mine titanium, deploy buildings from space, and fight over roads, water, resources, and the ruins of abandoned cities.

The game takes inspiration from the strategic counterplay of Age of Empires II, the desert atmosphere of Stronghold Crusader and Dune, and the heavy orbital machinery and battlefield control of Dawn of War.

Target match length: **15–25 minutes**.

First mode: **1v1 against another player or a bot**.

## Faction scope

**Current decision:** the game has one playable faction. Both players use the same core buildings, units, and technology tree.

## Design pillars

### Strategic without busywork

Expansion, army composition, positioning, and timing should matter. Repetitive worker micromanagement should not dominate the match.

### Clear counterplay

Every unit needs a recognizable silhouette, a clear purpose, and an understandable weakness. Counters should create a strong advantage without making battles completely predetermined.

### The map matters

Roads, sand, water, ruins, high ground, and resource locations should shape movement and create natural fronts, ambushes, and defensive positions.

### Fast reinforcement

New units can automatically join control groups and move toward their assigned army. Rebuilding after a fight should not require reorganizing every new unit by hand.

## Starting a match

Each player begins with:

- A Command Center
- A small amount of titanium
- Limited baseline energy from the Command Center
- One Scout Drone for immediate exploration
- The ability to produce additional Scout Drones from the Command Center immediately
- Enough starting capacity to build either an economy structure or an early military structure

The generated map must guarantee a safe Titanium Deposit and enough building space near every starting position. A player should never lose because the map generated an unusable start.

## Economy

**Current direction:** the economy has two primary resources: **energy** and **titanium**. Salvage from ruins and wrecks is not a core resource for now.

### Titanium

Titanium is extracted from visible **Titanium Deposits**: low, walkable fields of angular charcoal-black ore with thick silver-white veins, raised slightly above the desert like the stone and iron deposits in Stronghold Crusader. Their dark mass and bright fractures must remain recognizable against pale sand at the normal game camera distance.

The player places a **Titanium Mine** directly on a deposit. It is an automated orbital mining facility and produces titanium over time without requiring miners. The exposed veins and mineable mass should visibly diminish as the deposit is depleted.

Titanium is stockpiled and spent on:

- Buildings
- Infantry and vehicles
- Repairs
- Technology upgrades

Deposits should eventually run out, but not so quickly that the player must constantly replace mines. Depletion forces gradual expansion and creates valuable targets to contest.

### Energy

Energy is produced by:

- Solar Arrays: cheap, exposed, and spread over a larger area
- Generators: reliable mid-game power structures
- Reactors: expensive, compact, high-output late-game structures

**Open:** decide whether energy is stockpiled and spent like a normal resource, or whether it behaves as power capacity. The simpler and more distinctive model may be:

- Titanium pays for construction.
- Power plants increase the base's available energy capacity.
- Buildings and advanced units reserve some of that capacity while active.
- Orbital drops temporarily consume energy when called.

This gives titanium and energy different jobs instead of making them two differently colored currencies. It needs a prototype before becoming a final decision.

### Preventing economic deadlocks

- The Command Center always supplies a small amount of energy.
- A player can always rebuild a basic Solar Array after losing external power.
- Scout Drones and basic infantry must remain available under low power.
- Losing power should disable advanced systems before essential recovery tools.

## Scouting, fog of war, and expansion

**Current decision:** fog of war is central to the game. The player explores the procedurally generated map primarily with Scout Drones, although every unit provides vision. Scouting reveals terrain, routes, enemy activity, and Titanium Deposits.

Construction follows simple vision rules:

- Any unit provides vision around itself.
- The player can deploy a building on any valid location that is currently visible.
- Solar Arrays and ordinary buildings can be placed on suitable open ground.
- A Titanium Mine can only be placed directly on a discovered Titanium Deposit.
- Once deployed, a building continues to operate even if the player loses vision around it.
- There is no territory, relay, or coverage requirement.

This makes economic expansion a product of scouting and map control. A player harasses the opponent by destroying exposed Solar Arrays and Titanium Mines, occupying valuable deposits, and preventing expansion units from safely reaching new areas. There are no villagers to raid.

Explored terrain remains known under fog of war, while enemy units require current vision to see. The exact treatment of previously seen enemy buildings can be decided during prototyping.

## Base building and orbital deployment

Buildings are fabricated or stored in orbit, dropped onto the battlefield, and unfold automatically. There are no conventional construction workers in the current design.

Recommended rules:

- Buildings can land on any valid location inside the player's current vision.
- A landing zone is visibly marked for a few seconds.
- The building is vulnerable while landing and unfolding.
- Large orbital drops have cooldowns.
- Buildings cannot be dropped directly on enemy units.
- Titanium pays for the building; energy powers the orbital delivery and operation.

After landing, a building operates normally anywhere on the map. Losing vision does not disable or remove it.

## Initial building roster

### Command Center

The heart of a base. Provides baseline power and produces Scout Drones immediately. The Scout Drone is the Command Center's first direct unit-production role; ordinary combat infantry still come from the Barracks.

Players can deploy additional Command Centers at valid locations inside their current vision, creating separate bases across the map. A new Command Center is expensive, takes a long time to land and unfold, and is clearly announced to the opponent. A player is defeated only when all of their Command Centers have been destroyed and none is currently being deployed.

### Solar Array

Provides early energy. Cheap, visually distinctive, and vulnerable because it occupies a broad open area.

### Generator / Reactor

More compact power production for later stages of the match. Exact differences between generators and reactors are still open.

### Orbital Navigation Array

An expensive Dominance-stage observatory, communications system, and precision laser uplink. It provides two late-game capabilities:

- **Planetary Survey:** a costly one-time technology that permanently explores the entire terrain, including resource deposits and neutral locations. It does not provide live vision of enemy units or remove fog of war; ordinary scouting is still required to see current enemy activity.
- **Orbital Nuclear Strike:** a massive base-destroying weapon guided by the Array's targeting laser.

The strike should feel like a true late-game superweapon rather than stronger artillery. It requires an enormous amount of titanium and energy, has a long charge and cooldown, and cannot be fired repeatedly. The player must have current vision of the target when designation begins. A visible targeting beam, global warning, and delayed impact give the opponent time to evacuate mobile units or destroy the Navigation Array and abort the strike.

At impact, the inner blast destroys every ordinary unit and building in a base-sized radius, including Command Centers, while the wider shockwave deals severe damage. The weapon causes friendly fire. Its purpose is to erase one fortified base completely, but not necessarily end the match: a prepared opponent can survive through Command Centers and production established elsewhere on the map.

Exact cost, radius, warning time, and whether any exceptionally hardened structure can survive at the edge of the blast remain balance questions. The core promise is not open: a direct hit must produce an enormous explosion and leave a compact base effectively gone.

### Titanium Mine

An automated orbital mining facility that must be placed directly on a Titanium Deposit. It extracts and stockpiles titanium without requiring workers.

### Barracks

Produces individual infantry units.

### Vehicle Bay

Produces cars, heavy tanks, walkers, and siege vehicles.

### Turret

Controls ground and protects economic structures. It is effective against ordinary units but is outranged by Rocket Troopers, Heavy Tanks, and Behemoths, which deal strong damage to buildings. A turret therefore delays an unsupported assault but cannot defeat a properly protected siege force by itself.

### Mercenary Camp

A neutral structure found on the map. Controlling it allows the player to hire local units whose improvised wasteland appearance contrasts with the clean professional army.

## Terrain and movement

**Current direction:** terrain changes movement speed and positioning. These values are starting points, not final balance numbers.

| Terrain | Initial behavior |
| --- | --- |
| Paved road | Fastest ordinary movement; approximately 20% faster |
| Firm desert | Normal movement speed |
| Soft sand / dunes | Approximately 15% slower, especially for heavy units |
| Shallow water | Strong movement penalty; units remain vulnerable while crossing |
| Deep water | Impassable to ordinary ground units |

### Roads

Procedural roads connect important areas of the map. They make reinforcement and raiding faster, but units travelling on them are exposed and easy to predict. Roads are wide abandoned asphalt highways or city streets with faded markings, cracks, repairs, and windblown sand. They are generated as mostly straight, ground-level corridors before hills. They may make a broad detour around water or use an explicit crossing, but hills must never rise through a road corridor.

Future ruined city blocks and abandoned buildings should be generated in candidate bands alongside roads after the road network is fixed. They still claim normal placement footprints, keeping intersections, road surfaces, water, and other buildings clear.

### Water

Ponds, oases, canals, and rivers create attractive visual contrast against the yellow desert and reshape movement.

- Oases and ponds should be occasional small landmarks, not dominant features that consume large parts of the battlefield.
- Rivers may create choke points, but every river must have several guaranteed walkable crossings so it never divides the map into disconnected halves.
- Shallow crossings slow armies.
- Bridges and roads provide faster but predictable routes.
- Some oasis or fountain locations may heal units outside combat, but this is not yet a core rule.

### Ruins

Ruins provide cover against ranged attacks and help form lanes through abandoned cities. Most ruins are **traversable cover fields**, not solid building footprints: units can move through the ruined floor and between wall fragments while walls, windows, columns, and rubble edges provide directional protection.

| Ruin type | Navigation | Tactical role |
| --- | --- | --- |
| Traversable ruin cover | The interior floor and gaps remain walkable; only explicit wall sections, columns, and large rocks block movement | Creates protected firing positions, ambush spaces, and short lanes without becoming a permanent map barrier |
| Solid ruin obstacle | The main structure footprint is impassable and may also block vision | Shapes larger movement lanes and provides cover around its exterior edges |

Traversable ruins are the default. Their art must clearly communicate usable space: open floors, broken wall lines, windows, multiple entrances, low rubble, and gaps wide enough for units. They claim an exclusion footprint during procedural placement so other objects are not generated inside them, but their runtime navigation is defined by a local walkability mask rather than blocking the entire footprint.

Solid obstacle ruins may use denser collapsed buildings, intact shells, or boulder-heavy footprints. They should be less common and must not accidentally seal essential routes.

The first cover implementation can remain simple and deterministic: walls and window sections register cover edges, and a unit receives protection only when the relevant edge lies between it and the attacker. Destructible walls, interior floors on multiple levels, and detailed indoor simulation are out of scope for now.

### High ground

High ground should grant better vision and possibly a small range advantage. It should not provide bonus damage and damage reduction simultaneously, because that may make established positions too difficult to challenge.

Procedural high ground starts from a seeded gameplay graph. Hidden Voronoi adjacency defines regions, route loops, elevation relationships, and blocked areas. The terrain compiler then assigns each region to lowland, a walkable mesa, or a mountain. Wide level-1 elevated regions become mesas; narrow or higher regions become tall blocked mountains.

The graph controls the large-scale layout, but its polygon borders are not rendered directly. Seeded field warping bends shared borders into organic contours without creating detached hill fragments. Walkable mesas use broad continuous slopes around their perimeter and keep large flat interiors. Mountains rise directly as tall, steep masses without a level-one shelf. A separate foundation mask blends darker dirt and rock into the nearby sand before the mountain face begins.

Each starting position keeps a flat level-1 construction area. The generator validates graph connectivity against the final height field using the largest current ground-unit clearance and slope limit. Non-mountain nodes must remain reachable, mountain nodes must remain blocked, and every pair of bases must retain two graph routes.

`src/generatedTerrain.ts` supplies the same height field, blocked mountain mask, foundation mask, and topology to gameplay and the unified terrain preview. `src/terrain.ts` renders both paths with the same material logic. Ground navigation uses only the blocked mask as its terrain boundary, so the softer foundation remains walkable while rocky mountain bodies stay blocked. The current production match remains 1v1, while terrain generation supports two to six player starts.

Ground navigation uses radius-aware tiled terrain layers, so large units cannot pass through gaps that fit infantry. Buildings are temporary navigation obstacles: construction or destruction updates only the affected tiles instead of rebuilding the entire terrain mesh.

### Layered ground and decoration

The desert should be built as a small layered system rather than one sand image stretched across the map.

| Layer | Contents | Placement behavior |
| --- | --- | --- |
| Base surface | Pale sand and darker compacted warm ground | Continuous materials mixed by broad, low-frequency procedural masks with soft irregular borders; no placement footprint |
| Surface detail | Cracks, dried mud, dust stains, and tiny embedded stones | Sparse decals or material masks; cosmetic only and cleared beneath later buildings |
| Soft scatter | Loose pebbles and very small debris | Instanced decoration; does not block units and is hidden or cleared when a building occupies the area |
| Hard props | Bushes and large dark brown rocks or boulders | Claim explicit footprints and must clear roads, water, hills, resources, structures, and reserved starts |

The current ruin is the palette anchor: pale sand is approximately `#d0bda0`, while compacted dust and earth are approximately `#a9987d`. The two base surfaces should vary gradually across large regions. Small decals break repetition locally; they must not cover the whole map with another repeated wallpaper pattern.

Runtime materials should separate scale levels: fine tiling supplies grain and roughness, broad procedural masks create regional color variation, and sparse authored decals add recognizable cracks or mud. Props should come in reusable families with varied rotation, scale, and grouping. A few source boulders can form many clusters; the generator must not repeatedly place one visibly identical cluster.

**Current texture roles:** Aerial Beach 01 is the single base texture. Broad procedural patches use either Coast Sand 05 or Dirt Aerial 03, with a long gradual blend into the base; the seed controls patch placement, not texture selection. Stone Embedded Tiles, Hexagonal Concrete, and Mud Cracked Dry 03 are reserved for future authored locations such as structure aprons, roads, industrial ground, or dried basins rather than general random mixing.

## Procedurally generated maps

**Requirement:** skirmish and multiplayer maps are generated procedurally from a shareable seed.

The current 1v1 battlefield is **240 × 240 world units**. Larger matches scale with their player count: 320 for three players, then another 40 world units per additional player up to 440 for six. Neutral mesa count grows from four in 1v1 to ten in a six-player map, in addition to one plateau per base. Bases follow a square inset so multiplayer maps use the corners. The target composition is several large separated plateaus with winding low-ground roads between them, not a central knot, circular hill cells, or one connected ridge chain.

Procedural generation must create strategically valid maps, not merely random-looking terrain. Every generated map should pass the following rules:

- Fair starting areas for every player
- A guaranteed nearby Titanium Deposit per player
- Enough usable space for an initial base and Solar Arrays
- Connected routes between all starting positions
- No player trapped by deep water, cliffs, or impassable terrain
- Roads that connect starts to valuable central or side areas
- Several expansion deposits outside the safe starting zones
- Water that creates interesting routes without randomly deciding the match
- A battlefield large enough that palms and buildings read as small tactical objects rather than defining the scale of the whole map
- Contested neutral locations such as mercenary camps or high ground
- Similar total resource opportunity for each player, without requiring perfect mirror symmetry

A sensible generation order is:

1. Place player bases, two route curves per base, and a fixed number of large plateau spines around those routes.
2. Compile the warped plateau contours into the shared terrain height field, add local ramps, then validate base-to-base routes and reserve fair starting zones in the placement grid.
3. Generate water and broad base-ground regions without breaking the validated topology, then classify impassable cells.
4. Generate mostly straight road corridors between strategically important regions, detouring around blocked terrain or using guaranteed crossings.
5. Place starting and expansion Titanium Deposits on valid unclaimed terrain.
6. Place ruins, palms, bushes, boulders, cover, and neutral structures while claiming generation footprints. Traversable ruins then contribute their own local walkability and cover-edge masks; solid ruins contribute blocked navigation footprints.
7. Add non-blocking cracks, mud, pebbles, and debris only after the occupied layout is known; clear or suppress them under structures and on incompatible surfaces.
8. Run automatic connectivity, overlap, and fairness assertions; treat a failure as a generator bug instead of rerolling the seed.

The placement grid is the shared authority for terrain and occupancy. Water, hills, roads, palms, reserved starts, resources, and later buildings claim flags or footprints on this grid. Rendering consumes the generated result but does not decide whether two objects are allowed to overlap.

The first prototype should use one desert biome and a small number of reliable terrain pieces. Biome variety can come later.

For the current fixed-camera prototype, palms use detailed high-isometric alpha sprites with thin trunks, asymmetric crowns, and many narrow drooping fronds. This is a visual experiment inspired by classic desert RTS readability, not a commitment to render every future prop as a sprite.

## Controls and quality of life

- Every infantry soldier, vehicle, and siege machine is produced and controlled individually.
- The bottom-left selection HUD uses an RTS action grid beside unit portraits. Every combat unit starts with **Attack (`A`)**, **Move (`M`)**, and **Stop (`S`)**; the unarmed Scout Drone currently exposes Move and Stop instead.
- A visible building can be selected with a left click regardless of ownership. Its selection card identifies the building, allegiance, and current and maximum health. Friendly buildings use the same contextual action-grid area as units as production and construction actions are added; enemy-building selection is read-only. Buildings do not enter unit drag-box selection or receive unit movement and combat commands.
- Behemoth replaces ordinary Attack with **Attack ground (`A`)**. Its current prototype firing annulus runs from 7 to 22 world units: it approaches targets beyond maximum range and backs away from targets inside minimum range before firing. The attack deals 140 area damage in a 4-unit radius every 2 seconds. As true area fire, it damages every unit and building footprint in the blast, including friendly targets. Like the Hornet, it authoritatively rotates to face its target before committing a ready shot, then launches immediately once aligned; a move or stop order during that turn cancels the uncommitted attack completely. Damage resolves one 0.1-second simulation tick after the first rocket explodes rather than when it launches. Each weapon-fire event presents as a staggered seven-rocket barrage: layered irregular translucent orange exhaust flames, a brief launcher glow, individually wandering high arcs, low-cost pooled smoke, large overlapping impacts across the damage area, and broad connected scorch marks that linger before fading. Selecting the Behemoth shows sparse warm-primary dotted minimum and maximum boundaries fixed to the terrain, while the Hornet shows the same style for its single maximum range; future selectable turrets should reuse this treatment. HUD stats list attack damage and the numerical range. Ranged and area-impact checks use the target's visible combat footprint rather than its broader navigation clearance or only its center. Entering Attack Ground shows a restrained but clearly readable red cursor-following area preview with a solid border and faint fill. World-space selection, command, range, and attack colors come from one shared UI palette.
- Each selected unit type receives one portrait card showing its count, current or average health, maximum health, movement speed, and attack damage when armed. Mixed selections show one card per type rather than pretending the whole selection is one unit. Contextual world health bars appear for units and buildings while selected, below maximum health, or for three seconds after they attack or take damage. Units stop participating in combat at zero health; Ghostrunners play their one-shot `Dead` model animation at 1.3× speed, leave the corpse on its final pose for 4 seconds, then fade it out over 2 seconds.
- Selecting multiple ranged unit types hides their range overlays. Selecting several ranged units of one type merges overlapping circles into a single exterior coverage boundary instead of drawing intersecting interior arcs.
- Formation slots use each selected unit's collision size rather than fixed infantry spacing. Behemoths resist displacement by lighter units, while grouped or overlapping Behemoths keep destinations outside each other's visible vehicle footprint.
- Current prototype stats are Ghostrunner 140 health / 9 speed / 20 direct damage every 1.1 seconds, Scout Drone 45 / 10, Hornet 180 / 8.5 / 14 attack range / 30 direct damage every 0.8 seconds, and Behemoth 900 / 5. These are visible tuning values, not final balance. Direct and ground attacks, damage, deaths, and weapon-fire timing are authoritative simulation events; Three.js projectiles and flashes only visualize those events.
- Selecting multiple units and assigning a number creates a persistent control group.
- The interface shows a small numbered group icon for units belonging to a control group.
- A production building can use an existing control group as its gather point.
- Every new unit from that building automatically joins the chosen control group and travels toward the group.
- Multiple production buildings can reinforce the same control group.
- A linked control group remains available even if all its current units die, allowing production to refill it.
- Players can change or disable automatic grouping per production building at any time.
- Idle military units can be selected with one key.
- Units maintain useful loose formations without constant manual adjustment.

## Early unit roster

The initial combat roster should remain compact. The complete early roster currently contains roughly nine combat units plus the Scout Drone, although the first combat prototype can introduce them in smaller batches.

| Unit | Purpose | Strong against | Weak against |
| --- | --- | --- | --- |
| Scout Drone | Very fast, extremely fragile, unarmed scout with a committed self-detonation option | Vision, remote deployment, and isolated light infantry at the cost of the drone | Any ranged fire, turrets, and grouped infantry |
| Hornet | Fast flying ranged skirmisher firing visible laser bolts | Scouts, exposed infantry, and slow unsupported targets | Arc Archers, Juggernauts, turrets, and concentrated fire |
| Juggernaut | Slow, heavily protected infantry with a six-barrel rotary machine gun | Light infantry, drones, light vehicles, and heavy targets under sustained fire | Arc Archers, artillery, and coordinated Ghostrunner flanks |
| Arc Archer | Fragile long-range electromagnetic marksman | Ghostrunners before contact, Juggernauts, Rocket Troopers, drones, turrets, and light vehicles | Ghostrunners at close range, Rifleman pressure, and fast raids |
| Ghostrunner | Very fast cybernetic melee assassin with limited projectile evasion | Arc Archers after closing, Rocket Troopers, artillery, and isolated infantry | Massed fire, suppression, explosives, vehicles, and buildings |
| Rocket Trooper | Slow long-range infantry carrying a heavy rocket launcher | Buildings, heavy vehicles, and stationary machinery | Arc Archers, Ghostrunners, and mobile light units |
| Dust Runner | Armed retro muscle car for raids and drive-by attacks | Exposed infantry, mines, and extractors | Turrets and anti-vehicle weapons |
| Heavy Tank | Slow, heavily armored frontline vehicle with a large laser cannon | Light vehicles, fortified positions, and infantry caught in open ground | Rocket Troopers, other tanks, and sustained fire from protected specialists |
| Behemoth | Slow tracked rocket artillery | Buildings and stationary formations | Fast units at close range |

Stealth should probably belong to a separate mercenary assassin rather than the already-fast Ghostrunner.

### Initial counter framework

The first counter system should combine unit composition with distance and positioning rather than create a closed rock-paper-scissors triangle.

- **Arc Archer versus Ghostrunner is range-dependent.** Arc Archers win while they have distance, vision, and a screen. A Ghostrunner that survives the approach should kill them quickly in melee.
- **Juggernauts are durable, not invulnerable.** Their six-barrel rotary guns suppress frontal light infantry and build up meaningful damage against slow armored targets when allowed to fire continuously. Arc bolts are their cleanest counter. Several Ghostrunners can surround a lone Juggernaut, but charging a supported line of them should be inefficient.
- **Rocket Troopers are the hard anti-armor answer.** Their reach lets them fire from behind the infantry line, and they remain the most cost-efficient infantry counter to Heavy Tanks and buildings. Their slow movement and reload give Arc Archers time to pick them off and Ghostrunners time to close the distance.
- **Arc Archers are the soft anti-armor answer and ranged specialist counter.** Their electromagnetic bolts receive a useful bonus against powered mechanical targets such as turrets and vehicles, while their precision and superior range threaten Rocket Troopers. Groups of Arc Archers can damage a Heavy Tank, but they should take longer and cost more than Rocket Troopers so the dedicated anti-armor unit still matters.
- **Ghostrunners are deliberately bad against machinery.** Their blades deal poor damage to buildings, turrets, and armored vehicles. Speed cannot solve the wrong target matchup.

The initial damage relationships are:

| Attack | Best use | Poor use |
| --- | --- | --- |
| Ordinary bullets | Light infantry, drones, exposed specialists | Heavy infantry and armored vehicles |
| Juggernaut rotary fire | Frontal infantry and slow targets under sustained fire | Spread attackers, distant marksmen, and short firing windows |
| Ghostrunner blade | Infantry and weapon crews | Buildings, turrets, and armored vehicles |
| Electromagnetic arc bolt | Heavy infantry, drones, turrets, and vehicles | Raw building demolition and enemies already in melee range |
| Hornet laser bolt | Scouts, exposed infantry, and mobile harassment | Fortified buildings, heavy armor, and protected ranged specialists |
| Rocket | Heavy vehicles, buildings, and stationary machinery | Small fast units and close combat |
| Scout Drone detonation | One exposed light-infantry target or a tiny cluster | Juggernauts, vehicles, buildings, and spread formations |

These are role definitions, not final damage percentages. Prototype tuning should begin with time-to-kill, range, speed, and production cost before adding many hidden bonuses.

### Ghostrunner

The Ghostrunner is a fast melee unit designed to break the distance to fragile ranged infantry. It should kill Arc Archers, Rocket Troopers, artillery crews, and isolated Riflemen quickly after making contact, but it must cross open ground to do so.

Projectile evasion should be deterministic and readable rather than a hidden random miss chance. The starting design gives each Ghostrunner **two evasion charges**:

- One charge negates one incoming direct projectile hit.
- Charges recover only after the Ghostrunner has remained out of combat for a meaningful period.
- Explosions, flames, suppression effects, mines, and other area damage cannot be dodged this way.
- Concentrated fire can deliberately strip the charges before the Ghostrunner reaches the line.

Two charges are a starting point. The goal is to help the unit survive the approach, not let it stand under ranged fire indefinitely. Ghostrunners should be relatively expensive, vulnerable once their charges are gone, and ineffective against structures and armor.

### Arc Archer

The Arc Archer fires slow, high-value electromagnetic bolts from long range. It is a precision support unit rather than a replacement for Riflemen or Rocket Troopers.

- Long range and accurate volleys let prepared Arc Archers kill approaching Ghostrunners before contact, especially when screened by Riflemen or Juggernauts.
- Their range and precision also let them pick off slow Rocket Troopers, whose rockets are inefficient against individual infantry.
- Electromagnetic damage is strong against Juggernaut armor, drones, turrets, light vehicles, and powered systems.
- Several Arc Archers can contribute meaningful damage against a Heavy Tank, giving an army a flexible fallback when no Rocket Troopers are present.
- Slow firing, low durability, and poor close-range performance make Arc Archers collapse quickly when Ghostrunners or fast vehicles reach them.
- Their anti-structure damage remains modest outside powered defenses such as turrets.

### Hornet

The Hornet is a Connected-stage flying skirmisher. It fires a steady stream of bright laser projectiles from medium-long range and can harass exposed infantry or chase down scouts without entering melee distance. Its speed and flight make it useful on open ground, but low durability prevents it from hovering over a defended army: Arc Archers, Juggernauts, turrets, and concentrated ranged fire should bring it down efficiently. Its laser is deliberately poor against heavy armor and buildings so it does not replace Rocket Troopers or the Heavy Tank.

### Juggernaut

The Juggernaut is slow, visibly heavy infantry carrying a six-barrel rotary machine gun. It has enough protection to anchor ordinary infantry, and its weapon spins up into increasingly dangerous sustained fire.

Juggernauts should beat Riflemen, drones, and light vehicles in a straightforward firefight. If protected and allowed to keep firing, their high-caliber rotary guns can also wear down turrets and heavy armor, but Rocket Troopers remain much more efficient at that job. Arc Archers counter Juggernaut armor from outside its comfortable range. Multiple Ghostrunners can kill an isolated Juggernaut by approaching from different sides, but a supported Juggernaut firing into a frontal charge should remain dangerous.

### Rocket Trooper

The Rocket Trooper is the straightforward anti-armor and anti-building infantry unit. The soldier moves slowly on foot while carrying a heavy launcher. Its long reach lets it attack armored vehicles from behind a frontline. Rockets deal high damage but have a long reload and are inaccurate and wasteful against individual infantry.

This creates clear counterplay:

- Tanks and exposed buildings need protection from Rocket Troopers.
- Arc Archers can pick them off from greater range.
- Ghostrunners can close the distance during the long reload and kill them quickly.
- Riflemen and fast light vehicles can punish them when no frontline is present.
- The Rocket Trooper remains cheaper and easier to produce than a dedicated siege vehicle.

The weapons need a strong launch trail and impact effect so players immediately understand what is threatening their machinery.

### Heavy Tank

The Heavy Tank is a slow armored anchor for an army. It should survive ordinary rifle fire and force opponents to produce proper anti-armor units. Rocket Troopers are the hard infantry counter. Other Heavy Tanks can meet it directly, while protected groups of Arc Archers or spun-up Juggernauts provide slower, less efficient secondary answers.

For the initial version, a large laser cannon gives it the clearest role. A flamethrower would make it an anti-infantry tank and overlap with the Juggernaut. Later, the laser and flamethrower could become mutually exclusive variants or upgrades rather than giving one tank both weapons.

The tank should be powerful from the front but vulnerable when isolated, surrounded, or caught in narrow streets without infantry support.

### Scout Drone

The Scout Drone is available from the Command Center at the beginning of the match. It is very fast, cheap, and has a wide field of vision. It has extremely low health and no basic attack; ordinary ranged units and turrets should destroy it quickly when it is spotted.

Because any current vision allows orbital construction, a drone can discover a Titanium Deposit and enable a Titanium Mine to land on it. It can also enable aggressive forward buildings, so opponents benefit from detecting and destroying exposed drones.

The drone also has a deliberate **Detonate** command. This is a committed suicide action, not a normal weapon:

- The drone must enter very short range and visibly arm for roughly one second.
- Arming produces a clear light and sound warning and cannot be cancelled once committed.
- The explosion destroys the drone and can kill one ordinary light-infantry unit at full health.
- Splash radius is tiny so one cheap drone cannot erase a packed army.
- Juggernauts survive it, while vehicles and buildings take little damage.
- The drone remains targetable during its approach and arming time.

Drone cost and Command Center production time must make a one-for-one infantry trade roughly even or slightly inefficient. Otherwise players would mass suicide drones instead of using them to scout. Detonation may require an early upgrade if immediate drone rushing dominates the opening.

## Technology progression

Instead of historical ages, players improve their connection to orbital infrastructure:

1. **Stranded:** basic infantry, mines, Solar Arrays, and defenses
2. **Connected:** vehicles, improved generators, advanced weapons, mercenary contracts, and additional Command Centers
3. **Dominance:** reactors, heavy tanks, siege systems, and late-game technology

Each stage should unlock new strategic options, not only percentage bonuses.

Dominance also unlocks the Orbital Navigation Array, Planetary Survey, and the Orbital Nuclear Strike. These are deliberately expensive endpoints for a player who has secured a large economy.

### Periodic upgrade choices

**Current idea:** at regular intervals, initially about every five minutes, each player is offered three randomly selected upgrades and chooses one. The chosen upgrade lasts for the rest of the match and improves a specific unit, weapon, or defensive structure.

Possible upgrades include:

- Increase the Rocket Trooper's attack range or the radius of its rocket explosion, building on its readable area damage in the style of an Age of Empires mangonel.
- Increase the Ghostrunner's movement speed or attack damage.
- Give the Ghostrunner one additional projectile-evasion charge, allowing it to block one more direct ranged hit.
- Increase the Turret's attack range.

The upgrade pool should contain many focused effects across different unit types. Each player's three choices are rolled independently, so matches and army compositions develop differently even when both players begin with the same faction. Later rounds can stack upgrades and push surviving armies toward a more powerful, chaotic endgame.

Randomness should create adaptation rather than decide the match by itself: every offer should contain useful choices, upgrades need clear descriptions, and no single roll should remove a unit's intended counterplay. The exact interval, pool size, stacking rules, and whether later upgrades become stronger remain open for playtesting.

## Core match loop

1. Establish power and place the first Titanium Mine.
2. Scout roads, water crossings, Titanium Deposits, and neutral locations.
3. Secure additional deposits and open ground for power generation.
4. Build an army based on the enemy's unit composition.
5. Use roads for fast reinforcement while contesting defensive terrain.
6. Break the enemy's mines, power generation, defenses, or production.
7. Establish additional Command Centers so one destroyed base does not end the match.
8. Destroy all enemy Command Centers through conventional assaults or a late-game Orbital Nuclear Strike.

## First playable slice

The smallest useful prototype should contain:

- One procedurally generated desert map format
- One shared playable faction
- One Command Center per player
- One starting Scout Drone, with more available immediately from the Command Center
- Titanium Deposits, Titanium Mines, and Solar Arrays
- Roads, normal sand, slow sand, and water obstacles
- Four production or support buildings
- Six to eight combat units, introduced in small prototype batches
- Individual unit production and persistent control groups
- Fog of war and construction anywhere inside current vision
- Orbital building deployment
- One basic AI opponent
- One clear victory condition: destroy the enemy Command Center

The prototype succeeds if repeatedly fighting the bot for ten to fifteen minutes is already enjoyable.

### Current combat proof

Before building the complete first playable slice, the current implementation milestone is a smaller deterministic combat proof:

- The player starts with one Command Center and three Ghostrunners.
- Each active Command Center trains Scout Drones, Ghostrunners, Hornets, and Behemoths through its own visible five-slot queue. Only the first slot advances; selecting a filled slot cancels that specific order. Stronger units take longer to train, so time temporarily replaces resource costs, and additional Command Centers provide independent queues.
- Scout Drones are trained at the Command Center, with at most three alive or queued across all of a player's Command Centers at once in this proof.
- A completed unit appears at the first collision-free exit around its Command Center and moves toward that building's selectable terrain rally point. If every exit is blocked, the first queue item remains complete at 100% until a safe exit opens instead of spawning inside another entity.
- A selected Scout Drone has a **Build (`B`)** menu containing Turret and Command Center. Choosing a building shows a green or red footprint preview. A valid footprint must remain inside the map, sit on sufficiently level terrain, avoid reserved terrain, and not overlap any living unit or existing building. The simulation repeats this validation before accepting the command.
- An accepted build order creates a vulnerable construction site immediately as a navigation obstacle, then moves the assigned Scout to its edge. The site begins with minimal health; construction increases both progress and health until the full model is reached and, if undamaged, maximum health. Damage taken during construction remains missing after completion.
- Moving, stopping, or destroying the assigned Scout pauses construction without losing progress. The same or another selected Scout can resume a friendly site with right click; reassignment releases the previous Scout, and one Scout works on a site at a time for now. Destroying a site releases its assigned Scout.
- Initial tuning targets are roughly 8 seconds for a Scout Drone, 12 for a Ghostrunner, 20 for a Hornet, and 35 for a Behemoth; a Turret takes roughly 10 seconds to construct and a Command Center roughly 60. These are visible playtest values, not final balance.
- The enemy base is preconfigured at the opposite player start: one Command Center, two forward Turrets, two hold-position Ghostrunners, and one hold-position Hornet. Guards acquire hostile units only inside their existing weapon range and never chase, move, construct, or produce. This is a deterministic encounter fixture, not strategic AI.
- Every active Turret automatically holds its current valid target or acquires the nearest hostile unit in its 12-unit range, breaking distance ties by stable entity ID. Its current proof tuning is 25 damage every second. Construction sites cannot fire; a completed player Turret uses the same defense rule. Selecting a Turret shows its numerical weapon stats and terrain-conforming range boundary.
- Friendly and visible enemy buildings are selectable and attackable. Selection shows identity, ownership, health, relevant actions, and weapon range where applicable.
- World health bars appear while an entity is selected, damaged, or recently involved in combat. A future setting will control this policy.
- Destroyed buildings leave authoritative state and navigation immediately, while their client model plays a brief collapse and fade before removal.
- A side remains in the encounter while it owns at least one active Command Center or Command Center construction site. Other surviving units, including Scout Drones that could have started another site, do not postpone elimination. Losing the final Command Center resolves the encounter authoritatively as victory or defeat; losing both sides' final Command Centers on the same fixed tick is a draw. Resolution freezes gameplay and rejects further commands.
- The resolved encounter clears command and selection state, shows a victory, defeat, or draw overlay, and can restart the same seeded encounter from its restart button or **R**.

The resource economy, fog of war, strategic AI, configurable health-bar visibility, and orbital deployment are deferred in `BACKLOG.md`. This combat proof does not replace the broader first playable slice above.

## Technical direction

Research snapshot: **August 11, 2026**.

### Technical goals

- Build and test the game locally before operating a server.
- Treat multiplayer as an architectural requirement from the first line of simulation code.
- Keep rendering, input, and interface code outside the authoritative game rules.
- Make matches reproducible from a map seed and an ordered stream of player commands.
- Keep the initial browser download small enough that joining feels quick.
- Prefer a small code-driven stack over a large general-purpose game engine.

### Stack direction

The current prototype uses TypeScript, Vite, and Three.js. The multiplayer direction below is chosen for a future technical match but should not be installed before that work begins; the remaining entries are still options to evaluate when a concrete need appears.

| Area | Options to evaluate |
| --- | --- |
| Browser language | TypeScript; JavaScript only if the type layer becomes counterproductive |
| Runtime and package manager | Bun, Node.js with pnpm |
| Development server and bundler | Vite, Bun's built-in tooling |
| Rendering | Three.js, Babylon.js, PlayCanvas, Phaser for a 2D alternative |
| Graphics API | Mature WebGL 2 first; WebGPU as a later experiment |
| Camera | Fixed orthographic 3D, fixed perspective 3D, or rendered isometric sprites |
| Interface | Plain HTML/CSS, Svelte, Vue, or an engine-provided GUI |
| Simulation | Pure TypeScript fixed-tick model, engine-integrated model, or server-native model |
| Local simulation host | Main thread for the smallest prototype, Web Worker once simulation cost warrants it |
| Editable asset source | Blender, purchased source files, procedural scripts |
| Runtime asset format | Binary glTF (`.glb`), compressed sprite atlases if 2D is chosen |
| Tests | Bun test, Vitest, or another lightweight TypeScript runner |
| Multiplayer backend | Cloudflare Workers with PartyServer and one Durable Object per match; SpacetimeDB remains a fallback |
| Asset generation | Procedural Three.js geometry, Blender Python/Geometry Nodes, stock packs, Meshy, Tripo, Rodin, TRELLIS.2, Hunyuan3D |

React, a physics engine, a general ECS framework, and a monorepo are also possible, but none should be added to a prototype without a concrete need.

### 2D versus fixed-camera 3D

**Option currently being tested:** native 3D models at runtime with a fixed isometric-style camera. This is an experiment, not a final engine or rendering commitment.

The earlier Phaser experience identified a real production cost: traditional directional sprites multiply every animation by several viewing directions. Texture atlases and compressed textures reduce transfer and draw overhead, but they do not remove the need to create and store all those frames.

With 3D:

- One model can face any direction.
- One rig can reuse walk, attack, death, and idle animations.
- Camera angle and zoom can change without redrawing every asset.
- Vehicles, buildings, solar panels, rocks, and ruins are particularly suitable for procedural or AI-assisted generation.
- Lighting and team colors can be changed at runtime.

3D is not automatically faster. It adds vertices, skeletal animation, draw calls, shadows, rigging, and texture memory. It is recommended because it gives this unit-heavy RTS a better **asset-production tradeoff**, not because every 3D frame is cheaper than every 2D frame.

The game should use stylized low-detail models, strong silhouettes, simple materials, limited real-time shadows, shared textures, and instanced static props. The fixed distant camera makes this visual direction practical.

#### Engine comparison

| Option | Assessment |
| --- | --- |
| Phaser | Excellent for 2D and already familiar, but retains the directional sprite and animation workload that prompted this evaluation |
| Three.js | Small, code-driven, strong glTF support, and does not impose its own gameplay architecture; selected for the first disposable map prototype |
| Babylon.js | Capable full engine with WebGL/WebGPU, navigation, animation, GUI, and extensive tooling; useful features, but more engine than this custom grid-based RTS currently needs |
| PlayCanvas | Strong web engine and visual editor, but a scene editor is less valuable when most maps and placement are procedural |

The first map prototype uses Three.js `WebGLRenderer` to test the 3D direction. Three.js currently describes its newer `WebGPURenderer` as experimental, while `WebGLRenderer` remains maintained and recommended for pure WebGL 2 applications. The result of this prototype—not the convenience of its initial setup—will determine whether Three.js remains a candidate.

### Simulation architecture

The simulation owns the truth. Three.js only draws a view of it.

```text
mouse / keyboard
      |
      v
player Command -----> MatchSession ----------------> Three.js interpolation
                            |
                +-----------+-----------+
                |                       |
       WorkerMatchSession      RemoteMatchSession
                |                       |
       fixed-tick simulation      PartySocket later
                |                       |
                +--------> authoritative frames, events, and receipts
```

The first implementation can remain one application with clear folders rather than a premature multi-package workspace:

```text
src/
  sim/              pure state, commands, rules, definitions, pathfinding, worker host
  matchSession.ts   local-worker and transport-neutral remote client adapters
  unitInput.ts      input, selection, smart commands, and HUD actions
  unitSystem.ts     interpolation, presentation, selection views, and combat effects
assets/
  source/    Blender source files and license records
  runtime/   optimized GLB files and compressed textures
```

The `sim` code must not import Three.js, DOM APIs, wall-clock time, or browser input. It receives commands, advances one fixed tick, and returns state changes or snapshots.

### Authoritative state and client-only state

Authoritative simulation state includes:

- Match tick and procedural-map seed
- Player resources and technology level
- Units, buildings, production queues, orders, health, and cooldowns
- Resource deposits and map occupancy
- Movement, combat, construction, and visibility results
- Player-private reinforcement routing needed to restore a match after reconnecting

Client-only state includes:

- Camera position and zoom
- Current mouse hover, selected unit IDs, and drag-selection box
- Ordinary numbered control-group bindings
- Interface panels and visual effects
- Local key bindings

Ordinary control groups are local shortcuts over stable unit IDs and do not need to enter the simulation. Configuring a production building to reinforce a persistent group is different: that relationship must become private authoritative state so newly produced units keep joining it after a reconnect. Opponents never need to receive either form of group metadata.

### Commands, ticks, and replays

Clients issue intentions rather than changing entities directly. Initial command types include:

- Move explicitly identified units
- Attack a unit or building with explicitly identified units
- Attack ground at a position with compatible artillery units
- Stop and atomically clear the previous order for explicitly identified units
- Attack-move to a position
- Place a building
- Queue or cancel production
- Configure a production building's reinforcement group

Selection remains local. Clicking one unit, dragging a box, selecting every visible unit of the same type, or recalling a numbered control group must all produce the same result: an ordered, duplicate-free set of stable unit IDs. The selection system then sends that set to the simulation without maintaining a separate movement or combat path for each selection method.

A multiplayer command envelope contains a client command ID, the explicit unit IDs, and the requested order and target. Authenticated player identity is supplied separately by the session/server and never trusted from the payload. The authority assigns the server tick, validates ownership and visibility, deduplicates retries, records accepted commands, and atomically replaces the previous order for every accepted unit. A unit that cannot currently find a route must enter an explicit blocked state or receive a rejection; it must never silently continue an older order.

Use a fixed simulation rate of approximately **10 ticks per second** initially. Rendering continues at the display frame rate and interpolates between simulation states. The rate can be raised only if playtesting proves that unit response feels poor.

Every local match should be recordable as:

- Game version
- Map seed
- Initial settings
- Ordered commands with their authoritative ticks

Replaying that data should produce the same periodic state hash. This gives us deterministic map tests, useful bug reports, eventual replays, and an early warning when multiplayer synchronization assumptions break.

The current simulation exposes accepted-command records, authoritative ticks, bounded command deduplication, deterministic combat events, and a state hash. The future PartyServer adapter persists those accepted records and periodic checkpoints instead of teaching the simulation about Cloudflare.

Use integer tile coordinates and scaled integers for authoritative positions where practical. Avoid frame-dependent movement and unseeded randomness. Render code may convert those values to floating-point Three.js coordinates.

### Pathfinding and movement

Do not add a general physics engine. The game already has a procedural grid with explicit roads, sand, shallow water, obstacles, and building footprints.

Use a hybrid navigation model:

- Recast builds navigation meshes from the static map and living building footprints, with clearance layers for ordinary and large units
- Detour supplies global route queries around those static obstacles
- Terrain costs for roads, sand, and water
- Per-ruin walkability masks so units can move through traversable ruin footprints
- Directional cover edges for walls, windows, columns, and solid ruin boundaries
- A small spatial index and deterministic local separation so units do not occupy the same point
- Walkable-target projection and outward recovery when crowding leaves a unit inside a building margin
- Group formation slots and a shared group corridor derived from one command rather than separate UI-issued orders
- Stable tie-breaking so identical inputs choose identical routes

Recast/Detour does not own unit velocity, collision response, formation settling, or attack positions. Those remain deterministic game rules in the fixed-tick simulation, which preserves constant unit speed and the authored RTS behavior. In particular, do not use DetourCrowd as the unit controller; that experiment produced undesirable acceleration, spreading, jitter, and command-transition behavior.

The current prototype constructs the static meshes once during match setup and rebuilds them only when the building topology changes. Group moves query one route for the formation center and preserve each unit's offset through the corridor. A small deterministic visibility planner remains only for dynamic unpushable-unit avoidance when the static route is not locally clear. Moving units use local collision resolution rather than becoming navmesh obstacles. Browser workers use Recast's normal WASM loader; Cloudflare Workers and Durable Objects must import the compiled `.wasm` module directly because runtime WASM compilation is disabled there.

Flow fields, hierarchical pathfinding, and more sophisticated crowd behavior should wait until a real unit-count profile demonstrates the need.

### Local-first multiplayer seam

The browser talks to a small `MatchSession` rather than directly calling game objects. `WorkerMatchSession` hosts local authority off the renderer thread. `RemoteMatchSession` queues the same identity-free commands through a transport callback and consumes server frames and command receipts; PartySocket will only provide that transport. `GameSimulation` remains the synchronous authority used inside the worker or PartyServer.

Frames distinguish full snapshots from deltas and can explicitly remove units or buildings, allowing fog-filtered disappearance and reconnect snapshots without inventing a second renderer API. Combat effects are driven from authoritative frame events rather than client timers. This seam should remain tiny—not become a repository or networking framework.

The standalone `@colyseus/schema` prototype is retained as a replication codec experiment, not as a second authority. It mirrors only the small network projection of units and buildings, produces field-level binary deltas, and maintains a separate fog-filtered `StateView` per player. The live local match transport still uses ordinary frames. Before adopting Schema in PartyServer, compare its mirror/sync cost against a direct dirty-entity bitmask codec under the same four-player visibility workload.

The renderer must tolerate:

- State arriving less frequently than frames are drawn
- Commands being rejected
- Entities appearing or disappearing due to fog of war
- A full snapshot after reconnecting
- Corrections to predicted visual movement

For the local version, commands are queued to the worker and reflected in the next authoritative frame. Do not build complex client prediction until real network testing shows it is necessary; RTS commands are more latency-tolerant than action-game controls.

## Multiplayer backend evaluation

### Current direction: Cloudflare PartyServer

Use **Cloudflare Workers with PartyServer and one named Durable Object per match**. PartyServer is a thin Cloudflare-owned layer over Durable Objects that supplies room routing, WebSocket lifecycle hooks, connection tracking, broadcasting, hibernation support, and optional location hints. The browser may use PartySocket for reconnecting WebSockets.

`MatchServer` should remain a network shell around the ordinary TypeScript `GameSimulation`: restore it in `onStart`, authenticate in `onConnect`, validate and dispatch commands in `onMessage`, and send snapshots or events after fixed simulation ticks. PartyServer must not leak into simulation rules or content definitions.

Important quirks:

- The active 10 Hz timer keeps the match awake and billable. Advance from elapsed time because timers are not exact, then clear the timer when the match finishes or pauses.
- Durable Objects may restart. Persist accepted commands and periodic checkpoints, and restore them in `onStart` rather than trusting process memory alone.
- Do not broadcast one shared state update: fog of war requires a separately filtered update for each player.
- PartySocket reconnects automatically, but buffered stale orders are dangerous. Disable blind offline buffering or use command IDs, acknowledgements, deduplication, and explicit replacement rules.
- PartyServer is still pre-1.0. Pin its version and isolate it inside the server adapter so replacing it does not affect the simulation.

Accounts, matchmaking, ratings, and match summaries can live in an ordinary Worker and D1 when they become necessary; they do not belong inside every match object.

### Fallback: SpacetimeDB

SpacetimeDB remains a credible fallback if maintaining the WebSocket protocol and persistence becomes burdensome. Its reducers, generated bindings, subscriptions, and caller-aware views remove networking and database plumbing. The tradeoff is a worse fit for the current long-lived simulation: authoritative state must live in tables, producing high-frequency table reads, writes, replication, and per-player visibility work. Do not run both backends or create a generic adapter pretending they have identical semantics.

## Browser performance budget

Initial targets, to be validated on ordinary integrated graphics:

- Approximately 50–80 controllable units per player
- One shared mesh, rig, and material set per unit type
- One material per ordinary unit where practical
- Roughly 3,000–8,000 triangles for infantry and 3,000–12,000 for vehicles
- Mostly 512 px or 1K textures, shared across related assets
- Instanced meshes for rocks, vegetation, road props, and repeated static structures
- Baked or simple lighting with one primary directional light
- Minimal transparent materials and post-processing
- A small initial download, with match-specific assets loaded before the match begins

Use GLB assets with mesh compression and KTX2/Basis compressed textures after the graybox phase. Both reduce network transfer; KTX2 also reduces GPU texture memory by transcoding to formats supported by the device.

Profile before adding elaborate LOD systems. At the intended camera distance, a well-designed single low-detail model may be sufficient for many units.

## Asset creation pipeline

### 2D concept-art exploration

**Current experiment:** define the visual language in 2D before committing individual designs to 3D production. Concept assets use one fixed high-isometric camera, one upper-left sun direction, and a shared palette of pale sand, bone-colored armor, charcoal machinery, muted rust, and restrained cyan technology accents.

The first concept set contains:

- Pale desert sand and compacted ground
- Command Center
- Ghostrunner human cyberpunk melee operative with a restrained kabuto-inspired combat helmet
- Arc Archer futuristic longbowman
- Ruined concrete-and-metal building
- One combined isometric battlefield scene testing their scale and coherence

These are design references, not final game sprites. Characters still need neutral multi-view model sheets before any image-to-3D experiment, while the combined scene is mainly a test of palette, materials, silhouette, camera, and relative scale.

### Current Three.js composition test

The browser prototype now loads the Command Center, ruin, Ghostrunner, Scout Drone, Hornet, Behemoth, and Arc Archer GLBs into one layout-aware desert clearing and focuses the orthographic camera on the same building-over-units composition as the 2D concept. The Arc Archer is still a static evaluation asset, the Ghostrunner tests the rigged and animated character path, the Scout Drone tests a fast selectable hovering unit without a basic attack, and the Hornet tests ranged movement plus visible laser projectiles.

The earlier animation experiment proved that Blender can add a katana to a Meshy rig and export the character, weapon, skin, and clip together as one GLB, avoiding runtime weapon construction in Three.js.

The regenerated manually exported Ghostrunner contains 19 clips, including additional attacks, traversal, taunt, jump, death, and recovery options for future gameplay. The current demo still uses `Idle_6`, `Female_Throwing_Stance_Charge_inplace`, and `Attack`; `Running`, `Walking`, and the other clips remain packaged for later use. The Blender runtime pass preserves the regenerated mesh, 24-joint skin, material, and every clip while converting its textures to 1024 px WebP, producing a 1.50 MB GLB. Its armor uses a balanced warm ivory with a restrained material lift, while a separate metallic-roughness mask makes the sword blade reflective without turning the armor metallic. Every clip's horizontal Hips track starts from the shared bind position while retaining its relative lunge or movement, and the runtime pivot is calibrated to the regenerated body's center.

The composition uses deliberately exaggerated RTS scale rather than physical scale, following Age of Empires readability: infantry render about 20% larger and the current buildings about 15–20% smaller than the first 3D pass. Unit materials receive a restrained ambient color lift so dark armor retains painted detail instead of collapsing into a silhouette. The sand material blends warped fine and broad samples of the same texture with low-contrast warm variation, reducing obvious wallpaper repetition and bringing the ground into the buildings' bone-and-ochre palette.

The production character path is:

1. Generate the approved T-pose as a Smart Topology model.
2. Clean the mesh and create one reusable humanoid rig.
3. Retarget in-place `idle`, `walk`, `run`, `attack`, and `death` clips to that rig.
4. Keep weapons separate and editable in Blender, then package each equipped character and weapon into one runtime GLB when that avoids unnecessary Three.js attachment code. Attach the sword to the right-hand bone; attach the bow to the left hand, use a temporary arrow in the right hand while drawing, then spawn the gameplay projectile separately.
5. Let the simulation move the unit while Three.js only advances and blends its animation clips.

Meshy can rig a humanoid and includes basic walk and run clips; its animation library also contains sword and bow actions. Mixamo is a useful free alternative for testing humanoid stock animations. Any retained clip still needs retargeting, root-motion removal, cleanup, and an RTS-distance readability check.

### Unit palette and player color

**Current direction:** ordinary infantry are humans wearing dark cyberpunk military or police equipment, not robots. Their main palette is matte charcoal-black, graphite fabric, and dark gunmetal. Small bone-colored wear and restrained cyan technology lights provide contrast without making the army yellow.

Every unit reserves several large, consistently placed armor panels for player color: shoulders, forearms, knees, and one or two silhouette-specific panels such as waist guards or a hood band. Concept art shows these panels in cobalt blue, but blue is only the example player color. Player-color regions are non-emissive and visually separate from cyan screens, optics, and energy effects.

The image-to-3D pipeline does not need to preserve player color as technical metadata:

1. Concept art establishes the approved panel locations.
2. Meshy generates and retextures the base character normally.
3. Blender cleanup restores those panel selections after topology and UVs are final.
4. The first runtime version assigns the panels a dedicated `TeamColor` material whose color is set per player.
5. If the additional material becomes a measured draw-call problem, bake the same selection into a one-channel team-color mask and recolor it in the main unit shader.

This makes Blender—not the generative steps—the authority for team-color ownership. The team material should retain neutral grayscale scratches and dirt so different player colors still look weathered rather than freshly painted.

### Canonical rule

Every production 3D asset ends as an editable Blender source file and an optimized `.glb` runtime file. AI-service output and purchased files are inputs to this pipeline, not final assets dropped directly into the game.

The cleanup step checks:

- Scale, origin, and orientation
- Silhouette at the actual game camera distance
- Polygon count and hidden geometry
- UVs and texture resolution
- Material count
- Team-color mask
- Rig, bone count, skin weights, and animation names
- Collision or selection footprint
- GLB export and browser performance

### Recommended source order

1. Primitive graybox models generated directly in Three.js
2. Programmatic Blender models for repeatable hard-surface assets
3. Properly licensed stock packs for environment coverage and prototypes
4. AI-generated concepts converted into editable 3D starting points
5. Manual cleanup or custom modeling for important units and signature buildings

This order keeps the game playable while its art direction is still changing.

### Where programmatic generation works well

Blender's Python API and Geometry Nodes are suitable for families of assets that share parameters:

- Solar panels with different sizes and damage states
- Titanium Deposits and mineral outcrops
- Modular roads, bridges, walls, and ruins
- Generators, pipes, vents, antennas, and industrial props
- Building landing pods and unfolding parts
- Low-detail desert clutter

AI can help write and revise these Blender scripts. Procedural output is especially valuable because it is repeatable, editable, and style-consistent. It is usually more reliable than image-to-3D for simple hard-surface geometry.

### Current AI-to-3D tools

| Tool | Best use in this project | Relevant current capabilities | Caution |
| --- | --- | --- | --- |
| Meshy | Candidate for characters, vehicles, and props | Single- and multi-image to 3D, target polygon count, triangle or quad topology, A/T pose, PBR, GLB, remeshing, rigging, and animation APIs | Output still needs visual, topology, material, and animation QA in Blender |
| Tripo | Compare against Meshy for the Rifleman or Ghostrunner | Text/image/multiview generation plus documented rig, rig-check, and animation-retarget flow | Do not assume every generated mesh will pass its rig check or share a consistent style |
| Hyper3D Rodin | High-quality experiments for tanks, buildings, and static props | Single- and multi-image generation, adjustable polygon counts, PBR or shaded materials, and GLB/FBX/OBJ output | Character rigging is not the documented strength of the core Rodin pipeline |
| TRELLIS.2 through fal.ai | Strong hosted candidate for vehicles, buildings, and static props | Image-to-3D GLB output with controllable seed, resolution, remeshing, vertex target, texture size, and optional LoRA training | Default outputs can be far heavier than our web budget and always require decimation and texture QA |
| Hunyuan3D through fal.ai | Additional hosted comparison for hard-surface and stylized assets | Multiple hosted image-to-3D versions with GLB and PBR-capable output | Model and endpoint versions change quickly; record the exact endpoint and parameters for every retained asset |

### Models and API hosts are separate choices

**Current decision:** do not self-host 3D generation on the development laptop. Use hosted APIs for model inference and Blender locally for inspection, cleanup, rigging, and export.

fal.ai currently exposes hosted TRELLIS, TRELLIS.2, Hunyuan3D, Meshy, and Tripo endpoints through one queued API and can return GLB files. This makes fal.ai useful as an experimentation layer: we can compare several underlying models without installing their GPU environments or integrating every vendor separately.

The API host should not become part of the game runtime. Asset generation is an offline development tool. API keys stay outside the browser game, and every accepted output is downloaded into the source-asset pipeline so the project does not depend on an old hosted endpoint remaining available.

For each retained generated asset, record:

- Underlying model and version
- API host and endpoint
- Input images and prompt, if any
- Seed and generation parameters
- Date, cost, and license or commercial-use terms
- Original downloaded file
- Blender cleanup and export version

Do not choose an AI model from marketing samples. Run the same three references through a small shortlist such as Meshy, Tripo, TRELLIS.2, Hunyuan3D, and optionally Rodin:

- A Solar Array or generator
- The Heavy Tank
- A neutral-pose Rifleman

Compare silhouette, back-side reconstruction, polygon count, texture consistency, Blender cleanup time, rig quality, final GLB size, and appearance in the real game camera. The winner is the service that produces the lowest **total cleanup cost**, not the prettiest close-up render.

### Local Blender workflow

**Available experiment:** Blender 5.2 is installed locally, with Blender MCP available for AI-assisted scene inspection and scripting. This makes the workflow testable, but does not commit every asset—or the game runtime—to Blender.

Blender serves two complementary roles:

- Interactive inspection and repair of generated or purchased assets
- Headless, repeatable scripts for procedural modeling, validation, and GLB export

The game itself must not require Blender. Source `.blend` files are committed as editable assets, while runtime GLB files are generated outputs. Once the pipeline begins, pin the Blender major/minor version used by export automation so an upgrade does not silently change every asset.

### Proposed AI-assisted workflow

1. Define a small visual style sheet: proportions, palette, materials, shape language, and forbidden details.
2. Generate concept sheets with front, side, back, and three-quarter views on a clean background.
3. For humanoids, request a neutral A-pose or T-pose without weapons fused to the hands.
4. Send multiple consistent views to the selected image-to-3D service.
5. Import the result into Blender.
6. Repair or replace topology, consolidate materials, and reduce textures.
7. Rig or validate the generated rig; keep a shared animation vocabulary such as `idle`, `walk`, `attack`, and `death`.
8. Export GLB and inspect it inside the actual Three.js scene.
9. Record the source, prompt, service, plan/license, edits, and export settings in the asset manifest.

For early development, purchased itch.io packs can provide desert rocks, ruins, sci-fi props, and temporary units. Licenses vary per creator, so each imported asset needs a recorded license and source URL. Avoid assembling the final art direction from many visually incompatible packs.

### If 2D is reconsidered later

A Blender scene can render one 3D model into consistent directional sprite sheets automatically. That is a viable fallback if native 3D proves too slow on target hardware. It solves directional consistency, but it restores the large texture-atlas and multi-angle storage cost. Supporting native 3D and sprites simultaneously would double the rendering and QA work, so do not build both paths during the prototype.

## Technical implementation phases

### Phase 0: rendering proof

- Orthographic Three.js camera
- Procedural sand plane, road, shallow water, and Titanium Deposit
- 100 placeholder moving units
- Selection box, right-click movement, zoom, and camera pan
- Frame-time and memory measurements on integrated graphics

### Phase 1: local simulation slice

- Fixed-tick simulation in a Web Worker
- Seeded procedural map generation
- Command Center, Scout Drone, Rifleman, Solar Array, and Titanium Mine
- Energy and titanium economy
- Fog of war
- Deterministic command recording, replay, and state hashes
- One simple AI opponent

### Phase 2: combat and production

- Individual production and persistent control groups
- Rifleman, Ghostrunner, Rocket Trooper, Heavy Tank, and Turret
- Pathfinding through roads, sand, and shallow water
- Building deployment, production queues, combat, and base destruction

### Phase 3: multiplayer feasibility spike

- Implement a disposable backend test, beginning with SpaceTimeDB if it remains the most interesting candidate
- Compare candidates using measured tick, bandwidth, fog-of-war, and development-complexity results
- Only then design authentication, lobbies, matchmaking, and deployment

### Phase 4: production asset pipeline

- Install and pin the project Blender version
- Establish Blender templates and export checks
- Compare hosted Meshy, Tripo, TRELLIS.2, Hunyuan3D, and optionally Rodin with the same reference assets
- Select stock environment packs with compatible licenses and style
- Automate GLB optimization and asset-manifest validation

## Technical research sources

- [SpaceTimeDB TypeScript quickstart](https://spacetimedb.com/docs/quickstarts/typescript)
- [SpaceTimeDB reducers and transactions](https://spacetimedb.com/docs/functions/reducers/)
- [SpaceTimeDB scheduled tables](https://spacetimedb.com/docs/tables/schedule-tables/)
- [SpaceTimeDB subscriptions](https://spacetimedb.com/docs/clients/subscriptions/)
- [SpaceTimeDB table permissions and caller-filtered views](https://spacetimedb.com/docs/tables/access-permissions/)
- [Colyseus state synchronization](https://docs.colyseus.io/state)
- [Nakama authoritative multiplayer](https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/)
- [Three.js WebGPU and WebGL renderer status](https://threejs.org/manual/en/webgpurenderer)
- [Three.js glTF loader](https://threejs.org/docs/pages/GLTFLoader.html)
- [Babylon.js engine capabilities](https://www.babylonjs.com/specifications/)
- [Phaser texture and atlas model](https://docs.phaser.io/phaser/concepts/textures)
- [Khronos glTF and KTX2 overview](https://www.khronos.org/gltf/)
- [Blender glTF export documentation](https://docs.blender.org/manual/en/3.3/addons/import_export/scene_gltf2.html)
- [Blender Geometry Nodes](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/introduction.html)
- [Meshy multi-image to 3D API](https://docs.meshy.ai/en/api/multi-image-to-3d)
- [Meshy commercial-use guidance](https://help.meshy.ai/en/articles/9992001-can-i-use-my-generated-assets-for-commercial-projects)
- [Tripo developer quickstart and game-ready character flow](https://developers.tripo3d.ai/en/docs/quick-start)
- [Hyper3D Rodin API overview](https://developer.hyper3d.ai/api-specification/overview)
- [Microsoft TRELLIS.2 repository](https://github.com/microsoft/TRELLIS.2)
- [fal.ai TRELLIS.2 API](https://fal.ai/docs/model-api-reference/3d-api/trellis-2)
- [fal.ai Meshy 6 multi-image endpoint](https://fal.ai/models/fal-ai/meshy/v6/multi-image-to-3d)
- [fal.ai Hunyuan3D endpoint](https://fal.ai/models/fal-ai/hunyuan3d/v2)

## Open design questions

1. Is energy accumulated like titanium, or used as live power capacity?
2. Do Titanium Deposits deplete completely, and how quickly?
3. Can all infantry cross shallow water, and can any units cross deep water?
4. Should previously seen enemy buildings remain visible under fog of war in their last known state?
5. Do neutral mercenary camps appear on every map?
6. How are procedural maps made fair enough for competitive play?
7. What prevents roads from making every attack route too predictable?
8. Does the Heavy Tank keep its laser cannon, or can the player choose a flamethrower variant?
9. Is Scout Drone Detonate available immediately, or unlocked by an early upgrade?
10. How long must a Ghostrunner remain out of combat before its evasion charges recover?
11. How much anti-vehicle damage can Arc Archers gain without replacing Rocket Troopers as the hard anti-armor counter?
12. What cost, blast radius, targeting delay, and cooldown make the Orbital Nuclear Strike decisive without making conventional late-game armies irrelevant?

## Naming note

`Dune77` works as a project codename. A more original public name may eventually help the game stand apart from *Dune* and *Cyberpunk 2077*.
