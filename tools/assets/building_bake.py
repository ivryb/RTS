"""Bake the authored materials and contact shading into one portable GLB material."""
import math

import bpy
import numpy as np


def bake_runtime(objects, output, size=2048, name='Building'):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name+' / baked runtime'
    obj.data.uv_layers.active.name = 'SourceUV'
    materials = list(obj.data.materials)
    # Every source image must retain its original UVs while the bake writes the new atlas.
    for mat in materials:
        nodes = mat.node_tree.nodes
        uv = nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'SourceUV'
        for node in list(nodes):
            if node.type == 'TEX_IMAGE':
                mat.node_tree.links.new(uv.outputs['UV'], node.inputs['Vector'])
    atlas = obj.data.uv_layers.new(name='RuntimeUV')
    obj.data.uv_layers.active = atlas
    atlas.active_render = True
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=.003, area_weight=1)
    bpy.ops.object.mode_set(mode='OBJECT')
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.render.bake.margin = 8
    scene.render.bake.use_selected_to_active = False
    targets = []
    for mat in materials:
        node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        mat.node_tree.nodes.active = node
        targets.append(node)

    def bake_image(name, kind, color=False):
        print(f'BAKE {name}', flush=True)
        image = bpy.data.images.new(name, width=size, height=size, alpha=False, float_buffer=True)
        if not color:
            image.colorspace_settings.name = 'Non-Color'
        for mat, target in zip(materials, targets):
            target.image = image
            mat.node_tree.nodes.active = target
        bpy.ops.object.bake(type=kind, pass_filter={'COLOR'} if kind == 'DIFFUSE' else set(), uv_layer='RuntimeUV')
        return image

    # Diffuse baking attenuates metallic surfaces. Bake the actual base color through
    # emission so dark machinery retains its authored fine lines and worn edges.
    restore = []
    for mat in materials:
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        shader = nodes.get('Principled BSDF')
        output_node = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
        restore.append((mat, output_node, output_node.inputs['Surface'].links[0].from_socket))
        emit = nodes.new('ShaderNodeEmission')
        source = shader.inputs['Base Color']
        if source.is_linked:
            links.new(source.links[0].from_socket, emit.inputs['Color'])
        else:
            emit.inputs['Color'].default_value = source.default_value
        links.new(emit.outputs[0], output_node.inputs['Surface'])
    base = bake_image('runtime-color', 'EMIT', True)
    for mat, node, socket in restore:
        mat.node_tree.links.new(socket, node.inputs['Surface'])
    normal = bake_image('runtime-normal', 'NORMAL')
    ao = bake_image('runtime-occlusion', 'AO')
    emission = bake_image('runtime-emission', 'EMIT', True)

    # Bake roughness and metallic into the standard glTF G/B channels.
    outputs = []
    for mat in materials:
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        shader = nodes.get('Principled BSDF')
        output_node = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
        outputs.append((mat, output_node, output_node.inputs['Surface'].links[0].from_socket))
        channels = nodes.new('ShaderNodeCombineColor')
        channels.inputs['Red'].default_value = 1
        for name, channel in [('Roughness', 'Green'), ('Metallic', 'Blue')]:
            source = shader.inputs[name]
            if source.is_linked:
                links.new(source.links[0].from_socket, channels.inputs[channel])
            else:
                channels.inputs[channel].default_value = source.default_value
        emit = nodes.new('ShaderNodeEmission')
        links.new(channels.outputs[0], emit.inputs['Color'])
        links.new(emit.outputs[0], output_node.inputs['Surface'])
    orm = bake_image('runtime-orm', 'EMIT')
    for mat, node, socket in outputs:
        mat.node_tree.links.new(socket, node.inputs['Surface'])

    def pixels(image):
        array = np.empty(size * size * 4, dtype=np.float32)
        image.pixels.foreach_get(array)
        return array.reshape((-1, 4))

    contact = np.clip(pixels(ao)[:, 0], 0, 1)
    # The game uses directional lighting without baked contact shadows. Preserve that
    # crevice depth in the diffuse map, as in the Meshy reference, without baking a sun.
    colors = pixels(base)
    colors[:, :3] *= (.65 + .35 * contact[:, None])
    base.pixels.foreach_set(colors.ravel())
    channels = pixels(orm)
    channels[:, 0] = contact
    orm.pixels.foreach_set(channels.ravel())
    for image in [base, normal, orm, emission]:
        image.filepath_raw = str(output / (image.name + '.png'))
        image.file_format = 'PNG'
        image.save()
        image.pack()

    runtime = bpy.data.materials.new(name+' / baked PBR')
    runtime.use_nodes = True
    nodes, links = runtime.node_tree.nodes, runtime.node_tree.links
    shader = nodes.get('Principled BSDF')

    def texture(image):
        node = nodes.new('ShaderNodeTexImage')
        node.image = image
        return node

    links.new(texture(base).outputs['Color'], shader.inputs['Base Color'])
    normal_node = nodes.new('ShaderNodeNormalMap')
    links.new(texture(normal).outputs['Color'], normal_node.inputs['Color'])
    links.new(normal_node.outputs['Normal'], shader.inputs['Normal'])
    separate = nodes.new('ShaderNodeSeparateColor')
    links.new(texture(orm).outputs['Color'], separate.inputs['Color'])
    links.new(separate.outputs['Green'], shader.inputs['Roughness'])
    links.new(separate.outputs['Blue'], shader.inputs['Metallic'])
    links.new(texture(emission).outputs['Color'], shader.inputs['Emission Color'])
    shader.inputs['Emission Strength'].default_value = 1
    # Occlusion is already included in base color; the unused R channel remains available.
    obj.data.materials.clear()
    obj.data.materials.append(runtime)
    for polygon in obj.data.polygons:
        polygon.material_index = 0
    obj.data.uv_layers.remove(obj.data.uv_layers['SourceUV'])
    return obj
