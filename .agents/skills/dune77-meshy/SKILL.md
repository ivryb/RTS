---
name: dune77-meshy
description: Create, retexture, rig, animate, or recover Dune77 assets in Meshy. Use the API when the user requests API generation or an existing API task needs recovery.
license: MIT-0
---

# Dune77 Meshy assets

Follow the project's [Meshy and asset policy](../../../AGENTS.md#meshy). The default
is the Meshy UI for visual control. An explicit API request selects the API workflow.
Old names `meshy-3d-agent` and `meshy-3d-generation` refer to this consolidated skill.

## Choose the workflow

- UI generation: use the supplied references and project topology/retexture policy.
  Preserve selected settings and download the result; API setup is unnecessary.
- API generation, texturing, rigging, or recovery: read [API execution](references/api-execution.md).
- The requested Smart Topology 3K then same-image 2K PBR pipeline:
  read [image pipeline](references/image-pipeline.md).
- Other formats, multi-view, animation, or printing: use the relevant
  [operation reference](references/other-operations.md), only when requested.

## Scope and authorization

Use the source image, polygon target, texture resolution, output format, and
animation choices already supplied. For Dune runtime output, use GLB unless the
request specifies another format. Ask only for a missing material choice.

The explicit request for Smart Topology at 3,000 polygons followed by retexturing
from the same image at 2K with PBR authorizes both stages. Continue through download
and verification without asking again between stages. Check current API pricing and
balance before submission. Pause if the cost or parameters materially differ from
the authorized pipeline, funds or permissions are insufficient, or the API blocks it.
Additional generations, image preprocessing, rigging, animations, or printing need
to be part of the requested scope; do not add them as automatic follow-up work.

## Completion

Keep each asset's source, task IDs, parameters, status responses, downloaded GLBs,
textures, and available thumbnails together under `meshy_output/<asset>/`.
Chained tasks reuse that directory. Save task IDs before polling so interrupted work
can resume without another paid generation. Report actual consumed credits when
returned by the API.

Inspect the downloaded model and requested maps. Preserve original geometry and
source files. If runtime integration is requested, export a separate runtime GLB,
update the asset manifest, and use the project's focused preview workflow. Generation
alone is not permission to replace runtime assets. Report paths, task IDs, verification,
and any unfinished stage.
