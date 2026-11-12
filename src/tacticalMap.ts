import { UI_ATTACK_COLOR } from "./uiColors";
import * as THREE from "three";
import type { MapCamera } from "./camera";
import { sampleHeight, type GeneratedMap } from "./map";
import type { UnitSystem } from "./unitSystem";

// Same orientation as the isometric camera: +X goes right/down, +Z left/down.
export const worldToMap = (x: number, z: number, size: number) => ({
  x: .5 + (x - z) / (2 * size),
  y: .5 + (x + z) / (2 * size),
});
export const mapToWorld = (x: number, y: number, size: number) => ({
  x: (x + y - 1) * size,
  z: (y - x) * size,
});

export class TacticalMap {
  private readonly context: CanvasRenderingContext2D;
  private readonly terrain = document.createElement("canvas");
  private readonly raycaster = new THREE.Raycaster();
  private readonly point = new THREE.Vector3();
  private map?: GeneratedMap;
  private system?: UnitSystem;
  private nextUpdate = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: MapCamera,
    private readonly clock: HTMLElement,
    private readonly count: HTMLElement,
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Tactical map requires a 2D canvas");
    this.context = context;
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.button !== 2) return;
      const point = this.pointerPoint(event);
      if (!point) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      if (event.button === 2) {
        if (this.system?.selectedCommandCenter()) this.system.setRallyPointSelected(point.x, point.z);
        else this.system?.moveSelected(point.x, point.z);
      } else {
        canvas.setPointerCapture(event.pointerId);
        this.camera.panTo(point);
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!canvas.hasPointerCapture(event.pointerId)) return;
      const point = this.pointerPoint(event);
      if (point) this.camera.panTo(point);
    });
    canvas.addEventListener("pointerup", (event) => {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener("keydown", (event) => {
      const steps: Record<string, [number, number]> = {
        ArrowUp: [-1, -1], ArrowDown: [1, 1], ArrowLeft: [-1, 1], ArrowRight: [1, -1],
      };
      const step = steps[event.key];
      if (!step) return;
      event.preventDefault();
      event.stopPropagation();
      this.camera.panTo({ x: this.camera.focusPoint.x + step[0] * 5, z: this.camera.focusPoint.z + step[1] * 5 });
    });
  }

  setWorld(map: GeneratedMap, system: UnitSystem) {
    this.map = map;
    this.system = system;
    this.nextUpdate = 0;
    const size = 384;
    this.terrain.width = this.terrain.height = size;
    const context = this.terrain.getContext("2d")!;
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const point = mapToWorld(x / size, y / size, map.size);
        if (Math.max(Math.abs(point.x), Math.abs(point.z)) > map.size / 2) continue;
        const height = sampleHeight(map, point.x, point.z);
        const slope = sampleHeight(map, point.x - 1, point.z - 1) - height;
        const shade = THREE.MathUtils.clamp(62 + height * 4 + slope * 14, 24, 145);
        const index = (y * size + x) * 4;
        image.data[index] = image.data[index + 1] = image.data[index + 2] = shade;
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }

  update(now: number) {
    const { map, system, context: ctx } = this;
    if (!map || !system || now < this.nextUpdate) return;
    this.nextUpdate = now + 100;
    const state = system.tacticalState();
    const seconds = Math.floor(state.seconds);
    this.clock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    this.count.textContent = String(state.entities.filter((entity) => entity.friendly && !entity.building).length);
    const size = this.canvas.width;
    const inset = 18;
    const extent = size - inset * 2;
    const project = (x: number, z: number) => {
      const p = worldToMap(x, z, map.size);
      return { x: inset + p.x * extent, y: inset + p.y * extent };
    };
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.terrain, inset, inset, extent, extent);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(size / 2, inset);
    ctx.lineTo(size - inset, size / 2);
    ctx.lineTo(size / 2, size - inset);
    ctx.lineTo(inset, size / 2);
    ctx.closePath();
    ctx.strokeStyle = "#949494";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.clip();
    for (const entity of state.entities) {
      const p = project(entity.x, entity.z);
      const radius = entity.building ? 5 : 3;
      ctx.save();
      ctx.translate(p.x, p.y);
      const color = entity.friendly ? "#f5f5f5" : `#${UI_ATTACK_COLOR.toString(16).padStart(6, "0")}`;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.8;
      if (!entity.friendly) ctx.rotate(Math.PI / 4);
      if (entity.selected) {
        ctx.strokeRect(-radius - 3, -radius - 3, (radius + 3) * 2, (radius + 3) * 2);
      }
      ctx.beginPath();
      if (entity.building || !entity.friendly) ctx.rect(-radius, -radius, radius * 2, radius * 2);
      else ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    for (const [index, corner] of corners.entries()) {
      this.raycaster.setFromCamera(new THREE.Vector2(corner[0]!, corner[1]!), this.camera.camera);
      const ray = this.raycaster.ray;
      let height = 0;
      for (let iteration = 0; iteration < 4; iteration++) {
        ray.at((height - ray.origin.y) / ray.direction.y, this.point);
        height = sampleHeight(map, this.point.x, this.point.z);
      }
      const p = project(this.point.x, this.point.z);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = "#ffffff12";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  private pointerPoint(event: PointerEvent) {
    if (!this.map) return;
    const bounds = this.canvas.getBoundingClientRect();
    const inset = 18 / this.canvas.width;
    const x = ((event.clientX - bounds.left) / bounds.width - inset) / (1 - inset * 2);
    const y = ((event.clientY - bounds.top) / bounds.height - inset) / (1 - inset * 2);
    const point = mapToWorld(x, y, this.map.size);
    if (Math.max(Math.abs(point.x), Math.abs(point.z)) > this.map.size / 2) return;
    return point;
  }
}
