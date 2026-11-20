import * as THREE from "three";
import type { ScoutLasers } from "../../scoutLaser";
import type { WorkStyle } from "./style";

const emitter = new THREE.Vector3();

/**
 * A blue scanning laser: a sheet of light that fans out from the nozzle to a line sweeping the
 * deck's edge. `lasers` draws it, and has to be made with `scanLook`.
 */
export const scanWith = (lasers: ScoutLasers): WorkStyle => ({
  reach: Infinity,
  fadeSeconds: 0.2,
  aim(tool, site, time) {
    site.scanLine(tool.from, time, tool.seed, tool.ends[0], tool.ends[1]);
    tool.contact.lerpVectors(tool.ends[0], tool.ends[1], 0.5);
  },
  draw(tool, _time, power) {
    lasers.fire(tool.nozzle.getWorldPosition(emitter), tool.ends[0], tool.ends[1], tool.seed, power);
  },
});
