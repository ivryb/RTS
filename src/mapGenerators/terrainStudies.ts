import type { Point } from './types';

import type { Site } from './types';
export type { Site } from './types';
type Landmass = { vertices: Point[]; height: number; blocked: boolean };
type Ramp = { a: Point; b: Point; low: number; high: number; width: number; height: number };
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function signedDistance(x: number, z: number, vertices: Point[]) {
  let inside = false, distance = Infinity;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i], b = vertices[j];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz));
    distance = Math.min(distance, Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside ? distance : -distance;
}

/** Two gameplay grammars: protected elevated starts, or low starts around a contested plateau. */
function createBattlefield(seed: number, mode: 'mesas' | 'canyons') {
  const hash = (x: number, z: number) => {
    let value = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  };
  const noise = (x: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z), u = smooth(0, 1, x - ix), v = smooth(0, 1, z - iz);
    return (hash(ix, iz) * (1 - u) + hash(ix + 1, iz) * u) * (1 - v)
      + (hash(ix, iz + 1) * (1 - u) + hash(ix + 1, iz + 1) * u) * v;
  };
  const quarter = Math.floor(hash(13, 71) * 4), mirror = hash(41, 5) > .5 ? 1 : -1;
  const world = (p: Point): Point => {
    let x = p.x * mirror, z = p.z;
    for (let i = 0; i < quarter; i++) [x, z] = [-z, x];
    return { x, z };
  };
  const local = (x: number, z: number) => {
    for (let i = 0; i < quarter; i++) [x, z] = [z, -x];
    return { x: x * mirror, z };
  };
  const masses: Landmass[] = [], ramps: Ramp[] = [], sites: Site[] = [];
  const scale = .92 + hash(4, 13) * .13;
  const bendX=(hash(8,19)-.5)*15,bendZ=(hash(19,8)-.5)*12;
  const point = (x: number, z: number): Point => ({
    x:x*scale+Math.sin(z*.024)*bendX,
    z:z*scale+Math.sin(x*.024)*bendZ,
  });
  const addMass = (coordinates: number[][], height: number, blocked = false, sign = 1) => {
    // Coarse correlated displacement changes coastlines without adding obstacles to the plateau.
    const vertices = coordinates.map(([x, z]) => point(x * sign, z * sign));
    masses.push({ vertices, height, blocked });
  };
  const addRamp = (ax: number, az: number, bx: number, bz: number, low: number, high: number, width: number, sign = 1) => {
    ramps.push({ a: point(ax * sign, az * sign), b: point(bx * sign, bz * sign), low, high, width, height: Math.abs(high - low) });
  };
  const addSite = (x: number, z: number, label: string, role: Site['role'], player: Site['player']) => {
    sites.push({ ...world(point(x, z)), label, role, player });
  };
  const wide = hash(23, 91) > .5;
  if (mode === 'mesas') {
    for (const sign of [1, -1]) {
      // Main and natural merge into a continuous two-level peninsula backed by the map edge.
      addMass([[-128,-128],[-21,-128],[-21,-85],[-30,-66],[-27,-43],[-43,-15],[-74,-11],[-128,-28]], 9, false, sign);
      addMass([[-128,-128],[-39,-128],[-37,-88],[-45,-69],[-45,-42],[-76,-35],[-128,-51]], 18, false, sign);
      addRamp(-63,-58,-55,-23,18,9,13,sign);
      addRamp(-46,-32,-14,-16,9,0,wide?17:13,sign);
      addRamp(-84,-23,-85,12,9,0,13,sign);
      addRamp(-31,-87,7,-90,9,0,12,sign);
      // Rock spines divide the central attack path from the outer expansion loop.
      const shift = (hash(5, 83) - .5) * 14;
      addMass([[2+shift,-77],[23+shift,-82],[41+shift,-74],[42+shift,-52],[30+shift,-37],[17+shift,-46],[16+shift,-68],[-1+shift,-79]], 22, true, sign);
      addMass([[68,-128],[128,-128],[128,-33],[103,-38],[97,-67],[81,-82]], 25, true, sign);
    }
    addSite(-83,-79,'Base A','base',1); addSite(83,79,'Base B','base',2);
    addSite(-73,-22,'Natural A','expansion',1); addSite(73,22,'Natural B','expansion',2);
    addSite(-81,36,'Third A','expansion',1); addSite(81,-36,'Third B','expansion',2);
    addSite(-61,75,'Outer supply','contest',0); addSite(61,-75,'Outer supply','contest',0);
    addSite(0,0,'Crossroads','contest',0);
  } else {
    const stretch = wide ? 1.12 : .90;
    const crown = [[-37,-23],[-17,-43],[10,-39],[31,-23],[36,3],[23,29],[0,40],[-29,25],[-40,3]];
    addMass(crown.map(([x,z])=>[x*stretch,z]),10);
    addRamp(-63,-20,-21,-17,0,10,wide?18:14);
    addRamp(63,20,21,17,0,10,wide?18:14);
    if (wide) {
      addRamp(-4,-66,-4,-24,0,10,12);
      addRamp(4,66,4,24,0,10,12);
    }
    for (const sign of [1,-1]) {
      // Secondary high ground has a role and an entrance; it is not a decorative mound.
      addMass([[42,-103],[78,-109],[105,-90],[102,-55],[81,-45],[60,-55],[48,-76]],7,false,sign);
      addRamp(70,-25,77,-65,0,7,15,sign);
      addMass([[-128,-128],[8,-128],[-4,-101],[-30,-98],[-48,-104],[-92,-102],[-108,-79],[-128,-65]],23,true,sign);
      addMass([[-113,-47],[-93,-36],[-83,-16],[-90,2],[-106,8],[-128,-6],[-128,-42]],19,true,sign);
      addMass([[-40,44],[-25,55],[-28,70],[-39,77],[-44,66],[-44,53]],18,true,sign);
    }
    addSite(-73,-69,'Base A','base',1); addSite(73,69,'Base B','base',2);
    addSite(-67,-39,'Natural A','expansion',1); addSite(67,39,'Natural B','expansion',2);
    addSite(-70,19,'West supply','expansion',0); addSite(70,-19,'East supply','expansion',0);
    addSite(78,-80,'High supply','contest',0); addSite(-78,80,'High supply','contest',0);
    addSite(0,0,'Central plateau','contest',0);
  }
  const warping = (x: number, z: number) => {
    // Rotation symmetry preserves corresponding approach distances for the two players.
    const sign = x < 0 || (x === 0 && z < 0) ? -1 : 1;
    const u=x*sign,v=z*sign;
    const fade=smooth(0,12,Math.abs(x));
    return { x:x+(noise(u*.035+37,v*.035)-.5)*4*sign*fade,
      z:z+(noise(u*.035,v*.035+51)-.5)*4*sign*fade };
  };
  const rampInfluence = (p: Point, ramp: Ramp) => {
    const dx=ramp.b.x-ramp.a.x,dz=ramp.b.z-ramp.a.z,length=Math.hypot(dx,dz);
    const along=((p.x-ramp.a.x)*dx+(p.z-ramp.a.z)*dz)/length;
    const across=Math.abs((p.x-ramp.a.x)*dz-(p.z-ramp.a.z)*dx)/length;
    const weight=(1-smooth(ramp.width/2,ramp.width/2+2,across))*smooth(-3,0,along)*(1-smooth(length,length+3,along));
    return {weight,height:ramp.low+(ramp.high-ramp.low)*smooth(0,length,along)};
  };
  const sample = (x: number,z: number) => {
    const p=local(x,z),w=warping(p.x,p.z);
    let height=0;
    for(const mass of masses) {
      const d=signedDistance(w.x,w.z,mass.vertices);
      if(d < -3)continue;
      let h=mass.height*smooth(-1.2,2.1,d);
      if(mass.blocked) h=mass.height*smooth(-1.2,11,d)+(2+noise(Math.abs(p.x)*.04,Math.abs(p.z)*.04)*4)*smooth(2,10,d);
      height=Math.max(height,h);
    }
    for(const ramp of ramps) {
      const {weight,height:target}=rampInfluence(p,ramp);
      height=height*(1-weight)+target*weight;
    }
    return height+.10*noise(Math.abs(p.x)*.025,Math.abs(p.z)*.025);
  };
  const blocked = (x: number,z: number) => {
    const p=local(x,z),w=warping(p.x,p.z);
    return masses.some(m=>m.blocked&&signedDistance(w.x,w.z,m.vertices)>-1);
  };
  const starts=sites.filter(s=>s.role==='base');
  const points=sites.map(({x,z})=>({x,z}));
  const ascents=ramps.map(r=>({...r,a:world(r.a),b:world(r.b)}));
  return { sample,blocked,noise,hash,points,clearings:points.map(p=>({...p,radius:12})),
    starts,channels:[],ascents,sites,seed,mode,layout:wide?'wide approaches':'narrow approaches' };
}

export const createStrongholds = (seed: number) => createBattlefield(seed,'mesas');
export const createCrossroads = (seed: number) => createBattlefield(seed,'canyons');
