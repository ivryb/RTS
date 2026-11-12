# Other Meshy operations

Use only the operation required by the request. Find its current endpoint, supported
models, parameters, cost, and response schema in the
[official API reference](https://docs.meshy.ai/en/api), then follow
[API execution](api-execution.md). This avoids maintaining competing copies of the
provider's changing catalog.

| Request | Operation and project constraint |
| --- | --- |
| Text-only concept | Text to 3D, or an image-first workflow when requested. Image preprocessing is an extra generation, not a mandatory stage. |
| Several reference views | Multi Image to 3D. Check whether it supports the requested topology/model; do not silently replace the project's Smart Topology choice. |
| Different textures | Retexture. Use the provided style/image; ask only if it is missing. Keep the source model and verify geometry, UVs, and materials before runtime replacement. |
| Another file format | Convert when geometry should stay unchanged. Remesh only when geometry/topology changes are requested. |
| Different scale or UVs | Resize or UV Unwrap. Preserve the source and check the relevant API's format/mesh limits. |
| Humanoid rig and motion | Rigging, then the requested animations. Inspect body/pose suitability first and use current animation names/IDs. Preserve existing verified skinning and animation when retexturing. |
| Printable output | Analyze Printability, optionally Repair Printability, then the requested single-color or multicolor workflow. Confirm physical size and printer/material requirements only when unknown. Repair may alter geometry or textures. |
| Slicer handoff | Open the requested output in an already available compatible slicer when requested. Generating a game asset does not imply printing, slicer installation, or a physical print. |

For unrelated printer or consumer-product workflows, consult that operation's docs
directly. They should not add instructions or paid stages to routine Dune assets.
