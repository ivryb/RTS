"""Shared steps for the wrecks and ruins of the death effects: burn shading and the colour-only bake.

The game draws every wreck of one model as instances of one mesh, so the unit wrecks carry one
small base-colour atlas and nothing else. The ruins use the full PBR baker in building_bake.py.
`docs/death_effects.md` says how an accepted GLB reaches the game.
"""
import math
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT/'art/workbench/death-wreck'

SOOT = (.014, .012, .011)
BURNT_METAL = (.085, .036, .018)
SAND_DUST = (.30, .22, .13)


class Graph:
    """Wires colour maths into one material. Arguments are sockets, numbers or RGB tuples."""

    def __init__(self, material):
        self.nodes, self.links = material.node_tree.nodes, material.node_tree.links
        self.coords = self.nodes.new('ShaderNodeTexCoord')

    def _set(self, socket, value):
        if isinstance(value, bpy.types.NodeSocket):
            self.links.new(value, socket)
        elif isinstance(value, (int, float)):
            socket.default_value = value
        else:
            socket.default_value = (*value, 1)

    def mix(self, a, b, factor, blend='MIX'):
        node = self.nodes.new('ShaderNodeMix')
        node.data_type, node.blend_type = 'RGBA', blend
        for index, value in [(0, factor), (6, a), (7, b)]:
            self._set(node.inputs[index], value)
        return node.outputs[2]

    def remap(self, value, low, high):
        node = self.nodes.new('ShaderNodeMapRange')
        node.clamp = True
        self.links.new(value, node.inputs[0])
        node.inputs[1].default_value, node.inputs[2].default_value = low, high
        return node.outputs[0]

    def noise(self, scale, low, high, offset=0.0):
        """Blotches fixed to the object, 0 below `low` and 1 above `high` of the noise value."""
        mapping = self.nodes.new('ShaderNodeMapping')
        mapping.inputs['Location'].default_value = (offset, offset*.37, offset*.71)
        self.links.new(self.coords.outputs['Object'], mapping.inputs['Vector'])
        node = self.nodes.new('ShaderNodeTexNoise')
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = 5
        node.inputs['Roughness'].default_value = .6
        self.links.new(mapping.outputs[0], node.inputs['Vector'])
        return self.remap(node.outputs[0], low, high)

    def height(self, low, high):
        split = self.nodes.new('ShaderNodeSeparateXYZ')
        self.links.new(self.coords.outputs['Object'], split.inputs[0])
        return self.remap(split.outputs['Z'], low, high)

    def faded(self, color, saturation, value):
        node = self.nodes.new('ShaderNodeHueSaturation')
        node.inputs['Saturation'].default_value, node.inputs['Value'].default_value = saturation, value
        self._set(node.inputs['Color'], color)
        return node.outputs[0]

    def scaled(self, value, factor):
        node = self.nodes.new('ShaderNodeMath')
        node.operation = 'MULTIPLY'
        self.links.new(value, node.inputs[0])
        node.inputs[1].default_value = factor
        return node.outputs[0]

    def radius(self, low, high):
        """Distance from the model's vertical axis, 0 inside `low` and 1 beyond `high`."""
        flat = self.nodes.new('ShaderNodeVectorMath')
        flat.operation = 'MULTIPLY'
        self.links.new(self.coords.outputs['Object'], flat.inputs[0])
        flat.inputs[1].default_value = (1, 1, 0)
        length = self.nodes.new('ShaderNodeVectorMath')
        length.operation = 'LENGTH'
        self.links.new(flat.outputs['Vector'], length.inputs[0])
        return self.remap(length.outputs['Value'], low, high)

    def skyward(self):
        """1 on faces that look straight up, 0 on walls and undersides."""
        split = self.nodes.new('ShaderNodeSeparateXYZ')
        self.links.new(self.nodes.new('ShaderNodeNewGeometry').outputs['Normal'], split.inputs[0])
        return self.remap(split.outputs['Z'], .35, .95)

    def edges(self, width):
        """1 along outward edges and corners, fading to 0 `width` into a face: where a plate chips."""
        node = self.nodes.new('ShaderNodeAmbientOcclusion')
        node.inside, node.only_local, node.samples = True, True, 8
        node.inputs['Distance'].default_value = width
        return self.remap(node.outputs['AO'], .9, .5)

    def occlusion(self, distance, floor=.35):
        node = self.nodes.new('ShaderNodeAmbientOcclusion')
        node.samples = 8
        node.inputs['Distance'].default_value = distance
        lift = self.nodes.new('ShaderNodeMapRange')
        self.links.new(node.outputs['AO'], lift.inputs[0])
        lift.inputs[3].default_value = floor
        return lift.outputs[0]

    def emit(self, color):
        """Sends `color` straight to the surface, which is what the colour bake records."""
        emission = self.nodes.new('ShaderNodeEmission')
        self._set(emission.inputs['Color'], color)
        output = next(node for node in self.nodes if node.type == 'OUTPUT_MATERIAL')
        self.links.new(emission.outputs[0], output.inputs['Surface'])


def base_color(material):
    """The socket or colour feeding a Principled material's base colour."""
    socket = material.node_tree.nodes['Principled BSDF'].inputs['Base Color']
    return socket.links[0].from_socket if socket.is_linked else tuple(socket.default_value)[:3]


def burnt(graph, material, size, soot, seed, floor, dust, paint=.42):
    """The burnt-out version of a material's colour: faded paint under soot, heat-stained metal,
    sand gathering at the ground line. `size` sets the width of the blotches (a unit's height),
    `floor` is the ground's Z, `dust` how far up the sand reaches as a share of `size`, and
    `paint` how bright the surviving paint stays."""
    faded = graph.faded(base_color(material), .45, paint)
    scorched = graph.mix(faded, BURNT_METAL, graph.noise(2.2/size, .46, .62, seed + 3.1))
    charred = graph.mix(scorched, SOOT, graph.noise(1.5/size, soot - .1, soot + .1, seed))
    return graph.mix(SAND_DUST, charred, graph.height(floor - .02*size, floor + dust*size))


def burn(material, size, soot=.5, seed=0.0, floor=0.0, dust=.16, paint=.42):
    """Makes the material emit its burnt colour with contact shading, ready for bake_color."""
    graph = Graph(material)
    graph.emit(graph.mix(burnt(graph, material, size, soot, seed, floor, dust, paint), graph.occlusion(.35*size), 1,
                         'MULTIPLY'))


def scorched(material, size, soot, seed=0.0, dust=.08, paint=.62):
    """A burnt copy of a palette material that still bakes through building_bake."""
    copy = material.copy()
    shader = copy.node_tree.nodes['Principled BSDF']
    copy.node_tree.links.new(burnt(Graph(copy), copy, size, soot, seed, 0, dust, paint), shader.inputs['Base Color'])
    return copy


def positions(obj):
    array = np.empty(len(obj.data.vertices)*3, dtype=np.float32)
    obj.data.vertices.foreach_get('co', array)
    return array.reshape((-1, 3))


def set_positions(obj, array):
    obj.data.vertices.foreach_set('co', array.astype(np.float32).ravel())
    obj.data.update()


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_modifier(obj, modifier):
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def dent(obj, depth, scale, weights=None):
    """Pushes the surface in and out along its normals by up to `depth`."""
    texture = bpy.data.textures.new('Dents', 'CLOUDS')
    texture.noise_scale = scale
    modifier = obj.modifiers.new('Dents', 'DISPLACE')
    modifier.texture, modifier.texture_coords = texture, 'LOCAL'
    modifier.strength, modifier.mid_level = depth*2, .5
    if weights is not None:
        group = obj.vertex_groups.new(name='Dent weight')
        for index, weight in enumerate(weights):
            group.add([index], float(weight), 'REPLACE')
        modifier.vertex_group = group.name
    apply_modifier(obj, modifier)


def decimate(obj, triangles):
    obj.data.calc_loop_triangles()
    modifier = obj.modifiers.new('Reduce', 'DECIMATE')
    modifier.ratio = min(1, triangles/len(obj.data.loop_triangles))
    apply_modifier(obj, modifier)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(38))


def bake_color(obj, size, name):
    """Bakes what the object's materials emit into one new atlas and leaves a single plain material."""
    activate(obj)
    source_uv = obj.data.uv_layers.active or (obj.data.uv_layers[0] if obj.data.uv_layers else None)
    if source_uv:
        # Source textures keep reading their own layout while the bake writes the new one.
        for material in obj.data.materials:
            nodes, links = material.node_tree.nodes, material.node_tree.links
            pin = nodes.new('ShaderNodeUVMap')
            pin.uv_map = source_uv.name
            for node in nodes:
                if node.type == 'TEX_IMAGE' and not node.inputs['Vector'].is_linked:
                    links.new(pin.outputs['UV'], node.inputs['Vector'])
    atlas = obj.data.uv_layers.new(name='WreckUV')
    obj.data.uv_layers.active = atlas
    atlas.active_render = True
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=.006, area_weight=1)
    bpy.ops.object.mode_set(mode='OBJECT')
    image = bpy.data.images.new(name+'-color', width=size, height=size, alpha=False)
    for material in obj.data.materials:
        target = material.node_tree.nodes.new('ShaderNodeTexImage')
        target.image = image
        material.node_tree.nodes.active = target
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.bake.margin = 6
    scene.render.bake.use_selected_to_active = False
    print(f'BAKE {name}', flush=True)
    bpy.ops.object.bake(type='EMIT', uv_layer='WreckUV')
    image.pack()
    runtime = bpy.data.materials.new(name)
    runtime.use_nodes = True
    shader = runtime.node_tree.nodes['Principled BSDF']
    texture = runtime.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    runtime.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value = .9
    shader.inputs['Metallic'].default_value = .12
    obj.data.materials.clear()
    obj.data.materials.append(runtime)
    for polygon in obj.data.polygons:
        polygon.material_index = 0
    for layer in [layer for layer in obj.data.uv_layers if layer.name != 'WreckUV']:
        obj.data.uv_layers.remove(layer)


def export(objects, name):
    """Writes the objects as `<name>.glb` to the workbench and returns a line for the build report."""
    OUTPUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    path = OUTPUT/f'{name}.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_animations=False, export_image_format='WEBP',
                              export_image_quality=85)
    triangles = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    return {'file': path.name, 'triangles': triangles, 'bytes': path.stat().st_size}


def preview(objects, name, ground=None, turn=0.0):
    """Renders the objects on sand from the game's camera angle into art/workbench, for a quick look.
    The sand lies at `ground`, or under the lowest point when that is not given. `turn` is the yaw
    the game stands the model at, in radians."""
    low = np.min([np.array(obj.matrix_world) [:3, :3] @ corner + np.array(obj.matrix_world)[:3, 3]
                  for obj in objects for corner in np.array(obj.bound_box)], axis=0)
    high = np.max([np.array(obj.matrix_world)[:3, :3] @ corner + np.array(obj.matrix_world)[:3, 3]
                   for obj in objects for corner in np.array(obj.bound_box)], axis=0)
    centre, extent = (low + high)/2, float(np.max(high - low))
    bpy.ops.mesh.primitive_plane_add(size=extent*8, location=(centre[0], centre[1], low[2] if ground is None else ground))
    sand = bpy.context.object
    sand.data.materials.append(bpy.data.materials.new('Preview sand'))
    sand.active_material.use_nodes = True
    sand.active_material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.52, .38, .24, 1)
    helpers = [sand]
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(48), 0, math.radians(-58)))
    bpy.context.object.data.energy = 4
    helpers.append(bpy.context.object)
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    helpers.append(camera)
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = extent*1.7
    # The game looks down along (-46, -58, -46) in its Y-up frame, which is (-46, 46, -58) here.
    east, north = 46*math.cos(turn) - 46*math.sin(turn), -46*math.sin(turn) - 46*math.cos(turn)
    camera.location = (centre[0] + east, centre[1] + north, centre[2] + 58)
    direction = camera.location - type(camera.location)(centre)
    camera.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_x, scene.render.resolution_y = 800, 600
    world = scene.world or bpy.data.worlds.new('Preview sky')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.9, .82, .7, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .9
    folder = ROOT/'art/workbench/death-wreck/previews'
    folder.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(folder/f'{name}.png')
    bpy.ops.render.render(write_still=True)
    for helper in helpers:
        bpy.data.objects.remove(helper)
