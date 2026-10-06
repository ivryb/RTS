// Offline rock LOD: keep scan boundaries and original vertex attributes intact.
// Called by prepare_terrain_runtime.py with an isolated meshoptimizer install.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const [modulePath, file, targetTriangles] = process.argv.slice(2);
const { MeshoptSimplifier } = await import(pathToFileURL(modulePath).href);
await MeshoptSimplifier.ready;

const source = fs.readFileSync(file);
const jsonLength = source.readUInt32LE(12);
const document = JSON.parse(source.subarray(20, 20 + jsonLength));
const binary = source.subarray(28 + jsonLength);
const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
const additions = [];
let binaryLength = binary.length;

function readAccessor(index) {
  const accessor = document.accessors[index];
  const view = document.bufferViews[accessor.bufferView];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const bytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
  const read = { 5121: 'getUint8', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[accessor.componentType];
  const values = accessor.componentType === 5126
    ? new Float32Array(accessor.count * components)
    : new Uint32Array(accessor.count * components);
  for (let row = 0; row < accessor.count; row++) {
    for (let component = 0; component < components; component++) {
      values[row * components + component] = data[read](
        start + row * (view.byteStride ?? components * bytes) + component * bytes, true,
      );
    }
  }
  return values;
}

for (const mesh of document.meshes) {
  for (const primitive of mesh.primitives) {
    const indices = readAccessor(primitive.indices);
    const positions = readAccessor(primitive.attributes.POSITION);
    const normals = readAccessor(primitive.attributes.NORMAL);
    const uv = readAccessor(primitive.attributes.TEXCOORD_0);
    const attributes = new Float32Array(positions.length / 3 * 5);
    for (let vertex = 0; vertex < positions.length / 3; vertex++) {
      attributes.set(normals.subarray(vertex * 3, vertex * 3 + 3), vertex * 5);
      attributes.set(uv.subarray(vertex * 2, vertex * 2 + 2), vertex * 5 + 3);
    }
    // The scans contain small open seams. Ordinary collapse expands those holes;
    // locked borders retain them exactly, while UV/normal error protects shading.
    const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(
      indices, positions, 3, attributes, 5, [0.1, 0.1, 0.1, 0.3, 0.3], null,
      Number(targetTriangles) * 3, 0.025, ['LockBorder'],
    );
    const padding = Buffer.alloc((4 - binaryLength % 4) % 4);
    additions.push(padding);
    binaryLength += padding.length;
    document.bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: reduced.byteLength });
    document.accessors.push({
      bufferView: document.bufferViews.length - 1, componentType: 5125,
      count: reduced.length, type: 'SCALAR',
    });
    primitive.indices = document.accessors.length - 1;
    additions.push(Buffer.from(reduced.buffer));
    binaryLength += reduced.byteLength;
    console.log(`${mesh.name}: ${indices.length / 3} → ${reduced.length / 3} triangles, error ${error.toFixed(5)}`);
  }
}

document.buffers[0].byteLength = binaryLength;
const encoded = Buffer.from(JSON.stringify(document));
const json = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
const outputBinary = Buffer.concat([binary, ...additions, Buffer.alloc((4 - binaryLength % 4) % 4)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + json.length + outputBinary.length, 8);
header.writeUInt32LE(json.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const binaryHeader = Buffer.alloc(8);
binaryHeader.writeUInt32LE(outputBinary.length, 0);
binaryHeader.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(file, Buffer.concat([header, json, binaryHeader, outputBinary]));
