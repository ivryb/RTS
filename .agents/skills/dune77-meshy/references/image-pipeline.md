# Smart Topology and same-image retexture

This recipe implements the explicitly requested 3,000-polygon, untextured GLB followed
by 2K PBR retexturing from the same image. It does not change the manual-UI default.
Use [API execution](api-execution.md) for authentication, task persistence, polling,
and downloads.

## Generate geometry

POST `/openapi/v1/image-to-3d` with the supplied image URL or data URI:

```json
{
  "image_url": "SOURCE_IMAGE_URL_OR_DATA_URI",
  "model_type": "smart-topology",
  "ai_model": "meshy-t2",
  "target_polycount": 3000,
  "should_texture": false
}
```

Save the task ID, poll it to completion, and download `model_urls.glb` as
`geometry.glb` before proceeding. Preserve that original. Smart Topology generates
at the requested face target without a separate remesh; the actual count may differ.
See [Image to 3D](https://docs.meshy.ai/en/api/image-to-3d) for current input support
and parameters. For characters that must be rigged, preserve the requested pose and
ensure the input is suitable before spending credits.

## Retexture the completed geometry

POST `/openapi/v1/retexture`, supplying the completed geometry task ID and the exact
same source image:

```json
{
  "input_task_id": "GEOMETRY_TASK_ID",
  "image_style_url": "SOURCE_IMAGE_URL_OR_DATA_URI",
  "ai_model": "meshy-6",
  "texture_resolution": "2k",
  "enable_pbr": true,
  "enable_original_uv": true,
  "target_formats": ["glb"]
}
```

The retexture example pins Meshy 6 rather than the changing `latest` alias. Preserve
an explicitly chosen retexture model; if unavailable, resolve the changed parameters
before substituting another. See [Retexture](https://docs.meshy.ai/en/api/retexture)
for current model compatibility, UV behavior, and output fields. This is a distinct
texturing request, not another geometry generation.

Save its task ID, poll, download `retextured.glb`, and retain the returned PBR maps
and thumbnail alongside both task responses. Inspect the result against the source
image. Continue to rigging or runtime integration only when included in the request.

Endpoint fields were checked against official documentation on September 6, 2026.
No paid request was made to verify this recipe.
