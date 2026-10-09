"""The views of one figure made ready for the Pixal3D worker's multi-view mode: cut out, and registered on one canvas.

  python scripts/props/mv_views.py <out dir> <front.png> <azimuth>:<picture> [<azimuth>:<picture> ...]

The worker (Trame/trame-mesh-pixal3d, v6) wants every view the same size, the figure the same size in each, its crown and its feet on the
same rows and its vertical axis at the canvas's middle. Pictures made by an image-edit model are none of that: each fills its frame a little
differently. Here each picture is cut out by the figure's skin colour (a bare figure on a grey studio), then scaled so
that crown-to-feet is the front's, and set so the crown is on the front's row and the figure's middle (the bounding box's) on the front's.
Writes <out dir>/front.png and <out dir>/view<azimuth>.png as RGBA (the cut-out is the alpha, which the worker takes as the mask), prints each
view's box, and writes `check.png`, all of them side by side. Azimuth: 0 front, 90 the figure's left (the figure faces the left of that picture),
180 the back, 270 the figure's right (it faces the right of that picture).
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

out = os.path.abspath(sys.argv[1])
front_path = sys.argv[2]
others = [(float(a.split(':', 1)[0]), a.split(':', 1)[1]) for a in sys.argv[3:]]
os.makedirs(out, exist_ok=True)


def cut(path):
    """The figure by its skin: warm (red well above blue) where a backdrop, a floor and a shadow are grey. For a bald, bare figure on a plain studio."""
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255
    chroma = rgb[:, :, 0] - rgb[:, :, 2]
    gap = chroma > 0.06
    gap = ndimage.binary_opening(gap, iterations=1)
    labels, n = ndimage.label(gap)
    if n > 1:
        sizes = ndimage.sum(gap, labels, range(1, n + 1))
        gap = labels == (1 + int(np.argmax(sizes)))
    gap = ndimage.binary_closing(gap, iterations=14)
    gap = ndimage.binary_fill_holes(gap)
    # The scalp's highlight is white, not skin: it bites a notch out of the crown. A head is convex, so its top tenth is filled to its hull.
    from PIL import ImageDraw
    from scipy.spatial import ConvexHull

    rows = np.nonzero(gap.any(axis=1))[0]
    r0, r1 = rows[0], rows[0] + int(0.10 * (rows[-1] - rows[0]))
    ys, xs = np.nonzero(gap[r0:r1])
    hull = ConvexHull(np.stack([xs, ys + r0], axis=1))
    pts = [(float(xs[v]), float(ys[v] + r0)) for v in hull.vertices]
    canvas = Image.new('L', (gap.shape[1], gap.shape[0]), 0)
    ImageDraw.Draw(canvas).polygon(pts, fill=255)
    gap = gap | (np.asarray(canvas) > 0)
    return Image.open(path).convert('RGB'), gap


def box(mask):
    rows, cols = np.nonzero(mask)
    return rows.min(), rows.max(), cols.min(), cols.max()


def rgba(image, mask):
    a = ndimage.gaussian_filter(mask.astype(np.float32), 0.8)
    out_img = np.dstack([np.asarray(image), (np.clip(a, 0, 1) * 255).astype(np.uint8)])
    return Image.fromarray(out_img, 'RGBA')


front_img, front_mask = cut(front_path)
W, H = front_img.size
top0, bottom0, left0, right0 = box(front_mask)
height0 = bottom0 - top0
mid0 = (left0 + right0) / 2
print(f'front: {W}x{H}, crown row {top0}, feet row {bottom0} ({height0} tall), middle column {mid0:.0f}, {right0 - left0} wide')
rgba(front_img, front_mask).save(os.path.join(out, 'front.png'))
tiles = [rgba(front_img, front_mask)]
for az, path in others:
    img, mask = cut(path)
    t, b, l, r = box(mask)
    s = height0 / (b - t)
    img2 = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    mask2 = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).resize(img2.size, Image.LANCZOS)) > 127
    t2, b2, l2, r2 = box(mask2)
    canvas = Image.new('RGB', (W, H), tuple(int(v) for v in np.median(np.asarray(front_img)[:6].reshape(-1, 3), axis=0)))
    cm = np.zeros((H, W), bool)
    dx, dy = round(mid0 - (l2 + r2) / 2), top0 - t2
    canvas.paste(img2, (dx, dy))
    ys, xs = np.nonzero(mask2)
    ok = (ys + dy >= 0) & (ys + dy < H) & (xs + dx >= 0) & (xs + dx < W)
    cm[ys[ok] + dy, xs[ok] + dx] = True
    name = f'view{int(az)}.png'
    tile = rgba(canvas, cm)
    tile.save(os.path.join(out, name))
    tiles.append(tile)
    print(f'{name}: scaled {s:.3f} (was {b - t} tall, {r - l} wide), now crown {box(cm)[0]}, feet {box(cm)[1]}, middle {(box(cm)[2] + box(cm)[3]) / 2:.0f}, {box(cm)[3] - box(cm)[2]} wide')
sheet = Image.new('RGB', (W * len(tiles) // 3, H // 3), (60, 60, 66))
for k, tl in enumerate(tiles):
    small = tl.resize((W // 3, H // 3))
    sheet.paste(small, (k * W // 3, 0), small)
sheet.save(os.path.join(out, 'check.png'))
print('WROTE', out)
