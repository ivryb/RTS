# Dune77

Dune77 is a browser-based RTS set in a sun-scorched cyberpunk wasteland. The current build is a deterministic combat proof: train units, construct a forward base, and destroy the enemy Command Center.

The game is still early. The combat foundation works; the economy, fog of war, strategic AI, and full multiplayer match remain future work. See [`draft.md`](draft.md) for the game design and [`BACKLOG.md`](BACKLOG.md) for deferred features.

## Run it locally

Requirements:

- Node.js 22 or newer
- pnpm 9 or newer
- Bun 1.3 or newer

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

No environment variables are required to run the game. Meshy API tooling is optional and uses `MESHY_API_KEY`; keep it in an untracked `.env` file.

## Controls

- Left click or drag to select units and buildings.
- Hold Shift to add to the selection.
- Right click to move, attack, resume construction, or set a rally point.
- Press `A` for attack, `B` for build, `M` for move, and `S` for stop.
- Press `R` to restart after the match ends.
- Drag with the middle mouse button to pan. Use the wheel to zoom.

## Checks

```sh
pnpm test
pnpm build
```

The visual checks reuse a running `pnpm dev` server:

```sh
pnpm preview:capture
pnpm preview:capture:terrain-topology
```

Generated screenshots go to the ignored `art/workbench/renders/previews/` directory.

For interactive material and shape reviews, open the [procedural building showcase](prototypes/procedural-buildings/README.md) at `/prototypes/procedural-buildings/`. It shows the production command center and turret together, with optional archived Meshy comparisons.

## Repository map

```text
src/          Production browser and deterministic simulation code
tests/        Simulation and presentation tests
assets/       Runtime assets and their current editable sources
art/          Current 2D concepts used as visual references
tools/        Maintained preview and asset-processing utilities
prototypes/   Isolated experiments that are not part of the game runtime
docs/         Architecture, terrain, and asset documentation
```

Production code never imports from `prototypes/`. A prototype may import production modules when it is evaluating them.

Start with [`docs/architecture.md`](docs/architecture.md) for the code flow and [`docs/assets.md`](docs/assets.md) before changing models or textures. [`CONTEXT.md`](CONTEXT.md) defines project terms. [`AGENTS.md`](AGENTS.md) contains repository-specific guidance for coding agents.

## Collaboration

Keep `main` runnable. Use a short-lived branch and a pull request for meaningful changes. Run the narrowest relevant checks while working, then run `pnpm test` and `pnpm build` before merging.

## License

Code is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). Project-created visual assets are licensed under [Creative Commons Attribution-ShareAlike 4.0](ASSET-LICENSE). Poly Haven terrain sources are CC0. See [`docs/assets.md`](docs/assets.md) for the exact asset boundaries and exceptions.
