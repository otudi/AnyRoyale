"""
AnyRoyale character forge (Blender 4.2, run headless):

    blender --background --python forge.py -- recipes.json out/ [unit ...]

Builds one GLB per unit from the CC0 KayKit character packs (cloned by tools/asset-pipeline):
  * body parts can come from any KayKit adventurer/skeleton (they share one rig), so units get
    their own head/body/legs combination, not just a tint;
  * each texture region (skin, hair, cloth, leather, metal...) is recoloured separately;
  * procedural accessories (crowns, helmets, horns, ears, armour, wings, weapons...) are attached
    to bones;
  * everything is merged into ONE skinned mesh with ONE 512px atlas ("Body"), plus a "Team" mesh
    that the game tints blue/red. Two draw calls per unit instead of ~8.

No animation is exported: the game plays the shared clip library (anims.glb) on these bones.
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '..', 'asset-pipeline', '.cache')
ADV = os.path.join(CACHE, 'adventurers', 'addons', 'kaykit_character_pack_adventures', 'Characters', 'gltf')
SKEL_ROOT = os.path.join(CACHE, 'skeletons', 'addons')

def skel_dir():
    for d in os.listdir(SKEL_ROOT):
        p = os.path.join(SKEL_ROOT, d, 'Characters', 'gltf')
        if os.path.isdir(p):
            return p
    raise RuntimeError('skeleton pack not found')

SOURCES = {
    'knight': (ADV, 'Knight.glb'),
    'barbarian': (ADV, 'Barbarian.glb'),
    'mage': (ADV, 'Mage.glb'),
    'rogue': (ADV, 'Rogue.glb'),
    'rogue_hooded': (ADV, 'Rogue_Hooded.glb'),
    'skel_warrior': (None, 'Skeleton_Warrior.glb'),
    'skel_minion': (None, 'Skeleton_Minion.glb'),
    'skel_mage': (None, 'Skeleton_Mage.glb'),
    'skel_rogue': (None, 'Skeleton_Rogue.glb'),
}

# Named texture regions: (column, row) swatches of each 8x4 KayKit palette texture.
REGIONS = {
    'barbarian': {
        'skin': [(0, 3)], 'beard': [(1, 3)], 'shirt': [(0, 2), (1, 2)], 'fur': [(7, 3)],
        'leather': [(6, 3)], 'pants': [(3, 1)], 'cloth': [(2, 2)], 'belt': [(7, 2)],
        'bracer': [(7, 1)], 'metal': [(3, 3)],
    },
    'knight': {
        'cape': [(0, 2)], 'skin': [(0, 3)], 'hair': [(1, 3)], 'metal': [(3, 3), (7, 3)],
        'leather': [(6, 3)], 'under': [(7, 2)], 'trim': [(1, 2)], 'plate': [(2, 2)], 'gloves': [(4, 3)],
    },
    'mage': {
        'robe': [(0, 2)], 'skin': [(0, 3), (7, 1)], 'hat': [(1, 2)], 'hair': [(1, 3)], 'scarf': [(2, 2)],
        'trousers': [(3, 1)], 'sash': [(5, 3)], 'trim': [(3, 3), (4, 3)], 'gem': [(2, 1)], 'robe_dark': [(7, 2)],
        'crystal': [(6, 1)], 'book': [(1, 1)],
    },
    'rogue': {
        'tunic': [(0, 2)], 'tunic2': [(1, 2)], 'skin': [(0, 3)], 'hair': [(1, 3)], 'pants': [(3, 1)],
        'leather': [(5, 3), (5, 1), (6, 3), (7, 2)], 'metal': [(3, 3)],
    },
    'skeleton': {
        'bone': [(1, 2)], 'cloth': [(2, 1)], 'metal': [(3, 3)], 'leather': [(6, 3), (7, 3)],
    },
}
REGIONS['rogue_hooded'] = REGIONS['rogue']

ATLAS = 512
QUAD = ATLAS // 2
QUADS = [(0, 1), (1, 1), (0, 0)]  # (x, y) of source-texture quadrants; (1, 0) = accessory palette
PALETTE_ORIGIN = (1, 0)


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


# ------------------------------------------------------------------------------------- import

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_model(key):
    folder, name = SOURCES[key]
    folder = folder or skel_dir()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(folder, name))
    new = [o for o in bpy.data.objects if o not in before]
    rig = next(o for o in new if o.type == 'ARMATURE')
    # drop the clip library and animation data: the game uses anims.glb
    rig.animation_data_clear()
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    rig.data.pose_position = 'REST'
    return rig, [o for o in new if o.type == 'MESH']


def mesh_image(obj):
    mat = obj.data.materials[0]
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image:
            return n.image
    raise RuntimeError('no texture on ' + obj.name)


def texture_key(img_name):
    n = img_name.lower()
    for k in ('barbarian', 'knight', 'mage', 'rogue', 'skeleton'):
        if k in n:
            return k
    raise RuntimeError('unknown texture ' + img_name)


# ------------------------------------------------------------------------------------- textures

def image_array(img):
    w, h = img.size
    return np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)


def recolor(arr, regions, recipe_colors, tex):
    """Repaints named regions keeping each swatch's light/dark gradient."""
    h, w, _ = arr.shape
    cw, rh = w // 8, h // 4
    for name, hexcol in recipe_colors.items():
        if name not in regions:
            continue
        target = hexrgb(hexcol)  # texture pixels are sRGB values
        for (cx, row) in regions[name]:
            block = arr[row * rh:(row + 1) * rh, cx * cw:(cx + 1) * cw, :3]
            lum = block @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
            ref = max(1e-4, float(np.median(lum)))
            shade = np.clip(lum / ref, 0.0, 1.6)[..., None]
            arr[row * rh:(row + 1) * rh, cx * cw:(cx + 1) * cw, :3] = np.clip(target[None, None, :] * shade, 0, 1)
    return arr


def downscale(arr, size):
    h, w, _ = arr.shape
    f = h // size
    return arr.reshape(size, f, size, f, 4).mean(axis=(1, 3))


def palette_block(colors):
    """8x8 cells of flat colours with a gentle top-light gradient (QUAD px square)."""
    block = np.ones((QUAD, QUAD, 4), dtype=np.float32)
    cell = QUAD // 8
    grad = np.linspace(0.78, 1.08, cell, dtype=np.float32)[:, None, None]  # rows bottom->top
    for i, hexcol in enumerate(colors):
        cx, cy = i % 8, i // 8
        c = hexrgb(hexcol)
        block[cy * cell:(cy + 1) * cell, cx * cell:(cx + 1) * cell, :3] = np.clip(c[None, None, :] * grad, 0, 1)
    return block


def palette_uv(index):
    cell = 1 / 16  # atlas units: palette quadrant is half the atlas, 8 cells across
    cx, cy = index % 8, index // 8
    return (PALETTE_ORIGIN[0] * 0.5 + (cx + 0.5) * cell, PALETTE_ORIGIN[1] * 0.5 + (cy + 0.5) * cell)


# ------------------------------------------------------------------------------------- accessories

class Builder:
    """Creates accessory meshes in rest-pose world space (Z up, character faces -Y)."""

    def __init__(self, rig, colors):
        self.rig = rig
        self.colors = colors  # palette list; index = cell
        self.objects = []

    def color(self, hexcol):
        hexcol = hexcol.lower()
        if hexcol not in self.colors:
            self.colors.append(hexcol)
        return self.colors.index(hexcol)

    def bone_head(self, name):
        b = self.rig.data.bones[name]
        return self.rig.matrix_world @ b.head_local

    def add(self, bm, bone, hexcol, team=False, name='acc'):
        me = bpy.data.meshes.new(name)
        uv = bm.loops.layers.uv.verify()
        u, v = palette_uv(self.color('#ffffff' if team else hexcol))
        for f in bm.faces:
            f.smooth = False
            for l in f.loops:
                l[uv].uv = (u, v)
        bm.to_mesh(me)
        bm.free()
        me.uv_layers[0].name = 'UVMap'
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        vg = obj.vertex_groups.new(name=bone)
        vg.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
        obj['team'] = team
        self.objects.append(obj)
        return obj

    # primitive helpers -------------------------------------------------------------
    @staticmethod
    def xf(bm, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
        m = Matrix.Translation(loc) @ Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Diagonal((*scale, 1))
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
        return bm

    def cone(self, r1, r2, depth, segs=8, **kw):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
        return self.xf(bm, **kw)

    def ball(self, r, sub=1, **kw):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
        return self.xf(bm, **kw)

    def box(self, sx, sy, sz, **kw):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        kw['scale'] = (sx, sy, sz)
        return self.xf(bm, **kw)

    def torus(self, R, r, segs=16, rsegs=6, **kw):
        bm = bmesh.new()
        verts = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring = []
            for j in range(rsegs):
                b = 2 * math.pi * j / rsegs
                p = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
                ring.append(bm.verts.new(p))
            verts.append(ring)
        for i in range(segs):
            for j in range(rsegs):
                a, b = verts[i][j], verts[(i + 1) % segs][j]
                c, d = verts[(i + 1) % segs][(j + 1) % rsegs], verts[i][(j + 1) % rsegs]
                bm.faces.new((a, b, c, d))
        return self.xf(bm, **kw)


HEAD = Vector((0, 0, 1.66))  # centre of the big chibi head
HEAD_TOP = 2.2


def acc_crown(B, p):
    gold = p.get('color', '#ffd23f')
    z = HEAD_TOP - 0.05 + p.get('lift', 0)
    s = p.get('size', 1.0)
    B.add(B.cone(0.36 * s, 0.4 * s, 0.22 * s, segs=10, loc=(0, 0, z)), 'head', gold, name='crown')
    for i in range(5):
        a = 2 * math.pi * i / 5 + math.pi / 2
        B.add(B.cone(0.08 * s, 0.0, 0.22 * s, segs=4, loc=(math.cos(a) * 0.36 * s, math.sin(a) * 0.36 * s, z + 0.2 * s)), 'head', gold, name='crownspike')
    B.add(B.ball(0.07 * s, 0, loc=(0, -0.4 * s, z)), 'head', p.get('gem', '#e8344a'), name='crowngem')


def acc_tiara(B, p):
    gold = p.get('color', '#ffd23f')
    B.add(B.torus(0.5, 0.045, loc=(0, 0, HEAD_TOP - 0.18), rot=(0.25, 0, 0)), 'head', gold, name='tiara')
    for i, h in ((-1, 0.16), (0, 0.24), (1, 0.16)):
        B.add(B.cone(0.06, 0.0, h, segs=4, loc=(i * 0.16, -0.48, HEAD_TOP - 0.06 + h / 2)), 'head', gold, name='tiaraspike')
    B.add(B.ball(0.06, 0, loc=(0, -0.53, HEAD_TOP - 0.12)), 'head', p.get('gem', '#ff4a9a'), name='tiaragem')


def acc_horns(B, p):
    col = p.get('color', '#f2e6c8')
    s = p.get('size', 1.0)
    for sx in (-1, 1):
        bm = B.cone(0.12 * s, 0.0, 0.55 * s, segs=6, loc=(sx * 0.5, 0, HEAD_TOP - 0.25), rot=(0, sx * -0.9, 0))
        B.add(bm, 'head', col, name='horn')


def acc_ears(B, p):
    col = p.get('color', '#7cc04a')
    s = p.get('size', 1.0)
    for sx in (-1, 1):
        B.add(B.cone(0.13 * s, 0.0, 0.62 * s, segs=5, loc=(sx * 0.68, 0.02, 1.7), rot=(0, sx * -1.2, 0)), 'head', col, name='ear')


def acc_hood(B, p):
    # pointed hood over the head (team coloured unless a colour is given)
    team = 'color' not in p
    col = p.get('color', '#ffffff')
    B.add(B.ball(0.68, 2, loc=(0, 0.08, 1.74), scale=(1.02, 1.02, 1.0)), 'head', col, team=team, name='hood')
    B.add(B.cone(0.32, 0.0, 0.6, segs=10, loc=(0, 0.3, HEAD_TOP + 0.14), rot=(0.6, 0, 0)), 'head', col, team=team, name='hoodtip')


def acc_witch_hat(B, p):
    col = p.get('color', '#3a2a55')
    band = p.get('band', '#c84ad8')
    B.add(B.cone(0.85, 0.82, 0.08, segs=14, loc=(0, 0, HEAD_TOP - 0.1)), 'head', col, name='brim')
    B.add(B.cone(0.48, 0.0, 1.0, segs=10, loc=(0, 0.1, HEAD_TOP + 0.42), rot=(0.25, 0, 0)), 'head', col, name='hatcone')
    B.add(B.cone(0.5, 0.48, 0.12, segs=10, loc=(0, 0.02, HEAD_TOP - 0.02)), 'head', band, name='hatband')


def acc_helmet(B, p):
    col = p.get('color', '#b8c2cc')
    if p.get('visor'):
        # closed helm: encloses the whole head, a thin glowing slit for the eyes
        B.add(B.ball(0.66, 2, loc=(0, 0, 1.68), scale=(1, 1, 0.98)), 'head', col, name='helm')
        B.add(B.box(0.62, 0.08, 0.09, loc=(0, -0.64, 1.66)), 'head', p.get('visor_color', '#2a2f3a'), name='visor')
        B.add(B.box(0.08, 0.06, 0.34, loc=(0, -0.645, 1.5)), 'head', p.get('visor_color', '#2a2f3a'), name='visor2')
        B.add(B.cone(0.7, 0.66, 0.1, segs=14, loc=(0, 0, 1.3)), 'head', col, name='gorget')
    else:
        # open cap helmet over the top of the head
        B.add(B.ball(0.64, 2, loc=(0, 0.04, 1.84), scale=(1, 1, 0.8)), 'head', col, name='helm')
        B.add(B.torus(0.62, 0.05, loc=(0, 0.02, 1.62)), 'head', col, name='helmrim')
    if p.get('plume'):
        B.add(B.ball(0.18, 2, loc=(0, 0.12, HEAD_TOP + 0.22), scale=(0.55, 2.2, 1.4)), 'head', '#ffffff' if p['plume'] == 'team' else p['plume'], team=p.get('plume') == 'team', name='plume')
    if p.get('horns'):
        acc_horns(B, {'color': p.get('horn_color', '#f2e6c8'), 'size': 1.15})


def acc_mask(B, p):
    # cloth bandana over nose and mouth
    B.add(B.ball(0.56, 2, loc=(0, -0.08, 1.42), scale=(1.0, 0.9, 0.42)), 'head', p.get('color', '#2a2f3a'), name='mask')
    eye = p.get('eyes')
    if eye:
        for sx in (-1, 1):
            B.add(B.ball(0.075, 1, loc=(sx * 0.2, -0.6, 1.68)), 'head', eye, name='maskeye')


def acc_mohawk(B, p):
    col = p.get('color', '#e8442a')
    for i in range(5):
        y = -0.35 + i * 0.18
        B.add(B.cone(0.13, 0.0, 0.42 - abs(i - 2) * 0.05, segs=4, loc=(0, y, HEAD_TOP + 0.1)), 'head', col, name='mohawk')


def acc_pigtails(B, p):
    col = p.get('color', '#e0a040')
    for sx in (-1, 1):
        B.add(B.ball(0.22, 2, loc=(sx * 0.62, 0.15, 1.5), scale=(0.8, 0.8, 1.5)), 'head', col, name='pigtail')


def acc_beard(B, p):
    col = p.get('color', '#f2f2f2')
    long = p.get('long', 1.0)
    d = 0.5 * long
    B.add(B.cone(0.05, 0.34, d, segs=10, loc=(0, -0.43, 1.42 - d / 2), scale=(1, 0.55, 1)), 'head', col, name='beard')


def acc_mustache(B, p):
    col = p.get('color', '#5a3a20')
    for sx in (-1, 1):
        B.add(B.ball(0.13, 1, loc=(sx * 0.13, -0.56, 1.5), scale=(1.4, 0.6, 0.6), rot=(0, sx * 0.35, 0)), 'head', col, name='mustache')


def acc_cap(B, p):
    team = p.get('team', False)
    col = p.get('color', '#ffffff')
    B.add(B.ball(0.6, 2, loc=(0, 0.02, 1.86), scale=(1, 1, 0.7)), 'head', col, team=team, name='cap')
    B.add(B.box(0.75, 0.45, 0.06, loc=(0, -0.55, 1.83), rot=(-0.12, 0, 0)), 'head', p.get('brim', col), team=team and 'brim' not in p, name='capbrim')


def acc_headlamp(B, p):
    B.add(B.cone(0.13, 0.15, 0.14, segs=10, loc=(0, -0.6, 1.95), rot=(math.pi / 2, 0, 0)), 'head', '#3a3a40', name='lamp')
    B.add(B.ball(0.1, 1, loc=(0, -0.67, 1.95), scale=(1, 0.5, 1)), 'head', p.get('color', '#fff2a0'), name='lamplight')


def acc_goggles(B, p):
    col = p.get('color', '#3a2a20')
    lens = p.get('lens', '#8ad8ff')
    B.add(B.torus(0.56, 0.05, loc=(0, 0, 1.86), rot=(0.1, 0, 0)), 'head', col, name='gogstrap')
    for sx in (-1, 1):
        B.add(B.cone(0.15, 0.15, 0.1, segs=10, loc=(sx * 0.2, -0.56, 1.86), rot=(math.pi / 2, 0, 0)), 'head', lens, name='goglens')


def acc_halo(B, p):
    B.add(B.torus(0.32, 0.05, loc=(0, 0, HEAD_TOP + 0.35)), 'head', p.get('color', '#ffe680'), name='halo')


def acc_shoulders(B, p):
    col = p.get('color', '#b8c2cc')
    s = p.get('size', 1.0)
    for sx, bone in ((1, 'upperarm.l'), (-1, 'upperarm.r')):
        B.add(B.ball(0.24 * s, 1, loc=(sx * 0.3, 0, 1.2), scale=(1.1, 1, 0.75)), bone, col, name='pauldron')
        if p.get('spikes'):
            B.add(B.cone(0.07, 0.0, 0.28, segs=4, loc=(sx * 0.36, 0, 1.4)), bone, p['spikes'], name='spike')


def acc_chestplate(B, p):
    col = p.get('color', '#b8c2cc')
    B.add(B.box(0.78, 0.5, 0.5, loc=(0, -0.02, 0.98)), 'chest', col, name='plate')
    if p.get('emblem'):
        B.add(B.ball(0.12, 1, loc=(0, -0.28, 1.0), scale=(1, 0.4, 1)), 'chest', p['emblem'], name='emblem')


def acc_cape(B, p):
    team = 'color' not in p
    B.add(B.box(0.8, 0.06, 0.9, loc=(0, 0.32, 0.72), rot=(-0.18, 0, 0)), 'chest', p.get('color', '#ffffff'), team=team, name='cape')


def acc_scarf(B, p):
    team = 'color' not in p
    B.add(B.torus(0.3, 0.09, loc=(0, 0, 1.22), scale=(1, 1, 0.6)), 'chest', p.get('color', '#ffffff'), team=team, name='scarf')


def acc_belt_bombs(B, p):
    for i, x in enumerate((-0.28, 0, 0.28)):
        B.add(B.ball(0.12, 1, loc=(x, -0.36, 0.62)), 'hips', p.get('color', '#2a2a30'), name='beltbomb')
        B.add(B.box(0.04, 0.04, 0.08, loc=(x, -0.36, 0.76)), 'hips', '#ffb030', name='fuse')


def acc_backpack(B, p):
    B.add(B.box(0.55, 0.32, 0.55, loc=(0, 0.42, 0.95)), 'chest', p.get('color', '#8a5a2c'), name='pack')
    if p.get('roll'):
        B.add(B.cone(0.12, 0.12, 0.6, segs=8, loc=(0, 0.42, 1.28), rot=(0, math.pi / 2, 0)), 'chest', p['roll'], name='bedroll')


def acc_quiver(B, p):
    B.add(B.cone(0.13, 0.13, 0.7, segs=8, loc=(0.18, 0.38, 1.05), rot=(0.35, 0.3, 0)), 'chest', p.get('color', '#8a5a2c'), name='quiver')
    for i in range(3):
        B.add(B.cone(0.04, 0.0, 0.14, segs=4, loc=(0.24 + i * 0.03, 0.5, 1.47)), 'chest', p.get('feather', '#f2f2f2'), name='feather')


def acc_wings(B, p):
    col = p.get('color', '#f4f4ff')
    for sx in (-1, 1):
        B.add(B.ball(0.35, 1, loc=(sx * 0.45, 0.45, 1.15), scale=(1.4, 0.25, 1.0), rot=(0, sx * 0.4, 0)), 'chest', col, name='wing')


def acc_tail(B, p):
    B.add(B.cone(0.1, 0.0, 0.7, segs=6, loc=(0, 0.45, 0.55), rot=(-1.1, 0, 0)), 'hips', p.get('color', '#7cc04a'), name='tail')


def acc_skirt(B, p):
    B.add(B.cone(0.48, 0.34, 0.38, segs=10, loc=(0, 0, 0.5)), 'hips', p.get('color', '#c04a8a'), name='skirt')


def acc_fur_collar(B, p):
    B.add(B.torus(0.36, 0.14, loc=(0, 0, 1.2), scale=(1, 1, 0.7)), 'chest', p.get('color', '#e8dcc8'), name='fur')


def hand_item(B, p, kind):
    """Weapons built along the hand slot (handslot.r at (-0.88, 0, 1.05), pointing -Y forward)."""
    side = p.get('hand', 'r')
    sx = -1 if side == 'r' else 1
    bone = 'handslot.' + side
    x = sx * 0.88
    col = p.get('color')
    if kind == 'spear':
        B.add(B.cone(0.035, 0.035, 1.9, segs=6, loc=(x, -0.2, 1.05), rot=(math.pi / 2, 0, 0)), bone, '#8a5a2c', name='shaft')
        B.add(B.cone(0.1, 0.0, 0.32, segs=4, loc=(x, -1.3, 1.05), rot=(math.pi / 2, 0, 0)), bone, col or '#d8dde8', name='spearhead')
    elif kind == 'hammer':
        B.add(B.cone(0.05, 0.05, 1.2, segs=6, loc=(x, -0.3, 1.05), rot=(math.pi / 2, 0, 0)), bone, '#6a4422', name='handle')
        B.add(B.box(0.42, 0.34, 0.34, loc=(x, -0.95, 1.05)), bone, col or '#8a96a8', name='hammerhead')
    elif kind == 'club':
        B.add(B.cone(0.08, 0.2, 1.0, segs=7, loc=(x, -0.55, 1.05), rot=(math.pi / 2, 0, 0)), bone, col or '#8a5a2c', name='club')
    elif kind == 'bow':
        B.add(B.torus(0.55, 0.04, segs=12, loc=(x - sx * 0.05, -0.25, 1.05), rot=(0, math.pi / 2, 0), scale=(1, 0.5, 1)), bone, col or '#8a5a2c', name='bow')
    elif kind == 'staff_orb':
        B.add(B.cone(0.045, 0.045, 1.8, segs=6, loc=(x, -0.05, 1.05), rot=(math.pi / 2, 0, 0)), bone, '#5a3a20', name='staff')
        B.add(B.ball(0.2, 1, loc=(x, -1.0, 1.05)), bone, col or '#7ad8ff', name='orb')
    elif kind == 'bomb':
        B.add(B.ball(0.3, 1, loc=(x, -0.3, 1.05)), bone, col or '#2a2a30', name='bomb')
        B.add(B.box(0.06, 0.06, 0.16, loc=(x, -0.3, 1.38)), bone, '#ffb030', name='fuse')
    elif kind == 'rod':
        B.add(B.cone(0.025, 0.025, 2.2, segs=5, loc=(x, -0.6, 1.4), rot=(math.pi / 2 - 0.5, 0, 0)), bone, '#8a5a2c', name='rod')
        B.add(B.ball(0.08, 0, loc=(x, -1.55, 0.95)), bone, '#e84a3a', name='bobber')
    elif kind == 'lantern':
        B.add(B.box(0.24, 0.24, 0.32, loc=(x, -0.25, 0.9)), bone, '#3a3a40', name='lantern')
        B.add(B.ball(0.1, 0, loc=(x, -0.25, 0.9)), bone, col or '#ffd060', name='flame')
    elif kind == 'shield':
        B.add(B.cone(0.42, 0.42, 0.08, segs=10, loc=(x, -0.12, 1.05), rot=(0, math.pi / 2, 0)), bone, col or '#8a5a2c', name='shield')
        B.add(B.ball(0.1, 0, loc=(x + sx * -0.06, -0.12, 1.05)), bone, '#c8ccd4', name='boss')
    elif kind == 'book':
        B.add(B.box(0.12, 0.42, 0.5, loc=(x, -0.2, 1.05)), bone, col or '#8a2a5a', name='book')
    elif kind == 'cannon':
        B.add(B.cone(0.17, 0.2, 0.9, segs=10, loc=(x, -0.45, 1.05), rot=(math.pi / 2, 0, 0)), bone, col or '#3a3a40', name='handcannon')


ACCESSORIES = {
    'crown': acc_crown, 'tiara': acc_tiara, 'horns': acc_horns, 'ears': acc_ears, 'hood': acc_hood,
    'witch_hat': acc_witch_hat, 'helmet': acc_helmet, 'mask': acc_mask, 'mohawk': acc_mohawk,
    'pigtails': acc_pigtails, 'beard': acc_beard, 'mustache': acc_mustache, 'cap': acc_cap, 'headlamp': acc_headlamp, 'goggles': acc_goggles, 'halo': acc_halo,
    'shoulders': acc_shoulders, 'chestplate': acc_chestplate, 'cape': acc_cape, 'scarf': acc_scarf,
    'belt_bombs': acc_belt_bombs, 'backpack': acc_backpack, 'quiver': acc_quiver, 'wings': acc_wings,
    'tail': acc_tail, 'skirt': acc_skirt, 'fur_collar': acc_fur_collar,
}
for _k in ('spear', 'hammer', 'club', 'bow', 'staff_orb', 'bomb', 'rod', 'lantern', 'shield', 'book', 'cannon'):
    ACCESSORIES[_k] = (lambda kind: (lambda B, p: hand_item(B, p, kind)))(_k)


# ------------------------------------------------------------------------------------- build

def bake_rigid_to_skin(obj, rig):
    """Bone-parented rigid mesh -> world-space mesh weighted 100% to that bone."""
    bone = obj.parent_bone
    mw = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = mw
    obj.data.transform(mw)
    obj.matrix_world = Matrix.Identity(4)
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')


def remap_uv(obj, quad):
    ox, oy = quad
    for d in obj.data.uv_layers[0].data:
        u, v = d.uv
        u = min(0.999, max(0.001, u)) * 0.5 + ox * 0.5
        v = min(0.999, max(0.001, v)) * 0.5 + oy * 0.5
        d.uv = (u, v)


def build(unit, recipe, out_dir):
    reset()
    base = recipe['base']
    rig, base_meshes = import_model(base)
    rig.name = 'Rig'
    keep = []  # (obj, team)
    loaded = {base: base_meshes}

    def take(model, mesh_name):
        if model not in loaded:
            r2, ms = import_model(model)
            loaded[model] = ms
            loaded[model + ':rig'] = r2
        for o in loaded[model]:
            if o.name.split('.')[0] == mesh_name:
                return o
        raise RuntimeError(f'{unit}: no mesh {mesh_name} in {model}')

    parts = recipe['parts']  # [[model, meshName, {team?}], ...]
    for entry in parts:
        model, mesh_name = entry[0], entry[1]
        opts = entry[2] if len(entry) > 2 else {}
        o = take(model, mesh_name)
        keep.append((o, bool(opts.get('team'))))

    # recoloured, downscaled textures into atlas quadrants
    textures = {}
    for o, _team in keep:
        img = mesh_image(o)
        if img.name not in textures:
            if len(textures) >= len(QUADS):
                raise RuntimeError(f'{unit}: too many source textures')
            textures[img.name] = (img, QUADS[len(textures)])
    atlas = np.zeros((ATLAS, ATLAS, 4), dtype=np.float32)
    atlas[..., 3] = 1
    for name, (img, (qx, qy)) in textures.items():
        tex = texture_key(name)
        arr = image_array(img).copy()
        arr = recolor(arr, REGIONS.get(tex, {}), recipe.get('colors', {}).get(tex, {}), tex)
        small = downscale(arr, QUAD)
        atlas[qy * QUAD:(qy + 1) * QUAD, qx * QUAD:(qx + 1) * QUAD] = small

    # accessories
    B = Builder(rig, ['#ffffff'])
    for acc in recipe.get('accessories', []):
        kind = acc['kind']
        ACCESSORIES[kind](B, acc)
    px, py = PALETTE_ORIGIN
    atlas[py * QUAD:(py + 1) * QUAD, px * QUAD:(px + 1) * QUAD] = palette_block(B.colors)

    # retarget kept parts to the base rig, bake rigid ones, remap UVs
    finals = []
    for o, team in keep:
        img = mesh_image(o)
        quad = textures[img.name][1]
        if o.parent_type == 'BONE':
            bake_rigid_to_skin(o, rig)
        else:
            mw = o.matrix_world.copy()
            o.parent = None
            o.data.transform(mw)
            o.matrix_world = Matrix.Identity(4)
        for m in list(o.modifiers):
            o.modifiers.remove(m)
        o.data.materials.clear()
        remap_uv(o, quad)
        if team:
            # team parts are tinted by the game: paint them white (palette cell 0)
            u, v = palette_uv(0)
            for d in o.data.uv_layers[0].data:
                d.uv = (u, v)
        finals.append((o, team))
    for o in B.objects:
        finals.append((o, bool(o.get('team'))))

    # delete everything not kept
    kept = {o for o, _ in finals} | {rig}
    for o in list(bpy.data.objects):
        if o not in kept:
            bpy.data.objects.remove(o, do_unlink=True)

    # one material, one image
    image = bpy.data.images.new(f'{unit}_atlas', ATLAS, ATLAS, alpha=False)
    image.colorspace_settings.name = 'sRGB'
    # byte image: pixel values are sRGB, like the source textures
    out = np.clip(atlas, 0, 1)
    out[..., 3] = 1
    image.pixels[:] = out.ravel()
    image.file_format = 'PNG'
    image.pack()
    mat = bpy.data.materials.new(f'{unit}_mat')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.8
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    tex.interpolation = 'Linear'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])

    groups = {False: [], True: []}
    for o, team in finals:
        if o.data.uv_layers[0].name != 'UVMap':
            o.data.uv_layers[0].name = 'UVMap'
        while len(o.data.uv_layers) > 1:
            o.data.uv_layers.remove(o.data.uv_layers[1])
        o.data.materials.append(mat)
        groups[team].append(o)

    def join(objs, name):
        if not objs:
            return None
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        o.name = name
        o.data.name = name
        o.parent = rig
        mod = o.modifiers.new('Armature', 'ARMATURE')
        mod.object = rig
        return o

    join(groups[False], 'Body')
    join(groups[True], 'Team')

    # strip rig helper bones? keep all: anims.glb drives the deforming bones by name.
    os.makedirs(out_dir, exist_ok=True)
    target = os.path.join(out_dir, f'forged_{unit}.glb')
    bpy.ops.export_scene.gltf(
        filepath=target,
        export_format='GLB',
        export_animations=False,
        export_skins=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_extras=False,
        use_selection=False,
    )
    print('FORGED', unit, os.path.getsize(target))


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    recipes = json.load(open(argv[0]))['units']
    out_dir = argv[1]
    only = set(argv[2:])
    for unit, recipe in recipes.items():
        if only and unit not in only:
            continue
        build(unit, recipe, out_dir)


main()
