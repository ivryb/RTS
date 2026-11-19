import * as THREE from "three";
import { seededRandom } from "../behemothAttack";
import type { GeneratedMap } from "../map";
import { GroundMarks } from "./groundMarks";
import { createBlotTexture, createGlowTexture, createPuffTexture, SpritePool } from "./sprites";

/**
 * The sprite and ground-mark vocabulary of death effects: flashes, fireballs, smoke, sand dust,
 * sparks and scorch. Every call writes into fixed pools and takes a `delay`, so a whole staged
 * death is scheduled in the frame the unit dies and then costs nothing on the CPU.
 *
 * Sizes are metres. `y` is the height of the effect's centre; ground-hugging puffs are lifted by
 * a share of their size so the terrain does not cut their quads.
 */

/** A particle's colour at birth and at death, converted once to the linear RGB the pools store. */
const tint = (start: number, end: number) => {
  const from = new THREE.Color(start);
  const to = new THREE.Color(end);
  return [from.r, from.g, from.b, to.r, to.g, to.b] as const;
};
type Tint = ReturnType<typeof tint>;

const FLASH = tint(0xfff0c8, 0xff8a34);
const FIRE = tint(0xffc978, 0x9a2d0e);
const FLAME = tint(0xffb24d, 0xb23a12);
const SMOKE_BLACK = tint(0x1b1917, 0x4b453f);
const SMOKE_GREY = tint(0x4b453f, 0x7a7168);
const SAND = tint(0xa98f6c, 0xc8b393);
const SAND_PALE = tint(0xc8b393, 0xc8b393);
const SPARKS = tint(0xffd9a0, 0xff7a26);
/** The cyan arcing of a cyborg's failing power cell. */
export const ARCING = tint(0x7fe9ff, 0x1f8fd0);

const SCORCH = new THREE.Color(0x1d140e);
/** The pale dust a collapsed, unburnt structure leaves on the sand. */
const PALE_STAIN = new THREE.Color(0xd8c6a4);

// A Command Center's scorch lasts over three minutes. In a pool of its own a long fight's many
// short-lived marks cannot push it out while its ruin still stands, and the unit marks get by
// with a small patch of terrain each.
const LARGEST_SMALL_MARK = 7.5;
const LARGEST_MARK = 13;

/**
 * A deterministic random sequence. Each death reseeds it from its casualty, so the same death
 * always looks the same and thirty deaths at once all differ.
 */
export class Dice {
  private seed = 0;
  private drawn = 0;

  reseed(value: number) {
    this.seed = value % 65_521;
    this.drawn = 0;
  }

  /** The next number of the sequence, from 0 up to 1. */
  random() {
    return seededRandom(this.seed, this.drawn++);
  }

  between(low: number, high: number) {
    return low + (high - low) * this.random();
  }
}

export class Bursts {
  /** Additive round glows: flashes, sparks, rocket motors. Drawn over everything, never cut by terrain. */
  private readonly glow: SpritePool;
  /** Additive billows: fireballs and flames. */
  private readonly fire: SpritePool;
  /** Alpha-blended billows: smoke and sand dust. */
  private readonly smoke: SpritePool;
  private readonly marks: GroundMarks;
  private readonly largeMarks: GroundMarks;
  private readonly textures = { glow: createGlowTexture(), puff: createPuffTexture(), blot: createBlotTexture() };

  constructor(
    parent: THREE.Object3D,
    map: GeneratedMap,
    private readonly groundHeight: (x: number, z: number) => number,
    private readonly dice: Dice,
  ) {
    const { glow, puff, blot } = this.textures;
    this.glow = new SpritePool({
      name: "Death flashes and sparks", capacity: 768, texture: glow, blending: "additive",
      fadeIn: 0, fadeOutFrom: 0, depthTest: false, renderOrder: 4,
    });
    this.fire = new SpritePool({
      name: "Death fire", capacity: 1024, texture: puff, blending: "additive", fadeOutFrom: 0.25, renderOrder: 3,
    });
    this.smoke = new SpritePool({
      name: "Death smoke and dust", capacity: 2048, texture: puff, blending: "normal",
      fadeIn: 0.12, fadeOutFrom: 0.35, wind: new THREE.Vector3(0.55, 0, -0.25), renderOrder: 2,
    });
    this.marks = new GroundMarks(map, { name: "Death scorch marks", capacity: 96, largest: LARGEST_SMALL_MARK, texture: blot });
    this.largeMarks = new GroundMarks(map, { name: "Ruin scorch marks", capacity: 16, largest: LARGEST_MARK, texture: blot });
    parent.add(this.marks.mesh, this.largeMarks.mesh, this.smoke.mesh, this.fire.mesh, this.glow.mesh);
  }

  update(deltaSeconds: number) {
    this.glow.update(deltaSeconds);
    this.fire.update(deltaSeconds);
    this.smoke.update(deltaSeconds);
    this.marks.update(deltaSeconds);
    this.largeMarks.update(deltaSeconds);
  }

  clear() {
    this.glow.clear();
    this.fire.clear();
    this.smoke.clear();
    this.marks.clear();
    this.largeMarks.clear();
  }

  dispose() {
    this.glow.dispose();
    this.fire.dispose();
    this.smoke.dispose();
    this.marks.dispose();
    this.largeMarks.dispose();
    for (const texture of Object.values(this.textures)) texture.dispose();
  }

  private put(
    pool: SpritePool, colours: Tint,
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    lifetime: number, startSize: number, endSize: number, alpha: number,
    gravity: number, drag: number, delay: number,
  ) {
    const next = pool.next;
    next.r = colours[0]; next.g = colours[1]; next.b = colours[2];
    next.endR = colours[3]; next.endG = colours[4]; next.endB = colours[5];
    next.x = x; next.y = y; next.z = z;
    next.vx = vx; next.vy = vy; next.vz = vz;
    next.lifetime = lifetime; next.startSize = startSize; next.endSize = endSize; next.alpha = alpha;
    next.gravity = gravity; next.drag = drag;
    next.rotation = this.dice.random() * Math.PI * 2;
    next.spin = this.dice.random() - 0.5;
    pool.emit(delay);
  }

  flash(x: number, y: number, z: number, size: number, delay = 0, lifetime = 0.16, colours: Tint = FLASH) {
    this.put(this.glow, colours, x, y, z, 0, 0, 0, lifetime, size * 1.1, size * 2.6, 0.95, 0, 0, delay);
  }

  /** A rolling fireball `size` across that turns into a rising knot of dark smoke. */
  fireball(x: number, y: number, z: number, size: number, delay = 0, smoke = 1) {
    const puffs = size > 2.4 ? 9 : size > 1.1 ? 6 : 4;
    for (let index = 0; index < puffs; index += 1) {
      const angle = this.dice.random() * Math.PI * 2;
      const reach = size * this.dice.between(0.5, 1.5);
      this.put(
        this.fire, FIRE, x, y, z,
        Math.cos(angle) * reach, size * this.dice.between(0.6, 2.2), Math.sin(angle) * reach,
        this.dice.between(0.32, 0.6) * (0.7 + size * 0.14), size * 0.45, size * this.dice.between(0.9, 1.25), 0.8,
        0, 3.2, delay + index * 0.012,
      );
    }
    const knots = Math.round(puffs * 0.7 * smoke);
    for (let index = 0; index < knots; index += 1) {
      const angle = this.dice.random() * Math.PI * 2;
      const reach = size * this.dice.between(0.2, 0.8);
      this.put(
        this.smoke, SMOKE_BLACK, x, y + size * 0.2, z,
        Math.cos(angle) * reach, size * this.dice.between(0.9, 2) + 0.4, Math.sin(angle) * reach,
        this.dice.between(1.3, 2.4) * (0.75 + size * 0.12), size * 0.5, size * this.dice.between(1.3, 1.9), 0.62,
        0.4, 1.5, delay + 0.07 + index * 0.03,
      );
    }
  }

  /** One puff of smoke; `darkness` 1 is oily black, 0 is thin grey. */
  smokePuff(
    x: number, y: number, z: number, size: number, rise: number, lifetime: number,
    darkness: number, delay = 0,
  ) {
    this.put(
      this.smoke, darkness > 0.5 ? SMOKE_BLACK : SMOKE_GREY, x, y, z, this.dice.between(-0.25, 0.25), rise, this.dice.between(-0.25, 0.25),
      lifetime, size * 0.4, size, 0.25 + darkness * 0.4, 0.15, 0.5, delay,
    );
  }

  /** A flame tongue that licks upward and shrinks. */
  flame(x: number, y: number, z: number, size: number, delay = 0) {
    this.put(
      this.fire, FLAME, x + this.dice.between(-0.3, 0.3) * size, y, z + this.dice.between(-0.3, 0.3) * size,
      0, size * this.dice.between(1.6, 2.6), 0, this.dice.between(0.35, 0.6), size, size * 0.3, 0.75, 0, 1, delay,
    );
  }

  /** Sand kicked outward along the ground from a ring `radius` wide; `linger` stretches how long it hangs. */
  dust(
    x: number, z: number, radius: number, count: number, delay = 0,
    pale = false, alpha = 0.42, linger = 1,
  ) {
    const ground = this.groundHeight(x, z);
    const size = Math.max(0.5, radius * 0.75);
    for (let index = 0; index < count; index += 1) {
      const angle = (index + this.dice.random()) / count * Math.PI * 2;
      const speed = radius * this.dice.between(1.1, 2.2);
      this.put(
        this.smoke, pale ? SAND_PALE : SAND,
        x + Math.cos(angle) * radius * 0.35, ground + size * 0.42, z + Math.sin(angle) * radius * 0.35,
        Math.cos(angle) * speed, this.dice.between(0.2, 0.9) * Math.sqrt(radius), Math.sin(angle) * speed,
        this.dice.between(0.9, 1.7) * (0.8 + radius * 0.12) * linger, size * 0.5, size * this.dice.between(1.1, 1.6), alpha,
        0, 2.2, delay + this.dice.random() * 0.05,
      );
    }
  }

  /** Bright fragments thrown mostly upward, falling under gravity. */
  sparks(
    x: number, y: number, z: number, speed: number, count: number, delay = 0,
    size = 0.16, colours: Tint = SPARKS,
  ) {
    for (let index = 0; index < count; index += 1) {
      const angle = this.dice.random() * Math.PI * 2;
      const out = speed * this.dice.between(0.3, 1);
      this.put(
        this.glow, colours, x, y, z,
        Math.cos(angle) * out, speed * this.dice.between(0.5, 1.5), Math.sin(angle) * out,
        this.dice.between(0.3, 0.7), size * this.dice.between(0.8, 1.4), size * 0.4, 1, -16, 1.2, delay + this.dice.random() * 0.04,
      );
    }
  }

  /**
   * A ground mark `size` across, draped over the terrain, that holds for `holdSeconds` and then
   * fades over a third of that again. `pale` is the dust stain of a structure that fell unburnt.
   */
  mark(x: number, z: number, size: number, alpha: number, holdSeconds: number, delay = 0, pale = false) {
    const width = Math.min(size, LARGEST_MARK);
    const pool = width > LARGEST_SMALL_MARK ? this.largeMarks : this.marks;
    const colour = pale ? PALE_STAIN : SCORCH;
    const next = pool.next;
    next.x = x; next.z = z;
    next.size = width;
    next.rotation = this.dice.random() * Math.PI * 2;
    next.blot = Math.floor(this.dice.random() * 4);
    next.r = colour.r; next.g = colour.g; next.b = colour.b;
    next.alpha = alpha;
    next.fadeIn = 0.25; next.hold = holdSeconds; next.fadeOut = holdSeconds * 0.35;
    pool.emit(delay);
  }
}
