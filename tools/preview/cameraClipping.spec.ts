import { expect, test } from "@playwright/test";

test("game camera keeps tall foreground terrain inside its depth range", async ({ page }) => {
  await page.route("**/tools/preview/camera-check", route => route.fulfill({
    contentType: "text/html", body: '<canvas id="camera-check"></canvas>',
  }));
  await page.goto("./tools/preview/camera-check");
  const result = await page.evaluate(async () => {
    const { MapCamera, DEFAULT_ZOOM } = await import("../../src/camera");
    const { generateMap } = await import("../../src/map");
    const THREE = await import("../../node_modules/three/build/three.module.js");
    const canvas = document.querySelector("canvas")!;
    const map = generateMap(14446, 6);
    const controller = new MapCamera(canvas, map.size);
    const camera = controller.camera;
    controller.focus(map.startingLocations[0]);
    camera.updateMatrixWorld(true);
    const reference = camera.clone();
    controller.setTerrain(map);
    camera.updateMatrixWorld(true);
    let framingError = 0;
    for (const site of map.layout.sites) {
      const before = new THREE.Vector3(site.x, 20, site.z).project(reference);
      const after = new THREE.Vector3(site.x, 20, site.z).project(camera);
      framingError = Math.max(framingError, Math.abs(before.x - after.x), Math.abs(before.y - after.y));
    }
    let clipped = 0;
    let visible = 0;
    const point = new THREE.Vector3();
    for (const start of [...map.startingLocations, ...[-1, 1].flatMap(x => [-1, 1].map(z => ({ x: x * map.size / 2, z: z * map.size / 2 })))]) {
      controller.focus(start);
      for (const zoom of [DEFAULT_ZOOM * .6, DEFAULT_ZOOM, DEFAULT_ZOOM * 3]) {
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        for (let i = 0; i < map.heights.length; i++) {
          const row = map.segments + 1;
          point.set((i % row) / map.segments * map.size - map.size / 2,
            map.heights[i], Math.floor(i / row) / map.segments * map.size - map.size / 2);
          point.project(camera);
          if (Math.abs(point.x) > 1 || Math.abs(point.y) > 1) continue;
          visible++;
          if (Math.abs(point.z) > 1) clipped++;
        }
      }
    }
    return { clipped, visible, framingError };
  });
  expect(result.visible).toBeGreaterThan(100);
  expect(result.clipped).toBe(0);
  expect(result.framingError).toBeLessThan(1e-10);
});
