import * as THREE from "three";

/** The cut glows this long behind the contact; `fire` wants the contact's place that long ago. */
export const MINING_TRAIL_SECONDS = 0.3;
const SPARKS = 6;
const FLOATS_PER_LASER = 10;
const INITIAL_CAPACITY = 32;
/** The shader clock wraps here so its hashes keep their precision in long matches. */
const SHADER_CLOCK_SECONDS = 512;

// One laser is a handful of camera-facing quads. Each vertex carries its quad corner in x and y
// (-1 to 1) and its part in z: 0 cut trail, 1 beam, 2 contact glow, 3 emitter glow, 4+ sparks.
const createQuads = () => {
  const parts = 4 + SPARKS;
  const corners = new Float32Array(parts * 12);
  const indices = new Uint16Array(parts * 6);
  for (let part = 0; part < parts; part += 1) {
    corners.set([-1, -1, part, 1, -1, part, 1, 1, part, -1, 1, part], part * 12);
    const vertex = part * 4;
    indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], part * 6);
  }
  return { corners, indices };
};

const vertexShader = /* glsl */ `
  uniform float time;
  attribute vec3 beamStart;
  attribute vec3 beamEnd;
  // xyz: where the contact was TRAIL_SECONDS ago; w: a per-drone random number.
  attribute vec4 beamTrail;
  varying vec2 vCorner;
  varying float vPart;
  varying float vSeed;
  varying float vLife;
  varying float vAlong;

  const float BEAM_HALF_WIDTH = 0.14;
  const float TRAIL_HALF_WIDTH = 0.085;
  const float TRAIL_SECONDS = ${MINING_TRAIL_SECONDS.toFixed(3)};
  const float CONTACT_RADIUS = 0.36;
  const float EMITTER_RADIUS = 0.2;
  const float SPARK_HALF_LENGTH = 0.13;
  const float SPARK_HALF_WIDTH = 0.04;
  const float SPARK_GRAVITY = 5.5;
  // Glows on the rock are drawn this much nearer the camera, so its surface does not slice them.
  const float SURFACE_LIFT = 0.28;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  vec3 towardCamera(vec3 point, float distance) {
    return point + (isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-point)) * distance;
  }

  void main() {
    vec2 corner = position.xy;
    float part = position.z;
    float seed = beamTrail.w;
    vec3 startView = (modelViewMatrix * vec4(beamStart, 1.0)).xyz;
    vec3 endView = (modelViewMatrix * vec4(beamEnd, 1.0)).xyz;
    vec3 point;
    vLife = 0.0;
    vAlong = 0.0;
    if (part < 1.5) {
      // Ribbons turned to the camera: the beam, and the cut still glowing behind the contact.
      bool trail = part < 0.5;
      vec3 tail = trail ? (modelViewMatrix * vec4(beamTrail.xyz, 1.0)).xyz : startView;
      vec3 along = endView - tail;
      vec3 center = mix(tail, endView, corner.y * 0.5 + 0.5);
      vec3 side = cross(along, isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-center));
      float sideLength = length(side);
      side = sideLength > 0.00001 ? side / sideLength : vec3(1.0, 0.0, 0.0);
      point = center + side * corner.x * (trail ? TRAIL_HALF_WIDTH : BEAM_HALF_WIDTH);
      if (trail) point = towardCamera(point, SURFACE_LIFT);
      vAlong = (corner.y * 0.5 + 0.5) * length(along);
    } else if (part < 3.5) {
      float flicker = 0.86 + 0.14 * sin(time * 47.0 + seed * 40.0) * sin(time * 31.0 + seed * 17.0);
      point = part < 2.5
        ? towardCamera(endView, SURFACE_LIFT) + vec3(corner * CONTACT_RADIUS * flicker, 0.0)
        : startView + vec3(corner * EMITTER_RADIUS, 0.0);
    } else {
      // Sparks need no state: each one's whole flight follows from the clock and its number.
      float id = part - 4.0;
      float rate = 2.3 + 1.3 * hash(id * 7.31 + seed * 13.7);
      float cycle = time * rate + hash(id * 3.17 + seed * 5.1);
      vLife = fract(cycle);
      float age = vLife / rate;
      float flight = floor(cycle) + id * 17.0 + seed * 101.0;
      vec3 scatter = vec3(hash(flight), hash(flight + 1.3), hash(flight + 2.7)) - 0.5;
      // They leave the rock back toward the drone, then fall, from where the contact was when struck.
      vec3 velocity = normalize(normalize(beamStart - beamEnd) + scatter * 1.8 + vec3(0.0, 0.5, 0.0))
        * (1.3 + 2.3 * hash(flight + 4.1));
      vec3 world = mix(beamEnd, beamTrail.xyz, age / TRAIL_SECONDS) + velocity * age
        - vec3(0.0, SPARK_GRAVITY * 0.5 * age * age, 0.0);
      vec3 heading = (modelViewMatrix * vec4(velocity - vec3(0.0, SPARK_GRAVITY * age, 0.0), 0.0)).xyz;
      vec2 direction = normalize(heading.xy + vec2(0.0001, 0.0));
      vec3 center = towardCamera((modelViewMatrix * vec4(world, 1.0)).xyz, SURFACE_LIFT);
      point = center + vec3(direction * corner.y * SPARK_HALF_LENGTH
        + vec2(direction.y, -direction.x) * corner.x * SPARK_HALF_WIDTH, 0.0) * (1.0 - vLife * 0.5);
    }
    vCorner = corner;
    vPart = part;
    vSeed = seed;
    gl_Position = projectionMatrix * vec4(point, 1.0);
  }
`;

// Output is premultiplied: rgb is light added to the scene, alpha is how much of the scene behind
// is covered. Covering keeps the beam readable over bright sand, where light that is only added
// washes out.
const fragmentShader = /* glsl */ `
  uniform float time;
  varying vec2 vCorner;
  varying float vPart;
  varying float vSeed;
  varying float vLife;
  varying float vAlong;

  const vec3 BEAM = vec3(0.04, 0.55, 1.0);
  const vec3 BEAM_CORE = vec3(0.72, 0.97, 1.0);
  const vec3 MOLTEN = vec3(1.0, 0.36, 0.05);
  const vec3 WHITE_HOT = vec3(1.0, 0.93, 0.74);
  const vec3 EMBER = vec3(0.9, 0.12, 0.02);

  void main() {
    vec3 light;
    float cover = 0.0;
    if (vPart < 0.5) {
      float across = 1.0 - abs(vCorner.x);
      float heat = vCorner.y * 0.5 + 0.5;
      light = mix(EMBER, MOLTEN, heat) * across * across * heat * heat * 1.3;
    } else if (vPart < 1.5) {
      float across = abs(vCorner.x);
      float core = 1.0 - smoothstep(0.14, 0.32, across);
      float sheath = 1.0 - smoothstep(0.3, 1.0, across);
      sheath *= sheath;
      float pulse = 0.86 + 0.14 * sin(vAlong * 11.0 - time * 34.0 + vSeed * 20.0);
      light = BEAM * sheath * 0.9 * pulse + BEAM_CORE * core;
      // The blue sheath covers the sand too: blue light merely added to orange sand turns grey.
      cover = max(core * 0.9, sheath * 0.75);
    } else if (vPart < 3.5) {
      float radius = length(vCorner);
      float glow = pow(max(0.0, 1.0 - radius), 2.2);
      float center = 1.0 - smoothstep(0.1, 0.32, radius);
      light = vPart < 2.5
        ? MOLTEN * glow * 1.25 + WHITE_HOT * center
        : BEAM * glow + BEAM_CORE * center * 0.9;
      cover = vPart < 2.5 ? center * 0.8 : max(center * 0.8, glow * 0.7);
    } else {
      float across = 1.0 - abs(vCorner.x);
      float body = across * across * (1.0 - abs(vCorner.y));
      light = mix(WHITE_HOT, MOLTEN, min(1.0, vLife * 1.6)) * body * (1.0 - vLife * vLife) * 2.2;
    }
    gl_FragColor = vec4(light, cover);
    #include <colorspace_fragment>
  }
`;

/**
 * Every Scout Drone's mining laser: beam, contact glow, glowing cut and sparks, all in one
 * instanced draw call with no lights.
 *
 * It keeps nothing between frames. Call `begin` once a frame, then `fire` for each drone that is
 * mining in that frame; a drone that stops calling `fire` has no laser.
 */
export class MiningLasers {
  /** Seconds this effect has run; drones time their sweeps from it. */
  time = 0;
  /** Lasers fired since the last `begin`. */
  count = 0;
  private lasers = new Float32Array(INITIAL_CAPACITY * FLOATS_PER_LASER);
  private instances!: THREE.InstancedInterleavedBuffer;
  private readonly material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader,
    fragmentShader,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    // Each quad is turned to the camera in the shader, so its winding says nothing about facing.
    side: THREE.DoubleSide,
    transparent: true,
  });
  private readonly mesh = new THREE.Mesh(new THREE.InstancedBufferGeometry(), this.material);

  constructor(world: THREE.Group) {
    this.mesh.name = "Scout mining lasers";
    // The quads are placed in the shader, so the geometry's own bounds say nothing.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    this.allocate();
    world.add(this.mesh);
  }

  begin(deltaSeconds: number) {
    this.time += deltaSeconds;
    this.material.uniforms.time!.value = this.time % SHADER_CLOCK_SECONDS;
    this.count = 0;
    this.mesh.visible = false;
  }

  /**
   * Draws one laser this frame from `start` to `end`, a point on the rock, with the cut glowing
   * back to `trail`, where that point was MINING_TRAIL_SECONDS ago. `seed`, from 0 to 1, keeps one
   * drone's flicker and sparks unlike another's.
   */
  fire(start: THREE.Vector3, end: THREE.Vector3, trail: THREE.Vector3, seed: number) {
    if ((this.count + 1) * FLOATS_PER_LASER > this.lasers.length) this.grow();
    const offset = this.count * FLOATS_PER_LASER;
    const lasers = this.lasers;
    lasers[offset] = start.x;
    lasers[offset + 1] = start.y;
    lasers[offset + 2] = start.z;
    lasers[offset + 3] = end.x;
    lasers[offset + 4] = end.y;
    lasers[offset + 5] = end.z;
    lasers[offset + 6] = trail.x;
    lasers[offset + 7] = trail.y;
    lasers[offset + 8] = trail.z;
    lasers[offset + 9] = seed;
    this.count += 1;
    this.mesh.geometry.instanceCount = this.count;
    this.mesh.visible = true;
    this.instances.needsUpdate = true;
  }

  /** Fires one laser far below the terrain, so loading compiles the shader instead of the first mining run. */
  prepareRendering() {
    const buried = new THREE.Vector3(0, -10_000, 0);
    this.fire(buried, buried, buried, 0);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  private grow() {
    const lasers = new Float32Array(this.lasers.length * 2);
    lasers.set(this.lasers);
    this.lasers = lasers;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.InstancedBufferGeometry();
    this.allocate();
  }

  private allocate() {
    const { corners, indices } = createQuads();
    const geometry = this.mesh.geometry;
    geometry.setAttribute("position", new THREE.BufferAttribute(corners, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.instances = new THREE.InstancedInterleavedBuffer(this.lasers, FLOATS_PER_LASER)
      .setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("beamStart", new THREE.InterleavedBufferAttribute(this.instances, 3, 0));
    geometry.setAttribute("beamEnd", new THREE.InterleavedBufferAttribute(this.instances, 3, 3));
    geometry.setAttribute("beamTrail", new THREE.InterleavedBufferAttribute(this.instances, 4, 6));
    geometry.instanceCount = this.count;
  }
}
