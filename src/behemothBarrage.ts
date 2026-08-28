import * as THREE from "three";
import {
  BEHEMOTH_MIN_FLIGHT_SECONDS,
  BEHEMOTH_ROCKET_COUNT,
  BEHEMOTH_ROCKET_SPEED,
  behemothFirstImpactSeconds,
  seededRandom as random,
} from "./behemothAttack";
import { sampleHeight, type GeneratedMap } from "./map";

export { BEHEMOTH_ROCKET_COUNT } from "./behemothAttack";

// The Meshy model's launcher face is a 5-by-3 tube grid on its local +Z side.
export const BEHEMOTH_LAUNCH_OFFSETS = [
  [-0.6, 2.17, 0.31],
  [0, 2.17, 0.31],
  [0.6, 2.17, 0.31],
  [-0.45, 1.88, 0.34],
  [0.15, 1.88, 0.34],
  [0.6, 1.88, 0.34],
  [-0.15, 1.59, 0.35],
] as const;

const MAX_ACTIVE_ROCKETS = 24;
const MAX_SMOKE_PARTICLES = 256;
const MAX_SPARKS = 96;
const MAX_SCORCH_MARKS = 160;
const MAX_SCORCH_SCALE = 7.8;
const SCORCH_SURFACE_OFFSET = 0.035;
const SMOKE_INTERVAL = 0.022;
const LAUNCH_FLASH_DURATION = 0.28;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const EXPLOSION_FIREBALL_OFFSETS = [
  [-0.45, 0.18, 0],
  [0.4, 0.32, 0],
  [0.05, 0.55, 0],
  [-0.08, 0.15, 0],
] as const;
const EXPLOSION_START_SCALES = [1.5, 1.8, 1.35, 1.55] as const;
const EXPLOSION_GROWTH = [4, 4.6, 3.6, 4] as const;
const EXPLOSION_OPACITY = [0.95, 0.8, 0.72, 0.64] as const;

interface Rocket {
  group: THREE.Group;
  flame: THREE.Group;
  start: THREE.Vector3;
  end: THREE.Vector3;
  age: number;
  delay: number;
  duration: number;
  arcHeight: number;
  lateral: number;
  phase: number;
  flamePhase: number;
  smokeElapsed: number;
  smokePosition: THREE.Vector3;
  launched: boolean;
  volley?: {
    impacted: boolean;
    onFirstImpact?: () => void;
  };
}

interface SmokeParticle {
  active: boolean;
  age: number;
  lifetime: number;
  scale: number;
  rotation: number;
  rotationSpeed: number;
  position: THREE.Vector3;
  drift: THREE.Vector3;
}

interface Spark {
  active: boolean;
  age: number;
  lifetime: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
}

interface ScorchMark {
  active: boolean;
  age: number;
  lifetime: number;
  scale: number;
  rotation: number;
  position: THREE.Vector3;
}

interface Explosion {
  root: THREE.Group;
  flash: THREE.Sprite;
  fireballs: THREE.Sprite[];
  age: number;
}

interface LaunchFlash {
  root: THREE.Group;
  sprite: THREE.Sprite;
  age: number;
}

const smoothNoise = (x: number, y: number, seed: number) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const sample = (px: number, py: number) => random(seed + px * 1_571, py * 3_119);
  const top = THREE.MathUtils.lerp(sample(x0, y0), sample(x0 + 1, y0), sx);
  const bottom = THREE.MathUtils.lerp(sample(x0, y0 + 1), sample(x0 + 1, y0 + 1), sx);
  return THREE.MathUtils.lerp(top, bottom, sy);
};

const fractalNoise = (x: number, y: number, seed: number) => {
  let value = 0;
  let amplitude = 0.58;
  let frequency = 1;
  for (let octave = 0; octave < 4; octave += 1) {
    value += smoothNoise(x * frequency, y * frequency, seed + octave * 37) * amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value;
};

const createGlowTexture = () => {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - 15.5, y - 15.5) / 16;
      const alpha = Math.max(0, 1 - distance) ** 2;
      const index = (y * size + x) * 4;
      data.set([255, 255, 255, Math.round(alpha * 255)], index);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
};

const createCloudTexture = () => {
  const size = 64;
  const alphaValues = new Float32Array(size * size);
  const data = new Uint8Array(size * size * 4);
  const lobes = Array.from({ length: 7 }, (_, index) => ({
    x: (random(811, index * 3) - 0.5) * 0.7,
    y: (random(811, index * 3 + 1) - 0.5) * 0.7,
    radius: 0.25 + random(811, index * 3 + 2) * 0.3,
  }));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      let cloudShape = 0;
      for (const lobe of lobes) {
        const distanceSquared = (nx - lobe.x) ** 2 + (ny - lobe.y) ** 2;
        cloudShape += Math.exp(-distanceSquared / (2 * lobe.radius ** 2));
      }
      const density = fractalNoise(nx * 2.4 + 13, ny * 2.4 + 21, 191);
      const alpha = THREE.MathUtils.smoothstep(cloudShape * (0.32 + density * 0.42), 0.04, 1.08)
        * (0.5 + density * 0.34);
      alphaValues[y * size + x] = alpha;
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let alpha = 0;
      let weight = 0;
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          const sampleX = THREE.MathUtils.clamp(x + offsetX, 0, size - 1);
          const sampleY = THREE.MathUtils.clamp(y + offsetY, 0, size - 1);
          const sampleWeight = (3 - Math.abs(offsetX)) * (3 - Math.abs(offsetY));
          alpha += alphaValues[sampleY * size + sampleX]! * sampleWeight;
          weight += sampleWeight;
        }
      }
      const index = (y * size + x) * 4;
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      const edgeFade = 1 - THREE.MathUtils.smoothstep(Math.hypot(nx, ny), 0.68, 1);
      data.set([255, 255, 255, Math.round(alpha / weight * edgeFade * 255)], index);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

const createScorchTexture = () => {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      const radius = Math.hypot(nx, ny);
      const noise = fractalNoise(nx * 2.1 + 31, ny * 2.1 + 47, 317);
      const irregularRadius = radius / (0.76 + noise * 0.28);
      const edge = 1 - THREE.MathUtils.smoothstep(irregularRadius, 0.42, 1);
      const char = 0.46 + fractalNoise(nx * 3.4 + 7, ny * 3.4 + 17, 613) * 0.54;
      const alpha = Math.max(0, Math.min(1, edge * char)) ** 1.3;
      const index = (y * size + x) * 4;
      data.set([255, 255, 255, Math.round(alpha * 255)], index);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

const createSmokeMaterial = (cloudTexture: THREE.Texture) => new THREE.ShaderMaterial({
  depthWrite: false,
  transparent: true,
  uniforms: {
    cloudMap: { value: cloudTexture },
    viewportScale: { value: 1 },
  },
  vertexShader: `
    attribute float particleSize;
    attribute float particleAlpha;
    attribute float particleRotation;
    attribute vec3 particleColor;
    uniform float viewportScale;
    varying float vAlpha;
    varying float vRotation;
    varying vec3 vColor;

    void main() {
      vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * viewPosition;
      float projectionScale = projectionMatrix[1][1];
      float attenuation = projectionMatrix[3][3] == 0.0
        ? projectionScale / max(0.01, -viewPosition.z)
        : projectionScale;
      gl_PointSize = max(0.0, particleSize * viewportScale * attenuation);
      vAlpha = particleAlpha;
      vRotation = particleRotation;
      vColor = particleColor;
    }
  `,
  fragmentShader: `
    uniform sampler2D cloudMap;
    varying float vAlpha;
    varying float vRotation;
    varying vec3 vColor;

    void main() {
      vec2 centered = gl_PointCoord - 0.5;
      float cosine = cos(vRotation);
      float sine = sin(vRotation);
      vec2 rotated = mat2(cosine, -sine, sine, cosine) * centered + 0.5;
      float cloud = texture2D(cloudMap, rotated).a;
      float alpha = cloud * vAlpha;
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(vColor, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
});

const trajectoryPoint = (rocket: Rocket, t: number, target: THREE.Vector3) => {
  target.lerpVectors(rocket.start, rocket.end, t);
  const envelope = Math.sin(Math.PI * t);
  const directionX = rocket.end.x - rocket.start.x;
  const directionZ = rocket.end.z - rocket.start.z;
  const distance = Math.hypot(directionX, directionZ) || 1;
  const sideX = -directionZ / distance;
  const sideZ = directionX / distance;
  const wandering = rocket.lateral * envelope
    + Math.sin(t * Math.PI * 4 + rocket.phase) * envelope * 0.22;
  target.x += sideX * wandering;
  target.z += sideZ * wandering;
  target.y += envelope * rocket.arcHeight;
  return target;
};

const createIrregularFlameGeometry = (radius: number, length: number, seed: number) => {
  const geometry = new THREE.ConeGeometry(radius, length, 7, 3);
  const positions = geometry.getAttribute("position");
  for (let index = 0; index < positions.count; index += 1) {
    const y = positions.getY(index);
    const taper = 1 - Math.abs(y / length) * 0.55;
    const angle = Math.atan2(positions.getZ(index), positions.getX(index));
    const curl = Math.sin(angle * 3 + y * 18 + seed) * radius * 0.18 * taper;
    positions.setX(index, positions.getX(index) + Math.cos(angle + 1.2) * curl);
    positions.setZ(index, positions.getZ(index) + Math.sin(angle + 1.2) * curl);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
};

/** Bounded, pooled presentation for the Behemoth's authoritative attack-ground event. */
export class BehemothBarrage {
  private readonly glowTexture = createGlowTexture();
  private readonly cloudTexture = createCloudTexture();
  private readonly scorchTexture = createScorchTexture();
  private readonly rocketBodyGeometry = new THREE.CylinderGeometry(0.075, 0.09, 0.54, 8);
  private readonly rocketNoseGeometry = new THREE.ConeGeometry(0.075, 0.2, 8);
  private readonly rocketFlameGeometry = createIrregularFlameGeometry(0.105, 0.36, 2.1);
  private readonly rocketFlameCoreGeometry = createIrregularFlameGeometry(0.065, 0.26, 4.7);
  private readonly rocketPlumeGeometry = new THREE.PlaneGeometry(0.28, 0.58);
  private readonly rocketBodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x171b1d,
    metalness: 0.9,
    roughness: 0.34,
  });
  private readonly rocketNoseMaterial = new THREE.MeshStandardMaterial({
    color: 0x252a2c,
    metalness: 0.82,
    roughness: 0.38,
  });
  private readonly rocketFlameMaterial = new THREE.MeshBasicMaterial({
    blending: THREE.NormalBlending,
    color: 0xf57b2b,
    depthWrite: false,
    opacity: 0.28,
    toneMapped: false,
    transparent: true,
  });
  private readonly rocketFlameCoreMaterial = new THREE.MeshBasicMaterial({
    blending: THREE.AdditiveBlending,
    color: 0xff7624,
    depthWrite: false,
    opacity: 0.42,
    toneMapped: false,
    transparent: true,
  });
  private readonly rocketPlumeMaterial = new THREE.MeshBasicMaterial({
    blending: THREE.NormalBlending,
    color: 0xff7926,
    depthWrite: false,
    map: this.glowTexture,
    opacity: 0.36,
    side: THREE.DoubleSide,
    toneMapped: false,
    transparent: true,
  });
  private readonly rocketGlowMaterial = new THREE.SpriteMaterial({
    blending: THREE.AdditiveBlending,
    color: 0xff6f22,
    depthWrite: false,
    map: this.glowTexture,
    opacity: 0.38,
    toneMapped: false,
    transparent: true,
  });
  private readonly smokePositions = new Float32Array(MAX_SMOKE_PARTICLES * 3);
  private readonly smokeSizes = new Float32Array(MAX_SMOKE_PARTICLES);
  private readonly smokeAlphas = new Float32Array(MAX_SMOKE_PARTICLES);
  private readonly smokeRotations = new Float32Array(MAX_SMOKE_PARTICLES);
  private readonly smokeColors = new Float32Array(MAX_SMOKE_PARTICLES * 3);
  private readonly smokeGeometry = new THREE.BufferGeometry();
  private readonly smokeMaterial = createSmokeMaterial(this.cloudTexture);
  private readonly smoke = new THREE.Points(this.smokeGeometry, this.smokeMaterial);
  private readonly smokeParticles = Array.from({ length: MAX_SMOKE_PARTICLES }, (): SmokeParticle => ({
    active: false,
    age: 0,
    lifetime: 1,
    scale: 1,
    rotation: 0,
    rotationSpeed: 0,
    position: new THREE.Vector3(),
    drift: new THREE.Vector3(),
  }));
  private readonly sparkPositions = new Float32Array(MAX_SPARKS * 6);
  private readonly sparkColors = new Float32Array(MAX_SPARKS * 6);
  private readonly sparkGeometry = new THREE.BufferGeometry();
  private readonly sparkMaterial = new THREE.LineBasicMaterial({
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
    vertexColors: true,
  });
  private readonly sparks = new THREE.LineSegments(this.sparkGeometry, this.sparkMaterial);
  private readonly sparkParticles = Array.from({ length: MAX_SPARKS }, (): Spark => ({
    active: false,
    age: 0,
    lifetime: 1,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
  }));
  private readonly scorchCellsPerSide: number;
  private readonly scorchVerticesPerMark: number;
  private readonly scorchIndicesPerMark: number;
  private readonly scorchPositions: Float32Array;
  private readonly scorchUvs: Float32Array;
  private readonly scorchColors: Float32Array;
  private readonly scorchIndices: Uint32Array;
  private readonly scorchGeometry: THREE.BufferGeometry;
  private readonly scorchMaterial = new THREE.MeshBasicMaterial({
    color: 0x17100c,
    depthWrite: false,
    map: this.scorchTexture,
    opacity: 0.22,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    transparent: true,
    vertexColors: true,
  });
  private readonly scorchMarks: THREE.Mesh;
  private readonly scorchStates = Array.from({ length: MAX_SCORCH_MARKS }, (): ScorchMark => ({
    active: false,
    age: 0,
    lifetime: 32,
    scale: 1,
    rotation: 0,
    position: new THREE.Vector3(),
  }));
  private readonly rockets: Rocket[] = [];
  private readonly rocketPool: Rocket[] = [];
  private readonly explosions: Explosion[] = [];
  private readonly explosionPool: Explosion[] = [];
  private readonly launchFlashes: LaunchFlash[] = [];
  private readonly launchFlashPool: LaunchFlash[] = [];
  private readonly effectLight = new THREE.PointLight(0xff6a2b, 0, 11, 2);
  private readonly position = new THREE.Vector3();
  private readonly nextPosition = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly drift = new THREE.Vector3();
  private readonly averageLaunch = new THREE.Vector3();
  private readonly lightPosition = new THREE.Vector3();
  private readonly viewportSize = new THREE.Vector2();
  private smokeCursor = 0;
  private sparkCursor = 0;
  private scorchCursor = 0;
  private particleSeed = 0;

  constructor(
    private readonly world: THREE.Object3D,
    private readonly map: GeneratedMap,
  ) {
    const terrainCellSize = map.size / map.segments;
    this.scorchCellsPerSide = Math.min(
      map.segments,
      Math.ceil(MAX_SCORCH_SCALE * Math.SQRT2 / terrainCellSize) + 2,
    );
    this.scorchVerticesPerMark = (this.scorchCellsPerSide + 1) ** 2;
    this.scorchIndicesPerMark = this.scorchCellsPerSide ** 2 * 6;
    this.scorchPositions = new Float32Array(
      MAX_SCORCH_MARKS * this.scorchVerticesPerMark * 3,
    );
    this.scorchUvs = new Float32Array(MAX_SCORCH_MARKS * this.scorchVerticesPerMark * 2);
    this.scorchColors = new Float32Array(MAX_SCORCH_MARKS * this.scorchVerticesPerMark * 4);
    this.scorchIndices = new Uint32Array(MAX_SCORCH_MARKS * this.scorchIndicesPerMark);
    this.scorchGeometry = new THREE.BufferGeometry();
    this.scorchMarks = new THREE.Mesh(this.scorchGeometry, this.scorchMaterial);

    this.smokeGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.smokePositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.smokeGeometry.setAttribute(
      "particleSize",
      new THREE.BufferAttribute(this.smokeSizes, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.smokeGeometry.setAttribute(
      "particleAlpha",
      new THREE.BufferAttribute(this.smokeAlphas, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.smokeGeometry.setAttribute(
      "particleRotation",
      new THREE.BufferAttribute(this.smokeRotations, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.smokeGeometry.setAttribute(
      "particleColor",
      new THREE.BufferAttribute(this.smokeColors, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.smokeGeometry.setDrawRange(0, 0);
    this.smoke.name = "Behemoth smoke";
    this.smoke.frustumCulled = false;
    this.smoke.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(this.viewportSize);
      this.smokeMaterial.uniforms.viewportScale!.value = this.viewportSize.y / 2;
    };

    this.sparkGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.sparkPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.sparkGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(this.sparkColors, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.sparkGeometry.setDrawRange(0, 0);
    this.sparks.name = "Behemoth explosion sparks";
    this.sparks.frustumCulled = false;
    this.prepareScorchGeometry();
    this.scorchGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(this.scorchColors, 4).setUsage(THREE.DynamicDrawUsage),
    );
    this.scorchMarks.name = "Behemoth scorch marks";
    this.scorchMarks.frustumCulled = false;
    this.scorchMarks.renderOrder = 1;
    this.effectLight.name = "Behemoth barrage light";
    this.effectLight.castShadow = false;
    this.world.add(this.smoke, this.sparks, this.scorchMarks, this.effectLight);

    // Two Behemoths can fire together in the current prototype. Preallocate both volleys so
    // impact frames only activate pooled objects and update buffers.
    for (let index = 0; index < BEHEMOTH_ROCKET_COUNT * 2; index += 1) {
      this.explosionPool.push(this.createExplosion());
    }
    for (let index = 0; index < 2; index += 1) {
      this.launchFlashPool.push(this.createLaunchFlash());
    }
  }

  fire(
    launchPoints: readonly THREE.Vector3[],
    targetX: number,
    targetZ: number,
    seed: number,
    targetDistance: number,
    onFirstImpact?: () => void,
  ) {
    if (!launchPoints.length || this.rockets.length + BEHEMOTH_ROCKET_COUNT > MAX_ACTIVE_ROCKETS) {
      return false;
    }

    this.averageLaunch.set(0, 0, 0);
    for (const point of launchPoints) this.averageLaunch.add(point);
    this.averageLaunch.multiplyScalar(1 / launchPoints.length);
    this.flashLaunch(this.averageLaunch);
    const volley = { impacted: false, onFirstImpact };

    for (let index = 0; index < BEHEMOTH_ROCKET_COUNT; index += 1) {
      const angle = random(seed, index * 3) * Math.PI * 2;
      const radius = 0.65 + random(seed, index * 3 + 1) * 2.7;
      const endX = targetX + Math.cos(angle) * radius;
      const endZ = targetZ + Math.sin(angle) * radius;
      const start = launchPoints[index % launchPoints.length]!.clone();
      const end = new THREE.Vector3(endX, sampleHeight(this.map, endX, endZ) + 0.16, endZ);
      const distance = Math.hypot(endX - start.x, endZ - start.z);
      const rocket = this.rocketPool.pop() ?? this.createRocket();
      rocket.start.copy(start);
      rocket.end.copy(end);
      rocket.age = 0;
      rocket.delay = index * 0.045;
      rocket.duration = index === 0
        ? behemothFirstImpactSeconds(targetDistance, seed)
        : Math.max(BEHEMOTH_MIN_FLIGHT_SECONDS, distance / BEHEMOTH_ROCKET_SPEED)
          + random(seed, index * 3 + 2) * 0.14;
      rocket.arcHeight = 4.4 + random(seed, index * 3 + 3) * 1.6;
      rocket.lateral = (random(seed, index * 3 + 4) - 0.5) * 2.4;
      rocket.phase = random(seed, index * 3 + 5) * Math.PI * 2;
      rocket.flamePhase = random(seed, index * 3 + 6) * Math.PI * 2;
      rocket.smokeElapsed = SMOKE_INTERVAL;
      rocket.smokePosition.copy(start);
      rocket.launched = false;
      rocket.volley = volley;
      this.rockets.push(rocket);
    }
    return true;
  }

  update(deltaSeconds: number) {
    this.updateRockets(deltaSeconds);
    this.updateSmoke(deltaSeconds);
    this.updateSparks(deltaSeconds);
    this.updateScorchMarks(deltaSeconds);
    this.updateExplosions(deltaSeconds);
    this.updateLaunchFlashes(deltaSeconds);
    this.updateDynamicLight();
  }

  dispose() {
    this.smoke.removeFromParent();
    this.sparks.removeFromParent();
    this.scorchMarks.removeFromParent();
    this.effectLight.removeFromParent();
    for (const rocket of this.rockets) rocket.group.removeFromParent();
    for (const explosion of this.explosions) explosion.root.removeFromParent();
    for (const flash of this.launchFlashes) flash.root.removeFromParent();
    for (const explosion of [...this.explosions, ...this.explosionPool]) {
      explosion.flash.material.dispose();
      for (const fireball of explosion.fireballs) fireball.material.dispose();
    }
    for (const flash of [...this.launchFlashes, ...this.launchFlashPool]) flash.sprite.material.dispose();
    this.rocketBodyGeometry.dispose();
    this.rocketNoseGeometry.dispose();
    this.rocketFlameGeometry.dispose();
    this.rocketFlameCoreGeometry.dispose();
    this.rocketPlumeGeometry.dispose();
    this.rocketBodyMaterial.dispose();
    this.rocketNoseMaterial.dispose();
    this.rocketFlameMaterial.dispose();
    this.rocketFlameCoreMaterial.dispose();
    this.rocketPlumeMaterial.dispose();
    this.rocketGlowMaterial.dispose();
    this.smokeGeometry.dispose();
    this.smokeMaterial.dispose();
    this.sparkGeometry.dispose();
    this.sparkMaterial.dispose();
    this.scorchGeometry.dispose();
    this.scorchMaterial.dispose();
    this.glowTexture.dispose();
    this.cloudTexture.dispose();
    this.scorchTexture.dispose();
  }

  private createRocket(): Rocket {
    const group = new THREE.Group();
    group.name = "Behemoth rocket";
    const body = new THREE.Mesh(this.rocketBodyGeometry, this.rocketBodyMaterial);
    const nose = new THREE.Mesh(this.rocketNoseGeometry, this.rocketNoseMaterial);
    const flame = new THREE.Group();
    flame.name = "Behemoth rocket flame";
    const outerFlame = new THREE.Mesh(this.rocketFlameGeometry, this.rocketFlameMaterial);
    const coreFlame = new THREE.Mesh(this.rocketFlameCoreGeometry, this.rocketFlameCoreMaterial);
    const plume = new THREE.Mesh(this.rocketPlumeGeometry, this.rocketPlumeMaterial);
    const crossedPlume = new THREE.Mesh(this.rocketPlumeGeometry, this.rocketPlumeMaterial);
    const glow = new THREE.Sprite(this.rocketGlowMaterial);
    nose.position.y = 0.37;
    flame.position.y = -0.42;
    outerFlame.rotation.z = Math.PI;
    coreFlame.position.y = 0.035;
    coreFlame.rotation.z = Math.PI;
    plume.position.y = -0.09;
    crossedPlume.position.y = -0.09;
    crossedPlume.rotation.y = Math.PI / 2;
    flame.add(plume, crossedPlume, outerFlame, coreFlame);
    glow.position.y = -0.39;
    glow.scale.setScalar(0.26);
    group.add(body, nose, flame, glow);
    group.renderOrder = 3;
    return {
      group,
      flame,
      start: new THREE.Vector3(),
      end: new THREE.Vector3(),
      age: 0,
      delay: 0,
      duration: 1,
      arcHeight: 6,
      lateral: 0,
      phase: 0,
      flamePhase: 0,
      smokeElapsed: 0,
      smokePosition: new THREE.Vector3(),
      launched: false,
      volley: undefined,
    };
  }

  private updateRockets(deltaSeconds: number) {
    for (let index = this.rockets.length - 1; index >= 0; index -= 1) {
      const rocket = this.rockets[index]!;
      rocket.age += deltaSeconds;
      if (rocket.age < rocket.delay) continue;
      const justLaunched = !rocket.launched;
      if (justLaunched) {
        rocket.launched = true;
        this.world.add(rocket.group);
      }
      const t = Math.min(1, (rocket.age - rocket.delay) / rocket.duration);
      trajectoryPoint(rocket, t, this.position);
      trajectoryPoint(rocket, Math.min(1, t + 0.012), this.nextPosition);
      this.direction.copy(this.nextPosition).sub(this.position).normalize();
      rocket.group.position.copy(this.position);
      rocket.group.quaternion.setFromUnitVectors(WORLD_UP, this.direction);
      const flamePulse = Math.sin(rocket.age * 38 + rocket.flamePhase);
      rocket.flame.scale.set(
        0.92 + flamePulse * 0.1,
        0.88 + flamePulse * 0.16,
        0.92 - flamePulse * 0.07,
      );

      if (justLaunched) {
        for (let puff = 0; puff < 3; puff += 1) {
          const angle = rocket.phase + puff / 3 * Math.PI * 2;
          this.nextPosition.copy(rocket.start).add(new THREE.Vector3(
            Math.cos(angle) * 0.08,
            Math.sin(angle) * 0.06,
            Math.sin(angle) * 0.08,
          ));
          this.drift.set(
            -this.direction.x * 0.25 + Math.cos(angle) * 0.12,
            0.22 + puff * 0.05,
            -this.direction.z * 0.25 + Math.sin(angle) * 0.12,
          );
          this.emitSmoke(this.nextPosition, 0.31 + puff * 0.045, 1.24, this.drift);
        }
      }

      rocket.smokeElapsed += deltaSeconds;
      this.nextPosition.copy(this.position).addScaledVector(this.direction, -0.34);
      if (justLaunched) rocket.smokePosition.copy(this.nextPosition);
      const emissionCount = Math.min(4, Math.floor(rocket.smokeElapsed / SMOKE_INTERVAL));
      if (emissionCount > 0 && t < 0.94) {
        rocket.smokeElapsed -= emissionCount * SMOKE_INTERVAL;
        this.drift.set(-this.direction.x * 0.08, 0.16, -this.direction.z * 0.08);
        for (let emission = 0; emission < emissionCount; emission += 1) {
          this.position.lerpVectors(
            rocket.smokePosition,
            this.nextPosition,
            (emission + 1) / emissionCount,
          );
          this.emitSmoke(this.position, 0.25, 1.45, this.drift);
        }
        rocket.smokePosition.copy(this.nextPosition);
      }
      if (t < 1) continue;

      rocket.group.removeFromParent();
      this.explode(rocket.end, rocket.phase);
      if (rocket.volley && !rocket.volley.impacted) {
        rocket.volley.impacted = true;
        rocket.volley.onFirstImpact?.();
      }
      rocket.volley = undefined;
      this.rockets.splice(index, 1);
      this.rocketPool.push(rocket);
    }
  }

  private emitSmoke(
    position: THREE.Vector3,
    scale: number,
    lifetime: number,
    drift: THREE.Vector3,
  ) {
    const index = this.smokeCursor;
    this.smokeCursor = (this.smokeCursor + 1) % MAX_SMOKE_PARTICLES;
    const particle = this.smokeParticles[index]!;
    const seed = this.particleSeed++;
    particle.active = true;
    particle.age = 0;
    particle.lifetime = lifetime * (0.88 + random(seed, 1) * 0.24);
    particle.scale = scale * (0.68 + random(seed, 2) * 0.68);
    particle.rotation = random(seed, 3) * Math.PI * 2;
    particle.rotationSpeed = (random(seed, 4) - 0.5) * 1.4;
    const spread = scale * 0.9;
    particle.position.set(
      position.x + (random(seed, 6) - 0.5) * spread,
      position.y + (random(seed, 7) - 0.5) * spread * 0.55,
      position.z + (random(seed, 8) - 0.5) * spread,
    );
    particle.drift.copy(drift).multiplyScalar(0.76 + random(seed, 5) * 0.48);
    particle.drift.x += (random(seed, 9) - 0.5) * 0.9;
    particle.drift.y += 0.08 + random(seed, 10) * 0.2;
    particle.drift.z += (random(seed, 11) - 0.5) * 0.9;
  }

  private updateSmoke(deltaSeconds: number) {
    let drawCount = 0;
    for (let index = 0; index < this.smokeParticles.length; index += 1) {
      const particle = this.smokeParticles[index]!;
      const positionOffset = index * 3;
      if (!particle.active) continue;
      particle.age += deltaSeconds;
      if (particle.age >= particle.lifetime) {
        particle.active = false;
        this.smokeSizes[index] = 0;
        this.smokeAlphas[index] = 0;
        continue;
      }
      drawCount = index + 1;
      const progress = particle.age / particle.lifetime;
      particle.position.addScaledVector(particle.drift, deltaSeconds);
      particle.position.x += Math.sin(particle.rotation + particle.age * 2.1) * deltaSeconds * 0.11;
      particle.position.z += Math.cos(particle.rotation + particle.age * 1.7) * deltaSeconds * 0.11;
      particle.rotation += particle.rotationSpeed * deltaSeconds;
      this.smokePositions[positionOffset] = particle.position.x;
      this.smokePositions[positionOffset + 1] = particle.position.y;
      this.smokePositions[positionOffset + 2] = particle.position.z;
      this.smokeSizes[index] = particle.scale * (1.34 + progress * 4.2);
      const fadeIn = Math.min(1, progress / 0.12);
      this.smokeAlphas[index] = fadeIn * (1 - progress) ** 1.12 * 0.3;
      this.smokeRotations[index] = particle.rotation;
      const shade = 0.04 + progress * 0.045;
      this.smokeColors[positionOffset] = shade * 1.08;
      this.smokeColors[positionOffset + 1] = shade * 0.94;
      this.smokeColors[positionOffset + 2] = shade * 0.78;
    }
    this.smokeGeometry.setDrawRange(0, drawCount);
    for (const attribute of Object.values(this.smokeGeometry.attributes)) attribute.needsUpdate = true;
  }

  private explode(position: THREE.Vector3, phase: number) {
    const explosion = this.explosionPool.pop() ?? this.createExplosion();
    explosion.age = 0;
    explosion.root.position.copy(position);
    explosion.flash.material.opacity = 1;
    explosion.fireballs.forEach((fireball, index) => {
      fireball.material.opacity = index === 0 ? 0.95 : 0.78;
      fireball.material.rotation = phase + index * 1.7;
      const [x, y, z] = EXPLOSION_FIREBALL_OFFSETS[index]!;
      fireball.position.set(x, y, z);
    });
    this.world.add(explosion.root);
    this.explosions.push(explosion);

    for (let index = 0; index < 9; index += 1) {
      const angle = phase + index / 9 * Math.PI * 2;
      const radius = 0.12 + random(Math.round(phase * 1_000), index) * 0.24;
      this.nextPosition.set(
        position.x + Math.cos(angle) * radius,
        position.y + 0.1 + random(index, 8) * 0.22,
        position.z + Math.sin(angle) * radius,
      );
      this.drift.set(
        Math.cos(angle) * (0.28 + random(index, 9) * 0.38),
        0.48 + random(index, 10) * 0.52,
        Math.sin(angle) * (0.28 + random(index, 11) * 0.38),
      );
      this.emitSmoke(this.nextPosition, 0.95 + random(index, 12) * 0.55, 1.8, this.drift);
    }
    this.emitSparks(position, phase);
    this.addScorchMark(position, phase);
  }

  private createExplosion(): Explosion {
    const root = new THREE.Group();
    root.name = "Behemoth explosion";
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xffc66b,
      depthWrite: false,
      map: this.glowTexture,
      toneMapped: false,
      transparent: true,
    }));
    const fireballs = [0xff8630, 0xc83b18, 0xed5a1d, 0x9f2815].map((color, index) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        blending: index === 0 ? THREE.AdditiveBlending : THREE.NormalBlending,
        color,
        depthWrite: false,
        map: this.cloudTexture,
        toneMapped: false,
        transparent: true,
      }));
      const [x, y, z] = EXPLOSION_FIREBALL_OFFSETS[index]!;
      sprite.position.set(x, y, z);
      return sprite;
    });
    root.add(...fireballs, flash);
    return { root, flash, fireballs, age: 0 };
  }

  private updateExplosions(deltaSeconds: number) {
    const duration = 0.72;
    for (let index = this.explosions.length - 1; index >= 0; index -= 1) {
      const explosion = this.explosions[index]!;
      explosion.age += deltaSeconds;
      const progress = Math.min(1, explosion.age / duration);
      explosion.flash.scale.setScalar(1.4 + progress * 4.2);
      explosion.flash.material.opacity = Math.max(0, 1 - progress * 3.6);
      for (let fireballIndex = 0; fireballIndex < explosion.fireballs.length;
        fireballIndex += 1) {
        const fireball = explosion.fireballs[fireballIndex]!;
        fireball.scale.setScalar(
          EXPLOSION_START_SCALES[fireballIndex]!
            + progress * EXPLOSION_GROWTH[fireballIndex]!,
        );
        fireball.material.opacity = (1 - progress) ** (1.25 + fireballIndex * 0.16)
          * EXPLOSION_OPACITY[fireballIndex]!;
        fireball.position.y += deltaSeconds * (0.38 - fireballIndex * 0.04);
      }
      if (progress < 1) continue;
      explosion.root.removeFromParent();
      this.explosions.splice(index, 1);
      this.explosionPool.push(explosion);
    }
  }

  private emitSparks(position: THREE.Vector3, phase: number) {
    const seed = Math.round(phase * 10_000);
    for (let index = 0; index < 12; index += 1) {
      const slot = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % MAX_SPARKS;
      const spark = this.sparkParticles[slot]!;
      const angle = phase + index / 12 * Math.PI * 2 + random(seed, index) * 0.32;
      const speed = 1.8 + random(seed, index + 20) * 3.4;
      spark.active = true;
      spark.age = 0;
      spark.lifetime = 0.34 + random(seed, index + 40) * 0.28;
      spark.position.copy(position).add(new THREE.Vector3(0, 0.18, 0));
      spark.velocity.set(
        Math.cos(angle) * speed,
        2.5 + random(seed, index + 60) * 3.8,
        Math.sin(angle) * speed,
      );
    }
  }

  private updateSparks(deltaSeconds: number) {
    let drawCount = 0;
    for (let index = 0; index < this.sparkParticles.length; index += 1) {
      const spark = this.sparkParticles[index]!;
      const offset = index * 6;
      if (!spark.active) continue;
      spark.age += deltaSeconds;
      if (spark.age >= spark.lifetime) {
        spark.active = false;
        this.sparkPositions.fill(0, offset, offset + 6);
        this.sparkColors.fill(0, offset, offset + 6);
        continue;
      }
      drawCount = (index + 1) * 2;
      const progress = spark.age / spark.lifetime;
      spark.velocity.y -= 9.5 * deltaSeconds;
      spark.position.addScaledVector(spark.velocity, deltaSeconds);
      this.direction.copy(spark.velocity).normalize();
      const tailLength = 0.18 + spark.velocity.length() * 0.035;
      this.sparkPositions[offset] = spark.position.x;
      this.sparkPositions[offset + 1] = spark.position.y;
      this.sparkPositions[offset + 2] = spark.position.z;
      this.sparkPositions[offset + 3] = spark.position.x - this.direction.x * tailLength;
      this.sparkPositions[offset + 4] = spark.position.y - this.direction.y * tailLength;
      this.sparkPositions[offset + 5] = spark.position.z - this.direction.z * tailLength;
      const strength = (1 - progress) ** 0.7;
      for (let vertex = 0; vertex < 2; vertex += 1) {
        const colorOffset = offset + vertex * 3;
        const tail = vertex ? 0.42 : 1;
        this.sparkColors[colorOffset] = strength * tail;
        this.sparkColors[colorOffset + 1] = strength * tail * 0.48;
        this.sparkColors[colorOffset + 2] = strength * tail * 0.12;
      }
    }
    this.sparkGeometry.setDrawRange(0, drawCount);
    for (const attribute of Object.values(this.sparkGeometry.attributes)) attribute.needsUpdate = true;
  }

  private prepareScorchGeometry() {
    for (let mark = 0; mark < MAX_SCORCH_MARKS; mark += 1) {
      const vertexStart = mark * this.scorchVerticesPerMark;
      for (let z = 0; z <= this.scorchCellsPerSide; z += 1) {
        for (let x = 0; x <= this.scorchCellsPerSide; x += 1) {
          const vertex = vertexStart + z * (this.scorchCellsPerSide + 1) + x;
          this.scorchColors[vertex * 4] = 1;
          this.scorchColors[vertex * 4 + 1] = 1;
          this.scorchColors[vertex * 4 + 2] = 1;
        }
      }
      let index = mark * this.scorchIndicesPerMark;
      for (let z = 0; z < this.scorchCellsPerSide; z += 1) {
        for (let x = 0; x < this.scorchCellsPerSide; x += 1) {
          const topLeft = vertexStart + z * (this.scorchCellsPerSide + 1) + x;
          const bottomLeft = topLeft + this.scorchCellsPerSide + 1;
          this.scorchIndices.set([
            topLeft,
            bottomLeft,
            topLeft + 1,
            topLeft + 1,
            bottomLeft,
            bottomLeft + 1,
          ], index);
          index += 6;
        }
      }
    }
    this.scorchGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.scorchPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.scorchGeometry.setAttribute("uv", new THREE.BufferAttribute(this.scorchUvs, 2));
    this.scorchGeometry.setIndex(new THREE.BufferAttribute(this.scorchIndices, 1));
  }

  private addScorchMark(position: THREE.Vector3, phase: number) {
    const index = this.scorchCursor;
    this.scorchCursor = (this.scorchCursor + 1) % MAX_SCORCH_MARKS;
    const mark = this.scorchStates[index]!;
    mark.active = true;
    mark.age = 0;
    mark.lifetime = 28 + random(Math.round(phase * 10_000), index) * 8;
    mark.scale = 6.5 + random(Math.round(phase * 20_000), index + 7)
      * (MAX_SCORCH_SCALE - 6.5);
    mark.rotation = phase + random(Math.round(phase * 30_000), index + 13) * Math.PI;
    mark.position.set(position.x, sampleHeight(this.map, position.x, position.z), position.z);
    const cos = Math.cos(mark.rotation);
    const sin = Math.sin(mark.rotation);
    const centerGridX = (mark.position.x / this.map.size + 0.5) * this.map.segments;
    const centerGridZ = (mark.position.z / this.map.size + 0.5) * this.map.segments;
    const gridStartX = THREE.MathUtils.clamp(
      Math.floor(centerGridX - this.scorchCellsPerSide / 2),
      0,
      this.map.segments - this.scorchCellsPerSide,
    );
    const gridStartZ = THREE.MathUtils.clamp(
      Math.floor(centerGridZ - this.scorchCellsPerSide / 2),
      0,
      this.map.segments - this.scorchCellsPerSide,
    );
    const row = this.map.segments + 1;
    const vertexStart = index * this.scorchVerticesPerMark;
    for (let z = 0; z <= this.scorchCellsPerSide; z += 1) {
      for (let x = 0; x <= this.scorchCellsPerSide; x += 1) {
        const gridX = gridStartX + x;
        const gridZ = gridStartZ + z;
        const worldX = (gridX / this.map.segments - 0.5) * this.map.size;
        const worldZ = (gridZ / this.map.segments - 0.5) * this.map.size;
        const offsetX = worldX - mark.position.x;
        const offsetZ = worldZ - mark.position.z;
        const localX = offsetX * cos - offsetZ * sin;
        const localZ = offsetX * sin + offsetZ * cos;
        const vertex = vertexStart + z * (this.scorchCellsPerSide + 1) + x;
        this.scorchPositions[vertex * 3] = worldX;
        this.scorchPositions[vertex * 3 + 1] = this.map.heights[gridZ * row + gridX]!
          + SCORCH_SURFACE_OFFSET;
        this.scorchPositions[vertex * 3 + 2] = worldZ;
        this.scorchUvs[vertex * 2] = localX / mark.scale + 0.5;
        this.scorchUvs[vertex * 2 + 1] = localZ / mark.scale + 0.5;
      }
    }
    (this.scorchGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.scorchGeometry.getAttribute("uv") as THREE.BufferAttribute).needsUpdate = true;
  }

  private setScorchAlpha(markIndex: number, alpha: number) {
    const vertexStart = markIndex * this.scorchVerticesPerMark;
    for (let vertex = vertexStart; vertex < vertexStart + this.scorchVerticesPerMark; vertex += 1) {
      this.scorchColors[vertex * 4 + 3] = alpha;
    }
  }

  private updateScorchMarks(deltaSeconds: number) {
    for (let index = 0; index < this.scorchStates.length; index += 1) {
      const mark = this.scorchStates[index]!;
      if (!mark.active) continue;
      mark.age += deltaSeconds;
      if (mark.age >= mark.lifetime) {
        mark.active = false;
        this.setScorchAlpha(index, 0);
        continue;
      }
      const fadeIn = Math.min(1, mark.age / 0.12);
      const fadeOut = Math.min(1, (mark.lifetime - mark.age) / 12);
      this.setScorchAlpha(index, fadeIn * fadeOut);
    }
    (this.scorchGeometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  private flashLaunch(position: THREE.Vector3) {
    const flash = this.launchFlashPool.pop() ?? this.createLaunchFlash();
    flash.age = 0;
    flash.root.position.copy(position);
    flash.sprite.material.opacity = 0.9;
    this.world.add(flash.root);
    this.launchFlashes.push(flash);
  }

  private createLaunchFlash(): LaunchFlash {
    const root = new THREE.Group();
    root.name = "Behemoth launch flash";
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xff7130,
      depthWrite: false,
      map: this.glowTexture,
      toneMapped: false,
      transparent: true,
    }));
    root.add(sprite);
    return { root, sprite, age: 0 };
  }

  private updateLaunchFlashes(deltaSeconds: number) {
    const duration = LAUNCH_FLASH_DURATION;
    for (let index = this.launchFlashes.length - 1; index >= 0; index -= 1) {
      const flash = this.launchFlashes[index]!;
      flash.age += deltaSeconds;
      const progress = Math.min(1, flash.age / duration);
      flash.sprite.scale.set(1.45 + progress * 0.9, 0.95 + progress * 0.65, 1);
      flash.sprite.material.opacity = (1 - progress) * 0.9;
      if (progress < 1) continue;
      flash.root.removeFromParent();
      this.launchFlashes.splice(index, 1);
      this.launchFlashPool.push(flash);
    }
  }

  private updateDynamicLight() {
    this.lightPosition.set(0, 0, 0);
    let totalWeight = 0;
    let peakStrength = 0;

    for (const flash of this.launchFlashes) {
      const strength = Math.max(0, 1 - flash.age / LAUNCH_FLASH_DURATION);
      this.lightPosition.addScaledVector(flash.root.position, strength);
      totalWeight += strength;
      peakStrength = Math.max(peakStrength, strength);
    }
    for (const explosion of this.explosions) {
      const strength = Math.max(0, 1 - explosion.age / 0.29);
      this.lightPosition.addScaledVector(explosion.root.position, strength);
      totalWeight += strength;
      peakStrength = Math.max(peakStrength, strength);
    }

    if (totalWeight <= 0) {
      this.effectLight.intensity = 0;
      return;
    }
    this.effectLight.position.copy(this.lightPosition).multiplyScalar(1 / totalWeight);
    this.effectLight.position.y += 0.65;
    this.effectLight.intensity = Math.min(8.5, peakStrength * 6.8 + totalWeight * 0.25);
  }
}
