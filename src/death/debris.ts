import * as THREE from "three";

const GRAVITY = -19;
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

type State = "free" | "waiting" | "flying" | "resting" | "sinking";

interface Piece {
  state: State;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Euler;
  /** Tumble in radians per second about each axis. */
  spin: THREE.Vector3;
  scale: number;
  /** Seconds left in the `waiting`, `resting` or `sinking` state. */
  timer: number;
  bounced: boolean;
}

export interface DebrisSpawn {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Tumble in radians per second about each axis, and uniform scale. */
  spinX: number; spinY: number; spinZ: number;
  scale: number;
}

export interface DebrisPoolOptions {
  name: string;
  capacity: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
  groundHeight(x: number, z: number): number;
  /** Seconds a landed piece stays before it sinks, and how long sinking takes. */
  restSeconds: number;
  sinkSeconds: number;
}

/**
 * Solid chunks of one model in one draw call, thrown on ballistic paths. A piece bounces once,
 * rests, then sinks into the ground. When the pool is full the oldest piece is reused, and the
 * pool does no work while every piece is gone. Nothing allocates after construction.
 */
export class DebrisPool {
  readonly mesh: THREE.InstancedMesh;
  /** Scratch piece: set its fields, then call `emit`. */
  readonly next: DebrisSpawn = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spinX: 0, spinY: 0, spinZ: 0, scale: 1,
  };

  private readonly pieces: Piece[];
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private cursor = 0;
  private busy = 0;

  constructor(private readonly options: DebrisPoolOptions) {
    this.pieces = Array.from({ length: options.capacity }, (): Piece => ({
      state: "free", position: new THREE.Vector3(), velocity: new THREE.Vector3(),
      rotation: new THREE.Euler(), spin: new THREE.Vector3(), scale: 1, timer: 0, bounced: false,
    }));
    this.mesh = new THREE.InstancedMesh(options.geometry, options.material, options.capacity);
    this.mesh.name = options.name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = options.castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.clear();
  }

  /** Throws the scratch piece. With `delay`, it stays hidden for that many seconds first. */
  emit(delay = 0) {
    const { next } = this;
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.options.capacity;
    const piece = this.pieces[index]!;
    if (piece.state === "free") this.busy += 1;
    piece.position.set(next.x, next.y, next.z);
    piece.velocity.set(next.vx, next.vy, next.vz);
    // Any start angle will do; these spread the pieces of one burst over different ones.
    piece.rotation.set(next.spinX * 7.1, next.spinY * 3.3, next.spinZ * 5.7);
    piece.spin.set(next.spinX, next.spinY, next.spinZ);
    piece.scale = next.scale;
    piece.timer = delay;
    piece.bounced = false;
    piece.state = delay > 0 ? "waiting" : "flying";
    // The slot's last piece may still lie there; it goes at once.
    this.mesh.setMatrixAt(index, hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = true;
    if (this.mesh.count < index + 1) this.mesh.count = index + 1;
  }

  update(deltaSeconds: number) {
    if (this.busy === 0) return;
    const { restSeconds, sinkSeconds, groundHeight } = this.options;
    let moved = false;
    for (let index = 0; index < this.mesh.count; index += 1) {
      const piece = this.pieces[index]!;
      if (piece.state === "free") continue;
      const { position, velocity } = piece;
      if (piece.state === "waiting" || piece.state === "resting") {
        piece.timer -= deltaSeconds;
        if (piece.timer > 0) continue;
        if (piece.state === "waiting") {
          piece.state = "flying";
          continue;
        }
        piece.state = "sinking";
        piece.timer = sinkSeconds;
      }
      if (piece.state === "flying") {
        velocity.y += GRAVITY * deltaSeconds;
        position.addScaledVector(velocity, deltaSeconds);
        piece.rotation.x += piece.spin.x * deltaSeconds;
        piece.rotation.y += piece.spin.y * deltaSeconds;
        piece.rotation.z += piece.spin.z * deltaSeconds;
        const floor = groundHeight(position.x, position.z) + piece.scale * 0.25;
        if (position.y <= floor && velocity.y < 0) {
          position.y = floor;
          if (!piece.bounced && velocity.y < -4) {
            piece.bounced = true;
            velocity.set(velocity.x * 0.45, velocity.y * -0.28, velocity.z * 0.45);
            piece.spin.multiplyScalar(0.4);
          } else {
            piece.state = "resting";
            piece.timer = restSeconds;
          }
        }
      } else {
        piece.timer -= deltaSeconds;
        position.y -= piece.scale * 0.9 * deltaSeconds / sinkSeconds;
        if (piece.timer <= 0) {
          piece.state = "free";
          this.busy -= 1;
          this.mesh.setMatrixAt(index, hidden);
          moved = true;
          continue;
        }
      }
      this.quaternion.setFromEuler(piece.rotation);
      this.scale.setScalar(piece.scale);
      this.mesh.setMatrixAt(index, this.matrix.compose(position, this.quaternion, this.scale));
      moved = true;
    }
    if (moved) this.mesh.instanceMatrix.needsUpdate = true;
    if (this.busy === 0) this.mesh.visible = false;
  }

  /** Removes every piece, scheduled ones included. */
  clear() {
    for (let index = 0; index < this.pieces.length; index += 1) {
      this.pieces[index]!.state = "free";
      this.mesh.setMatrixAt(index, hidden);
    }
    this.busy = 0;
    this.cursor = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** Frees the instance buffers; the geometry and material belong to the wreck kit. */
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }
}
