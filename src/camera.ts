import * as THREE from "three";

const VIEW_HEIGHT = 56;
export const DEFAULT_ZOOM = 1.3;
const MIN_ZOOM = DEFAULT_ZOOM * 0.6;
const MAX_ZOOM = DEFAULT_ZOOM * 3;

export class MapCamera {
  readonly camera = new THREE.OrthographicCamera();

  private readonly target = new THREE.Vector3();
  private readonly offset = new THREE.Vector3(46, 58, 46);
  private readonly keys = new Set<string>();
  private dragging = false;
  private pointerX = 0;
  private pointerY = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private mapSize: number,
  ) {
    this.camera.zoom = DEFAULT_ZOOM;
    this.camera.near = 0.1;
    this.camera.far = 360;
    this.bindEvents();
    this.resize();
    this.updatePosition();
  }

  update(deltaSeconds: number) {
    const forward = new THREE.Vector3(-this.offset.x, 0, -this.offset.z).normalize();
    const right = new THREE.Vector3().crossVectors(forward, THREE.Object3D.DEFAULT_UP).normalize();
    const speed = (34 / this.camera.zoom) * deltaSeconds;

    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) this.target.addScaledVector(forward, speed);
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) this.target.addScaledVector(forward, -speed);
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) this.target.addScaledVector(right, -speed);
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) this.target.addScaledVector(right, speed);

    this.clampTarget();
    this.updatePosition();
  }

  focus(point: { x: number; z: number }) {
    this.target.set(point.x, 0, point.z);
    this.clampTarget();
    this.camera.zoom = DEFAULT_ZOOM;
    this.camera.updateProjectionMatrix();
    this.updatePosition();
  }

  setMapSize(mapSize: number) {
    this.mapSize = mapSize;
    this.clampTarget();
    this.updatePosition();
  }

  get focusPoint() {
    return this.target;
  }

  resize = () => {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera.left = (-VIEW_HEIGHT * aspect) / 2;
    this.camera.right = (VIEW_HEIGHT * aspect) / 2;
    this.camera.top = VIEW_HEIGHT / 2;
    this.camera.bottom = -VIEW_HEIGHT / 2;
    this.camera.updateProjectionMatrix();
  };

  private bindEvents() {
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("auxclick", (event) => event.preventDefault());
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      this.dragging = true;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;

      const dx = event.clientX - this.pointerX;
      const dy = event.clientY - this.pointerY;
      if (dx || dy) this.canvas.classList.add("is-panning");
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;

      const unitsPerPixel = VIEW_HEIGHT / this.camera.zoom / window.innerHeight;
      const forward = new THREE.Vector3(-this.offset.x, 0, -this.offset.z).normalize();
      const right = new THREE.Vector3().crossVectors(forward, THREE.Object3D.DEFAULT_UP).normalize();
      this.target.addScaledVector(right, -dx * unitsPerPixel);
      this.target.addScaledVector(forward, dy * unitsPerPixel);
      this.clampTarget();
    });
    this.canvas.addEventListener("pointerup", (event) => {
      if (event.button !== 1 || !this.dragging) return;
      this.dragging = false;
      this.canvas.classList.remove("is-panning");
      this.canvas.releasePointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointercancel", () => {
      this.dragging = false;
      this.canvas.classList.remove("is-panning");
    });
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.camera.zoom = THREE.MathUtils.clamp(
          this.camera.zoom * Math.exp(-event.deltaY * 0.0012),
          MIN_ZOOM,
          MAX_ZOOM,
        );
        this.camera.updateProjectionMatrix();
      },
      { passive: false },
    );
    window.addEventListener("keydown", (event) => this.keys.add(event.code));
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("resize", this.resize);
  }

  private clampTarget() {
    const limit = this.mapSize / 2;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -limit, limit);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -limit, limit);
  }

  private updatePosition() {
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
  }
}
