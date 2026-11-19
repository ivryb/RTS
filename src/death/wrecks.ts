import * as THREE from "three";
import { seededRandom } from "../behemothAttack";
import type { Bursts } from "./bursts";
import type { WreckModel } from "./wreckKit";

/**
 * What stays on the sand after a death: every wreck, husk or ruin of one model is an instance of
 * one InstancedMesh with a fixed number of slots. A wreck burns, smokes, goes cold, then sinks
 * into the ground and frees its slot. When a pool is nearly full its oldest wreck sinks early
 * and quickly, so the count never grows. Only a burst of more than about two deaths a second of
 * one kind, kept up past the pool's size, replaces a wreck that is still on its way down.
 */
export interface WreckProfile {
  /** Slots in the pool. */
  capacity: number;
  castShadow: boolean;
  /** Seconds after it appears until the flames stop, the smoke stops, and it starts to sink. */
  flameSeconds: number;
  smokeSeconds: number;
  restSeconds: number;
  sinkSeconds: number;
  /** Smoke puffs per second and per emitter while burning, the width a puff grows to, how fast it rises, how long it lasts. */
  smokeRate: number;
  smokeSize: number;
  smokeRise: number;
  smokeLife: number;
  flameSize: number;
  /** Points smoke and flame rise from, as x, y, z triples in the model's own frame; none means the top centre. */
  emitters: readonly number[];
  /** Colour multiplier the wreck appears with before it settles to its baked colours over `coolSeconds`. */
  heat: readonly [number, number, number];
  coolSeconds: number;
}

/**
 * Free slots a pool keeps (half its slots when it has fewer than six) by sinking its oldest
 * wreck early, and the share of its usual sinking time that wreck then takes.
 */
const HEADROOM = 3;
const EARLY_SINK_SHARE = 0.4;

interface Wreck {
  /** False once the wreck has sunk and its slot is free. */
  lying: boolean;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Uniform scale, and its height as a share of the model's. */
  scale: number;
  heightShare: number;
  age: number;
  /** The age at which it starts to sink, and how long that takes. */
  sinksAt: number;
  sinkSeconds: number;
  /** It rises out of the ground to its full height over this long, as rubble piles up. */
  growSeconds: number;
  /** A wreck that lands moving: its speed, how long it still slides, and for how long in all. */
  slideX: number;
  slideZ: number;
  slideLeft: number;
  slideSeconds: number;
  yaw: number;
  yawRate: number;
  /** Fractions of a smoke puff and a flame owed since the last one, and how many were emitted. */
  smokeDebt: number;
  flameDebt: number;
  emitted: number;
  seed: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const emitter = new THREE.Vector3();
const colour = new THREE.Color();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export class WreckPool {
  readonly mesh: THREE.InstancedMesh;
  /** Height of the model in its own frame, and the middle of its bounds. */
  readonly height: number;
  readonly centre = new THREE.Vector3();

  private readonly emitters: readonly number[];
  private readonly wrecks: Wreck[];
  private readonly headroom: number;
  private lying = 0;

  constructor(
    name: string,
    model: WreckModel,
    private readonly profile: WreckProfile,
    private readonly bursts: Bursts,
    private readonly groundHeight: (x: number, z: number) => number,
  ) {
    const bounds = model.geometry.boundingBox!;
    this.height = bounds.max.y - bounds.min.y;
    bounds.getCenter(this.centre);
    this.emitters = profile.emitters.length > 0
      ? profile.emitters
      : [this.centre.x, bounds.min.y + this.height * 0.7, this.centre.z];
    this.headroom = Math.min(HEADROOM, profile.capacity >> 1);
    this.wrecks = Array.from({ length: profile.capacity }, (): Wreck => ({
      lying: false, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1, heightShare: 1,
      age: 0, sinksAt: 0, sinkSeconds: 0, growSeconds: 0,
      slideX: 0, slideZ: 0, slideLeft: 0, slideSeconds: 0, yaw: 0, yawRate: 0,
      smokeDebt: 0, flameDebt: 0, emitted: 0, seed: 0,
    }));
    this.mesh = new THREE.InstancedMesh(model.geometry, model.material, profile.capacity);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = profile.castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, colour.setRGB(1, 1, 1));
    this.clear();
  }

  /**
   * Lays a wreck with the given world transform. A wreck that lands moving slides on for
   * `slideSeconds`, turning at `yawRate`; one with `growSeconds` rises out of the ground to its
   * full height over that time, as rubble piles up. `heightShare` flattens a heap that had less
   * to fall from.
   */
  spawn(
    source: THREE.Matrix4, seed: number,
    slideX = 0, slideZ = 0, slideSeconds = 0, yaw = 0, yawRate = 0, growSeconds = 0, heightShare = 1,
  ) {
    const index = this.claim();
    const wreck = this.wrecks[index]!;
    source.decompose(wreck.position, wreck.quaternion, scale);
    wreck.scale = scale.x;
    wreck.heightShare = heightShare;
    wreck.age = 0;
    wreck.sinksAt = this.profile.restSeconds;
    wreck.sinkSeconds = this.profile.sinkSeconds;
    wreck.growSeconds = growSeconds;
    wreck.slideX = slideX; wreck.slideZ = slideZ;
    wreck.slideLeft = slideSeconds; wreck.slideSeconds = slideSeconds;
    wreck.yaw = yaw; wreck.yawRate = yawRate;
    wreck.smokeDebt = 0; wreck.flameDebt = 0; wreck.emitted = 0;
    wreck.seed = seed % 65_521;
    if (!wreck.lying) this.lying += 1;
    wreck.lying = true;
    this.mesh.visible = true;
    if (this.mesh.count < index + 1) this.mesh.count = index + 1;
    this.place(index, wreck, 0);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tint(index, 0);
    if (this.lying > this.profile.capacity - this.headroom) this.retireOldest();
  }

  update(deltaSeconds: number) {
    if (this.lying === 0) return;
    const { profile } = this;
    let moved = false;
    for (let index = 0; index < this.mesh.count; index += 1) {
      const wreck = this.wrecks[index]!;
      if (!wreck.lying) continue;
      wreck.age += deltaSeconds;
      let animated = wreck.age < wreck.growSeconds;
      if (wreck.slideLeft > 0) {
        const pace = wreck.slideLeft / wreck.slideSeconds;
        wreck.position.x += wreck.slideX * pace * deltaSeconds;
        wreck.position.z += wreck.slideZ * pace * deltaSeconds;
        wreck.position.y = this.groundHeight(wreck.position.x, wreck.position.z);
        wreck.yaw += wreck.yawRate * pace * deltaSeconds;
        wreck.slideLeft -= deltaSeconds;
        wreck.quaternion.setFromAxisAngle(UP, wreck.yaw);
        animated = true;
      }
      const sunk = Math.max(0, (wreck.age - wreck.sinksAt) / wreck.sinkSeconds);
      if (sunk >= 1) {
        wreck.lying = false;
        this.lying -= 1;
        this.mesh.setMatrixAt(index, hidden);
        moved = true;
        continue;
      }
      if (animated || sunk > 0) {
        this.place(index, wreck, sunk);
        moved = true;
      }
      if (wreck.age < profile.coolSeconds + deltaSeconds) this.tint(index, wreck.age);
      if (wreck.age < profile.smokeSeconds && sunk === 0) this.burn(wreck, deltaSeconds);
    }
    if (moved) this.mesh.instanceMatrix.needsUpdate = true;
    if (this.lying === 0) this.mesh.visible = false;
  }

  /** Removes every wreck at once. */
  clear() {
    for (let index = 0; index < this.wrecks.length; index += 1) {
      this.wrecks[index]!.lying = false;
      this.mesh.setMatrixAt(index, hidden);
    }
    this.lying = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** Frees the instance buffers; the geometry and material belong to the wreck kit. */
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
  }

  /** A free slot, or with none free the wreck that has been lying longest. */
  private claim() {
    let oldest = 0;
    for (let index = 0; index < this.wrecks.length; index += 1) {
      const wreck = this.wrecks[index]!;
      if (!wreck.lying) return index;
      if (wreck.age > this.wrecks[oldest]!.age) oldest = index;
    }
    return oldest;
  }

  /** Starts the oldest wreck that is not sinking yet on a quick way down. */
  private retireOldest() {
    let oldest: Wreck | undefined;
    for (let index = 0; index < this.mesh.count; index += 1) {
      const wreck = this.wrecks[index]!;
      if (!wreck.lying || wreck.age >= wreck.sinksAt) continue;
      if (!oldest || wreck.age > oldest.age) oldest = wreck;
    }
    if (!oldest) return;
    oldest.sinksAt = oldest.age;
    oldest.sinkSeconds *= EARLY_SINK_SHARE;
  }

  private place(index: number, wreck: Wreck, sunk: number) {
    const grown = wreck.growSeconds > 0 ? Math.min(1, wreck.age / wreck.growSeconds) : 1;
    const height = this.height * wreck.scale * wreck.heightShare;
    position.copy(wreck.position);
    position.y -= sunk * sunk * (height + 0.3);
    scale.set(wreck.scale, wreck.scale * wreck.heightShare * (0.05 + 0.95 * grown * (2 - grown)), wreck.scale);
    this.mesh.setMatrixAt(index, matrix.compose(position, wreck.quaternion, scale));
  }

  private tint(index: number, age: number) {
    const { heat, coolSeconds } = this.profile;
    const cooled = coolSeconds > 0 ? Math.min(1, age / coolSeconds) : 1;
    const warm = (1 - cooled) * (1 - cooled);
    colour.setRGB(1 + (heat[0] - 1) * warm, 1 + (heat[1] - 1) * warm, 1 + (heat[2] - 1) * warm);
    this.mesh.setColorAt(index, colour);
    this.mesh.instanceColor!.needsUpdate = true;
  }

  /** Emits this frame's share of flame and smoke; the smoke thins from black to grey wisps. */
  private burn(wreck: Wreck, deltaSeconds: number) {
    const { profile, bursts, emitters } = this;
    const points = emitters.length / 3;
    const fading = Math.min(1, (profile.smokeSeconds - wreck.age) / (profile.smokeSeconds * 0.45));
    const burning = wreck.age < profile.flameSeconds;
    wreck.smokeDebt += deltaSeconds * profile.smokeRate * (0.35 + 0.65 * fading) * points;
    if (burning) wreck.flameDebt += deltaSeconds * 7 * points;
    while (wreck.smokeDebt >= 1 || wreck.flameDebt >= 1) {
      const at = Math.floor(seededRandom(wreck.seed, wreck.emitted) * points) * 3;
      wreck.emitted += 1;
      emitter.set(emitters[at]!, emitters[at + 1]!, emitters[at + 2]!)
        .multiplyScalar(wreck.scale).applyQuaternion(wreck.quaternion).add(wreck.position);
      if (wreck.flameDebt >= 1) {
        wreck.flameDebt -= 1;
        bursts.flame(emitter.x, emitter.y + profile.flameSize * 0.3, emitter.z, profile.flameSize);
      } else {
        wreck.smokeDebt -= 1;
        const darkness = burning ? 1 : 0.25 + 0.5 * fading;
        bursts.smokePuff(
          emitter.x, emitter.y + profile.smokeSize * 0.25, emitter.z,
          profile.smokeSize * (0.6 + 0.4 * fading), profile.smokeRise, profile.smokeLife, darkness,
        );
      }
    }
  }
}
