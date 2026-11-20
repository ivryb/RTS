# A hook arena game, an engine, or a platform? (2026-11-20)

Ivan asked whether to build a team hook game inspired by the Warcraft 3 map Pudge Wars, reusing Dune77's code, and whether to pull out a hackable engine plus a multiplayer platform on Cloudflare Durable Objects where others build and share games, "like Steam Workshop". He also asked what already exists and what is trending. Four researchers read primary sources on 2026-11-20. Their notes, with a dated source for every claim, are in [2026-11-20-game-platforms/](2026-11-20-game-platforms/):

- [creator-platforms.md](2026-11-20-game-platforms/creator-platforms.md) covers platforms where creators publish games, and where web games find players.
- [multiplayer-backends.md](2026-11-20-game-platforms/multiplayer-backends.md) covers Durable Objects, game backends and netcode, with a table of 16 options.
- [web-engines.md](2026-11-20-game-platforms/web-engines.md) covers web engines, libraries and trends.
- [hook-genre-and-market.md](2026-11-20-game-platforms/hook-genre-and-market.md) covers hook games, the path from custom map to genre, empty lobbies and naming rules.

This page is the synthesis. Facts link to the note that sources them. The recommendation is my judgment from those facts.

## Recommendation

Build the hook game first, as a game. Do not build the platform yet. Build the one piece of engine that is actually missing, an open TypeScript netcode layer for Durable Objects, as a byproduct of the game, and extract it only when Dune77 is the second game using it.

1. **The hook game is worth building, but only with bots and friend links from day one.** The mechanic is proven fun. A Roblox hook arena reached 44,457 concurrent players in March 2026, and the Dota 2 Pudge Wars peaked at 21,220. Every standalone hook game the researcher found is empty. The difference is that the successes sat inside a host with millions of players. A small game dies in the matchmaking queue, not on its hook types.
2. **The platform is not worth building now.** Several teams have built "a hackable place to make and share multiplayer games", and none outside Roblox and Fortnite has held players. The scarce thing is players, not tools.
3. **The engine is mostly commodity, except for the netcode seam.** Rendering, physics, entity storage, navigation and editors are all free and maintained. What nobody ships is one TypeScript simulation that runs in a browser worker and in a Durable Object, with the prediction and lag compensation an action game needs. Dune77 already has half of that shape.

## What already exists

**Creator platforms are crowded and mostly failing.** Roblox paid creators $403 million in Q3 2026, with 138 million daily users. Its median creator earned about $1,500 in the year to June 30. Creator islands take 47% of Fortnite play hours, and Epic has paid creators over $1 billion. Both had their audience before their tools. The platforms that launched tools first shrank or closed: Core, Crayta, Dreams, Hiber, Hytopia and Rec Room. Rec Room closed on June 1 despite 150 million players, saying its costs always overwhelmed its revenue. s&box launched in April 2026 with a $1 million creator fund, peaked near 13,000 concurrent players and fell under 500 within five months. ([creator-platforms.md](2026-11-20-game-platforms/creator-platforms.md))

**The two products closest to Ivan's idea both turned away from being a platform.** Hytopia ran TypeScript games on its servers in the browser. It open-sourced its engine in March 2026 and now presents itself as a single first-party game, Far Worlds. Rune runs JavaScript games with hosted netcode. It keeps creator code safe by allowing only pure, synchronous functions with a 10 ms limit, and it sells distribution inside its 10-million-install voice-chat app rather than the SDK. ([web-engines.md](2026-11-20-game-platforms/web-engines.md))

**No open game framework runs on Durable Objects.** Colyseus is the closest in spirit, with TypeScript rooms and schema sync, but it runs on Node, and its Durable Objects port is an open issue. The hosted PartyKit platform shut down on 23 October 2026. PartyServer is maintained but thin, and Cloudflare's realtime work now goes into its AI Agents SDK. Hathora shut down in May 2026. Rivet now sells itself as infrastructure for AI agents. Playroom and Rune are closed hosted services. SpacetimeDB's license forbids platforms where third parties upload their own schemas. ([multiplayer-backends.md](2026-11-20-game-platforms/multiplayer-backends.md))

**Cloudflare now has the hard piece of a Workshop.** Dynamic Workers with Durable Object Facets, both new in 2026, run code uploaded by strangers in a sandbox with its own storage. If the platform ever makes sense, sandboxing creator games is no longer a research project. ([multiplayer-backends.md](2026-11-20-game-platforms/multiplayer-backends.md))

**Someone already started a hook game on Ivan's stack.** A GitHub project from October 2026 is a 5v5 river hook game in Three.js, TypeScript and Node, with bots, three hook types and runes. It shows the idea itself is no moat. Polish, netcode feel and distribution are. ([hook-genre-and-market.md](2026-11-20-game-platforms/hook-genre-and-market.md))

## What it takes to make the hook game survive

**Expect a small audience.** Well-loved indie arena games hold about 200 concurrent players on Steam. Stick Fight averages 195 and Bopl Battle 215. Battlerite fell from a 44,850 peak to an average of 57. The Awesomenauts developer called 40 concurrent players "pretty decent" for an indie game. ([hook-genre-and-market.md](2026-11-20-game-platforms/hook-genre-and-market.md))

**Design against the empty lobby.** The researcher's order, which I agree with:

1. Bots fill every empty slot, so one human always gets a match.
2. The game has one queue. Splitting 40 players across three modes stretched Awesomenauts' wait from 2 to 7 minutes.
3. Teams scale from 1v1 to 5v5 with the players present.
4. A room link lets friends join a match in the browser in one click.
5. A Discord Activity build puts the game where groups of friends already are.

**Ship where players already are.** Discord Activities let developers keep 85% of sales up to $1 million, and Discord's own Activity Death by AI reached 7 million players. CrazyGames takes web multiplayer games without exclusivity and publishes a multiplayer checklist. Poki has 100 million monthly players but requires exclusivity among web game sites. Reddit blocks WebSocket connections to outside servers, and YouTube Playables has no multiplayer support, so both are poor fits. ([creator-platforms.md](2026-11-20-game-platforms/creator-platforms.md))

**Plan for geography.** A Durable Object never moves after it is created, and Cloudflare's South America hint places it in Eastern North America. Frankfurt to New York is about 85 ms round trip, and Frankfurt to Sydney about 258 ms. A study puts the comfort limit for precise, deadline-bound actions near 100 ms. Matches therefore need queues grouped by region. The netcode should be a server that decides hits, with client prediction and a capped rewind for lag, rather than the lockstep an RTS can live with. ([multiplayer-backends.md](2026-11-20-game-platforms/multiplayer-backends.md))

**Servers cost almost nothing.** Cloudflare bills incoming WebSocket messages as one request per 20 and does not bill outgoing ones. A 15-minute, 10-player match at 25 messages per player per second costs about $0.003, by the researcher's arithmetic from the pricing page. ([multiplayer-backends.md](2026-11-20-game-platforms/multiplayer-backends.md))

**Keep clear of Valve's and Blizzard's names and look.** Game rules are free to copy, and Tetris v. Xio protects only how rules are expressed. Leave out "Pudge", "Pudge Wars", "Dota", Dota ability names and any butcher character like Pudge. The researcher could not search trademark databases directly. ([hook-genre-and-market.md](2026-11-20-game-platforms/hook-genre-and-market.md))

## Engine: what to reuse, what to skip

**Reuse from Dune77.** These parts carry over: the fixed-tick TypeScript simulation behind the `MatchSession` boundary, `@colyseus/schema` replication, the Cloudflare Worker prototype, and the Playwright verify tooling that an agent can drive. ([web-engines.md](2026-11-20-game-platforms/web-engines.md))

**Do not build.** These layers already have free, maintained libraries: a renderer (Three.js, Babylon.js, PlayCanvas), physics (Rapier, Jolt), entity storage (bitECS, Koota), navigation (Recast, which Dune77 uses) and an editor (PlayCanvas's editor is MIT and has an MCP server for agents). ([web-engines.md](2026-11-20-game-platforms/web-engines.md))

**Two technical notes for later.** Three.js has stopped adding large features to `WebGLRenderer`, and its WebGPU renderer does not support `ShaderMaterial` or `onBeforeCompile`, which nine Dune77 files use. A new game should start with that in mind. Also, Dune77's simulation calls `Math.sin` and `Math.cos`, which differ across machines. That is fine for a server that decides outcomes, but it would break rollback netcode. ([web-engines.md](2026-11-20-game-platforms/web-engines.md))

## Trends worth knowing

- AI-written Three.js games are a crowded niche. The 2026 Vibe Jam required 90% AI-written code, drew 945 entries, and its top three games were all Three.js. The entry count comes from search snippets of a post the researcher could not open. ([web-engines.md](2026-11-20-game-platforms/web-engines.md))
- Browser multiplayer that people can join in one click is less crowded. Inference from the same survey.
- Creator platforms are consolidating into Roblox and Fortnite, and the independent ones are closing or turning into single games. ([creator-platforms.md](2026-11-20-game-platforms/creator-platforms.md))
- When a custom game proves a genre, the host captures it. Riot and Valve shipped their own versions of Auto Chess within six months of the original Dota 2 custom game. ([hook-genre-and-market.md](2026-11-20-game-platforms/hook-genre-and-market.md))

## Gaps in this research

SteamDB, Hive Workshop and WC3 Tracker blocked automated reads, so some player numbers come from search snippets and are marked in the notes. Current player counts are snapshots from about 14:30 UTC on 2026-11-20. Some platform numbers rest on a single source, and the notes mark them.
