# Multiplayer backends and netcode for web games (November 2026)

Researched on 2026-11-20 for a team hook arena game (Pudge Wars style, about 10 players, skillshots) and a possible open engine and game platform on Cloudflare Durable Objects. Every source below was read on 2026-11-20 unless a different date is given. Statements marked "inference" or "my judgment" are mine and are not taken from a source.

## Conclusion

No one ships an open, hackable multiplayer game engine on Durable Objects today. The pieces exist, but they sit at two levels that nobody has joined.

The low level is Cloudflare's own. Durable Objects give one single-threaded room per match with WebSockets, hibernation and SQLite. PartyServer adds a thin room API on top. Dynamic Workers and Durable Object Facets, both new in 2026, can run code uploaded by strangers inside a sandbox with its own storage. That last part is the missing primitive for a "Steam Workshop for multiplayer games", and it now exists.

The high level is game frameworks, and none of them run on Durable Objects. Colyseus is the closest open match in spirit (TypeScript, authoritative rooms, schema sync), but it runs on Node, and its Durable Objects port is an open research issue plus a community repository with 2 stars. Rivet, which once pitched itself as "open source Durable Objects for games", now sells itself as infrastructure for AI agents. Playroom Kit and Rune are hosted and closed. SpacetimeDB's license forbids exactly the kind of platform where third parties upload their own schemas. Hathora shut down on 5 May 2026, and the hosted PartyKit platform shut down on 23 October 2026.

So the real gap is narrow and specific. It is an open TypeScript library that runs one deterministic simulation both in a browser worker and in a Durable Object, and that ships the netcode an action game needs: client prediction, reconciliation, interpolation and server-side lag compensation. A hosting layer that loads user games into Dynamic Workers would sit on top. Dune77 already has the first half of this shape (a deterministic simulation behind a `MatchSession` boundary, `@colyseus/schema` replication and a Worker prototype).

My judgment on what is worth building: the netcode kernel is worth extracting, because it is what the hook game needs anyway and nobody offers it on this stack. The platform layer (accounts, discovery, moderation, payouts, abuse handling) is a much larger and different business, and Cloudflare could close the backend part of the gap at any time with a game template. Build the hook game first on PartyServer plus the extracted kernel, and decide on the platform once a second game wants the same kernel.

Durable Objects are cheap for this load. A 15-minute, 10-player match with 25 incoming messages per player per second costs about $0.003 on Durable Objects (worked out below). The real constraint is geography. One match lives in one city, and Frankfurt to New York is about 85 ms round trip, while Frankfurt to Sydney is about 258 ms. Skillshot games therefore need regional matchmaking rather than one global pool.

## Cloudflare

### Durable Objects limits

- A SQLite-backed Durable Object gets 30 seconds of CPU per request or WebSocket message by default, configurable up to 5 minutes, and each message resets the budget. [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- One object has a soft limit of 1,000 requests per second. [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) A 10-player match at 25 to 30 messages per player per second sends 250 to 300 messages per second, which is a quarter to a third of that limit (inference from the numbers).
- A received WebSocket message can be up to 32 MiB. [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- Memory is capped at 128 MB per isolate, including the JavaScript heap and WebAssembly. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) Durable Objects are billed on 128 MB whether they use it or not. [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- A Durable Object is a single thread with no hard wall-time limit while a client stays connected. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

### WebSocket hibernation

- When an object gets no events for a short while, it is evicted from memory, but its WebSocket clients stay connected, and the constructor runs again on the next event. [WebSocket best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- Duration charges stop during hibernation. [WebSocket best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- `setTimeout`, `setInterval` and alarms prevent hibernation. [WebSocket best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) A match with a fixed server tick is therefore awake for its whole length, and hibernation only helps lobbies and idle rooms (inference).
- Per-connection data that must survive hibernation goes in an attachment of at most 16,384 bytes. [WebSocket best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

### Pricing, and the cost of one match

The Workers Paid plan costs at least $5 a month. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) Durable Objects add these charges. [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) (page modified 2026-11-13)

- Requests cost $0.15 per million after 1 million included each month.
- Duration costs $12.50 per million GB-seconds after 400,000 included each month, billed on 128 MB per object.
- Incoming WebSocket messages count as one request per 20 messages. Outgoing messages and protocol pings are free.
- Workers have no charge for egress or bandwidth. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

Worked example (my arithmetic from the prices above). One match has 10 players, each sending 25 messages per second, for 15 minutes.

- Incoming messages are 10 × 25 × 900 = 225,000. At 20 messages per billed request, that is 11,250 requests, or about $0.0017.
- Duration is 0.125 GB × 900 s = 112.5 GB-seconds, or about $0.0014. The object stays awake for the whole match because of the tick loop.
- The total is about $0.003 per match, or about $0.0003 per player per match.
- At 1,000 matches a day (30,000 a month), the bill is about $93 a month including the $5 base and the included amounts.
- Server snapshots sent to players at 20 to 30 per second add nothing, because outgoing messages and bandwidth are free.

### Location

- By default, an object is created in a data center near the first `get()` request. [Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)
- Location hints are `wnam`, `enam`, `sam`, `weur`, `eeur`, `apac`, `apac-ne`, `apac-se`, `oc`, `afr` and `me`. They are best effort and apply only on the first `get()`. A `sam` hint currently places the object in Eastern North America, and `afr` and `me` go to a nearby supported location. [Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)
- Objects never move after creation. Cloudflare says dynamic relocation is planned. [Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)
- Cloudflare says 95% of internet users are within 50 ms of a Cloudflare data center. [Cloudflare network](https://www.cloudflare.com/network/) That figure is for the nearest edge, not for the one city that hosts a match.

### PartyKit and PartyServer

- The hosted PartyKit platform was announced as shutting down on 9 October 2026. Deploys stopped on 16 October, and the platform and its room data were deleted on 23 October. [PartyKit blog](https://blog.partykit.io/posts/hosted-platform-shutdown)
- PartyServer, partysocket and y-partyserver stay maintained at `cloudflare/partykit`. PartyServer runs as an ordinary Worker with Durable Objects in your own account, deployed with Wrangler. [PartyKit blog](https://blog.partykit.io/posts/hosted-platform-shutdown)
- `cloudflare/partykit` has 1,317 stars, an ISC license, and its last commit on 2026-08-03. The latest `partyserver` on npm is 0.5.10, published 2026-08-03. (GitHub API and `npm view`, read 2026-11-20)
- PartyServer depends only on `nanoid`. (`npm view partyserver dependencies`) It is a room and connection helper, with no tick loop, state sync, prediction or matchmaking (inference from its size and the PartyKit docs above).

### Agents SDK

- The Agents SDK builds AI agents, and each agent is a Durable Object with SQL storage, real-time connections and scheduling. [Agents docs](https://developers.cloudflare.com/agents/) Its docs do not mention games.
- `cloudflare/agents` has 6,012 stars and was pushed on 2026-11-20. The `agents` package is at 0.33.0 (2026-11-03), and it no longer depends on `partyserver`, only on `partysocket`. (GitHub API and `npm view`) Cloudflare's realtime investment appears to be flowing into Agents rather than PartyServer (inference).

### Dynamic Workers and Durable Object Facets

These two features are what make a user-generated game platform on Durable Objects technically possible.

- Dynamic Workers start Workers at runtime from code you supply, in a sandbox, as "a lightweight alternative to containers for running untrusted code". Outbound network access can be blocked or intercepted. [Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/)
- A Durable Object Facet runs dynamically loaded code as a Durable Object with its own SQLite database. A supervisor object that you write creates facets, and the loaded code cannot read the supervisor's database. [Facets](https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/) The page does not say whether a facet can accept WebSocket upgrades directly, so a supervisor might have to own the sockets and forward messages (inference, worth testing).
- Dynamic Workers need the Workers Paid plan. Each month includes 1,000 unique Dynamic Workers created per day, 10 million requests and 30 million CPU ms. Beyond that, each Dynamic Worker costs $0.002 per day. Billing for created Dynamic Workers started on 26 May 2026. [Dynamic Workers pricing](https://developers.cloudflare.com/dynamic-workers/pricing/)
- Workers for Platforms, the older route for hosting customer code, costs $25 a month with 20 million requests and 1,000 scripts included. [Workers for Platforms pricing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/platform/pricing/)

### Realtime (formerly Calls)

- The Realtime SFU and TURN cost $0.05 per GB of egress after 1,000 GB free each month. [Realtime pricing](https://developers.cloudflare.com/realtime/sfu/pricing/)
- The SFU supports WebRTC DataChannels with reliable or unreliable, ordered or unordered delivery. Browsers own the channels, and your backend allocates them through the SFU API. [Realtime DataChannels](https://developers.cloudflare.com/realtime/sfu/datachannels/) The docs do not show a Worker or Durable Object as a DataChannel endpoint, so DataChannels cannot carry traffic between players and an authoritative Durable Object (inference from the docs).
- Cloudflare's game-related Realtime material is an experimental cloud-gaming example that streams video from a Container and takes input over DataChannels. [Cloud gaming example](https://developers.cloudflare.com/realtime/sfu/examples/cloud-gaming/)

### Is anyone shipping games on Durable Objects?

- Yes, but only single games and demos, not frameworks or platforms. Examples include `cloudflare/doom-workers`, a board-game site (`genisis-lab/table-games`) and a Diablo-style backend (`JohnImril/hellgate-ws`). [table-games](https://github.com/genisis-lab/table-games), [hellgate-ws](https://github.com/JohnImril/hellgate-ws)
- GitHub repository searches for "durable objects multiplayer", "cloudflare multiplayer game" and "partykit game" return only repositories with 0 or 1 stars. (`gh search repos`, 2026-11-20)
- Liveblocks runs its collaboration product on Durable Objects. [Cloudflare case study](https://www.cloudflare.com/case-studies/liveblocks)
- Playroom joined the Cloudflare Launchpad program in April 2024. [Playroom blog](https://docs.joinplayroom.com/blog) I could not confirm whether Playroom's servers run on Durable Objects.

## Hosted and open-source game backends

### Colyseus and Colyseus Cloud

- Model: authoritative Node.js rooms with binary state sync through `@colyseus/schema`. Clients interpolate, and prediction is left to the game (inference from the framework's design; the docs I read do not offer built-in prediction).
- Health: 7,563 stars, MIT, last push 2026-11-18, and `@colyseus/core` 0.18.29 released on 2026-11-18. (GitHub API)
- Transport: besides WebSockets, Colyseus ships `@colyseus/h3-transport` for WebTransport (0.18.6, 2026-11-10). (`npm view`) Its issue tracker shows recent fixes to make it work from real browsers. [issue 946](https://github.com/colyseus/colyseus/issues/946)
- Durable Objects: an official "[Research]: Cloudflare Durable Objects" issue has been open since 2025-04-11. The maintainer notes that Colyseus needs inter-process communication for seat reservation, and points to a community port. [issue 851](https://github.com/colyseus/colyseus/issues/851) That port, `c-py/colyseus-cloudflare-worker-transport`, has 2 stars and was last pushed on 2026-06-04. (GitHub API)
- Pricing: self-hosting is free. Colyseus Cloud starts at $15 a month with no player caps and unlimited bandwidth, and there is no free hosted tier. [Colyseus pricing](https://colyseus.io/pricing/), [Colyseus Cloud](https://colyseus.io/cloud-managed-hosting/) (32 locations, 99.9% uptime SLA)

### Nakama (Heroic Labs)

- Model: a Go server with authoritative match handlers written in Go, TypeScript or Lua, plus relayed matches. Authoritative matches do not rebroadcast messages automatically. The docs give no hard tick cap and advise the lowest tick rate that plays well. [Nakama authoritative multiplayer](https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/)
- Web support: a JavaScript client (`heroiclabs/nakama-js`, 221 stars, pushed 2026-11-17). (GitHub API)
- Health: 13,756 stars, Apache-2.0, v3.42.0 released on 2026-11-03. (GitHub API)
- Pricing: the Heroic Cloud page shows no Nakama price and asks you to contact sales. Their Satori product starts at $600 a month. [Heroic Labs pricing](https://heroiclabs.com/pricing/)
- Fit: it is a full live-ops backend (accounts, leaderboards, matchmaking) that needs Postgres or CockroachDB and a Go server, which is heavy for a solo browser game (my judgment).

### Photon (Realtime, Fusion, Quantum)

- Realtime always connects clients through a Photon server, which relays events between players and does not sync game state by itself. [Photon Realtime intro](https://doc.photonengine.com/realtime/current/getting-started/realtime-intro)
- Quantum is deterministic predict and rollback. Clients exchange only input, and the server is game-agnostic. It is "made with Unity", with a C# simulation. [Quantum intro](https://doc.photonengine.com/quantum/current/getting-started/quantum-intro) It reaches browsers through Unity WebGL builds. [Quantum WebGL](https://doc.photonengine.com/quantum/v3/manual/webgl) Photon warns that its rollback simulation needs more CPU per frame, which taxes WebGL. [Photon blog](https://blog.photonengine.com/photon-multiplayer-webgl-for-game-jams/)
- Pricing: 20 concurrent users free for development, 100 for $95 for 12 months, then $95 a month for 500 and $185 a month for 1,000. [Photon pricing](https://www.photonengine.com/pricing)
- Fit: none for a TypeScript and Three.js game, because the SDKs are C# and Unity-first (inference).

### Rivet

- Rivet Actors are long-lived processes with in-memory state, SQLite, WebSockets and scheduling. They run on Node.js or Bun, self-hosted or on Rivet Cloud. Apache-2.0. [Rivet GitHub](https://github.com/rivet-dev/rivet)
- Positioning changed: the homepage tagline is "Run and scale agents", and game hosting appears only in the legal name "Rivet Gaming, Inc." [rivet.dev](https://rivet.dev/)
- Pricing: a free control plane, Hobby at $18 a month and Team at $156 a month, plus actor nodes from $18 a month (¼ vCPU, 1 GB). [Rivet pricing](https://rivet.dev/pricing/)
- Health: 6,964 stars, last push 2026-11-20, `rivetkit` 3.1.1 published 2026-11-20. (GitHub API and `npm view`)
- Durable Objects: Rivet does not run on Cloudflare. It positions itself as an alternative to Durable Objects. [rivet.dev](https://rivet.dev/)

### Hathora

- Fireworks AI acquired Hathora, which now focuses on AI inference. Game customer support continued until 5 May 2026. Stormgate had to ship an offline mode as a result. [Game Developer, 2026-04-02](https://www.gamedeveloper.com/business/stormgate-rushing-offline-mode-after-losing-server-access-to-an-ai-company)
- Edgegap publishes a migration guide for former Hathora customers. [Edgegap docs](https://docs.edgegap.com/docs/tools-and-integrations/switch-from-hathora)

### Edgegap

- Model: it hosts your own dedicated server containers across what it calls 615+ edge locations, each run capped at 24 hours on Edge Cloud. [Edgegap pricing](https://edgegap.com/pricing)
- Pricing: $0.00115 per vCPU-minute on demand plus $0.10 per GB of egress. A free trial includes 1.5 vCPU. [Edgegap pricing](https://edgegap.com/pricing)
- Fit: a 10-player match on ¼ vCPU for 15 minutes would cost about $0.004 in compute before egress (my arithmetic), similar to Durable Objects. You would run and ship your own server process, and Edgegap can place it near the players of each match, which Durable Objects cannot do after creation (inference).

### SpacetimeDB

- Model: a database that runs your server logic as modules ("reducers") and pushes table changes to clients.
- Health: 25,569 stars, v2.16.1 released 2026-11-20. (GitHub API)
- License: Business Source License 1.1. You may use it in production with no more than one SpacetimeDB instance, and not for a "Database Service", defined as a commercial offering that lets third parties create tables whose schemas they control. It changes to AGPL v3 with a linking exception on 2031-11-10. [SpacetimeDB LICENSE](https://github.com/clockworklabs/SpacetimeDB/blob/master/LICENSE.txt) A platform where users upload their own game modules with their own tables would likely fall under that restriction (inference; ask Clockwork Labs before relying on either reading).
- Pricing (Maincloud): free with 2,500 TeV a month (about 3 million function calls), Pro at $25 a month with 100,000 TeV, Team at $250 a month. [SpacetimeDB pricing](https://spacetimedb.com/pricing)

### Playroom Kit

- Model: hosted rooms with shared state. Reliable updates go over WebSockets and unreliable ones over WebRTC. The host is the player who started the room, and host status moves when that player leaves. [Playroom docs](https://docs.joinplayroom.com/llms-full.txt) Game logic runs on the host client, not on a server (inference from the docs).
- Pricing: free for 10 unique users a day, then $10 a month for 10,000 monthly active users plus $0.0015 per extra user. [Playroom docs](https://docs.joinplayroom.com/llms-full.txt)
- License: the docs do not state an open-source license for the SDK. [Playroom docs](https://docs.joinplayroom.com/llms-full.txt) The npm package `playroomkit` was last published on 2026-07-06 (0.0.97). (`npm view`)
- Direction: a March 2026 post repositions it for vibe-coding tools. [Playroom blog](https://docs.joinplayroom.com/blog/playroom-kit-for-vibe-coding)

### Rune

- Model: game logic in JavaScript runs on Rune's servers with predict and rollback, inside the Rune mobile app's WebView. Free for developers, and Rune takes a cut of money it helps games make. Example games list 2 to 6 players. [Rune developers](https://developers.rune.ai/)
- Health: `rune/rune` has 433 stars, MIT, last push 2026-08-27, and `rune-sdk` 6.0.34 was published on 2026-11-17. (GitHub API and `npm view`)
- Fit: it is the closest existing "make and share small multiplayer games" platform, but it is closed, mobile-app-first, and built for small casual rooms (my judgment).

### Croquet and Multisynq

- Model: replicated computation. Every client runs the same deterministic model, and a "reflector" server only orders and timestamps input. The Croquet homepage says the reflector code is open source. [croquet.io](https://croquet.io/)
- Health: `croquet/croquet` has 38 stars (Apache-2.0, pushed 2026-11-12). `multisynq/multisynq-client` is archived, with its last push on 2025-08-25. `@croquet/croquet` 2.0.4 was published on 2026-02-17. (GitHub API and `npm view`) The company homepage now describes "decentralized systems" in general. [croquet.io](https://croquet.io/)
- Fit: like lockstep, every client waits on ordered input from the reflector, so latency is the slowest path to the reflector (inference).

### Unity Gaming Services

- Unity ended direct support for Multiplay game server hosting on 31 March 2026, and the service passed to Rocket Science. Relay, Lobby and Matchmaker continue. [Unity Discussions](https://discussions.unity.com/t/end-of-services/1698428), [Gameye summary](https://gameye.com/blog/game-server-shake-up-2026/)
- Fit: none for a Three.js game (inference).

### Geckos.io

- Model: client-server messaging over WebRTC DataChannels from a Node.js server, giving UDP-like delivery in browsers. BSD-3-Clause. [geckos.io GitHub](https://github.com/geckosio/geckos.io)
- Health: 1,488 stars, last push 2026-03-27, `@geckos.io/server` 3.1.0. (GitHub API and `npm view`)
- Fit: it needs a Node server with UDP, so it cannot run on Durable Objects (inference from the transport section below).

### Liveblocks and Supabase Realtime (general realtime)

- Liveblocks meters "realtime collaboration minutes" at $0.002 per user-minute and caps rooms at 10 simultaneous connections on Free and Pro. [Liveblocks pricing](https://liveblocks.io/pricing) A 15-minute, 10-player match is 150 user-minutes, or $0.30, which is about 100 times the Durable Objects cost (my arithmetic).
- Supabase counts each broadcast once when sent plus once per receiving client, and charges $2.50 per million after 2 to 5 million included. [Supabase message billing](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages) Pro allows 500 messages per second per project. [Supabase limits](https://supabase.com/docs/guides/realtime/limits) Relaying 250 messages per second to 9 other players creates 2,500 billed messages per second, about 2.25 million per match, or about $5.60 per match, and it exceeds the Pro rate limit (my arithmetic).
- Both are built for collaboration, not game ticks, and neither runs your game logic (my judgment).

## Transport in browsers

- WebSocket works everywhere and is the only transport a Durable Object accepts from browsers. The hibernation docs mention only WebSockets. [WebSocket best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- WebTransport shipped in Safari 26.4 on 2026-03-24, running over HTTP/3 and QUIC with streams that do not block each other. [WebKit blog](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/) Secondary sources list Chrome 97+, Edge 98+, Firefox 114+ and Safari 26.4+ as supported, making it Baseline in 2026. [WebRTC.ventures](https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/)
- Cloudflare Workers gained inbound raw TCP in private beta on 2026-08-03 through Spectrum, and a socket can be passed to a Durable Object. UDP is listed only as a future direction, and WebTransport is not mentioned. [Cloudflare blog](https://blog.cloudflare.com/grpc-workers/) I found no Cloudflare document that offers WebTransport termination in Workers or Durable Objects.
- WebRTC DataChannels give unreliable delivery, but in Cloudflare only between browsers through the Realtime SFU, not to a Durable Object. [Realtime DataChannels](https://developers.cloudflare.com/realtime/sfu/datachannels/)
- What this means for a hook game (my judgment): WebSocket's head-of-line blocking hurts only when packets drop. A lost packet stalls later ones for about one round trip. On good connections at 20 to 30 messages per second this is rare, and many browser .io games ship on WebSockets. If it ever matters, the move is to a server that speaks WebTransport (Colyseus h3, or your own on Edgegap or a VM), not to Durable Objects.

## Netcode for a skillshot hook game

### How much latency players tolerate

- Claypool and Claypool group games by how players see the world. First-person avatar games (shooters, racing) degrade past about 100 ms. Third-person avatar games (sports, role-playing) degrade past about 500 ms. Omnipresent games (RTS) degrade past about 1,000 ms. [Claypool and Claypool, CACM 2006, open tech report](http://www.cs.wpi.edu/~claypool/papers/precision-deadline/tr-06-13.pdf)
- The same paper explains that sensitivity depends on how precise an action is and how short its deadline is. A hook is a precise action against a moving target with a deadline of a fraction of a second, so it should behave closer to the 100 ms class than the 500 ms class even though the camera is top-down (inference from that framework).
- Riot built VALORANT on 128-tick servers and aimed for most players to be under 35 ms ping. [Riot tech blog](https://technology.riotgames.com/node/112), [TechRadar interview](https://techradar.com/au/news/valorant-interview-talking-the-tech-behind-one-of-pcs-most-competitive-shooters) This is a shooter-grade target and stricter than a hook game needs (my judgment).

### Which model fits

- Server-authoritative with client prediction is the best fit (my judgment). The client predicts its own movement and the start of its own hook, the server decides hits, and other players are shown interpolated slightly in the past. Gambetta describes the server rewinding the world to the moment the shooter fired. The cost is that a target can be hit a few milliseconds after reaching cover. [Gambetta, lag compensation](https://www.gabrielgambetta.com/lag-compensation.html) For a hook, a capped rewind (for example up to 150 ms) keeps "I clearly hit him" true for most players while limiting unfair hits on high-ping players (my judgment).
- Deterministic lockstep sends only inputs, but each step waits for every player's input, so delayed packets stall everyone. [Gaffer on Games](https://gafferongames.com/post/deterministic_lockstep/) With 10 players on different connections, the slowest player sets the input delay for all of them (inference). Warcraft III's Pudge Wars ran on this model, which is part of why it felt laggy online (my judgment, not sourced).
- Rollback (as in Photon Quantum and Rune) predicts everyone and re-simulates when real input arrives. [Quantum intro](https://doc.photonengine.com/quantum/current/getting-started/quantum-intro) With 10 players, mispredictions happen far more often than in a 2-player fighting game, and a hook that visibly snaps back after rollback feels worse than a hook judged once on the server (my judgment). Rollback also needs every client to run the full simulation each frame, many times when rolling back.
- Dune77's existing design already matches the server-authoritative model. The same deterministic simulation can run in the browser worker for prediction and in the Durable Object for authority (inference from `docs/architecture.md`).

### What one location per match does

Round-trip times between cities, from WonderNetwork's averages. [WonderNetwork New York](https://wondernetwork.com/pings/New%20York), [WonderNetwork Frankfurt](https://wondernetwork.com/pings/Frankfurt)

| From | London | Frankfurt | New York | Los Angeles | São Paulo | Tokyo | Singapore | Sydney |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Frankfurt | 18 ms | n/a | 85 ms | 146 ms | 200 ms | 220 ms | 158 ms | 258 ms |
| New York | 71 ms | 85 ms | n/a | 69 ms | 110 ms | 176 ms | 222 ms | 204 ms |

- A match placed in Western Europe gives European players 20 to 50 ms and East Coast players about 85 ms. Both stay under the 100 ms class, so a combined Europe and North America East queue is workable (inference from the table).
- A match that mixes Europe with Asia or Oceania puts some players at 150 to 260 ms. That is past where skillshots feel fair (inference).
- The fix is to group players by region before creating the room, and pass the region's location hint on the first `get()`. Objects cannot move later. [Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)
- South America is weak on Durable Objects today because `sam` objects are created in Eastern North America, about 110 ms from São Paulo. [Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/), [WonderNetwork New York](https://wondernetwork.com/pings/New%20York)

## Where the gap is

What already exists and need not be built:

- Rooms, sockets, hibernation, storage and global placement come from Durable Objects and PartyServer.
- Sandboxed hosting of strangers' server code with its own storage comes from Dynamic Workers and Facets.
- Binary state replication comes from `@colyseus/schema`, which Dune77 already uses.
- Live-ops features (accounts, leaderboards, matchmaking) come from Nakama, if they are ever needed.

What nobody offers on Durable Objects:

- An open, TypeScript, engine-agnostic netcode library for action games. It would run the same deterministic simulation in a browser worker and in a Durable Object, and include fixed-tick input handling, client prediction with reconciliation, interpolation of remote entities and capped server-side lag compensation. Colyseus has rooms and schema sync without prediction, and Rune and Quantum have rollback but are closed or Unity-bound.
- An open "upload a multiplayer game and get a shareable room link" layer on Dynamic Workers. Rune and Playroom come closest, and both are closed and hosted.

Risks to the gap (my judgment):

- Cloudflare could publish a game template on PartyServer or Agents that covers rooms and state sync. It has already folded PartyKit into its own tooling.
- Colyseus could finish its Durable Objects transport, which has an open issue and a working community port.
- The backend is the smallest part of a user-generated game platform. Discovery, moderation, abuse limits on uploaded code and creator payouts are the bulk of the work, and none of them come from Cloudflare.

## Comparison

| Option | Model | Browser support | Pricing (Nov 2026) | License | Health | Runs on Durable Objects |
| --- | --- | --- | --- | --- | --- | --- |
| Durable Objects plus PartyServer | Authoritative room you write yourself | WebSocket | About $0.003 per 15-minute 10-player match, plus $5 a month | Proprietary platform, ISC library | `partyserver` 0.5.10, last release 2026-08-03 | Yes |
| Dynamic Workers plus Facets | Sandboxed user code as a Durable Object | Through a supervisor Durable Object | $0.002 per Dynamic Worker per day after 1,000 a day | Proprietary | Billing since 2026-05-26 | Yes |
| Colyseus | Authoritative rooms, schema sync | WebSocket, WebTransport (h3) | Free self-host, Cloud from $15 a month | MIT | 7.6k stars, release 2026-11-18 | Community port only (2 stars) |
| Nakama | Authoritative or relayed matches, live ops | JavaScript client | Self-host free, Cloud by quote | Apache-2.0 | 13.8k stars, release 2026-11-03 | No |
| Photon Quantum | Deterministic rollback | Unity WebGL only | 20 users free, 100 users $95 a year | Proprietary | Active | No |
| Rivet | Stateful actors, now aimed at AI agents | WebSocket | Free tier, Hobby $18 a month plus nodes | Apache-2.0 | 7.0k stars, release 2026-11-20 | No (an alternative to it) |
| Hathora | Dedicated servers | n/a | n/a | n/a | Shut down 2026-05-05 | No |
| Edgegap | Your dedicated server container at the edge | Whatever your server speaks | $0.00115 per vCPU-minute, $0.10 per GB | Proprietary | Active | No |
| SpacetimeDB | Database with server modules | WebSocket SDK | Free tier, Pro $25 a month | BSL 1.1, no third-party-schema services | 25.6k stars, release 2026-11-20 | No |
| Playroom Kit | Host-client shared state | WebSocket plus WebRTC | Free 10 users a day, $10 a month for 10,000 MAU | Not stated | npm last published 2026-07-06 | Unconfirmed |
| Rune | Server-run logic with rollback | Rune app WebView | Free, revenue share | MIT SDK, closed platform | Active, SDK 2026-11-17 | No |
| Croquet / Multisynq | Replicated computation via reflector | WebSocket | Free key, open reflector | Apache-2.0 | Multisynq client archived 2025-08 | No |
| Unity Gaming Services | Relay plus Netcode for GameObjects | Unity WebGL | By usage | Proprietary | Multiplay hosting ended 2026-03-31 | No |
| Geckos.io | Server messaging over WebRTC | DataChannels | Free | BSD-3-Clause | 1.5k stars, last push 2026-03-27 | No |
| Liveblocks | Collaborative storage sync | WebSocket | $0.002 per user-minute | Proprietary | Active | Built on it, closed |
| Supabase Realtime | Broadcast and presence | WebSocket | $2.50 per million messages, per recipient | Apache-2.0 | 7.7k stars, active | No |
