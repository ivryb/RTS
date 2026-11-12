# Match outcome and restart

The match ends when a side's final Command Center is destroyed: a banner
announces Victory, Defeat, or (simultaneous loss) Draw, and input freezes until
the user restarts. Restart (`R`, the banner button, or `New map`) rebuilds the
encounter cleanly.

## Sub-features

- `outcome-victory` destroying the enemy Command Center shows the Victory
  banner.
- `outcome-defeat` losing the player Command Center shows Defeat.
- `outcome-input-lock` after resolution, orders are ignored.
- `restart-key` `R` restarts the same seed with a fresh match.
- `restart-button` the banner button restarts too.
- `new-map` the HUD button generates a random new seed and match.
- `outcome-draw` simultaneous CC destruction shows Draw (practically only
  reachable in simulation tests).

## How to get to it (user POV)

- Play the objective: train, build, siege the enemy Command Center → Victory.
- Lose your Command Center to enemy fire → Defeat.
- Press `R` anytime, click `Restart encounter` in the banner, or click
  `New map` in the HUD.

## Driving it with the tools/verify Playwright harness

Preconditions:

- Doctor reports the match healthy on seed 77.
- Budget: a full siege victory takes ~3.5 real minutes (see the gotchas in
  SKILL.md and [attack-and-defense](./attack-and-defense.md)). Restart proofs
  are cheap; full-outcome proofs are not.

- **Restart key.** Make a few moves, note `inspect().tick` and unit positions,
  then `page.keyboard.press("KeyR")` — wait for `inspect().tick` to reset low
  and `ghostrunner-1..3` back at their spawn positions with `health` full.
  `#match-outcome` stays hidden.
- **Restart mid-fight.** Damage the enemy CC a little (see
  [attack-and-defense](./attack-and-defense.md)), restart, then confirm
  `enemy-command-center.health` is back to max and the match is unresolved.
- **Victory.** Train Behemoths (35 s each), build an expansion Command Center
  for production redundancy, siege with `attackGroundSelected` on the enemy CC,
  and wait (multi-minute `waitForSnapshot` timeout) for
  `inspect().outcome === "victory"` and `#match-outcome-title` reading
  `Victory`. Screenshot the banner.
- **Input lock.** With the banner visible, attempt a move order —
  `selected.unitIds` stays empty and units never report `moving: true`.
- **Restart button.** `page.click("#restart-match")` — the banner hides, tick
  resets, full health everywhere.
- **New map.** `page.click("#new-map")` — `#seed` changes to a new seed value
  and the encounter respawns for that seed.
- **Defeat / Draw.** Do not drive these through the UI; they are covered by
  `tests/combatProofFlow.test.ts` (headless). Report them as verified-by-sim
  if the UI victory path works.

## Gotchas

- `R` is handled globally: pressing it while the page has focus restarts even
  mid-proof — never send `KeyR` accidentally (it is also not `S`/`A`; a stray
  keypress can silently reset the match and void earlier evidence).
- After resolution the input system ignores orders but the animation loop keeps
  running; `inspect()` keeps ticking — assert on `outcome`, not on tick freeze.
- The banner focuses the restart button when shown; a subsequent
  `page.keyboard` proof may hit the focused button instead of the game.
- `#match-outcome` uses `aria-live="assertive"`; the title element
  `#match-outcome-title` is the stable handle for the result text.
