import * as THREE from "three";
import type { ConstructionSite } from "../constructionSites";
import { laserSeed } from "../scoutLaser";
import type { GlowList } from "./glowEffects";
import type { ScoutArms } from "./scoutArms";
import type { Tool, WorkStyle } from "./work/style";
import { weld } from "./work/weld";

/**
 * Metres the drone's nose has to stand above its work before the work starts, so nothing reaches
 * up through the hull. Once on, it stays on while the nose is above the work at all: on a slow
 * machine the drone's rise trails the building's by a few tenths of a metre.
 */
const CLEARANCE = 0.3;

const scratch = new THREE.Vector3();

/** A Scout's building made visible: how it works on the edge of its site. */
export class BuilderWork {
  /** Whether the work was drawn in the latest update. */
  active = false;
  /** The drone's nose, and the point on the site it works at; current while `active`. */
  readonly nose = new THREE.Vector3();
  readonly contact = new THREE.Vector3();
  private readonly tool: Tool;
  private power = 0;
  /** The site the work is lit on, kept until it has gone out. */
  private lit?: ConstructionSite;

  /**
   * `nozzle` sits on the drone's model at the front of its nose. `glows` holds this drone's arcs
   * and sparks, and `arms` draws its tools. `style` is how it works: the game leaves it out.
   */
  constructor(
    nozzle: THREE.Object3D, glows: GlowList, arms: ScoutArms, unitId: string,
    private readonly style: WorkStyle = weld,
  ) {
    this.tool = {
      from: new THREE.Vector3(), body: new THREE.Object3D(), nozzle, contact: this.contact,
      ends: [new THREE.Vector3(), new THREE.Vector3()], lean: 0, deltaSeconds: 0, seed: laserSeed(unitId), glows, arms,
    };
  }

  /** The world height a drone at `from` hovers over while it works on `site`: the edge it reaches. */
  workHeight(site: ConstructionSite, from: THREE.Vector3) {
    return site.workPoint(from, this.style.reach, 0, scratch).y;
  }

  /**
   * Works on `site` for this frame when one is given, from a drone standing at `from`. Without a
   * site the work goes out where it last was. `time` is the clock the glows are drawn with, and
   * `body` the drone's model group, which a style may lean or shake. Call it after the drone's
   * model has been posed for the frame.
   */
  update(site: ConstructionSite | undefined, from: THREE.Vector3, time: number, deltaSeconds: number, body: THREE.Object3D) {
    this.active = false;
    const { tool, style } = this;
    tool.glows.clear();
    body.position.set(0, 0, 0);
    if (!site && this.power === 0) return;
    // A drone sent straight to another site lets its work go out on the first one before it
    // starts on the second, or it would jump from one to the other.
    if (this.power === 0) {
      this.lit = site;
      tool.lean = 0;
    }
    const working = site === this.lit ? site : undefined;
    tool.from.copy(from);
    tool.body = body;
    tool.deltaSeconds = deltaSeconds;
    // Read from the model: the nose rises, bobs and sways with the hovering body.
    tool.nozzle.getWorldPosition(this.nose);
    if (working) style.aim(tool, working, time);
    const clear = working !== undefined && this.nose.y - this.contact.y >= (this.power > 0 ? 0 : CLEARANCE);
    this.power = THREE.MathUtils.clamp(this.power + deltaSeconds / (clear ? style.fadeSeconds : -style.fadeSeconds), 0, 1);
    this.active = this.power > 0;
    if (!this.active) return;
    style.draw(tool, time, THREE.MathUtils.smoothstep(this.power, 0, 1));
    tool.nozzle.getWorldPosition(this.nose);
  }

  /** For a Scout that is no longer drawn, and so no longer updated: it is left standing straight, with nothing out. */
  hide() {
    this.active = false;
    this.power = 0;
    this.tool.glows.clear();
    this.tool.body.position.set(0, 0, 0);
  }
}
