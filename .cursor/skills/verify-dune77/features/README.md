# Dune77 verification map

This directory is the maintained source for verifying the user-facing behavior
of the live Dune77 game. Read the index before driving, then use the matching
feature file as the recipe. The harness and launch/doctor/cleanup instructions
live in [`../SKILL.md`](../SKILL.md).

## Baseline preconditions

- A dev server is answering at `http://localhost:<port>` (reuse the user's on
  5173, or start your own on 5175 per SKILL.md Launch).
- `node tools/verify/doctor.mjs http://localhost:<port>` reports
  `{"ok":true,"units":6,"buildings":4}` — the seed-77 combat-proof opening.
- Every recipe opens its own fresh page via `openGame(page, 77)`; matches do
  not share state between pages, but two specs against one server run
  sequentially (`workers: 1`).
- Never drive through `window.__dune77` — it is read-only observation. Orders
  go through canvas pointer input and HUD buttons only.

## Driving conventions

- Select entities with `clickEntity` / `dragSelectUnits`; click ground with
  `clickWorld`; wait for state with `waitForSnapshot` — never fixed sleeps.
- HUD actions use `page.click` on the stable `[data-*]` handles listed in
  SKILL.md Drive; the unit panel is `hidden` until something is selected.
- Assert behavior through `inspect()` snapshots; use screenshots for layout and
  rendering. Capture both when a feature has visible UI.
- The enemy acts on its own (turrets fire at range, guards hold position). When
  a recipe expects peace, keep interactions away from the enemy node.

## Proof and skip reporting

- Record what was driven, the seed, and the observed end state with every
  artifact set under `art/workbench/verify/<feature>/`.
- A proof that drives only one entry point covers only that entry point; check
  the feature file's `How to get to it` list and report the rest as unverified
  rather than claiming coverage.
- Report an unreachable path with the attempted action and the failing
  observation instead of skipping silently.

## Features

- [Select and move](./select-and-move.md) — click/drag/keyboard selection, move
  and stop orders, destination marker.
- [Train units](./train-units.md) — Command Center selection, training queue,
  spawn and rally behavior.
- [Build buildings](./build-buildings.md) — Scout Drone construction, placement
  preview, accept/cancel, construction progress.
- [Attack and defense](./attack-and-defense.md) — attack orders, turret range
  behavior, guard modes, damage and death.
- [Match outcome and restart](./match-outcome-restart.md) — victory/defeat/draw
  presentation and the restart loop.
