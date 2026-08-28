import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const [archive, output] = process.argv.slice(2);
if (!archive || !output) {
  throw new Error("Usage: node tools/assets/prepare_ghostrunner.mjs <meshy.zip|runtime.glb> <output.glb>");
}

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

const readGlb = (file) => {
  const data = readFileSync(file);
  if (data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2) {
    throw new Error(`${basename(file)} is not a glTF 2.0 binary`);
  }

  let json;
  let bin;
  for (let offset = 12; offset < data.length;) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(chunk.toString().trim());
    if (type === BIN_CHUNK) bin = chunk;
    offset += 8 + length;
  }
  if (!json || !bin) throw new Error(`${basename(file)} has no JSON or BIN chunk`);
  return { bin, json };
};

const writeGlb = (file, json, bin) => {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.alloc(Math.ceil(jsonBytes.length / 4) * 4, 0x20);
  jsonBytes.copy(paddedJson);
  const paddedBin = Buffer.alloc(Math.ceil(bin.length / 4) * 4);
  bin.copy(paddedBin);
  const outputBytes = Buffer.alloc(12 + 8 + paddedJson.length + 8 + paddedBin.length);
  outputBytes.writeUInt32LE(0x46546c67, 0);
  outputBytes.writeUInt32LE(2, 4);
  outputBytes.writeUInt32LE(outputBytes.length, 8);
  outputBytes.writeUInt32LE(paddedJson.length, 12);
  outputBytes.writeUInt32LE(JSON_CHUNK, 16);
  paddedJson.copy(outputBytes, 20);
  const binHeader = 20 + paddedJson.length;
  outputBytes.writeUInt32LE(paddedBin.length, binHeader);
  outputBytes.writeUInt32LE(BIN_CHUNK, binHeader + 4);
  paddedBin.copy(outputBytes, binHeader + 8);
  writeFileSync(file, outputBytes);
};

const rebaseHorizontalHipsMotion = (json, bin) => {
  const hips = json.nodes.findIndex((node) => node.name === "Hips");
  const bindPosition = json.nodes[hips]?.translation;
  if (hips < 0 || !bindPosition) throw new Error("Ghostrunner has no Hips bind position");

  let clips = 0;
  for (const animation of json.animations ?? []) {
    for (const channel of animation.channels) {
      if (channel.target.node !== hips || channel.target.path !== "translation") continue;
      const accessor = json.accessors[animation.samplers[channel.sampler].output];
      const view = json.bufferViews[accessor.bufferView];
      const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      const stride = view.byteStride ?? 12;
      const firstX = bin.readFloatLE(offset);
      const firstZ = bin.readFloatLE(offset + 8);
      for (let index = 0; index < accessor.count; index += 1) {
        const frame = offset + index * stride;
        bin.writeFloatLE(bindPosition[0] + bin.readFloatLE(frame) - firstX, frame);
        bin.writeFloatLE(bindPosition[2] + bin.readFloatLE(frame + 8) - firstZ, frame + 8);
      }
      clips += 1;
    }
  }
  return clips;
};

const cleanClipName = (name) => {
  const action = name.split("|")[1] ?? name;
  if (action === "running") return "Running";
  if (action === "walking_man") return "Walking";
  return action;
};

if (archive.endsWith(".glb")) {
  const { json, bin } = readGlb(archive);
  console.log(`REBASED ${rebaseHorizontalHipsMotion(json, bin)} clips`);
  writeGlb(output, json, bin);
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), "dune77-ghostrunner-"));
try {
  execFileSync("unzip", ["-q", archive, "-d", work]);
  const folder = join(work, readdirSync(work)[0]);
  const files = readdirSync(folder)
    .filter((file) => file.endsWith(".glb"))
    .map((file) => join(folder, file));
  const idleFile = files.find((file) => file.includes("Idle_6"));
  if (!idleFile) throw new Error("Archive does not contain an Idle_6 GLB");

  const base = readGlb(idleFile);
  const json = structuredClone(base.json);
  const nodeNames = JSON.stringify(json.nodes.map((node) => node.name));
  const joints = JSON.stringify(json.skins[0].joints);
  const image = json.images[0];
  const imageView = json.bufferViews[image.bufferView];
  const png = base.bin.subarray(
    imageView.byteOffset ?? 0,
    (imageView.byteOffset ?? 0) + imageView.byteLength,
  );
  const pngFile = join(work, "ghostrunner.png");
  const webpFile = join(work, "ghostrunner.webp");
  writeFileSync(pngFile, png);
  execFileSync("cwebp", ["-quiet", "-q", "88", "-sharp_yuv", pngFile, "-o", webpFile]);
  const webp = readFileSync(webpFile);

  const chunks = [];
  let byteLength = 0;
  const append = (bytes) => {
    const padding = (4 - byteLength % 4) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      byteLength += padding;
    }
    const offset = byteLength;
    chunks.push(bytes);
    byteLength += bytes.length;
    return offset;
  };

  json.bufferViews = json.bufferViews.map((view, index) => {
    const bytes = index === image.bufferView
      ? webp
      : base.bin.subarray(
        view.byteOffset ?? 0,
        (view.byteOffset ?? 0) + view.byteLength,
      );
    return { ...view, buffer: 0, byteLength: bytes.length, byteOffset: append(bytes) };
  });
  image.mimeType = "image/webp";
  image.name = "ghostrunner-texture";
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), "EXT_texture_webp"])];
  for (const texture of json.textures) {
    if (texture.source !== 0) continue;
    delete texture.source;
    texture.extensions = { ...texture.extensions, EXT_texture_webp: { source: 0 } };
  }
  for (const material of json.materials) {
    const pbr = material.pbrMetallicRoughness;
    pbr.baseColorFactor = [0.84, 0.76, 0.66, 1];
    pbr.metallicFactor = 0.2;
    pbr.roughnessFactor = 0.58;
    material.emissiveFactor = [0.5, 0.5, 0.5];
    const specular = material.extensions?.KHR_materials_specular;
    if (specular) {
      specular.specularFactor = 0.65;
      specular.specularColorFactor = [1, 1, 1];
    }
  }

  json.animations[0].name = "Idle_6";
  const animationFiles = files.filter((file) => file !== idleFile).sort();
  for (const file of animationFiles) {
    const source = readGlb(file);
    if (JSON.stringify(source.json.nodes.map((node) => node.name)) !== nodeNames) {
      throw new Error(`${basename(file)} has a different skeleton`);
    }
    if (JSON.stringify(source.json.skins[0].joints) !== joints) {
      throw new Error(`${basename(file)} has different skin joints`);
    }

    const animation = structuredClone(source.json.animations[0]);
    const viewMap = new Map();
    const accessorMap = new Map();
    const copyAccessor = (sourceIndex) => {
      if (accessorMap.has(sourceIndex)) return accessorMap.get(sourceIndex);
      const accessor = structuredClone(source.json.accessors[sourceIndex]);
      const sourceViewIndex = accessor.bufferView;
      if (!viewMap.has(sourceViewIndex)) {
        const sourceView = source.json.bufferViews[sourceViewIndex];
        const bytes = source.bin.subarray(
          sourceView.byteOffset ?? 0,
          (sourceView.byteOffset ?? 0) + sourceView.byteLength,
        );
        viewMap.set(sourceViewIndex, json.bufferViews.length);
        json.bufferViews.push({
          ...sourceView,
          buffer: 0,
          byteOffset: append(bytes),
        });
      }
      accessor.bufferView = viewMap.get(sourceViewIndex);
      const targetIndex = json.accessors.length;
      json.accessors.push(accessor);
      accessorMap.set(sourceIndex, targetIndex);
      return targetIndex;
    };

    for (const sampler of animation.samplers) {
      sampler.input = copyAccessor(sampler.input);
      sampler.output = copyAccessor(sampler.output);
    }
    animation.name = cleanClipName(animation.name);
    json.animations.push(animation);
  }

  json.buffers[0].byteLength = byteLength;
  const bin = Buffer.concat(chunks, byteLength);
  console.log(`REBASED ${rebaseHorizontalHipsMotion(json, bin)} clips`);
  writeGlb(output, json, bin);
  console.log(`WROTE ${output}`);
  console.log(`CLIPS ${json.animations.map((animation) => animation.name).join(", ")}`);
  console.log(`SIZE ${(readFileSync(output).length / 1024 / 1024).toFixed(2)} MB`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
