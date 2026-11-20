# Web game engines and frameworks in late 2026

Researched on 2026-11-20 for the question of whether to pull a hackable engine out of Dune77 and put a creator platform on Cloudflare Durable Objects. Every source below was read on 2026-11-20 unless a line says otherwise. GitHub star counts, licenses and release dates come from the GitHub API (`gh api repos/<owner>/<repo>` and `/releases/latest`), and npm versions come from `registry.npmjs.org`, both queried that day. Lines marked "Inference" are my reading of the evidence, not something a source states.

## Conclusion

An engine extracted from Dune77 would not offer anything that Three.js plus off-the-shelf libraries lacks at the level of rendering, physics, entity storage, navigation or editing. Each of those layers has a mature, free, MIT or Apache library with a 2026 release, listed in the table below. Building any of them again is wasted time.

What Dune77 has that is uncommon is the seam between them. One TypeScript simulation runs on fixed ticks with no Three.js or browser dependency, and the same code runs in a Web Worker today and is meant to run in a Durable Object per match tomorrow (`docs/architecture.md`). Around it sit a procedural terrain pipeline that feeds Recast navigation, and Playwright preview and verify tooling that an AI agent can drive. Only two products in this survey ship "write game logic once in TypeScript, the platform runs it authoritatively on a server": Rune and HYTOPIA. HYTOPIA open-sourced its engine in March 2026 and its site now says "HYTOPIA is now Far Worlds", a single first-party game. Rune's SDK is still updated, but its pitch is distribution inside a 10-million-install mobile app, not the SDK.

Inference: the hard and rare parts of a "Steam Workshop for web games" are not engine parts. They are running untrusted creator code safely, hosting it cheaply, and bringing players. The creator platforms that work (Roblox, Fortnite's UEFN, s&box) each own a large player base first. HYTOPIA shows what happens to a creator platform without one. So the blunt recommendation for this topic is: build the hook arena game on Dune77's code, keep the simulation and network seam clean, and extract only what a second game actually reuses. Do not build an engine or a platform before one game has players.

Commodity, so do not build:

- Rendering, materials and post effects are covered by Three.js, Babylon.js and PlayCanvas.
- Physics is covered by Rapier, Jolt and Box2D v3, and all three now offer cross-platform determinism in their browser builds.
- Entity storage is covered by bitECS and Koota.
- Navigation meshes are covered by recast-navigation, which Dune77 already uses.
- Room servers and state sync are covered by Colyseus and PartyServer, which Dune77 already uses in its prototype.
- Visual editors are covered by the PlayCanvas Editor (MIT frontend), the Babylon.js Editor, Godot and Needle's Unity and Blender exporters.

Rare, so maybe worth building, but only once a game needs it:

- A small kit that runs one TypeScript simulation module unchanged in a local Worker and in a Durable Object, with replication and a headless test harness. Rune and HYTOPIA are the only close examples, and neither targets Cloudflare.
- Agent-first verification: a headless simulation an agent can test with `bun test`, plus scripted visual previews. Every big engine is adding an MCP server in 2026, but those servers edit scenes; few give an agent a fast way to check gameplay outcomes.
- A sandbox for untrusted game logic in JavaScript. Nobody in the web space offers a general one. Rune restricts logic to pure functions with time and memory limits, which is the most practical model found.

## 3D web engines

| Engine | Latest release (date) | License | GitHub stars |
| --- | --- | --- | --- |
| Three.js | r187 (2026-10-30) | MIT | 119,010 |
| Babylon.js | 9.37.1 (2026-11-18) | Apache-2.0 | 26,407 |
| PlayCanvas engine | 2.24.2 (2026-11-18) | MIT | 17,336 |
| React Three Fiber | 9.8.2 (2026-10-15), 10.0 in alpha | MIT | 33,844 |
| Needle Engine | 5.1.16 stable (2026-10-15), 6.0 in alpha | No SPDX license on npm | 611 (support repo) |
| Godot | 4.7.2 (2026-08-18) | MIT | 120,466 |
| Bevy | 0.20.1 (2026-10-28) | Apache-2.0 | 49,889 |
| Defold | 1.14.1 (2026-11-10) | Defold license (not SPDX) | 6,472 |

Sources: GitHub API for each repository (github.com/mrdoob/three.js, github.com/BabylonJS/Babylon.js, github.com/playcanvas/engine, github.com/pmndrs/react-three-fiber, github.com/needle-tools/needle-engine-support, github.com/godotengine/godot, github.com/bevyengine/bevy, github.com/defold/defold) and https://registry.npmjs.org/@needle-tools/engine.

### Three.js

- Three.js shipped six releases in the twelve months to November 2026: r182 on 2025-12-10, r183 on 2026-02-20, r184 on 2026-04-16, r185 on 2026-07-01, r186 on 2026-09-24 and r187 on 2026-10-30. That is roughly one release every two months, slower than the monthly pace of 2025 (r176 to r180 came out between April and September 2025). Source: https://github.com/mrdoob/three.js/releases.
- r185 added clustered (Forward+) lighting and WebXR support to `WebGPURenderer`. Source: https://github.com/mrdoob/three.js/releases/tag/r185.
- r186 deprecated the CommonJS build and added MSAA to WebXR on WebGPU. Source: https://github.com/mrdoob/three.js/releases/tag/r186.
- r187 introduced meshlet and visibility-buffer drawing pipelines on the WebGPU side. Source: https://github.com/mrdoob/three.js/releases/tag/r187.
- Several 2026 changes in the release notes list `@claude` as a co-author, so the core library itself is now partly written with AI agents. Source: the release notes above.
- `WebGPURenderer` uses WebGPU by default and falls back to WebGL 2 on its own. Custom materials built on `ShaderMaterial`, `RawShaderMaterial` or `onBeforeCompile()` are not supported there; they must be rewritten in TSL, the node shading language. `EffectComposer` is also not supported. The manual says "there are no plans to add larger new features" to `WebGLRenderer`. Source: https://raw.githubusercontent.com/mrdoob/three.js/dev/manual/pages/webgpurenderer.html.
- Dune77 still uses `THREE.WebGLRenderer` (`src/main.ts` line 79), and nine files under `src/` use `ShaderMaterial` or `onBeforeCompile`. Inference: moving Dune77 to `WebGPURenderer` means porting those nine files to TSL first. Any engine extracted today would start on the renderer that three.js has stopped extending.

### Babylon.js

- Babylon.js 9.0 was announced on 2026-03-26 as "the most ambitious release yet". Source: https://forum.babylonjs.com/t/welcome-to-babylon-js-9-0/62940.
- Coverage of 9.0 lists clustered lighting on WebGPU and WebGL 2, a v1 Frame Graph, a rebuilt inspector and a multi-file Playground. This is a secondary source. Source: https://app.cinevva.com/news/2026-03-26-babylonjs-9.
- Babylon ships patch releases about weekly: 9.37.1 came out on 2026-11-18. Source: GitHub API.
- It is the only one of the big three with a full engine (physics plugins, GUI, audio, inspector) under one Microsoft-backed team. The Babylon.js Editor is community-managed (Apache-2.0, 1,127 stars). Source: GitHub API for BabylonJS/Editor.

### PlayCanvas

- The engine is at 2.24.2 (2026-11-18) and is MIT. Source: GitHub API.
- The browser editor's frontend is open source under MIT (github.com/playcanvas/editor, 1,378 stars). Source: GitHub API.
- PlayCanvas ships an official Editor MCP server that lets Claude Code, Codex or Cursor change a project and check the result in the viewport. Source: https://developer.playcanvas.com/user-manual/editor/mcp-server/.
- PlayCanvas leads on Gaussian splats. Engine 2.19 (June 2026) added a compute-based WebGPU splat renderer with level-of-detail streaming, and SuperSplat Editor 3.0 (September 2026) was rebuilt on WebGPU. SuperSplat has 10,691 stars and is MIT. Sources: https://blog.playcanvas.com/new-in-supersplat-editor-3-0-rebuilt-on-webgpu/ and the GitHub API.
- Inference: PlayCanvas is the closest existing thing to "a hackable web engine with an editor and an agent interface". Ivan would be competing with it, not filling a gap.

### React Three Fiber and its ecosystem

- R3F 9.8.2 is the stable line. Source: GitHub API.
- R3F 10 is in alpha. Its alpha.6 release, titled "Going WebGPU First", makes `WebGPURenderer` the default, moves TSL hooks to a new `@react-three/tsl` package, and requires three ≥ 0.185 and React 19. Source: https://github.com/pmndrs/react-three-fiber/releases/tag/v10.0.0-alpha.6.
- Drei (10,179 stars, 10.7.9 on 2026-09-25) and `@react-three/rapier` (2.2.0 on 2025-11-03) round out the stack. Sources: GitHub API and npm.
- Inference: R3F suits scene-heavy apps more than a fixed-tick authoritative game, because React owns the update loop. It does not fit Dune77's worker-driven architecture.

### Needle Engine

- Needle Engine is a framework on top of three.js with Rapier physics, WebXR including iOS, built-in multiplayer and voice, and Unity and Blender exporters. Source: https://engine.needle.tools/docs/explanation/core-concepts/features-overview.
- The stable npm tag is 5.1.16, while the `latest` tag points at 6.0.0-alpha.7 (2026-10-12). The npm package lists no SPDX license, and the public GitHub repository is a support repository, not the engine source. Source: https://registry.npmjs.org/@needle-tools/engine.

### Godot web export

- Godot 4 web builds only target WebGL 2 with the Compatibility renderer. The docs say "Godot currently does not support WebGPU." Source: https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html (the 4.7 docs).
- Single-threaded export is the default since Godot 4.3. Threaded export needs cross-origin isolation headers or a service worker workaround. Source: same page.
- "Projects written in C# using Godot 4 currently cannot be exported to the web." Source: same page. A third-party fork claims C# web export for 4.7.2, but it is not official. Source: https://github.com/joygram/godot-enhanced.

### Bevy

- Bevy 0.20 was released on 2026-10-08. Its notes say mesh shaders are unsupported on the web and point at the design plans for a future scene editor. Bevy still has no shipped editor. Source: https://bevy.org/news/bevy-0-20/.
- Inference: Bevy on the web is for Rust developers who accept a large wasm download and no editor. It is not a TypeScript option.

### Unity 6 Web

- Unity 6.6 (announced 2026-09-01) made WebGPU a production graphics API for web builds. WebGL 2 stays the default, and Unity falls back to it automatically. Source: https://discussions.unity.com/t/unity-6-6-is-now-available/1735357.

### Defold

- Defold says an empty HTML5 project downloads at about 1.06 MB gzipped since version 1.12.4. Source: https://defold.com/2026/06/30/Defold-H1-2026/ (via search snippet; I did not open the page).
- Defold is at 1.14.1 (2026-11-10). Source: GitHub API.

## 2D and no-code web engines

| Engine | Latest release (date) | License | GitHub stars |
| --- | --- | --- | --- |
| Phaser | 4.2.1 (2026-07-09) | MIT | 40,749 |
| PixiJS | 8.23.0 (2026-11-11) | MIT | 48,861 |
| Excalibur | 1.0.1 (2026-11-13) | BSD-2-Clause | 2,375 |
| GDevelop | 5.6.287 (2026-11-04) | Custom (not SPDX) | 29,114 |

Sources: GitHub API for phaserjs/phaser, pixijs/pixijs, excaliburjs/Excalibur and 4ian/GDevelop.

- Phaser 4.0.0 shipped on 2026-04-10, after release candidates through 2025. It replaces Phaser 3's WebGL pipelines with a new render-node architecture and deprecates the Canvas renderer. Phaser 4.2 followed on 2026-06-19. Sources: https://github.com/phaserjs/phaser/releases and https://raw.githubusercontent.com/phaserjs/phaser/HEAD/changelog/v4/4.0/CHANGELOG-v4.0.0.md.
- Excalibur reached 1.0.0 on 2026-11-08 after twelve years in 0.x. Source: https://github.com/excaliburjs/Excalibur/releases.
- PixiJS 8 releases about monthly and is MIT. Source: GitHub API.
- Construct 3 added TypeScript coding in the editor with stable release r440 in May 2025. Its 2026 releases are mostly maintenance. Source: https://www.construct.net/make-games/releases/stable/r440 (via search snippet).
- GDevelop's built-in multiplayer gives lobbies of up to 8 players, host migration, object ownership and client-side prediction, with "no servers to manage". Player 1 is the host by default, so it is host-authoritative, not server-authoritative. Source: https://wiki.gdevelop.io/gdevelop5/all-features/multiplayer/.
- GDevelop's free tier gets 1 lobby with up to 4 players; paid tiers get unlimited lobbies of up to 8. Source: https://gdevelop.io/pricing/business (via search snippet).

## Building blocks

### Entity component systems

- bitECS 0.4.0 (2025-12-06) is MPL-2.0 with 1,541 stars. Source: npm and GitHub API.
- Koota 0.6.6 (npm 2026-04-09) is ISC with 772 stars, from the pmndrs group behind R3F. Its repo was still active on 2026-11-19. Source: npm and GitHub API.
- Miniplex has not published since 2.0.0 on 2023-07-16. Source: npm.
- Inference: an ECS is a few hundred lines and a matter of taste. It is not a selling point for an engine.

### Physics

- Rapier's JavaScript and wasm build "is fully cross-platform deterministic": a snapshot hash matches across machines, as long as inputs are deterministic. The docs warn that `Math.sin` and `Math.cos` are not. Rapier is at 0.21.0 (2026-09-25), with a separate `@dimforge/rapier3d-deterministic-compat` package. Sources: https://rapier.rs/docs/user_guides/javascript/determinism/ and npm.
- JoltPhysics.js 1.1.1 (2026-10-23) is MIT, offers multithreaded and SIMD wasm builds, and has a `CROSS_PLATFORM_DETERMINISTIC` build option. Source: https://github.com/jrouwe/JoltPhysics.js.
- Box2D v3 is cross-platform deterministic because it avoids fast-math and FMA and uses its own trig functions. It is at v3.2.0 (2026-10-19) with 10,508 stars, and `box2d3-wasm` 6.0.0 (2026-10-26) wraps it for the web. Sources: https://box2d.org/posts/2024/08/determinism/ (published 2024), GitHub API and npm.
- Dune77's simulation calls `Math.sin`, `Math.cos` or `Math.atan2` in `src/sim/units.ts`, `navigation.ts`, `construction.ts` and `production.ts` (checked with grep). Inference: that is fine for the planned server-authoritative design. It would break lockstep or rollback netcode across different machines, which is the style Rune uses.

### WebGPU support in browsers

| Browser | Status | Source |
| --- | --- | --- |
| Chrome and Edge | Shipped on Windows, macOS and ChromeOS in 113, on Android 12+ in 121, and on Linux only for Intel Gen12+ (144) and NVIDIA on Wayland (147). | gpuweb wiki |
| Safari | Shipped and on by default in macOS, iOS, iPadOS and visionOS 26. | gpuweb wiki |
| Firefox | Shipped on Windows in 141 and on Apple Silicon Macs in 145 (macOS 26) and 147 (all macOS). Linux is Nightly only, and Android is behind a flag. | gpuweb wiki |

Source: https://github.com/gpuweb/gpuweb/wiki/Implementation-Status. caniuse puts global support at 88.6% including partial support. Source: https://caniuse.com/webgpu.

Inference: WebGPU is safe as the main path for a 2026 game, but a WebGL 2 fallback is still required for about one browser in nine, including all Firefox on Linux and Android. Three.js, Babylon, PlayCanvas and Unity all provide that fallback.

## Engines that double as creator platforms

| Platform | Creator language | How it contains creator code | Status in 2026 |
| --- | --- | --- | --- |
| Roblox | Luau | Luau is a sandboxed VM; the language is MIT open source (luau-lang/luau, 6,132 stars, 0.747 on 2026-11-13). | Paid creators over $1.5 billion in 2025 (secondary source). |
| Fortnite UEFN | Verse | Verse runs only inside Epic's runtime. Epic promised an open-source Verse in 2023, but only the CC0 "Book of Verse" docs are public. | Engagement payouts share 40% of eligible net revenue. |
| s&box | C# | A whitelist of allowed .NET APIs; code that breaks it will not load or publish. Fast hot reload. | Launched on Steam 2026-04-28. Its own code is MIT; Source 2 stays closed. |
| HYTOPIA | TypeScript | Server-authoritative: creator code runs on HYTOPIA's servers. | Engine open-sourced (MIT) on 2026-03-02. The site now redirects to Far Worlds, a single game. |
| Rune | JavaScript or TypeScript | Logic must be pure, synchronous functions, with a 10 ms and 1 MB limit per action and 10 actions per player per second. Clients predict, the server confirms. | SDK still updated (rune-sdk 6.0.34 on 2026-11-13). Games run inside the Rune app, which claims 10 million installs. |
| GDevelop | Visual events, optional JavaScript | Host-authoritative peer lobbies. | Free tier 1 lobby of 4 players. |

Sources:

- Luau: GitHub API for luau-lang/luau.
- Roblox payouts: Roblox's Q4 2025 earnings call as summarized at https://www.aol.com/articles/roblox-rblx-q4-2025-earnings-224200551.html (secondary). Roblox's own report says creators earned over $1 billion from March 2024 to March 2025: https://corp.roblox.com/newsroom/2025/09/roblox-annual-economic-impact-report (via search snippet).
- Roblox Studio now has a built-in MCP server, and Roblox's April 2026 post is titled "Roblox Studio going agentic": https://create.roblox.com/docs/studio/mcp and https://about.roblox.com/en-au/newsroom/2026/04/roblox-studio-going-agentic.
- Verse: https://www.unrealengine.com/blog/unreal-editor-for-fortnite-is-now-available-in-beta (the 2023 launch post with the 40% figure and the open-source promise) and https://github.com/verselang/book.
- s&box whitelist: https://sbox.game/dev/doc/code/code-basics/api-whitelist. s&box launch date and license: https://en.wikipedia.org/wiki/S%26box (secondary).
- HYTOPIA: https://github.com/hytopiagg/hytopia-source (MIT, 62 stars, last push 2026-03-02), https://github.com/hytopiagg/sdk ("currently in alpha development"), https://x.com/hytopia/status/2028539138686046596, and the live site https://hytopia.com, whose only text is "HYTOPIA is now Far Worlds". https://farworlds.com describes "an MMORPG-like co-op RPG, built from blocks". HYTOPIA reported 143,000 users seven months after its SDK launch: https://blog.hytopia.com/2025/09/30/seven-months-since-launch-hytopias-growth-story/ (via search snippet).
- Rune: https://github.com/rune/rune (README), https://developers.rune.ai/docs/how-it-works/syncing-game-state and npm.
- GDevelop: see the 2D section.

### What makes an engine hackable by others in practice

Inference, drawn from the table above:

- A scripting language that a beginner or an AI agent can write. Every successful platform picked one: Luau, Verse, C#, TypeScript. TypeScript is the natural pick for a web engine, and AI agents write it well.
- A hard boundary for untrusted code. Roblox uses its own VM, s&box uses an API whitelist, and Rune uses pure functions with time and memory caps. A Durable Object can run creator code only if that code is trusted or isolated, which in practice means either Cloudflare's Workers for Platforms (dynamic dispatch to per-creator Workers) or a restricted interpreter. Neither exists in Dune77 today. Cloudflare describes Workers for Platforms as letting you "run untrusted code written by your customers, or by AI, in a secure hosted sandbox". Source: https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/.
- Hot reload measured in milliseconds. s&box advertises it. HYTOPIA's dev server hot-reloads server logic on save.
- An asset pipeline that turns creator files into game-ready assets. Dune77 has scripts for its own assets in `tools/assets/`, not a general importer.
- An editor, or at least a scene format plus a viewer. PlayCanvas and Babylon have one. Dune77 has preview pages but no editor.

## Trends in 2025 and 2026

- The 2025 Vibe Coding Game Jam required at least 80% AI-written code, instant play on the web with no login, and recommended Three.js. Source: https://vibej.am/2025/.
- The Cursor Vibe Jam 2026 raised the bar to 90% AI-written code, ran in April 2026 with a 1 May deadline, recommended Three.js, said "multiplayer games preferred", and offered over $50,000 in prizes. Source: https://vibej.am/2026/.
- Pieter Levels announced the 2026 winners on 2026-06-17 and wrote that the games were "getting close to production-ready games that could compete with real game studios". Source: https://levels.io/vibe-jam-2026-winners-quality.
- The winner was a Three.js game built with Claude Code, chosen from 945 entries, and the second and third places were Three.js games built with Codex. These figures come from search snippets of Levels' X post, which I could not open. Source: https://x.com/levelsio/status/2067437528320512144.
- Agent interfaces are becoming standard. PlayCanvas has an official Editor MCP server, Roblox built one into Studio, Unity has one in open beta, and Rune ships `rune-mcp` for agents to build and upload games. Sources: the PlayCanvas and Roblox links above, https://github.com/rune/rune, and https://www.strayspark.studio/blog/unity-mcp-server-vs-unreal-godot-blender-2026 (secondary, for Unity).
- Web game portals report growth. Poki claims over 100 million monthly players in 2026, up from 10 million in 2020, and 1 billion gameplays a month. These are company figures. Source: https://investgame.net/news/pdf/2026-06-25-the_2026_state_of_web_gaming_report_4ee6fdc260_wp/.

Inference on crowded niches: small single-player Three.js games are now the most crowded niche, because a weekend with an AI agent produces a playable one and nearly a thousand were made for one jam. Engine-and-editor platforms are also crowded at the top (PlayCanvas, Babylon, Godot, Unity) and have already failed at the indie end (HYTOPIA). The less crowded space is polished, server-authoritative multiplayer that is instant to join in a browser, because AI agents still write single-player code far more easily than good netcode.

## What this means for Ivan

- Ivan's edge is not the engine. It is a working pattern for authoritative TypeScript simulation that runs in a Worker and on a Durable Object, plus agent-friendly verification. That pattern helps the hook game directly.
- A hook arena game lives or dies on skillshot netcode: client-side prediction of the hook throw and fair hit resolution on the server. Inference: that work is specific to the game and is worth more than any engine extraction.
- Extract a shared package only when the second game exists, and only for the parts both games use: the match session boundary, the worker and Durable Object host, replication, and the headless test harness.
- If a creator platform is still the goal later, the first unsolved problem is sandboxing creator logic on Cloudflare, not rendering. Rune's model (pure functions with time and memory caps) is the cheapest one to copy.
