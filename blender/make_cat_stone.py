"""在 Blender 內建立「貓咪冰壺」並匯出 glb。

用法（Blender 3.6+，終端機或「Scripting」分頁皆可）：
    blender --background --python blender/make_cat_stone.py -- public/models/cat_stone.glb

約定（遊戲程式依賴這些名稱）：
  * 需要換成隊伍色的材質，名稱必須是 TeamColor
  * 臉部／耳朵的群組物件命名為 Head（可選）
  * 單位為公尺，壺半徑約 0.18，底面貼在 y=0（Blender 的 Z=0）
"""
import sys
import bpy
import math

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "cat_stone.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


granite = mat("Granite", (0.6, 0.63, 0.66), 0.45, 0.1)
steel = mat("Rim", (0.43, 0.46, 0.5), 0.5, 0.2)
team = mat("TeamColor", (0.89, 0.23, 0.23), 0.6)
dark = mat("Dark", (0.11, 0.14, 0.25), 0.8)


def add(obj, m, name, parent=None):
    obj.name = name
    obj.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    if parent:
        obj.parent = parent
    return obj


root = bpy.data.objects.new("CatStone", None)
bpy.context.collection.objects.link(root)

bpy.ops.mesh.primitive_cylinder_add(radius=0.19, depth=0.13, location=(0, 0, 0.09), vertices=48)
add(bpy.context.object, granite, "Body", root)
bpy.ops.mesh.primitive_torus_add(major_radius=0.19, minor_radius=0.022, location=(0, 0, 0.06))
add(bpy.context.object, steel, "Rim", root)
bpy.ops.mesh.primitive_cylinder_add(radius=0.16, depth=0.05, location=(0, 0, 0.175), vertices=48)
add(bpy.context.object, team, "Cap", root)

head = bpy.data.objects.new("Head", None)
bpy.context.collection.objects.link(head)
head.parent = root
head.location = (0, 0, 0.2)

bpy.ops.mesh.primitive_uv_sphere_add(radius=0.12, location=(0, 0, 0.27), segments=32, ring_count=16)
face = bpy.context.object
face.scale = (1.1, 1.0, 0.85)
add(face, team, "Face", head)
for sx in (-1, 1):
    bpy.ops.mesh.primitive_cone_add(radius1=0.05, depth=0.09, location=(sx * 0.08, 0, 0.37), vertices=4)
    ear = bpy.context.object
    ear.rotation_euler = (0, math.radians(sx * 12), 0)
    add(ear, team, f"Ear{'L' if sx < 0 else 'R'}", head)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.014, location=(sx * 0.045, -0.11, 0.285))
    add(bpy.context.object, dark, f"Eye{'L' if sx < 0 else 'R'}", head)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, use_selection=True, export_yup=True)
print("已匯出", out)
