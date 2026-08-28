"""Split and texture the two outer tread loops from a Meshy Behemoth export."""

import os
import sys

import bmesh
import bpy
from mathutils import Vector


source, blend, output, preview = sys.argv[sys.argv.index("--") + 1 :]
texture_size = 1024


def connected_components(mesh):
    vertex_faces = [[] for _ in mesh.vertices]
    for polygon in mesh.polygons:
        for vertex in polygon.vertices:
            vertex_faces[vertex].append(polygon.index)

    remaining = set(range(len(mesh.polygons)))
    components = []
    while remaining:
        seed = remaining.pop()
        faces = {seed}
        pending = [seed]
        while pending:
            polygon = mesh.polygons[pending.pop()]
            for vertex in polygon.vertices:
                for neighbor in vertex_faces[vertex]:
                    if neighbor in remaining:
                        remaining.remove(neighbor)
                        faces.add(neighbor)
                        pending.append(neighbor)

        vertices = {
            vertex
            for face in faces
            for vertex in mesh.polygons[face].vertices
        }
        points = [mesh.vertices[index].co for index in vertices]
        minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
        maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
        components.append(
            {
                "faces": faces,
                "center": (minimum + maximum) / 2,
                "dimensions": maximum - minimum,
            }
        )
    return components


def extract_faces(source_object, face_indices, name):
    result = source_object.copy()
    result.data = source_object.data.copy()
    result.name = name
    result.data.name = f"{name}Mesh"
    bpy.context.scene.collection.objects.link(result)

    mesh = bmesh.new()
    mesh.from_mesh(result.data)
    mesh.faces.ensure_lookup_table()
    bmesh.ops.delete(
        mesh,
        geom=[face for face in mesh.faces if face.index not in face_indices],
        context="FACES",
    )
    mesh.to_mesh(result.data)
    mesh.free()
    result.data.update()
    return result


def create_track_texture():
    width, height = 128, 64
    image = bpy.data.images.new("track-scroll", width=width, height=height, alpha=False)
    pixels = []
    for y in range(height):
        across = y / (height - 1)
        edge = min(across, 1 - across)
        for x in range(width):
            along = x / width
            seam = min(along, 1 - along)
            value = 0.17
            if seam > 0.075 and edge > 0.08:
                value = 0.36 + 0.05 * (1 - abs(along - 0.5) * 2)
            if seam < 0.03 or edge < 0.035:
                value = 0.052
            rivet = min(
                (along - 0.5) ** 2 + (across - 0.16) ** 2,
                (along - 0.5) ** 2 + (across - 0.84) ** 2,
            )
            if rivet < 0.0022:
                value = 0.5
            pixels.extend((value * 0.92, value * 0.89, value * 0.82, 1.0))
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


def apply_track_material(belt, material):
    mesh = belt.data
    uv = mesh.uv_layers.new(name="TrackUV")
    minimum_x = min(vertex.co.x for vertex in mesh.vertices)
    maximum_x = max(vertex.co.x for vertex in mesh.vertices)
    width = maximum_x - minimum_x
    rear_y = min(vertex.co.y for vertex in mesh.vertices)
    front_y = max(vertex.co.y for vertex in mesh.vertices)
    bottom_z = min(vertex.co.z for vertex in mesh.vertices)
    top_z = max(vertex.co.z for vertex in mesh.vertices)
    length = front_y - rear_y
    height = top_z - bottom_z

    def distance_along_loop(point):
        distances = (
            abs(point.z - top_z),
            abs(point.y - front_y),
            abs(point.z - bottom_z),
            abs(point.y - rear_y),
        )
        edge = min(range(4), key=distances.__getitem__)
        if edge == 0:
            return point.y - rear_y
        if edge == 1:
            return length + top_z - point.z
        if edge == 2:
            return length + height + front_y - point.y
        return length * 2 + height + point.z - bottom_z

    for loop in mesh.loops:
        point = mesh.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (
            distance_along_loop(point) / 0.105,
            (point.x - minimum_x) / width,
        )
    mesh.uv_layers.active = uv
    uv.active_render = True
    mesh.materials.clear()
    mesh.materials.append(material)


def create_track_material(image):
    material = bpy.data.materials.new("BehemothTrackBelt")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.extension = "REPEAT"
    texture.interpolation = "Linear"
    shader.inputs["Metallic"].default_value = 0.45
    shader.inputs["Roughness"].default_value = 0.55
    material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def linked_images(socket, visited=None):
    visited = visited or set()
    images = set()
    for link in socket.links:
        node = link.from_node
        if node in visited:
            continue
        visited.add(node)
        if node.type == "TEX_IMAGE" and node.image:
            images.add(node.image)
        else:
            for input_socket in node.inputs:
                images.update(linked_images(input_socket, visited))
    return images


def grade_body_base_color(image):
    pixels = list(image.pixels[:])
    for index in range(0, len(pixels), 4):
        red, green, blue = pixels[index:index + 3]
        luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
        light = min(max((luminance - 0.32) / 0.45, 0), 1)
        dark = min(max((0.28 - luminance) / 0.22, 0), 1)
        shade = 1 - dark * 0.1
        pixels[index] = min(red * shade * (1 + light * 0.03), 1)
        pixels[index + 1] = min(green * shade * (1 + light * 0.012), 1)
        pixels[index + 2] = min(blue * shade * (1 - light * 0.06), 1)
    image.pixels.foreach_set(pixels)


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if len(meshes) != 1:
    raise RuntimeError(f"Expected one Behemoth mesh, found {len(meshes)}")

source_object = meshes[0]
components = connected_components(source_object.data)
belts = [
    component
    for component in components
    if component["dimensions"].x > 0.08
    and abs(component["center"].x) > 0.2
    and component["center"].z < -0.08
]
negative_parts = [component["faces"] for component in belts if component["center"].x < 0]
positive_parts = [component["faces"] for component in belts if component["center"].x > 0]
if not negative_parts or not positive_parts:
    raise RuntimeError(f"Could not find mirrored belt surfaces among {len(belts)} candidates")

negative_faces = set().union(*negative_parts)
positive_faces = set().union(*positive_parts)
belt_faces = negative_faces | positive_faces
body_faces = set(range(len(source_object.data.polygons))) - belt_faces

root = bpy.data.objects.new("BehemothRoot", None)
bpy.context.scene.collection.objects.link(root)
body = extract_faces(source_object, body_faces, "BehemothBody")
negative_belt = extract_faces(source_object, negative_faces, "TrackBeltXNegative")
positive_belt = extract_faces(source_object, positive_faces, "TrackBeltXPositive")
for obj in (body, negative_belt, positive_belt):
    obj.parent = root
bpy.data.objects.remove(source_object, do_unlink=True)

track_image = create_track_texture()
track_material = create_track_material(track_image)
apply_track_material(negative_belt, track_material)
apply_track_material(positive_belt, track_material)

# Keep all used source maps but resize them for a browser-scale runtime asset.
used_images = {
    node.image
    for material in bpy.data.materials
    if material and material.use_nodes
    for node in material.node_tree.nodes
    if node.type == "TEX_IMAGE" and node.image
}
base_color_images = {
    image
    for material in bpy.data.materials
    if material and material.use_nodes
    for shader in material.node_tree.nodes
    if shader.type == "BSDF_PRINCIPLED"
    for image in linked_images(shader.inputs["Base Color"])
    if image != track_image
}
for image in used_images:
    width, height = image.size
    if image != track_image and max(width, height) > texture_size:
        scale = texture_size / max(width, height)
        image.scale(round(width * scale), round(height * scale))
    if image in base_color_images:
        grade_body_base_color(image)
    image.pack()
for image in list(bpy.data.images):
    if image not in used_images:
        bpy.data.images.remove(image)

os.makedirs(os.path.dirname(blend), exist_ok=True)
os.makedirs(os.path.dirname(output), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=blend)

bpy.ops.object.select_all(action="DESELECT")
for obj in (root, body, negative_belt, positive_belt):
    obj.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(
    filepath=output,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_image_format="WEBP",
    export_image_quality=80,
)

# Highlight the exact exported belt geometry in the QA render.
highlight = bpy.data.materials.new("TrackBeltSelection")
highlight.use_nodes = True
highlight_shader = highlight.node_tree.nodes.get("Principled BSDF")
highlight_shader.inputs["Base Color"].default_value = (0.55, 0.0, 0.025, 1.0)
highlight_shader.inputs["Metallic"].default_value = 0.1
highlight_shader.inputs["Roughness"].default_value = 0.5
for belt in (negative_belt, positive_belt):
    belt.data.materials.clear()
    belt.data.materials.append(highlight)

objects = (body, negative_belt, positive_belt)
corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
minimum = Vector(tuple(min(point[axis] for point in corners) for axis in range(3)))
maximum = Vector(tuple(max(point[axis] for point in corners) for axis in range(3)))
center = (minimum + maximum) / 2
extent = max(maximum - minimum)

bpy.ops.mesh.primitive_plane_add(size=extent * 5, location=(0, 0, minimum.z - extent * 0.015))
floor = bpy.context.object
floor.data.materials.append(bpy.data.materials.new("InspectionFloor"))
floor.active_material.diffuse_color = (0.12, 0.09, 0.06, 1)

for energy, offset, size in (
    (240, (extent, -extent, extent * 1.8), extent * 2.0),
    (100, (-extent, extent, extent), extent * 1.5),
):
    bpy.ops.object.light_add(type="AREA", location=center + Vector(offset))
    bpy.context.object.data.energy = energy
    bpy.context.object.data.shape = "DISK"
    bpy.context.object.data.size = size

bpy.ops.object.camera_add(location=center + Vector((extent * 1.35, -extent * 1.7, extent * 1.05)))
camera = bpy.context.object
camera.data.type = "ORTHO"
camera.data.ortho_scale = extent * 1.45
camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()

scene = bpy.context.scene
scene.camera = camera
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = preview
scene.world.color = (0.02, 0.025, 0.03)
scene.view_settings.look = "AgX - Medium High Contrast"
os.makedirs(os.path.dirname(preview), exist_ok=True)
bpy.ops.render.render(write_still=True)

print(
    f"BELTS components={len(belts)} faces={len(belt_faces)} "
    f"negative={len(negative_faces)} positive={len(positive_faces)}"
)
print(f"BODY faces={len(body_faces)} total={len(body_faces) + len(belt_faces)}")
print(f"OUTPUT {output} size={os.path.getsize(output)}")
print(f"BLEND {blend}")
print(f"PREVIEW {preview}")
