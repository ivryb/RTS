export const BEHEMOTH_ROCKET_COUNT = 7;
export const BEHEMOTH_ROCKET_SPEED = 18;
export const BEHEMOTH_MIN_FLIGHT_SECONDS = 0.82;
export const BEHEMOTH_DAMAGE_DELAY_SECONDS = 0.08;

export const seededRandom = (seed: number, offset: number) => {
  const value = Math.sin((seed + offset * 101.31) * 12.9898) * 43_758.5453;
  return value - Math.floor(value);
};

export const behemothVolleySeed = (attackerId: string, tick: number) => {
  let seed = tick;
  for (let index = 0; index < attackerId.length; index += 1) {
    seed = Math.imul(seed ^ attackerId.charCodeAt(index), 16_777_619);
  }
  return seed >>> 0;
};

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
