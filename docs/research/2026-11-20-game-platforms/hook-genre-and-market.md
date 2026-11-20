# Hook arena games: genre, mod-to-genre path, and player market

Researched on 2026-11-20. Every source below was read on that date unless a line says otherwise. Player counts are snapshots taken around 14:30 UTC on Friday 2026-11-20.

## Conclusion

A hook arena game is a reasonable first game for the platform idea, but only if it is built so that one human can always get a good match. The mechanic is proven fun. No standalone hook game has ever held a paying audience. The game will live or die on how it handles empty lobbies, not on its hook types.

The evidence for "the mechanic is fun" is strong. The Dota 2 custom game "Pudge Wars (1 hook = 1 kill)" reached an all-time peak of 21,220 concurrent players and has 6.8 million subscribers. A free Roblox hook arena called "Hooked! [TRAIT]" launched in February 2026 and reached 44,457 concurrent players on 21 March 2026.

The evidence against "a standalone hook game can hold players" is just as strong. Both successes sat inside a host with a huge built-in audience. Both have collapsed. Pudge Wars now has 32 players, and Hooked! has about 800, which is 2% of its peak. Every standalone hook game I found on Steam, the web, or mobile has zero reviews, zero live players, or a dead page.

To beat the empty-lobby problem, the game needs five things, in this order:

1. Bots that fill every empty slot, so a match starts with one human. Awesomenauts did this and its developer believes the game would not have survived without it.
2. One public queue and one mode. Splitting 40 players across three modes takes a 2 minute wait to 7 minutes, according to the Awesomenauts developer's own arithmetic.
3. Flexible team sizes from 1v1 to 5v5. The indie arena games that survive on Steam are built for 2 to 4 players, not 10.
4. A room link that a friend can open in a browser with no install. Among Us lived for two years on private room codes while its public Steam lobbies averaged 2 to 8 players.
5. A Discord Activity build. Activities are web apps in an iframe, which matches Ivan's TypeScript and Three.js stack, and the platform is built around friends who are already in a voice call.

The realistic audience is small. A browser hook game from a solo developer, with no host platform, should plan for tens of concurrent players on a normal day and a few hundred during a good week. That is an inference from the comparables below. Indie arena games with tens of thousands of positive reviews, like Stick Fight and Bopl Battle, hold about 200 concurrent players on Steam today. Battlerite, which peaked at 44,850, now averages 57.

The "build games on my platform" idea should wait until the first game has players. Every genre that came out of a mod scene grew on top of a host game that already had millions of players: Warcraft 3, Half-Life, Arma 2, and Dota 2. The hosts, or a large studio, captured most of the value. A platform with no players attracts no makers. The hook game is the right way to start only because its hook types and power-ups are a natural first thing for other people to mod.

## 1. Pudge Wars and every hook game I could find

### The Warcraft 3 map

Pudge Wars began as a Warcraft 3 custom map. The original version had teams of 3, a basic hook spell, and a "lay mine" spell. Its best-known branch, Pudge Wars Advanced, was created by Tossrock and taken over by Siraraz in 2010. Its final release, v2.03d, came out on 8 July 2012, after which only bug fixes were promised. I read these facts in search snippets of the Hive Workshop thread because the page itself returned HTTP 403 to my fetch. The original author's name did not appear in any source I found. (https://www.hiveworkshop.com/threads/pudge-wars-v2-03d.178683/)

The Pudge hero himself comes from the DotA Allstars mod, not from Valve. (https://x.com/DOTABUFF/status/2024034440209404292 and the DOTABUFF blog it corrects, read through search results)

WC3 Tracker still logs hosted Pudge Wars lobbies in 2026, with a "last hosted" date of 21 May 2026 and only 23 tracked lobby sessions. I read this in a search snippet because the page returned HTTP 403. (https://wc3tracker.com/map/pudge-wars)

### The Dota 2 custom games

The Dota 2 remake "Pudge Wars [7.29 Fixed]" was posted to the Steam Workshop on 21 December 2014. It credits Kobb and Aderum as main developers. It is a 5v5 game in which every player controls Pudge with only the Meat Hook, on a square map split by an uncrossable river. The first team to a set number of kills wins. It has 5,123,545 current subscribers and was last updated on 21 May 2021. (https://steamcommunity.com/sharedfiles/filedetails/?id=296831818)

"Pudge Wars (1 hook = 1 kill)" was posted on 27 June 2015. Players vote on a match length of 25, 50, 100 or 150 kills. It has 6,796,794 current subscribers. (https://steamcommunity.com/sharedfiles/filedetails/?id=470524658)

"Pudge Wars Reborn" was posted on 30 December 2020, credited to Insight, and last updated on 17 August 2025. It has 420,650 subscribers. (https://steamcommunity.com/sharedfiles/filedetails/?id=2341922913)

Live numbers come from the Custom Game Stats tracker's own data feed (http://www.customgamestats.com/custom-games/QueryMetrics, fetched 2026-11-20 at about 14:30 UTC):

- "Pudge Wars (1 hook = 1 kill)" had 32 players, a daily peak of 43, and an all-time peak of 21,220. It ranked tenth among custom games at that moment.
- "Pudge Wars Reborn" had 5 players, a daily peak of 15, and an all-time peak of 3,026.
- The 100 tracked custom games together had 13,077 players. One mode, "OMG LoD", held 8,293 of them.
- Dota 2 itself had 790,029 players at the same time, according to Steam's own API (https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=570). So all custom games together hold under 2% of Dota 2 players. That ratio is my calculation.

### Standalone and commercial hook games

| Game | Where | Released | Price | Players or reviews | Alive? |
|---|---|---|---|---|---|
| Hooked! [TRAIT] by World Tier 1 Game | Roblox | 2 Feb 2026 | Free, with skin rolls | 173.4 million visits, 2.29 million favorites, 170,313 up votes to 33,244 down. All-time peak 44,457 on 21 Mar 2026. 792 playing at fetch time. Peak in the past 30 days was 2,192. | Alive, but down 98% from its peak |
| Hook Wars by Superbullet Studio | Roblox | 6 Jan 2024 | Free | 4.16 million visits, 0 playing | Dead |
| Hook Fights by KaTBox Interactives | Roblox | 5 Dec 2024 | Free | 18,686 visits, 0 playing | Dead |
| Hook Em' | Roblox | 10 Nov 2023 | Free | 13,072 visits, 0 playing | Dead |
| Hook Showdown: Pinoy Hatak | Roblox | 22 May 2026 | Free | 1,626 visits, 0 playing. A 5v5 hook game with NPC farming. | Dead |
| Hook Party Arena | Steam | 18 Aug 2026 | €2.37 | No reviews. 0 players at fetch time. Top-down 1v1 to 5v5 hook arena with river runes, mines and upgrades. | Effectively dead after 3 months |
| Pudge Wars by Я Крут | Google Play | Last updated 30 Aug 2024 | Free | 100K+ downloads, 4.9 stars from 10,720 ratings. Reviews ask for online play, so it appears to be offline. | Unmaintained |
| hookwars.io by Bryan James Dela Luya | Browser | 2026 | Free | No numbers. Node.js, Socket.IO and canvas. The site refused my connection. | Unknown |
| HookWars by Dimofan | CrazyGames | March 2021 | Free | The game URL now redirects to the battle games category. | Removed |
| Hook Wars: Pudge Revenge | Unity, browser and desktop | 2014 open alpha | Free | Three per team | Dead |
| Hook Wars (Zarakilian) | GitHub, browser | October 2026 | MIT licensed | 0 stars. Three.js, TypeScript and Node. 5v5 over a river, bots fill empty slots, 3 hook types, runes, 8 maps. | New hobby project |
| Hook Wars Online | Unity Asset Store template | Undated | Paid asset | A 5v5 river hook game sold as a template | Not a game |

Sources for the table:

- Roblox numbers come from Roblox's public API (https://games.roblox.com/v1/games?universeIds=9663968307 and https://games.roblox.com/v1/games/votes?universeIds=9663968307 for Hooked!, the same endpoint with universe IDs 5496889373, 6880630232, 5283550057 and 10201268414 for the others). The Hooked! peak comes from Rolimons (https://www.rolimons.com/game/70390793715007). The Hooked! store page is https://www.roblox.com/games/70390793715007/Hooked and the Superbullet one is https://www.roblox.com/games/15896813347/Hook-Wars.
- Hook Party Arena: https://store.steampowered.com/app/4959190/Hook_Party_Arena/ and the Steam player API with appid 4959190.
- Pudge Wars on Google Play: https://play.google.com/store/apps/details?id=com.Ikrut.PudgeWars
- hookwars.io: described in a search snippet of https://hookwars.io/ because my fetch was refused.
- HookWars on CrazyGames: https://www.crazygames.com/game/hookwars (I observed the redirect; the release date comes from a search snippet).
- Hook Wars: Pudge Revenge: https://forum.unity.com/threads/game-hook-wars-pudge-revenge-free-multiplayer-online-game-open-alpha.254940/ (search snippet).
- Zarakilian Hook Wars: https://github.com/Zarakilian/Hook-Wars
- Unity template: https://www.finalbossgame.com/hookwarsonline/ (search snippet).

### What worked and what failed

What worked was the mechanic inside a host that already had players. Pudge Wars rode on Dota 2's lobby browser. Hooked! rode on Roblox's discovery, its mobile and console reach, and its free price. Hooked! also added a light progression layer: coins, skin rolls, and one chosen ability per match. (Hooked! description from the Roblox API above)

What failed was every attempt to stand alone. I found no standalone hook game on Steam, mobile or the web with a measurable live audience. A Steam store search for "hook wars" returned 126 results and only one hook arena, Hook Party Arena, which has no reviews. (https://store.steampowered.com/search/?term=hook+wars)

Even the hits decay fast. Hooked! fell from 44,457 to about 800 concurrent players in eight months. Pudge Wars fell from 21,220 to 32. A hook game's novelty runs out, and players need either new content or friends to keep coming back. That last sentence is my inference from the two curves.

Two warnings for Ivan follow from the table. First, a free Roblox hook arena with 2.29 million favorites already exists, so "hook arena" alone is not a new idea to players under 20. Second, a GitHub project with nearly the same feature list in the same stack (Three.js, TypeScript, river, bots, hook types, runes) appeared in October 2026. Neither has an audience outside Roblox, but the concept itself is not a moat.

## 2. From custom map to genre

| Genre | Mod origin | Who captured the genre |
|---|---|---|
| MOBA | DotA, a Warcraft 3 map, which itself followed the StarCraft map Aeon of Strife | Riot (League of Legends, 2009) and Valve (Dota 2, which hired DotA's maintainer) |
| Auto battler | Dota Auto Chess, a Dota 2 custom game by the five-person Drodo Studio, released 4 Jan 2019 | Riot (Teamfight Tactics, June 2019) and Valve (Dota Underlords, June 2019) |
| Tactical shooter | Counter-Strike, a Half-Life mod by Minh Le and Jess Cliffe, first beta 18 June 1999 | Valve bought the rights in early 2000 |
| Battle royale | Minecraft Hunger Games servers (2012), the DayZ mod for Arma 2 (August 2012), Brendan Greene's Battle Royale mod (2013) | PUBG (March 2017) and Fortnite Battle Royale (September 2017) |
| Tower defense | StarCraft maps Turret Defense (May 2000) and Sunken Defense (November 2001), then Warcraft 3 maps | Flash and mobile studios: Desktop Tower Defense (March 2007), Bloons TD (2007), Plants vs. Zombies (May 2009), Kingdom Rush (2011) |
| Team tower defense | Legion TD, called "the 2nd most popular Warcraft 3 mod of all time" by its makers | The map's own makers, AutoAttack Games, with Legion TD 2 |

Sources:

- DotA: Steve "Pendragon" Mescon's postmortem on Game Developer, 19 March 2009, says DotA reached "more than 10 million people worldwide." It also lists what the Warcraft 3 platform could not give: matchmaking, stat tracking, maps over 4 MB, and easy installation. (https://www.gamedeveloper.com/design/postmortem-i-defense-of-the-ancients-i-)
- Auto Chess: over 8 million players by May 2019 and more than 300,000 daily active players. Valve and Drodo could not agree on a joint game, so each built its own. Drodo's standalone Auto Chess went to mobile and the Epic Games Store. (https://en.wikipedia.org/wiki/Dota_Auto_Chess)
- Counter-Strike: https://en.wikipedia.org/wiki/Counter-Strike_(video_game)
- Battle royale: PUBG sold over 20 million copies by the end of 2017 and peaked at over 1.3 million concurrent players on Steam. (https://en.wikipedia.org/wiki/Battle_royale_game)
- Tower defense: https://en.wikipedia.org/wiki/Tower_defense
- Legion TD 2: early access on 20 November 2017, full release on 1 October 2021, 87% positive of 6,563 English reviews, 2v2 and 4v4 matchmade games. (https://store.steampowered.com/app/469600/Legion_TD_2__Multiplayer_Tower_Defense/) It averaged 717 concurrent players in October 2026, with an all-time peak of 5,751 in July 2023. (https://steamcharts.com/app/469600)

### What this implies for a "build games on my platform" idea

Every one of these genres came from a mod scene. Every mod scene grew on a host with millions of paying players and a free, powerful editor. The DotA postmortem credits the Warcraft 3 World Editor for supplying "models, tilesets, and scripting" so the team could focus on gameplay. (Mescon postmortem above)

The genre inventor rarely kept the genre. Riot and Valve took the MOBA. Riot and Valve took the auto battler within six months of Auto Chess's release. Valve took Counter-Strike. The exception is Legion TD 2, where the map's own makers went standalone, and it holds about 700 players.

Hosts learned to claim the value. In January 2020, Blizzard's Warcraft 3: Reforged custom game policy made Blizzard the owner of everything created in its editor. Press coverage linked the rule directly to DotA. (https://pcgamer.com/all-your-warcraft-3-reforged-custom-games-belong-exclusively-to-blizzard) A small platform could stand out by doing the opposite and letting makers own and export their games. That is my inference.

Dedicated custom-game hubs fade when the host fades. All 100 tracked Dota 2 custom games together hold 13,077 players today (Custom Game Stats feed above). StarCraft 2's Arcade struggled with discovery: Blizzard's own 2017 patch notes call difficulty of use one of the most common complaints. (https://starcraft2.com/en-gb/news/21048080, read through a search snippet)

My conclusion from this section is an inference. Ivan's platform will not get makers until it has players, and it will not get players from the platform pitch. It needs one game people already play. A hook arena is a good candidate for that first game because the moddable parts are small and obvious: a new hook type, a new power-up, a new map.

## 3. The empty-lobby problem

### The arithmetic

The Awesomenauts developer Joost van Dongen wrote in September 2015 that 40 concurrent players a few weeks after launch is "pretty decent" for an indie game. In his example, a four-player game with 40 players online and three modes means a wait of nearly 7 minutes. Cutting to one mode brings it down to about 2 minutes 15 seconds. He says games below 10 concurrent players need "extreme measures." (https://joostdevblog.blogspot.com/2015/09/designing-matchmaking-for-smaller.html)

A November 2014 post on the same theme works through skill, region, ranked and party filters. It concludes that "with 1,000 concurrent players it will take 30 minutes to fill a match" if you filter strictly, and that ideal matchmaking needs about 58,000 concurrent players at peak. (https://sunlightf.blogspot.com/2014/11/why-good-matchmaking-requires-enormous.html)

My own rough version for a hook game follows. It is an inference, not a measurement. If a match lasts L minutes and needs P players, and C players are online in one region, about C divided by L players come free each minute. Filling one match from empty then takes about P times L divided by C minutes. For a 10-player match of 6 minutes, that is 3 minutes at 20 players online, 1 minute at 60, and 6 minutes at 10. Split the players across 3 regions and each wait triples. So a 10-player game with no bots needs roughly 100 to 200 concurrent players worldwide before strangers can find quick matches.

### How small team games died

- Battlerite: early access in September 2016, full free-to-play release on 7 November 2017, and a peak of 44,850 in November 2017. Monthly peaks fell below 4,000 during 2018. (https://en.wikipedia.org/wiki/Battlerite) In July 2019 Stunlock said the next season might be its last because of declining player numbers, and that the game "has struggled to retain players." (https://www.pcgamer.com/due-to-declining-player-numbers-battlerites-next-season-may-be-its-last/) It averaged 57 concurrent players over the last 30 days, with a peak of 150. (https://steamcharts.com/app/504370) Critics blamed the split into a separate Battlerite Royale game, which divided an already shrinking player base. (https://www.tentonhammer.com/articles/battlerite-what-went-wrong, read through a search snippet)
- Spectre Divide: about 400,000 players in launch week, then just over 300 concurrent players when the studio announced its closure in March 2025, six months after launch. The CEO said they had not seen "enough active players and incoming revenue to cover the costs." (https://pcgamer.com/games/fps/spectre-divide-and-its-studio-are-shutting-down-after-just-six-months-the-industry-is-in-a-tough-spot-right-now and https://esports.gg/news/spectre-divide/spectre-divide-to-shut-down/)
- Knockout City: shut down on 6 June 2023 after struggling to keep players even after going free-to-play. Velan released a private-server version so fans could keep playing. (https://gematsu.com/2023/02/knockout-city-to-end-service-on-june-6-private-hosted-server-edition-to-be-released-for-pc) It had 0 players on Steam today (Steam API, appid 1301210).
- Duelists of Eden: launched at about $5, peaked at 663 concurrent on 8 March 2024, and fell to about 200 within a week, according to an essay on "queue death." (https://ericguan.substack.com/p/revive-dead-games-with-multi-game) I could not confirm the 663 figure on SteamDB directly because SteamDB returned HTTP 403.

### Remedies that worked

- Bots. Awesomenauts starts matches with bots when it cannot find enough players. Players complain, but its developer argues the game "might not have survived without it." (Joost 2015, above) The browser developer behind Earth's Greatest Defender added bots in April 2026 because he "couldn't realistically expect enough players" online at once. That game has over 4 million plays on Poki. (https://remvst.substack.com/p/letting-bots-learn-to-move-like-players)
- Small match sizes. The indie arena games still alive on Steam are built for few players. Stick Fight is "2 to 4 players" (https://store.steampowered.com/app/674940/Stick_Fight_The_Game/). Bopl Battle has no bots and no single-player mode but supports local play for 4 (https://store.steampowered.com/app/1686940/Bopl_Battle/). Brawlhalla supports up to 8 (https://store.steampowered.com/app/291550/Brawlhalla/).
- One mode and one queue. Awesomenauts keeps one core mode and offers the others only through friend invites. (Joost 2015, above)
- Playing with friends through a code or link. Among Us is a 10-player game. It averaged 2 to 8 concurrent players on Steam from November 2018 to May 2019 and peaked at 438,524 in September 2020. (https://steamcharts.com/app/945360) The team nearly quit in early 2019 (https://www.nme.com/news/gaming-news/among-us-development-almost-ended-in-2019-3281040). Private rooms with friends kept it going until Twitch streamers made it a hit in mid 2020 (https://kotaku.com/among-us-improbable-rise-to-the-top-of-twitch-1844986025).
- Discord Activities. Activities are "web apps hosted in an iframe" that run in Discord on desktop, mobile and web. (https://docs.discord.com/developers/activities/overview) Discord opened them to all developers on 26 September 2024. Its launch post says Death by AI reached "nearly 7 million players" in weeks. (https://discord.com/blog/build-where-the-world-plays) Krunker Strike FRVR supports up to 12 players in a voice call and saw a 33% rise in players during a Discord Quest. (https://discord.com/quests-success-stories/krunker-strike-frvr) Naavik wrote on 15 November 2026 that Activities "has yet to produce lasting hits" with real monetization, and is better suited to small studios with modest commercial goals. (https://naavik.substack.com/p/discords-path-to-ipo-needs-game-developers)
- Scheduled play sessions. Some developers promote a weekly "multiplayer evening" or open multiplayer only on weekends. (Joost 2015, above) Guan suggests the Friday Night Magic model and rotating modes into fixed time windows. (Guan essay, above)
- Cross-play. Brawlhalla added cross-play across all platforms in 2019. Ubisoft's developers say it "significantly contributed" to growth. Brawlhalla reported 100 million lifetime players in May 2023. (https://news.ubisoft.com/en-us/article/MvVxfuQT6SZ5XnlJY8Pgp/brawlhalla-celebrates-100-million-lifetime-players-with-ingame-event) Its Steam page now claims over 125 million. For a browser game, "cross-play" simply means the same URL works on a laptop and a phone.
- Free or cheap entry. Joost advises against pricing a multiplayer-only game above $15. (Joost 2015, above)

## 4. Comparable small arena games

All "now" numbers come from Steam's player API at about 14:30 UTC on 2026-11-20 (https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=ID). Averages and peaks come from Steam Charts (https://steamcharts.com/app/ID), which samples less often than SteamDB and can miss short peaks. SteamDB itself returned HTTP 403 to my fetches.

| Game | Steam app | Launch and price | Players per match | All-time peak | Last 30 days average | Now |
|---|---|---|---|---|---|---|
| Brawlhalla | 291550 | 17 Oct 2017, free, cross-play | Up to 8 | 34,169 (Feb 2021) | 8,718 | 9,755 |
| Party Animals | 1260320 | 20 Sep 2023, paid | Not checked | 104,174 on 20 Sep 2023 according to SteamDB as quoted by GamesRadar. Steam Charts shows 57,806. | 3,660 | 7,342 |
| Stick Fight: The Game | 674940 | 28 Sep 2017, €4.75. 94% positive of 52,690 reviews. Has a level editor with over 100,000 community levels. | 2 to 4 | 5,033 (Oct 2017) | 195 | 207 |
| Bopl Battle | 1686940 | 16 Nov 2023, €9.75. 97% positive of 17,443 reviews. | Up to 4, no bots | 2,175 (Feb 2025) | 215 | 147 |
| Lethal League Blaze | 553310 | Paid | Not checked | 2,538 (Oct 2018) | 23 | 20 |
| Battlerite | 504370 | Sep 2016 early access, full free release Nov 2017 | Not checked | 44,850 (Nov 2017) | 57 | 24 |
| Grapples Galore | 2239140 | Feb 2025, paid. 91% positive of 4,612 reviews. | Arena shooter with grappling hooks | Not checked | Not checked | 271 |
| Krunker | 1408720 | Browser game also on Steam | Not checked | Not checked | Not checked | 4 on Steam |

Other sources: Party Animals peak (https://gamesradar.com/co-op-hit-party-animals-already-has-over-100k-steam-players-but-mostly-negative-reviews-as-players-cite-server-problems-and-no-offline-mode). Grapples Galore reviews (https://store.steampowered.com/app/2239140/Grapples_Galore/, read through a search snippet).

Browser and Discord games:

- Krunker.io had over 200 million lifetime unique players when FRVR bought it in May 2022. That is a lifetime total, not an active count. (https://www.gamedeveloper.com/press-release/frvr-acquires-popular-free-to-play-shooter-krunkerio) Its Steam page shows 4 players now, which suggests nearly all play happens in the browser. Browser players never show up in Steam numbers.
- Bonk.io is a browser physics game by a developer called Chaz, first released as a Flash game in 2016. It supports up to 8 players per room and has a built-in map editor. No public player counts exist. (https://crazygames.com/game/bonkio)
- Death by AI peaked at a reported 700,000 daily players on Discord, and ScoreSpace's Blackjack claims 1.2 million monthly players. Both are short social games, not skill arenas. (Naavik, above)

What the comparables say, as my inference: the arena games that last are cheap, short, skill-based, and playable with 2 to 4 people on one couch or one call. Big team arenas like Battlerite collapse once the launch crowd leaves. Browser hits like Krunker and Bonk.io last for years because they cost nothing to try and give players a map editor.

## 5. Legal

This section is research, not legal advice.

### Names

Valve owns the DOTA trademark in the US, registration number 5246626. (https://trademarks.justia.com/860/83/dota-86083608.html) In May 2012 Blizzard and Valve settled their dispute. Valve kept commercial use of DOTA, and Blizzard kept noncommercial use for community maps in Warcraft 3 and StarCraft 2. (https://www.gamedeveloper.com/business/blizzard-and-valve-settle-ongoing-dota-trademark-controversy)

I found no registered trademark for "Pudge" or "Pudge Wars" in web searches. I could not search the USPTO or EUIPO databases directly, so this is not proof that none exists. "Pudge" is the name of a Dota 2 hero, and Valve's art, voice lines and icons for him are protected by copyright whether or not the name is registered. (https://www.dota2.com/heroes)

An Android app titled "Pudge Wars" sits on Google Play with 100K+ downloads. (https://play.google.com/store/apps/details?id=com.Ikrut.PudgeWars) That shows the name is not always enforced. It does not show that using it is safe.

### Mechanics

The US Copyright Office says copyright does not protect "the idea for a game, its name or title, or the method or methods for playing it." (https://www.copyright.gov/register/tx-games.html and the games factsheet FL-108, read through search snippets) Copyright law excludes "any idea, procedure, process, system, method of operation." (https://www.copyright.gov/circs/circ33.pdf)

In Tetris Holding v. Xio Interactive (D.N.J., 30 May 2012), the court said one "cannot protect some functional aspect of a work by copyright," but that the owner is "entitled to copyright protection for the way in which it chooses to express game rules or game play." Xio lost because its game looked nearly identical, not because it used the same rules. (https://www.loeb.com/en/insights/publications/2012/06/tetris-holding-llc-v-xio-interactive-inc)

In Spry Fox v. Lolapps (W.D. Wash., 2012), the court let a claim go forward against Yeti Town because it copied Triple Town's specific expression. The court also said Spry Fox had no monopoly on the idea behind the game. The case settled in October 2012. (https://en.wikipedia.org/wiki/Spry_Fox,_LLC_v._Lolapps,_Inc.)

An ABA Landslide article argues that rules, game mechanics and other functional elements are not copyrightable under section 102(b). (https://www.americanbar.org/groups/intellectual_property_law/resources/landslide/archive/why-videogame-rules-are-not-expression-protected-copyright-law/)

### What Ivan must avoid

- Do not use "Pudge", "Pudge Wars", "Dota" or "DotA" in the game's name, store title, domain, or ads.
- Do not use Dota 2 or Warcraft art, models, icons, sounds, voice lines, or hero names. Avoid ability names that point straight at Dota, such as "Meat Hook", "Rot" or "Dismember".
- Do not make a character that reads as Pudge: a fat, stitched, undead butcher with a cleaver and a chain hook. Tetris v. Xio turned on look and feel.
- Do not copy a specific map layout, item list, or icon set from a Pudge Wars version. Copying the general idea of two halves split by a river is fine.
- It is fine to use the core mechanic: hooks that pull enemies across a river, team kill targets, hook upgrades, and power-ups.
- Saying "inspired by classic hook custom maps" in a devlog is low risk. Naming Pudge Wars in a factual blog post is common, but keep it out of branding. That is my judgment, not a lawyer's.

## Sources I could not reach

SteamDB, Hive Workshop, WC3 Tracker and the Dota 2 Fandom wiki returned HTTP 403 or 402. The hookwars.io site refused the connection. Where a fact depends on those sites, I read it in a search engine snippet and say so next to the claim.
