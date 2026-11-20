import type { LaserLook } from "../scoutLaser";

// The scanning laser's parts: 0 the sheet of light, 1 the line it draws on the deck, 2 and 3 the
// sheet's two edges, 4 the glow at the nozzle. `beamEnd` and `beamTrail.xyz` are the line's ends.
const vertexShader = /* glsl */ `
  attribute vec3 beamStart;
  attribute vec3 beamEnd;
  attribute vec4 beamTrail;
  attribute float beamPower;
  varying vec2 vCorner;
  varying float vPart;
  varying float vSeed;
  varying float vPower;
  // On the sheet: how far across it (-1 to 1) times how far along it, and how far along it
  // (0 at the nozzle, 1 at the line). Dividing the first by the second gives one ray's own
  // number, the same all the way down the ray.
  varying vec2 vSheet;

  const float LINE_HALF_WIDTH = 0.2;
  const float EDGE_HALF_WIDTH = 0.07;
  // No ribbon is narrower than this share of the view's half height (about 2 pixels).
  const float LEAST_SCREEN = 0.005;
  const float EMITTER_RADIUS = 0.2;
  // The line is drawn this much nearer the camera, so the deck it lies on does not slice it.
  const float SURFACE_LIFT = 0.12;

  void main() {
    vec2 corner = position.xy;
    float part = position.z;
    vec3 nozzle = (modelViewMatrix * vec4(beamStart, 1.0)).xyz;
    vec3 lineStart = (modelViewMatrix * vec4(beamEnd, 1.0)).xyz;
    vec3 lineEnd = (modelViewMatrix * vec4(beamTrail.xyz, 1.0)).xyz;
    vec3 point;
    vSheet = vec2(0.0);
    if (part < 0.5) {
      // A triangle: both lower corners sit at the nozzle, the upper two at the line's ends.
      float along = corner.y * 0.5 + 0.5;
      point = mix(nozzle, mix(lineStart, lineEnd, corner.x * 0.5 + 0.5), along);
      vSheet = vec2(corner.x * along, along);
    } else if (part < 3.5) {
      // Ribbons turned to the camera: the line on the deck, and the sheet's two edges.
      bool line = part < 1.5;
      vec3 tail = line ? lineStart : nozzle;
      vec3 head = line ? lineEnd : part < 2.5 ? lineStart : lineEnd;
      vec3 center = mix(tail, head, corner.y * 0.5 + 0.5);
      vec3 toCamera = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-center);
      vec3 side = cross(head - tail, toCamera);
      float sideLength = length(side);
      side = sideLength > 0.00001 ? side / sideLength : vec3(1.0, 0.0, 0.0);
      float leastWidth = (isOrthographic ? 1.0 : -center.z) / projectionMatrix[1][1] * LEAST_SCREEN;
      point = center + side * corner.x * max(line ? LINE_HALF_WIDTH : EDGE_HALF_WIDTH, leastWidth);
      if (line) point += toCamera * SURFACE_LIFT;
    } else {
      point = nozzle + vec3(corner * EMITTER_RADIUS, 0.0);
    }
    vCorner = corner;
    vPart = part;
    vSeed = beamTrail.w;
    vPower = beamPower;
    gl_Position = projectionMatrix * vec4(point, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float time;
  varying vec2 vCorner;
  varying float vPart;
  varying float vSeed;
  varying float vPower;
  varying vec2 vSheet;

  const vec3 SCAN = vec3(0.05, 0.38, 1.0);
  // Ice blue, not white: white is the colour of selection rings and health bars.
  const vec3 SCAN_CORE = vec3(0.62, 0.9, 1.0);

  void main() {
    vec3 light;
    float cover;
    float hum = 0.9 + 0.1 * sin(time * 53.0 + vSeed * 30.0) * sin(time * 37.0 + vSeed * 11.0);
    if (vPart < 0.5) {
      float across = vSheet.x / max(vSheet.y, 0.0001);
      // The light is fine rays that shimmer in place. Anything travelling down the sheet would
      // read as the drone sending something into the building.
      float rays = 0.72 + 0.28 * sin(across * 41.0 + vSeed * 40.0) * sin(time * 7.0 + across * 13.0 + vSeed * 9.0);
      // It thins as it spreads, and gathers a little toward its edges.
      float sheet = (0.17 + 0.08 * pow(abs(across), 4.0)) * rays * mix(1.0, 0.55, vSheet.y) * hum;
      // The sheet tints what is behind it more than it adds light to it. Added light turns white
      // over the cream hull, shows only in dark recesses, and several drones' sheets would add up
      // to a white blot.
      light = SCAN * sheet * 0.8;
      cover = sheet * 1.3;
    } else if (vPart < 1.5) {
      // The line is the brightest part: it is what the scanner reads.
      float offAxis = abs(vCorner.x) * 0.2;
      float core = exp(-offAxis * offAxis / (0.022 * 0.022));
      float halo = exp(-offAxis * offAxis / (0.075 * 0.075)) * hum;
      // It ends softly, not in a square cut.
      float ends = 1.0 - smoothstep(0.9, 1.0, abs(vCorner.y));
      light = (SCAN_CORE * core + SCAN * halo * 0.85) * ends;
      cover = max(core * 0.9, halo * 0.6) * ends;
    } else if (vPart < 3.5) {
      // The edges only outline the sheet: as bright as the line, they make it a blue shard.
      float offAxis = abs(vCorner.x) * 0.07;
      float core = exp(-offAxis * offAxis / (0.008 * 0.008));
      float halo = exp(-offAxis * offAxis / (0.024 * 0.024)) * hum;
      light = SCAN_CORE * core * 0.3 + SCAN * halo * 0.35;
      cover = max(core * 0.3, halo * 0.35);
    } else {
      float radius = length(vCorner);
      float glow = pow(max(0.0, 1.0 - radius), 2.2) * hum;
      float center = 1.0 - smoothstep(0.08, 0.3, radius);
      light = SCAN * glow * 0.7 + SCAN_CORE * center * 0.6;
      cover = max(center * 0.5, glow * 0.3);
    }
    gl_FragColor = vec4(light, cover) * vPower;
    #include <colorspace_fragment>
  }
`;

/**
 * A building drone's scanning laser: a thin sheet of blue light that fans out from the nozzle
 * and draws a bright line across the deck. `fire` takes the nozzle and the line's two ends.
 */
export const scanLook: LaserLook = { name: "Scout scanning lasers", parts: 5, vertexShader, fragmentShader };
