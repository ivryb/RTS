"""Shared procedural building finishes. Blender callers use create_materials()."""
from dataclasses import dataclass
import json
from pathlib import Path
import subprocess

import bpy


@dataclass(frozen=True)
class BuildingMaterials:
    armor: bpy.types.Material
    roof: bpy.types.Material
    machinery: bpy.types.Material
    structure: bpy.types.Material
    recess: bpy.types.Material
    indicator: bpy.types.Material
    glass: bpy.types.Material


def create_materials(output: Path, texture_python: str, seed: int = 77) -> BuildingMaterials:
    """Generate shared PBR tiles and return packed, glTF-compatible Blender materials."""
    directory = Path(__file__).parent
    subprocess.run([texture_python, str(directory / 'generate_textures.py'), str(output), '--seed', str(seed)], check=True)
    palette = json.loads((directory / 'palette.json').read_text())
    materials = {}
    for key, spec in palette['materials'].items():
        mat = bpy.data.materials.new(spec['name'])
        mat.use_nodes = True
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        shader = nodes.get('Principled BSDF')
        # Palette colors are sRGB bytes; untextured shader values must be linear.
        color = tuple((v / 255 / 12.92 if v / 255 <= .04045 else ((v / 255 + .055) / 1.055) ** 2.4) for v in spec['color'])
        mat.diffuse_color = (*color, 1)
        shader.inputs['Base Color'].default_value = (*color, 1)
        shader.inputs['Metallic'].default_value = spec['metallic']
        shader.inputs['Roughness'].default_value = spec['roughness']
        if spec.get('emission'):
            shader.inputs['Emission Color'].default_value = (*color, 1)
            shader.inputs['Emission Strength'].default_value = spec['emission']
        if spec['textured']:
            for channel in ['color', 'normal', 'roughness']:
                image = bpy.data.images.load(str(output / f'{key}-{channel}.png'), check_existing=True)
                if channel != 'color':
                    image.colorspace_settings.name = 'Non-Color'
                image.pack()
                texture = nodes.new('ShaderNodeTexImage')
                texture.image = image
                if channel == 'normal':
                    normal = nodes.new('ShaderNodeNormalMap')
                    normal.inputs['Strength'].default_value = spec['normal_strength']
                    links.new(texture.outputs['Color'], normal.inputs['Color'])
                    links.new(normal.outputs['Normal'], shader.inputs['Normal'])
                else:
                    links.new(texture.outputs['Color'], shader.inputs['Base Color' if channel == 'color' else 'Roughness'])
        mat.asset_mark()
        mat.asset_data.description = f"{palette['name']} / {spec['name']} — procedural building finish"
        materials[key] = mat
    bpy.data.libraries.write(str(output / 'aged-desert-materials.blend'), set(materials.values()), fake_user=True)
    return BuildingMaterials(**materials)
