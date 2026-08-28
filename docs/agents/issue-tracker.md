# Issue tracker

Dune77 has no hosted issue tracker. Durable deferred implementation work lives in the root `BACKLOG.md`; Wayfinding efforts use local Markdown under `.scratch/<effort>/` for their decision maps and tickets.

## Wayfinding operations

Each effort contains `map.md` and a `tickets/` directory. The map has `label: wayfinder:map`; every ticket has a stable filename, a title, one `wayfinder:<type>` label, `status`, `parent`, `blocked_by`, and `claimed_by` fields in YAML frontmatter.

- Child relationship: a ticket's `parent` points to `../map.md`.
- Dependencies: `blocked_by` lists relative ticket paths. A ticket is unblocked only when every listed ticket has `status: closed`.
- Claim: set `claimed_by` to the active agent/session name, save, then reload the ticket and verify the same value before working. Empty `claimed_by` means unclaimed.
- Frontier: open child tickets with empty `claimed_by` whose `blocked_by` tickets are all closed, ordered by filename.
- Resolution: append a `## Resolution` section, set `status: closed`, clear `claimed_by`, then add one linked gist to the map's `## Decisions so far` section.
- Out of scope: close the ticket with the reason in `## Resolution` and link it from the map's `## Out of scope`, not `## Decisions so far`.

Ticket bodies contain only a `## Question` section until resolution. Create all tickets before adding their `blocked_by` paths.
