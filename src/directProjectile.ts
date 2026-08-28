export const DIRECT_PROJECTILE_SPEED = 45;

export const directProjectileImpactDelayTicks = (
  distance: number,
  tickSeconds: number,
) => Math.max(1, Math.ceil(distance / DIRECT_PROJECTILE_SPEED / tickSeconds));
