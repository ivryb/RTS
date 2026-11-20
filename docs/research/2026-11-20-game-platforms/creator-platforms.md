# Creator platforms and web game distribution, late 2026

Research for the hook arena game and the idea of a hackable multiplayer platform on Durable Objects. Every URL below was read on 2026-11-20. Claims marked "inference" are my reasoning, not something a source says.

## Conclusion

A hackable web platform where people build and share multiplayer games already exists several times over. None of them has won. Rune (JavaScript games with hosted predict-rollback netcode inside a mobile voice-chat app), Hytopia (TypeScript games in the browser), Astrocade and Google Playground (AI-made browser games), Reddit Devvit and Bloxd custom games all occupy parts of that idea. The engine and netcode are the easy part. The scarce part is players.

The winners own an audience first and add creation second. Roblox has 138 million daily users and paid $403 million to creators in Q3 2026 alone. Fortnite already had its players before UEFN, and creator islands now take 47% of Fortnite play hours. Garry's Mod sold over 25 million copies as a game, and Dota 2 custom games and Warcraft 3 maps like Pudge Wars rode the lobby list of a hit game.

The losers launched an editor and hoped players would follow. Core, Crayta, Dreams, Hiber, Hytopia, Rec Room and Horizon Worlds VR all shrank or closed between 2023 and 2026. The causes repeat. The maker-to-player ratio became lopsided, costs exceeded revenue per user, the platform depended on a host that died (Stadia, VR), and there was no lead game giving players a reason to come. s&box is the 2026 case study. It launched in April with a $1 million creator fund and Facepunch's reputation, peaked near 13,000 concurrent players, and fell under 500 within five months.

For Ivan, the evidence points to building the hook game first and shipping it where players already are (inference). A Discord Activity, CrazyGames and Poki each accept web multiplayer games and bring their own audience. A platform for other creators is only worth extracting if the hook game itself draws a crowd, because a crowd is the one thing every failed platform lacked (inference).

## Why platforms won or died

Four forces explain nearly every case below.

1. Player liquidity. A multiplayer game is empty without other players in the lobby at that moment. GameDiscoverCo's s&box analysis says small creation platforms fail when makers outnumber players so much the ratio becomes "unworkable", and names Dreams as the earlier example ([GameDiscoverCo, 2026-09-29](https://newsletter.gamediscover.co/p/what-do-s-and-boxs-issues-so-far)).
2. Creator economics. Creators follow money, and money follows players. Roblox, Fortnite and Overwolf together paid about $2.2 billion to developers in 2025, up 47% from 2024 ([Naavik, 2026-03-01](https://naavik.co/digest/the-state-of-ugc-2026/)). Platforms outside that group cannot match those payouts. Facepunch funds the s&box Play Fund from Garry's Mod profits, not from s&box itself ([PC Gamer via search summary](https://www.pcgamer.com/games/rpg/we-dont-have-to-fire-1000-people-to-keep-it-working-facepunch-studios-says-paying-s-and-box-game-developers-is-sustainable-with-usd500-000-paid-out-to-date/)).
3. Discovery. A platform needs a reason for a player to open it. GameDiscoverCo's sharpest point on s&box is that it gives players little reason to play its games "on this platform" rather than on Steam, itch.io or Roblox ([GameDiscoverCo](https://newsletter.gamediscover.co/p/what-do-s-and-boxs-issues-so-far)). Naavik notes that no Web3 UGC platform has reached meaningful scale and that most mobile party UGC games declined ([Naavik](https://naavik.co/digest/the-state-of-ugc-2026/)).
4. Cost per user. Rec Room reached 150 million players and still closed because "our costs always ended up overwhelming the revenue we brought in" ([Road to VR, 2026-04-02](https://www.roadtovr.com/rec-room-shutdown-why-top-creator/)). Technology was rarely the killer. Every dead platform below had a working editor.

## The large creator platforms today

### Roblox

- Roblox had 138 million daily active users in Q3 2026, down 9% year over year and up 12% from Q2 ([Q3 2026 shareholder letter](https://www.sec.gov/Archives/edgar/data/0001315098/000162828026068235/ex991-q32026earningsshar.htm)).
- Bookings were $1,697 million in Q3 2026, down 12% year over year, and hours were near 34 billion, down 15% ([same letter](https://www.sec.gov/Archives/edgar/data/0001315098/000162828026068235/ex991-q32026earningsshar.htm)).
- Developer Exchange (DevEx) fees paid to creators were $403 million in Q3 2026, 24% of bookings, and $1,189 million for the first nine months of 2026 ([same letter](https://www.sec.gov/Archives/edgar/data/0001315098/000162828026068235/ex991-q32026earningsshar.htm)).
- By the end of Q3 2026, 64% of daily users had completed an age check ([same letter](https://www.sec.gov/Archives/edgar/data/0001315098/000162828026068235/ex991-q32026earningsshar.htm)). The letter does not say the checks caused the decline, so any link is a guess.
- The standard DevEx rate is $0.0038 per earned Robux, which is $114 for 30,000 Robux ([Roblox docs](https://create.roblox.com/docs/production/monetization/developer-exchange)).
- From 2026-06-08, spend by age-checked US players over 18 in eligible games cashes out at $0.0054, a 42% increase ([Roblox newsroom, 2026-04-30](https://about.roblox.com/newsroom/2026/04/roblox-fuels-high-fidelity-games-over-18-players-increases-qualifying-devex-rate-42); [Roblox docs](https://create.roblox.com/docs/production/monetization/18-plus-devex-rate)).
- Creators earned over $1.5 billion in 2025 ([Roblox newsroom, 2026-09-03](https://about.roblox.com/newsroom/2026/09/global-impact-of-creation-on-roblox)).
- Earnings are extremely concentrated. Over 42,000 creators take part in DevEx, and the median one received about $1,500 in the 12 months to 2026-06-30 ([Roblox newsroom](https://about.roblox.com/newsroom/2026/09/global-impact-of-creation-on-roblox)). Over the same period, the top 10 creators averaged $65.7 million and the top 1,000 averaged $1.4 million, according to figures Roblox showed at its developer conference ([TechSpot](https://www.techspot.com/news/113855-roblox-top-creators-making-65-million-year-while.html)).

### Fortnite UEFN and Creative

- Epic said at Unreal Fest on 2026-06-17 that creators have earned over $1 billion since UEFN launched in 2023 ([GamesBeat](https://gamesbeat.com/epic-games-has-paid-out-1-billion-to-creators-since-launching-unreal-editor-for-fortnite-in-2023/)).
- In May 2026, creator islands took 47% of all Fortnite player hours, up from 35% in May 2025 ([GamesBeat](https://gamesbeat.com/epic-games-has-paid-out-1-billion-to-creators-since-launching-unreal-editor-for-fortnite-in-2023/)). Fortnite has more than 75 million monthly active users ([same](https://gamesbeat.com/epic-games-has-paid-out-1-billion-to-creators-since-launching-unreal-editor-for-fortnite-in-2023/)).
- In-island purchases launched in January 2026. Over 3,000 islands now earn more from them than from engagement payouts ([GamesBeat](https://gamesbeat.com/epic-games-has-paid-out-1-billion-to-creators-since-launching-unreal-editor-for-fortnite-in-2023/)).
- Epic's announcement says creators normally earn 50% of the V-Bucks value of in-island sales, raised to 100% from launch through the end of 2026 ([Epic, 2025-09-18](https://www.fortnite.com/news/fortnite-developers-will-soon-be-able-to-sell-in-game-items?lang=en), returned 403 to my fetch, so this comes from search summaries of that page). One analysis says that is about 74% of real money after platform fees in 2026 and about 37% from January 2027 ([GEEIQ](https://geeiq.com/fortnites-new-creator-tools-key-takeaways-for-brands/)).
- The engagement payout pool is 40% of net revenue from the Item Shop and most real-money purchases, split by engagement. Creators who bring in new or lapsed players get 75% of those players' pool contribution for six months (Epic page above, via search summary).
- Active Fortnite creators slightly declined in 2025 while published maps more than doubled, and engagement payouts grew about 5% ([Naavik](https://naavik.co/digest/the-state-of-ugc-2026/)). Inference: more islands are splitting a pool that barely grows.
- Scene Graph, Epic's entity and component system for UEFN, is still labelled Beta in Epic's documentation ([Epic docs](https://dev.epicgames.com/documentation/fortnite/scene-graph-in-unreal-editor-for-fortnite?lang=en-US)). The v43.10 release notes from November 2026 still list new Scene Graph features as experimental ([Epic release notes](https://dev.epicgames.com/documentation/fortnite/43-10-fortnite-ecosystem-updates-and-release-notes?lang=en-US), via search summary). Verse remains the scripting language.

### s&box (Facepunch)

- s&box launched on Steam on 2026-04-28 ([Steam store](https://store.steampowered.com/app/590830/sbox/)). It is a Source 2 platform positioned as the successor to Garry's Mod ([Wikipedia](https://en.wikipedia.org/wiki/S%26box)).
- It launched at $20 and later dropped by $10 ([GameDiscoverCo](https://newsletter.gamediscover.co/p/what-do-s-and-boxs-issues-so-far)).
- Creators earn from a Play Fund, a daily pool split by roughly clamped player hours. Facepunch doubled it to $1 million at launch and takes no royalties ([search summary of PC Gamer and Wikipedia](https://www.pcgamer.com/games/s-and-box-makes-nearly-usd1-million-on-launch-day-and-yes-there-are-problems-but-thats-okay-we-love-it-when-things-break-because-then-we-get-to-fix-them/)). Facepunch said it had paid out over $500,000 ([PC Gamer headline](https://www.pcgamer.com/games/rpg/we-dont-have-to-fire-1000-people-to-keep-it-working-facepunch-studios-says-paying-s-and-box-game-developers-is-sustainable-with-usd500-000-paid-out-to-date/)).
- In March 2026, Facepunch agreed a licence with Valve so creators can export s&box projects as standalone Steam games without royalties. As of May 2026 the Steam page still listed export as "coming soon" ([igor'sLAB](https://www.igorslab.de/en/sandbox-launches-on-steam-facepunch-is-turning-garrys-mod-into-an-open-gaming-platform-rather-than-a-sequel/)).
- Concurrent players peaked near 13,000 at launch and were under 500 by late September. Gross revenue was about $6 million by Facepunch's own finance page ([GameDiscoverCo](https://newsletter.gamediscover.co/p/what-do-s-and-boxs-issues-so-far)). Trackers show a few hundred players in November ([SteamCharts](https://steamcharts.com/app/590830)).
- GameDiscoverCo's reasons are a $20 price that narrowed the audience to hardcore fans, Garry's Mod expectations (no Workshop support, unfinished sandbox mode), an engine-first focus, and no lead game ([GameDiscoverCo](https://newsletter.gamediscover.co/p/what-do-s-and-boxs-issues-so-far)).

### Garry's Mod

- Garry's Mod passed 25 million copies sold by Facepunch's last official count in November 2024 ([3DNews](https://3dnews.ru/1114763/sozdatel-garry-s-mod-ne-veril-chto-eyo-kto-to-kupit-a-spustya-18-let-prodazhi-pesochnitsy-prevysili-25-millionov-kopiy)).
- It still draws roughly 20,000 to 30,000 concurrent players on Steam in 2026, by tracker snapshots ([Steambase](https://steambase.io/apps/4000)).
- Inference: Garry's Mod is the clearest proof that a paid sandbox with Steam Workshop and community servers can outlive its maker's attention for 20 years, and also that its successor cannot inherit its audience automatically.

### Dota 2 Custom Games (Arcade)

- Custom Games still exist inside Dota 2, but Valve publishes no counts ([timesaver.gg](https://timesaver.gg/news/dota-2-player-count-drop-october-2026)).
- After a silent update on 2026-10-27, one content creator counted the ten most popular custom games falling from 257,146 players to 469. The leading theory is that idle bot accounts in custom lobbies were removed, which Valve has not confirmed ([timesaver.gg](https://timesaver.gg/news/dota-2-player-count-drop-october-2026)).
- Inference: the real human audience for Dota 2 custom games was likely far smaller than its visible numbers, and it is not a place to launch a new game in 2026.

### StarCraft II Arcade

- Blizzard disabled custom map uploads in September 2025 after an exploit and re-enabled them on 2026-02-24 ([Blizzard forums](https://us.forums.blizzard.com/en/sc2/t/starcraft-ii-editor-map-publishing-update-feb-24-2026/30688)). I found no Arcade roadmap.

### Steam Workshop (what it actually provides)

- Steam hosts uploaded items, lets players subscribe, downloads them automatically and keeps them updated ([Steamworks docs](https://partner.steamgames.com/doc/features/workshop)).
- It has two modes. "Ready-to-use" lets anyone upload freely. "Curated" puts items into a voting queue that the developer approves ([same](https://partner.steamgames.com/doc/features/workshop)).
- For paid items, Steam handles the sale, payments to authors and to the developer, and tax withholding. The game's publisher sets the author's percentage ([same](https://partner.steamgames.com/doc/features/workshop); [Workshop legal agreement](https://steamcommunity.com/workshop/workshoplegalagreement/?appid=440)).
- The game itself must do the rest. It must load subscribed files through the ISteamUGC API, provide an upload tool, and make every client fetch the needed item before joining a match ([same](https://partner.steamgames.com/doc/features/workshop)).
- Inference: Workshop is file hosting, subscriptions and payments attached to an existing Steam game. It is not discovery for a new game, matchmaking, servers or a runtime. The audience comes from the base game.
- The closest analogue outside Steam is Overwolf (CurseForge), which paid mod creators about $300 million in 2025 ([Naavik](https://naavik.co/digest/the-state-of-ugc-2026/)).

## Dead or shrunk platforms, 2023 to 2026

| Platform | What happened | Stated or likely cause |
|---|---|---|
| Crayta (Unit 2, Meta) | Shut on 2023-03-03, and players lost all their creations ([Game Developer](https://gamedeveloper.com/business/crayta-to-shut-down-after-launch-platform-stadia-bites-the-dust)). | Stadia's closure and "not quite enough growth" ([same](https://gamedeveloper.com/business/crayta-to-shut-down-after-launch-platform-stadia-bites-the-dust)). |
| Dreams (Media Molecule) | Live support ended 2023-09-01, and the game stays playable without updates ([Game Informer](https://www.gameinformer.com/2023/04/11/dreams-live-support-ending-as-media-molecule-shifts-to-new-project)). | The studio could not find a "sustainable path" ([same](https://www.gameinformer.com/2023/04/11/dreams-live-support-ending-as-media-molecule-shifts-to-new-project)). Makers outnumbered players ([GameDiscoverCo](https://newsletter.gamediscover.co/p/what-do-s-and-boxs-issues-so-far)). |
| Core (Manticore) | Still listed as early access, with Web3 features turned off in January 2024 for "limited use" ([Wikipedia](https://en.wikipedia.org/wiki/Core_(video_game))). A large layoff wave hit Manticore in 2023 ([LinkedIn post](https://www.linkedin.com/posts/benjamin-staneck_big-wave-of-layoffs-today-at-manticore-games-activity-7070115998904774656-wCgI)). Its standalone game Out of Time, built on Core, was shut down after struggling to find players ([Rogueliker](https://rogueliker.com/out-of-time-offline/)). | I found no official Core shutdown notice, so its status is "shrunk", not "closed". |
| Hiber (HiberWorld, Hiber3D) | Filed for bankruptcy in June 2025, according to CB Insights ([CB Insights](https://www.cbinsights.com/investor/hiber)). | Single aggregator source. Its 2023 revenue was about 21.6 million SEK against a 17.6 million SEK loss ([Allabolag](https://www.allabolag.se/5591051726)). |
| Hytopia | The TypeScript browser games platform shut down after running out of money, and in April 2026 the team said it was waiting on an IRS refund to cover costs ([Play2Moon, 2026-05-03](https://play2moon.com/hytopia-operations-paused-irs-tax-refund-web3-gaming/); [BlockchainGamerBiz](https://www.blockchaingamer.biz/news/43183/nft-worlds-hytopia-rebrands-far-worlds/)). In November 2026 the project rebranded as Far Worlds, a single RPG ([BlockchainGamerBiz](https://www.blockchaingamer.biz/news/43183/nft-worlds-hytopia-rebrands-far-worlds/)). | Cash, and an NFT and token economy. A co-founder later said "execution proved difficult" ([eGamers, 2026-09-23](https://egamers.io/hytopia-co-founder-arkdev-pitches-a-new-exploration-game-after-the-platforms-collapse/)). |
| Rec Room | Announced 2026-03-30 and closed 2026-06-01 after a decade, 150 million players, about $294 million raised and a $3.5 billion valuation ([GeekWire](https://www.geekwire.com/2026/rec-room-shutting-down-seattles-3-5b-social-gaming-platform-says-it-cant-make-the-business-work/); [Road to VR](https://www.roadtovr.com/rec-room-shutdown-why-top-creator/)). | Costs exceeded revenue. A top creator blamed overhiring, chasing mobile and console growth that brought "little to no payoff", and neglecting core players ([Road to VR](https://www.roadtovr.com/rec-room-shutdown-why-top-creator/)). It took only a 30% cut on creator items ([same](https://www.roadtovr.com/rec-room-shutdown-why-top-creator/)). |
| Meta Horizon Worlds (VR) | In March 2026 Meta said the VR version would stop adding new games, then said existing games would stay up. Meta is focusing Worlds on mobile ([Wikipedia](https://en.wikipedia.org/wiki/Horizon_Worlds)). | The VR market shift. |
| s&box | Live, but under 500 concurrent players five months after launch ([GameDiscoverCo](https://newsletter.gamediscover.co/p/what-do-s-and-boxs-issues-so-far)). | See the s&box section above. |

The pattern across the table is that no platform died because its engine was bad. They died from too few paying players per dollar of cost, or because they lived inside a host platform that shrank (inference).

## Newer web, social and AI creator platforms

### Rune (closest match to Ivan's platform idea)

- Rune is a mobile app (iOS and Android, more than 10 million installs by its own claim) where friends voice chat and play small multiplayer web games ([Rune developers](https://developers.rune.ai/)).
- Developers write game logic in JavaScript and the client in any web framework. Rune runs the logic on its servers with a "predict-rollback approach" that "removes the need for any game networking code" ([same](https://developers.rune.ai/)).
- Hosting is free. Rune plans to take "a small cut on any money we help devs make" and runs a creator fund that pays by game stats, with no published percentages ([same](https://developers.rune.ai/)).
- The company was called Dusk until it renamed itself Rune in September 2024. It raised $8 million in July 2024 ([Game Developer](https://gamedeveloper.com/business/mobile-multiplayer-app-dusk-launches-with-gen-z-focus-raises-8-million-in-funding)). It ran a game jam on itch.io in February and March 2026 that allowed generative AI ([itch.io](https://itch.io/jam/rune-jam-party-vibes)).
- I found no independent 2026 traction numbers for Rune.
- Inference: Rune already sells "write a deterministic JS game, we handle netcode, servers and an audience". Its games are 2 to 6 player party games, not team arena games, and its audience lives in its own app.

### Playroom

- Playroom Kit is a backend for social web multiplayer games, handling rooms and state sync, with Discord Activity support in public preview ([Playroom docs](https://playroom-docs.vercel.app/features/integrations/discord)).
- Its own game Death by AI reached almost 7 million players within weeks as a Discord Activity, with over 70% of sessions having more than three friends ([Discord case study](https://discord.com/build-case-studies/playroom)).
- Inference: Playroom is a toolkit plus a studio, not a destination. Its biggest success came from riding Discord's audience.

### Astrocade

- Astrocade raised $56 million in Series A and B rounds led by Sea and Sequoia, announced 2026-05-07, and claims over 20 million users within eight months of launch and "hundreds of millions" of plays a month ([PocketGamer.biz](https://www.pocketgamer.biz/astrocade-raises-56m-to-expand-ai-powered-games-creation-platform/)).
- A different report put it at about 5 million monthly active users, 140 million plays a month and over 75,000 games ([Dealroom](https://app.dealroom.co/news/note/astrocade-raises-56m-to-let-anyone-build-games-with-ai)).
- Creators are paid by plays, and some top creators earn "thousands of dollars per month" ([PocketGamer.biz](https://www.pocketgamer.biz/astrocade-raises-56m-to-expand-ai-powered-games-creation-platform/)). I found no evidence of real-time multiplayer.

### Google Playground and Unity Spark

- Google Labs launched Playground on 2026-10-07. Users describe a browser game in text, choose 2D or 3D and single-player or multiplayer, and publish to a gallery or share a link. It is limited to US users 18 and over at launch ([TechCrunch](https://techcrunch.com/2026/10/07/google-experiments-with-an-ai-powered-gaming-platform/)).
- Unity announced Unity Spark the same day, a browser-based AI 3D game tool headed for closed beta inside Playground ([GameDev.net](https://gamedev.net/news/unity-unveils-a-web-based-ai-game-creation-platform-r6265/)).
- No usage numbers are public ([TechCrunch](https://techcrunch.com/2026/10/07/google-experiments-with-an-ai-powered-gaming-platform/)).

### Rosebud

- Rosebud makes browser games from prompts and offers multiplayer worlds without networking code ([Rosebud](https://develop.play.rosebud.ai/g/multiplayer)). Its funding and user figures conflict across sources, so I give none.

### BitCraft and SpacetimeDB

- BitCraft Online left early access with version 1.0 on 2026-11-13 ([Gamespress](https://www.gamespress.com/BitCraft-Online-Leaves-Early-Access-and-Launches-Version-10-on-Novembe)). It draws 1,000 to 2,000 concurrent players, less than half its early access launch ([MassivelyOP, 2026-11-16](https://massivelyop.com/2026/11/16/bitcraft-gets-a-modest-post-launch-bump-as-it-posts-its-future-roadmap/)).
- Clockwork Labs is open-sourcing the server modules that run inside SpacetimeDB, its own backend ([BitCraft blog](https://bitcraftonline.com/blog/open-sourcing-bitcraft-online)).
- Inference: BitCraft is a game that showcases a backend product. That is the same "build the game, sell the engine" shape Ivan is weighing, and the game's modest numbers show the showcase does not need a huge audience to sell the infrastructure.

### Bloxd.io and KoGaMa

- Bloxd.io is a free browser voxel game that added player-made Custom Games in May 2025. Creators build in a lobby and submit a schematic that can become a playable minigame ([Bloxd wiki](https://bloxd-io.fandom.com/wiki/Custom_Games)). I found no reliable player count.
- KoGaMa is an older browser UGC platform. I found no 2026 numbers for it.

### Not found

- I found no game platform called "Moonbase" or "Overworld" in 2026. Searches returned unrelated products. If Ivan has a link, I can check it.

## Distribution channels for small web multiplayer games

### Discord Activities (Embedded App SDK)

- Activities are web apps that run inside Discord voice and text channels. Any engine that compiles to the web works ([Cinevva guide, updated 2026-11-17](https://app.cinevva.com/guides/publish-game-discord-activities)).
- The developer hosts the game. Requests go through Discord's `discordsays.com` proxy, and every backend URL, including a game server, must be mapped in the Developer Portal or it fails with a content security policy error ([same](https://app.cinevva.com/guides/publish-game-discord-activities)). Inference: a Durable Object server works behind such a mapping.
- Discovery comes from the App Launcher after verification, links shared in chat, and rich presence on profiles. There is no global store for browsing Activities ([Discord blog, 2024-09-26](https://discord.com/blog/build-where-the-world-plays); [Cinevva](https://app.cinevva.com/guides/publish-game-discord-activities)).
- Apps are used by over 25% of Discord's monthly active users, per Discord's 2024 figure ([Discord blog](https://discord.com/blog/build-where-the-world-plays)).
- Developers keep 85% of payments for the first $1 million in sales, then 70%, less processing fees ([Discord developer support](https://support-dev.discord.com/hc/articles/17299902720919)). One guide adds a 6% processing fee on desktop and browser payments ([Cinevva](https://app.cinevva.com/guides/publish-game-discord-activities)).
- Top results: Death by AI reached almost 7 million players ([Discord case study](https://discord.com/build-case-studies/playroom)), and Chef Showdown passed 14 million players ([Cinevva](https://app.cinevva.com/guides/publish-game-discord-activities)).

### Reddit Devvit games

- Reddit pays Developer Funds when a Devvit app reaches daily engagement or install thresholds, for up to three apps per developer, under terms updated 2026-10-05 ([Reddit Help, H2 2026 terms](https://support.reddithelp.com/hc/en-us/articles/50860336905108-Reddit-Developer-Funds-H2-2026-Terms), returned 403 to my fetch, so this comes from a search summary).
- Earlier tiers started at $500 for 500 daily qualified engagers held on a seven-day average, with higher tiers up to tens of thousands of dollars per app (r/Devvit announcements, read through mirrors such as [this one](https://libreddit.winscloud.net/r/Devvit/comments/1jlhi8b/the_continuation_of_reddit_developer_funds)). Treat exact amounts as unverified.
- Reddit is running a "Game of the Day" hackathon from November 11 to December 8 with $35,000 in prizes, aimed at daily games ([Devpost](https://redditgameofday2026.devpost.com/)).
- Devvit Web has its own realtime pub/sub channels. One hackathon team reports that Reddit's content security policy blocked WebSocket connections to their external SpacetimeDB server, so they moved to Devvit's built-in realtime and Redis ([Devpost project](https://devpost.com/software/reddit-legacy-1999)). Inference: a Durable Object match server probably cannot be reached from inside a Reddit post, and Reddit favours async daily games over real-time arenas.

### YouTube Playables

- Access is early access through an interest form ([YouTube Playables docs](https://developers.google.com/youtube/gaming/playables)).
- Games must load the Playables SDK before any game code and monetize through YouTube's interstitial and rewarded ads ([SDK reference](https://developers.google.com/youtube/gaming/playables/reference/sdk)).
- Revenue sharing is a limited pilot with select developers, and no rate is published ([portalready.world, 2026-10-03](https://portalready.world/portals/)). The initial bundle must be under 30 MiB ([same](https://portalready.world/portals/)).
- The official docs say nothing about multiplayer ([YouTube Playables docs](https://developers.google.com/youtube/gaming/playables)).

### Telegram Mini Apps

- Players buy Telegram Stars through Apple, Google or Telegram's bot, and developers withdraw Stars as Toncoin through Fragment ([Telegram blog](https://telegram.org/blog/telegram-stars)). Telegram's payments docs give no commission rate ([Telegram Bot API](https://core.telegram.org/bots/payments-stars)).
- Gaming Mini Apps fell from 52 million to 47 million monthly users as play-to-earn clones lost traction, per an ad network's 2025 report ([PropellerAds](https://propellerads.com/blog/adv-telegram-mini-app-advertising-report/)). Hamster Kombat fell from about 300 million users at its peak to about 27 million active ([Wikipedia](https://en.wikipedia.org/wiki/Hamster_Kombat)).

### Poki

- Poki says it has more than 100 million monthly active players in 2026 ([Poki, 2026-06-25](https://poki.com/blog/state-of-web-gaming-report-2026)).
- Poki splits ad revenue 50/50 for players it brings, and the developer keeps 100% from players who arrive directly. Poki requires web exclusivity, but Steam, app stores and consoles stay open ([Poki developers](https://developers.poki.com/guide/working-with-poki)).
- Every game is hand-picked, and Poki offers a free networking library, Netlib, for online multiplayer ([same](https://developers.poki.com/guide/working-with-poki)).
- 54% of surveyed players play web games with friends or family often or very often ([Poki report](https://poki.com/blog/state-of-web-gaming-report-2026)).

### CrazyGames

- Games start in a Basic Launch to a small audience, and selected games move to a Full Launch that requires the CrazyGames SDK and unlocks ad revenue ([CrazyGames docs](https://docs.crazygames.com/requirements/intro/)).
- The initial download must be 50 MB or less and the total 250 MB or less ([same](https://docs.crazygames.com/requirements/intro/)).
- Multiplayer games at Full Launch should support room info, invite links, an instant multiplayer flow and rooms that persist across rounds ([same](https://docs.crazygames.com/requirements/intro/)).
- CrazyGames does not publish a revenue percentage. It pays monthly by plays and ad performance, and the default is non-exclusive ([portalready.world](https://portalready.world/portals/)).

### itch.io

- Developers choose itch.io's share of each sale from 0% to 100% ([itch.io FAQ](https://itch.io/docs/creators/faq)), with a default of 10% ([portalready.world](https://portalready.world/portals/)).
- HTML5 uploads need no SDK, and limits are 1,000 files and 500 MB extracted ([portalready.world](https://portalready.world/portals/)).
- Inference: itch.io is good for jams and a free playable link, but it brings few concurrent players to a real-time multiplayer game.

### Steam

- Each new app costs a $100 Steam Direct fee, recouped after $1,000 in adjusted gross revenue ([Steamworks](https://partner.steamgames.com/doc/gettingstarted/appfee)).
- Valve takes 30% up to $10 million in revenue per game and 25% from $10 million to $50 million ([Wccftech on Valve's 2018 tiers](https://wccftech.com/valve-updates-revenue-share-tiers/amp/)).
- Steam gives Workshop, matchmaking lobbies and a store page, but a web-native game needs a desktop wrapper to ship there (inference).

## What this means for the hook game and the platform idea

These points are inference from the facts above.

1. A Pudge Wars style game is a lobby game for 6 to 10 friends. Discord Activities match that shape best, because friends are already in a voice channel together and Death by AI proved the reach. CrazyGames is the second fit, since it has a multiplayer checklist and a non-exclusive default. Poki brings more players but asks for web exclusivity.
2. Reddit and YouTube Playables are poor fits for a real-time arena game. Reddit appears to block external WebSockets and favours daily async games. YouTube documents no multiplayer and keeps revenue sharing to a pilot.
3. A platform for other creators competes with Rune, Astrocade, Google Playground, Roblox and UEFN on audience, not on engine quality. Every platform that launched without its own audience shrank. s&box shows that even a famous studio with $1 million in creator payouts cannot create liquidity on demand.
4. The path that has worked is a hit game that opens up later. Warcraft 3 became a platform because of its custom maps, Garry's Mod because of Workshop and servers, and Fortnite because of UEFN. Each opened creation after players were already there.
5. A narrow version of the platform idea that may earn its place is open-sourcing the engine and the Durable Object match server as a library, the way Clockwork Labs uses BitCraft to show off SpacetimeDB. That needs no player liquidity, while a game-sharing destination does.
