"""The face lab: shape a character's face (and body) by hand in Blender with MPFB's own sliders, then save it back.

  npm run face:lab                      (Mack: scripts/blender/characters/mack.json)
  blender --python scripts/blender/face_lab.py -- scripts/blender/characters/<name>.json

Opens Blender (with its window, not in the background) on the character as its definition builds it: the body, the
skin, eyes, brows and lashes, no clothes or hair (they're fitted in the full build). Select the body, open the
sidebar (N), and use MPFB's Model panel: face, nose, eyes, mouth, chin, ears, head, body. The City Popper tab has:

  Save to <file>       writes the body's shape targets into the definition's "body.targets", replacing what was
                       there (left and right values that match become one "lr-" entry; the macros, age, weight,
                       muscle and so on, stay as the file says: change those in the file)
  Save and rebuild     the same, then builds the character and every outfit made from it (definitions whose
                       "base" is this file) in the background, one after another; the console says when each is done
                       (about two minutes a model), into assets/characters/ with their previews

A definition that is itself an outfit (has a "base") edits its base. Faceless characters (Mack) are hidden in the
game anyway; the lab shows the face as modelled.
"""
import json
import os
import re
import subprocess
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_character as bc  # noqa: E402
import mpfb_base as mb  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = {'path': None, 'basemesh': None}


def definition_file(path):
    """The file whose targets the lab edits: the definition, or the one it's an outfit of."""
    with open(path, encoding='utf-8') as f:
        d = json.load(f)
    return definition_file(os.path.join(os.path.dirname(path), d['base'])) if 'base' in d else os.path.abspath(path)


def build(path):
    d = bc.load_definition(path)
    mb.clear_scene()
    info = bc.human_info(d)
    info['clothes'] = []
    info['hair'] = ''
    if 'height_cm' in d['body']:
        mb.solve_height_macro(info, float(d['body']['height_cm']))
    basemesh, rig = mb.build(info)
    STATE['basemesh'] = basemesh
    # Frame the head: a camera-like view on the face, the body selected for the Model panel.
    bpy.ops.object.select_all(action='DESELECT')
    basemesh.select_set(True)
    bpy.context.view_layer.objects.active = basemesh
    for area in bpy.context.screen.areas if bpy.context.screen else []:
        if area.type == 'VIEW_3D':
            space = area.spaces.active
            space.shading.type = 'MATERIAL'
            r3d = space.region_3d
            head = rig.matrix_world @ rig.data.bones['head'].head_local
            r3d.view_location = (head.x, head.y, head.z + 0.06)
            r3d.view_distance = 0.9
            from mathutils import Euler
            r3d.view_rotation = Euler((1.45, 0, 0.35)).to_quaternion()
            space.show_region_ui = True
    return basemesh


def current_targets(basemesh):
    """The body's shape targets now (name: value), less the macros and anything under 0.005."""
    T = mb.TargetService
    out = {}
    for t in T.get_target_stack(basemesh):
        name = T.decode_shapekey_name(t['target'])
        if name.startswith('macrodetail') or abs(t['value']) < 0.005:
            continue
        out[name] = round(float(t['value']), 3)
    # Pairs that match become one lr- entry.
    merged = {}
    for name, v in sorted(out.items()):
        if name.startswith('r-') and out.get('l-' + name[2:]) == v:
            continue
        if name.startswith('l-') and out.get('r-' + name[2:]) == v:
            merged['lr-' + name[2:]] = v
        else:
            merged[name] = v
    return merged


def save(path):
    """Writes the targets into the file's "body.targets", keeping the rest of the file as it's written."""
    targets = current_targets(STATE['basemesh'])
    with open(path, encoding='utf-8') as f:
        text = f.read()
    m = re.search(r'("targets":\s*)\{', text)
    if not m:
        raise RuntimeError('no "targets" in ' + path)
    # The matching close brace.
    depth, i = 0, m.end() - 1
    while True:
        depth += {'{': 1, '}': -1}.get(text[i], 0)
        if depth == 0:
            break
        i += 1
    indent = re.search(r'\n([ \t]*)"targets"', text).group(1)
    body = ',\n'.join(f'{indent}  "{k}": {v}' for k, v in targets.items())
    text = text[:m.end() - 1] + '{\n' + body + '\n' + indent + '}' + text[i + 1:]
    json.loads(text)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
    return len(targets)


def outfits_of(path):
    """The definitions made from this one (their "base" is it), this one first."""
    out = [path]
    folder = os.path.dirname(path)
    for name in sorted(os.listdir(folder)):
        p = os.path.join(folder, name)
        if not name.endswith('.json') or os.path.abspath(p) == os.path.abspath(path):
            continue
        with open(p, encoding='utf-8') as f:
            d = json.load(f)
        if 'base' in d and os.path.abspath(os.path.join(folder, d['base'])) == os.path.abspath(path):
            out.append(p)
    return out


def rebuild(path):
    """Builds the character and its outfits in a background Blender, one after another."""
    script = os.path.join(HERE, 'build_character.py')
    cmds = ' && '.join(f'"{bpy.app.binary_path}" -b --python "{script}" -- "{p}"' for p in outfits_of(path))
    subprocess.Popen(cmds, shell=True, cwd=bc.REPO)
    return len(outfits_of(path))


class CITYPOP_OT_save_face(bpy.types.Operator):
    bl_idname = 'citypop.save_face'
    bl_label = 'Save'
    bl_description = "Write the body's shape targets into the definition"
    rebuild: bpy.props.BoolProperty(default=False)

    def execute(self, context):
        n = save(STATE['path'])
        msg = f'{n} targets saved to {os.path.basename(STATE["path"])}'
        if self.rebuild:
            msg += f'; rebuilding {rebuild(STATE["path"])} models in the background (see the console)'
        self.report({'INFO'}, msg)
        print('FACE_LAB', msg)
        return {'FINISHED'}


class CITYPOP_PT_face_lab(bpy.types.Panel):
    bl_label = 'Face lab'
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'City Popper'

    def draw(self, context):
        col = self.layout.column()
        col.label(text='Shape him with MPFB > Model,')
        col.label(text='with the body selected.')
        name = os.path.basename(STATE['path'] or '')
        col.operator('citypop.save_face', text=f'Save to {name}').rebuild = False
        col.operator('citypop.save_face', text='Save and rebuild models').rebuild = True


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    path = argv[0] if argv else os.path.join(HERE, 'characters', 'mack.json')
    STATE['path'] = definition_file(path)
    build(STATE['path'])
    for cls in (CITYPOP_OT_save_face, CITYPOP_PT_face_lab):
        bpy.utils.register_class(cls)
    print('FACE_LAB ready:', STATE['path'])


main()
