# New terrain source assets

The production [terrain manifest](../../../models/terrain/manifest.json) records the exact approved six environment GLBs and nine texture maps promoted on 6 October 2026. It includes source pages, licenses, SHA-256 hashes, preparation recipes, and the input hashes used by the model pipeline. Promotion copies the approved bytes without reprocessing them.

The JPEGs here are the six original maps used for Rock Face 03 caprock, Mud Cracked Dry 03 alluvial ground, and Aerial Ground Rock scree. Cliff Side's three original maps already live in [`../titanium/`](../titanium/), so they are referenced without duplication. All these photographs and derived terrain maps remain **CC0**.

| Asset | Source and authors |
| --- | --- |
| Cliff Side | [Poly Haven](https://polyhaven.com/a/cliff_side): Dario Barresi, James Ray Cock, Jenelle van Heerden |
| Rock Face 03 | [Poly Haven](https://polyhaven.com/a/rock_face_03): Dario Barresi, Rico Cilliers |
| Mud Cracked Dry 03 | [Poly Haven](https://polyhaven.com/a/mud_cracked_dry_03): Dimitrios Savva, Dario Barresi |
| Aerial Ground Rock | [Poly Haven](https://polyhaven.com/a/aerial_ground_rock): Rob Tuytel |
| Tree Small 02, Shrub 04, Grass Medium 02 | [Tree](https://polyhaven.com/a/tree_small_02), [shrub](https://polyhaven.com/a/shrub_04), [grass](https://polyhaven.com/a/grass_medium_02): Rico Cilliers |
| Namaqualand Boulders 01 | [Poly Haven](https://polyhaven.com/a/namaqualand_boulders_01): Greg Zaal, Jenelle van Heerden |
| Wild Rooibos Bush | [Poly Haven](https://polyhaven.com/a/wild_rooibos_bush): James Ray Cock, Jenelle van Heerden |

Each promoted GLB keeps its editable geometry and embedded photographic maps in one runtime copy under `assets/models/terrain/`. This is the explicit source-preservation exception recorded for each model: large pre-optimization and intermediate GLB duplicates remain in the local workbench. The source URLs, input hashes, and existing preparation ledgers preserve their provenance. The recipes retain their workbench input/output paths; promotion does not introduce another conversion pipeline.

The scanned tree, shrubs, rocks, and their derived maps remain **CC0**. The grass bed's newly authored Dune77 ribbon geometry follows **CC BY-SA 4.0** under `ASSET-LICENSE`; its embedded Poly Haven photographs remain **CC0**. Rejected basalt, earlier grass geometry, and unused source maps are not part of this production set.
