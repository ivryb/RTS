export const BEHEMOTH_ROCKET_COUNT = 7;
export const BEHEMOTH_ROCKET_SPEED = 18;
export const BEHEMOTH_MIN_FLIGHT_SECONDS = 0.82;
export const BEHEMOTH_DAMAGE_DELAY_SECONDS = 0.08;

export const seededRandom = (seed: number, offset: number) => {
  const value = Math.sin((seed + offset * 101.31) * 12.9898) * 43_758.5453;
  return value - Math.floor(value);
};

/** A stable whole number for an id (FNV-1a), started from `seed`. */
export const hashId = (id: string, seed = 2_166_136_261) => {
  let hash = seed;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16_777_619);
  }
  return hash >>> 0;
};

export const behemothVolleySeed = (attackerId: string, tick: number) => hashId(attackerId, tick);

export const behemothFirstImpactSeconds = (distance: number, seed: number) =>
  Math.max(BEHEMOTH_MIN_FLIGHT_SECONDS, distance / BEHEMOTH_ROCKET_SPEED)
    + seededRandom(seed, 2) * 0.14;

/** The launch frame advances the rocket once; damage follows impact on the next whole tick. */
export const behemothImpactDelayTicks = (
  distance: number,
  seed: number,
  tickSeconds: number,
) => Math.max(1, Math.ceil(behemothFirstImpactSeconds(distance, seed) / tickSeconds) - 1)
  + Math.max(1, Math.ceil(BEHEMOTH_DAMAGE_DELAY_SECONDS / tickSeconds));
