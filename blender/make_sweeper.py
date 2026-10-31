"""在 Blender 內建立「掃冰員」（Q 版小人＋掃帚＋骨架）與全部動畫，並匯出 glb。

用法（Blender 4.2+，已用 5.2 測試）：
    blender --background --python blender/make_sweeper.py -- public/models/sweeper.glb

匯出的 glb 包含四段可循環動畫（30 fps）：
    Idle        站著待命（輕微呼吸、雙手斜抱掃帚）
    SweepLight  跟著壺小跑（身體微前傾、掃帚輕點冰面）
    SweepHard   全力刷冰（深度前傾、雙腳交替、掃帚左右大幅擺動，一圈 0.4 秒）
    Cheer       歡呼（雙手高舉、原地跳）

約定（遊戲程式依賴這些名稱）：
  * 面向 Blender 的 +Y（匯出後為 glTF 的 -Z，也就是球道遠端）
  * 材質：Skin / Hair / TeamColor（袖子與圍兜，遊戲會換成隊伍色）/ Shirt / Pants / Shoe / Eye / Blush / BroomHandle / BroomHead / BroomBrush
  * 物件：Tail（馬尾）與 Bun（包頭）預設都在，遊戲依髮型顯示其一
  * 骨架節點：root / hips / spine / head / armL / armR / legL / legR / broom
"""
import math
import sys

import bpy
from mathutils import Euler, Matrix, Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "sweeper.glb"
FPS = 30

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = FPS


# ───────── 材質 ─────────
def mat(name, color, rough=0.7, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def hexc(h):
    return tuple(((h >> s) & 255) / 255 for s in (16, 8, 0))


M = {
    "Skin": mat("Skin", hexc(0xF2C9A0), 0.65),
    "Hair": mat("Hair", hexc(0x7A4A2A), 0.8),
    "Shirt": mat("Shirt", (1, 1, 1), 0.7),
    "TeamColor": mat("TeamColor", hexc(0xE23B3B), 0.6),
    "Pants": mat("Pants", hexc(0x1F2A40), 0.8),
    "Shoe": mat("Shoe", hexc(0xF4F4F4), 0.7),
    "Eye": mat("Eye", hexc(0x222222), 0.5),
    "Blush": mat("Blush", hexc(0xFF8A8A), 0.8),
    "BroomHandle": mat("BroomHandle", hexc(0x8A95A6), 0.4, 0.4),
    "BroomHead": mat("BroomHead", (1, 1, 1), 0.9),
    "BroomBrush": mat("BroomBrush", hexc(0x35C46A), 0.9),
}

# ───────── 骨架（休息姿勢；單位公尺，+Y 為正面，+Z 為上） ─────────
arm_obj = bpy.data.objects.new("Sweeper", bpy.data.armatures.new("SweeperRig"))
bpy.context.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_obj.data.edit_bones


def bone(name, head, tail, parent=None, deform=True):
    b = eb.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    if parent:
        b.parent = eb[parent]
    b.use_deform = deform
    return b


bone("root", (0, 0, 0), (0, 0, 0.12))
bone("hips", (0, 0, 0.5), (0, 0, 0.62), "root")
bone("spine", (0, 0, 0.62), (0, 0, 0.95), "hips")
bone("head", (0, 0, 0.95), (0, 0, 1.45), "spine")
bone("armL", (-0.23, 0, 0.9), (-0.23, 0, 0.5), "spine")
bone("armR", (0.23, 0, 0.9), (0.23, 0, 0.5), "spine")
bone("legL", (-0.1, 0, 0.5), (-0.1, 0, 0.0), "hips")
bone("legR", (0.1, 0, 0.5), (0.1, 0, 0.0), "hips")
# 掃帚：原點在刷頭，沿 +Z 向上是握把
bone("broom", (0, 0.5, 0.03), (0, 0.5, 1.28), "root")
# 握點（雙手追蹤用，不變形）
bone("gripL", (-0.04, 0.5, 0.80), (-0.04, 0.5, 0.84), "broom", deform=False)
bone("gripR", (0.04, 0.5, 1.02), (0.04, 0.5, 1.06), "broom", deform=False)
bpy.ops.object.mode_set(mode="OBJECT")


def attach(obj, bone_name, material, name):
    """把物件掛在骨頭上（剛性跟隨）。"""
    obj.name = name
    obj.data.materials.append(material)
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.parent = arm_obj
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    # Blender 的「骨頭父子」是相對骨頭「尾端」；用 matrix_parent_inverse 抵銷，讓物件維持原本的世界位置
    pbone = arm_obj.pose.bones[bone_name]
    tail_mat = arm_obj.matrix_world @ pbone.matrix @ Matrix.Translation((0, pbone.bone.length, 0))
    obj.matrix_parent_inverse = tail_mat.inverted()
    return obj


def sphere(r, loc, scale=(1, 1, 1), seg=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=rings)
    o = bpy.context.object
    o.scale = scale
    return o


def cyl(r, depth, loc, verts=14, r2=None):
    bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2 if r2 is not None else r, depth=depth, location=loc, vertices=verts)
    return bpy.context.object


def box(size, loc):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.scale = size
    return o


# 軀幹、圍兜
attach(sphere(0.17, (0, 0, 0.72), (1.06, 0.95, 1.9)), "spine", M["Shirt"], "Torso")
attach(box((0.34, 0.2, 0.07), (0, 0, 0.55)), "hips", M["TeamColor"], "Bib")
# 頭、頭髮、五官
attach(sphere(0.27, (0, 0, 1.16), seg=32, rings=20), "head", M["Skin"], "Face")
attach(sphere(0.285, (0, -0.03, 1.24), (1, 1, 0.78), seg=32, rings=16), "head", M["Hair"], "Hair")
attach(sphere(0.09, (0, -0.27, 1.2), seg=12, rings=8), "head", M["Hair"], "Tail")
attach(sphere(0.1, (0, -0.02, 1.46), seg=12, rings=8), "head", M["Hair"], "Bun")
for s, side in ((-1, "L"), (1, "R")):
    attach(sphere(0.03, (s * 0.1, 0.245, 1.17), seg=10, rings=8), "head", M["Eye"], f"Eye{side}")
    bpy.ops.mesh.primitive_cylinder_add(radius=0.04, depth=0.006, location=(s * 0.15, 0.232, 1.1), rotation=(math.radians(90), 0, 0), vertices=14)
    attach(bpy.context.object, "head", M["Blush"], f"Blush{side}")
# 手臂（袖子）與手
for s, side in ((-1, "L"), (1, "R")):
    attach(cyl(0.06, 0.38, (s * 0.23, 0, 0.7), 12, 0.054), f"arm{side}", M["TeamColor"], f"Sleeve{side}")
    attach(sphere(0.065, (s * 0.23, 0, 0.49), seg=12, rings=8), f"arm{side}", M["Skin"], f"Hand{side}")
# 腿與鞋
for s, side in ((-1, "L"), (1, "R")):
    attach(cyl(0.075, 0.52, (s * 0.1, 0, 0.26), 12, 0.068), f"leg{side}", M["Pants"], f"Leg{side}")
    attach(box((0.12, 0.2, 0.07), (s * 0.1, 0.04, 0.035)), f"leg{side}", M["Shoe"], f"Shoe{side}")
# 掃帚
attach(cyl(0.018, 1.25, (0, 0.5, 0.66), 8), "broom", M["BroomHandle"], "BroomStick")
attach(box((0.34, 0.14, 0.06), (0, 0.5, 0.06)), "broom", M["BroomHead"], "BroomHead")
attach(box((0.34, 0.14, 0.025), (0, 0.5, 0.0175)), "broom", M["BroomBrush"], "BroomBrush")

# ───────── 雙手追蹤握點 ─────────
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode="POSE")
pb = arm_obj.pose.bones
for b in pb:
    b.rotation_mode = "XYZ"
for side in ("L", "R"):
    c = pb[f"arm{side}"].constraints.new("DAMPED_TRACK")
    c.name = "Track"
    c.target = arm_obj
    c.subtarget = f"grip{side}"
    c.track_axis = "TRACK_Y"
    c.influence = 1.0
bpy.ops.object.mode_set(mode="OBJECT")

# ───────── 動畫 ─────────
ANIM_BONES = ["root", "hips", "spine", "head", "armL", "armR", "legL", "legR", "broom"]


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(x):
    return x * x * (3 - 2 * x)


class Pose:
    """單格姿勢：每根骨頭的位置位移（公尺）、旋轉（弧度，XYZ）與手臂追蹤強度。"""

    def __init__(self):
        self.loc = {n: Vector((0, 0, 0)) for n in ANIM_BONES}
        self.rot = {n: Euler((0, 0, 0)) for n in ANIM_BONES}
        self.track = {"L": 1.0, "R": 1.0}


def apply(pose, frame):
    for n in ANIM_BONES:
        p = pb[n]
        p.location = pose.loc[n]
        p.rotation_euler = pose.rot[n]
        p.keyframe_insert("location", frame=frame)
        p.keyframe_insert("rotation_euler", frame=frame)
    for side in ("L", "R"):
        con = pb[f"arm{side}"].constraints["Track"]
        con.influence = pose.track[side]
        con.keyframe_insert("influence", frame=frame)


def make_action(name, frames, builder):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm_obj.animation_data_create()
    arm_obj.animation_data.action = act
    for f in range(frames + 1):
        ph = f / frames  # 0..1，首尾相同才能無縫循環
        apply(builder(ph), f)
    return act


TAU = math.tau
# 約定（休息姿勢向下的肢體）：繞 X 轉 +θ 往前（+Y）擺；向上的骨頭（脊椎、頭）繞 X 轉 -θ 往前傾


def idle(ph):
    p = Pose()
    s = math.sin(ph * TAU)
    p.loc["hips"].z = s * 0.006
    p.rot["spine"].x = s * 0.015
    p.rot["head"].x = -math.sin(ph * TAU + 0.6) * 0.03
    # 待命：雙手把掃帚斜抱在身前、刷頭離開冰面
    p.loc["broom"] = Vector((0.0, 0.42 + s * 0.01, 0.22))
    p.rot["broom"].x = 1.0
    p.rot["broom"].z = s * 0.02
    return p


def sweep(ph, lean, stride, swing, bob, depth, tilt):
    p = Pose()
    sw = math.sin(ph * TAU)
    co = math.cos(ph * TAU)
    p.rot["spine"].x = -lean
    p.rot["spine"].z = sw * 0.1 * swing
    p.rot["head"].x = lean * 0.7  # 頭抬回來看前方
    p.loc["hips"].z = -0.2 * lean - abs(math.sin(ph * TAU)) * bob * 0.5
    p.loc["hips"].y = 0.12 * lean
    p.rot["legL"].x = -0.12 * lean + sw * stride
    p.rot["legR"].x = -0.12 * lean - sw * stride
    # 掃帚：刷頭貼著冰面在身前左右刷；握把往身體方向傾斜
    p.loc["broom"] = Vector((sw * 0.22 * swing, depth + co * 0.07 * swing, 0.0))
    p.rot["broom"].x = tilt
    p.rot["broom"].y = sw * 0.12 * swing
    p.rot["broom"].z = sw * 0.35 * swing
    return p


def sweep_light(ph):
    return sweep(ph, lean=0.42, stride=0.45, swing=0.35, bob=0.02, depth=0.6, tilt=0.88)


def sweep_hard(ph):
    return sweep(ph, lean=0.78, stride=0.6, swing=1.0, bob=0.05, depth=0.78, tilt=0.95)


def cheer(ph):
    p = Pose()
    s = math.sin(ph * TAU)
    hop = abs(math.sin(ph * math.pi * 2)) * 0.18
    p.loc["root"].z = hop
    p.rot["legL"].x = s * 0.1
    p.rot["legR"].x = -s * 0.1
    p.loc["broom"] = Vector((0.36, -0.28, 0.0))
    p.rot["broom"].z = 0.12
    p.track["L"] = 0.0
    p.track["R"] = 0.0
    p.rot["armL"].x = 2.8
    p.rot["armL"].z = 0.35 + s * 0.12
    p.rot["armR"].x = 2.8
    p.rot["armR"].z = -0.35 - s * 0.12
    p.rot["spine"].x = 0.08
    return p


make_action("Idle", 60, idle)
make_action("SweepLight", 24, sweep_light)
make_action("SweepHard", 12, sweep_hard)
make_action("Cheer", 18, cheer)
arm_obj.animation_data.action = bpy.data.actions["Idle"]

# ───────── 匯出 ─────────
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    use_selection=True,
    export_apply=False,
    export_yup=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_optimize_animation_size=False,
    export_anim_single_armature=True,
)
print("已匯出", out)
