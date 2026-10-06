import * as THREE from "three";

const smoothstep = (start: number, end: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

const noiseHash = (seed: number, x: number, z: number) => {
  let value = seed ^ Math.imul(x, 374_761_393) ^ Math.imul(z, 668_265_263);
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295;
};

const valueNoise = (seed: number, x: number, z: number, scale: number) => {
  const gridX = x / scale;
  const gridZ = z / scale;
  const x0 = Math.floor(gridX);
  const z0 = Math.floor(gridZ);
  const tx = smoothstep(0, 1, gridX - x0);
  const tz = smoothstep(0, 1, gridZ - z0);
  const top = THREE.MathUtils.lerp(noiseHash(seed, x0, z0), noiseHash(seed, x0 + 1, z0), tx);
  const bottom = THREE.MathUtils.lerp(noiseHash(seed, x0, z0 + 1), noiseHash(seed, x0 + 1, z0 + 1), tx);
  return THREE.MathUtils.lerp(top, bottom, tz);
};

export const createPatchWeights = (
  map: { seed: number },
  positions: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
) => {
  const weights = new Float32Array(positions.count);

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const warpX = (valueNoise(map.seed + 11, x, z, 72) - 0.5) * 28;
    const warpZ = (valueNoise(map.seed + 23, x, z, 72) - 0.5) * 28;
    const broad = valueNoise(map.seed + 37, x + warpX, z + warpZ, 46);
    const detail = valueNoise(map.seed + 53, x + warpX, z + warpZ, 21);
    const region = smoothstep(0.44, 0.72, broad * 0.72 + detail * 0.28);

    const lowland = 1 - smoothstep(1.25, 2.15, positions.getY(index));
    weights[index] = region * lowland;
  }

  return new THREE.Float32BufferAttribute(weights, 1);
};
