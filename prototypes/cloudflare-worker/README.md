# Cloudflare Worker prototype

This prototype checks whether the deterministic simulation, Recast WASM initialization, and per-player Colyseus Schema replication work within a Cloudflare Worker.

It is not the multiplayer server. The planned production adapter will use PartyServer and keep Cloudflare-specific code outside `src/sim/`.

```sh
pnpm benchmark:worker-stack
pnpm probe:cloudflare
```

The second command starts a local Wrangler process and may download or initialize Cloudflare development tooling.
