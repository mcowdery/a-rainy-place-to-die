"""A DiffPortrait360 orbit's frames framed as a Pixal3D multi-view job framed its front view, for
`project_picture.py --exact-views 1`: the job's `source_box` (in camera.json) cut from each 1024-px frame, padded
where it runs off the picture, with the frame's cut-out mask as alpha.

  python scripts/genia/orbit_reframe.py <dir with camera.json and f04.png ... f28.png (1024 px)> <masks dir (NNN.png, any size)>

Writes v04.png ... v28.png beside the frames (RGBA). Frame k of the 8 is orbit frame 4k.
"""
import json
import sys

from PIL import Image

O, M = sys.argv[1], sys.argv[2]
box = json.load(open(f'{O}/camera.json'))['source_box']
for i in range(4, 32, 4):
    im = Image.open(f'{O}/f{i:02d}.png').convert('RGB')
    m = Image.open(f'{M}/{i:03d}.png').convert('L').resize(im.size, Image.BILINEAR)
    rgba = im.copy()
    rgba.putalpha(m)
    out = Image.new('RGBA', (box[2] - box[0], box[3] - box[1]), (0, 0, 0, 0))
    out.paste(rgba, (-box[0], -box[1]))
    out.save(f'{O}/v{i:02d}.png')
print('reframed with', box)
