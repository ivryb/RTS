"""Warm Ghostrunner armor and isolate the sword's metallic response."""

import os
import sys

import bpy


blend, output = sys.argv[sys.argv.index("--") + 1 :]


def smoothstep(low, high, value):
    value = max(0.0, min(1.0, (value - low) / (high - low)))
    return value * value * (3.0 - 2.0 * value)


def linear_to_srgb(value):
    return 12.92 * value if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055


body = max(
    (obj for obj in bpy.context.scene.objects if obj.type == "MESH"),
    key=lambda obj: len(obj.data.polygons),
)
material = body.data.materials[0]
nodes = material.node_tree.nodes
links = material.node_tree.links
shader = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
base_link = next(iter(shader.inputs["Base Color"].links), None)
if not base_link or base_link.from_node.type != "TEX_IMAGE":
    raise RuntimeError("Ghostrunner base color is not a direct image texture")

base = base_link.from_node.image
if base.name != "ghostrunner-base-balanced":
    pixels = list(base.pixels)
    metal_roughness = bpy.data.images.new(
        "ghostrunner-metallic-roughness",
        width=base.size[0],
        height=base.size[1],
        alpha=True,
        is_data=True,
    )
    metal_pixels = [0.0] * len(pixels)
    metallic_pixel_count = 0
    for index in range(0, len(pixels), 4):
        r, g, b = (linear_to_srgb(pixels[index + channel]) for channel in range(3))
        brightness = max(r, g, b)
        chroma = brightness - min(r, g, b)
        metal = (
            smoothstep(0.58, 0.76, brightness)
            * (1 - smoothstep(0.045, 0.11, chroma))
            * smoothstep(-0.04, 0.01, b - r)
        )
        metal_pixels[index : index + 4] = (1.0, 0.62 - 0.40 * metal, 0.92 * metal, 1.0)
        metallic_pixel_count += metal >= 0.5

    base.name = "ghostrunner-base-balanced"
    base.pack()
    metal_roughness.pixels.foreach_set(metal_pixels)
    metal_roughness.colorspace_settings.name = "Non-Color"
    metal_roughness.pack()
else:
    metal_roughness = bpy.data.images["ghostrunner-metallic-roughness"]
    metallic_pixel_count = 0

for socket_name in ("Metallic", "Roughness"):
    socket = shader.inputs.get(socket_name)
    if socket:
        for link in list(socket.links):
            links.remove(link)
if not shader.inputs["Emission Color"].is_linked:
    links.new(base_link.from_node.outputs["Color"], shader.inputs["Emission Color"])
shader.inputs["Emission Strength"].default_value = 0.06
shader.inputs["Metallic"].default_value = 0
shader.inputs["Roughness"].default_value = 0.62

for node in list(nodes):
    if node.label == "Ghostrunner metal mask" or node.label == "Ghostrunner metal channels":
        nodes.remove(node)
metal_node = nodes.new("ShaderNodeTexImage")
metal_node.label = "Ghostrunner metal mask"
metal_node.image = metal_roughness
separate = nodes.new("ShaderNodeSeparateColor")
separate.label = "Ghostrunner metal channels"
links.new(metal_node.outputs["Color"], separate.inputs["Color"])
links.new(separate.outputs["Green"], shader.inputs["Roughness"])
links.new(separate.outputs["Blue"], shader.inputs["Metallic"])

bpy.ops.wm.save_as_mainfile(filepath=blend)
bpy.ops.export_scene.gltf(
    filepath=output,
    export_format="GLB",
    export_animations=True,
    export_skins=True,
    export_morph=True,
    export_yup=True,
    export_image_format="WEBP",
    export_image_quality=80,
)

print(
    f"GRADED images=2 metallic_pixels={metallic_pixel_count} "
    f"actions={len(bpy.data.actions)}"
)
print(f"OUTPUT {output} size={os.path.getsize(output)}")
print(f"BLEND {blend}")
