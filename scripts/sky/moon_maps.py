"""The moon's maps for the sky shader (src/poc3d/real/sky.ts), from NASA's CGI Moon Kit
(https://svs.gsfc.nasa.gov/4720: the LRO camera's colour mosaic and the laser altimeter's elevation, equirectangular,
longitude 0 at the centre of the near side).

    python scripts/sky/moon_maps.py

writes assets/sky/moon_albedo.jpg (the colour map as published, 2048 x 1024) and assets/sky/moon_normal.jpg (normals
from the elevation, 1024 x 512: x east, y north, z up, 0.5 + 0.5 n; smoothed so the 8-bit heights don't terrace, and
the relief exaggerated so the big craters and mountains catch the light along the terminator).
"""
import io
import os
import urllib.request

import numpy as np
from PIL import Image

BASE = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/'
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'sky')
# The steepest 1% of slopes come out at about this many degrees.
STEEP_DEG = 38.0


def fetch(name: str) -> bytes:
    with urllib.request.urlopen(BASE + name) as r:
        return r.read()


def blur(a: np.ndarray, sigma: float) -> np.ndarray:
    """A separable Gaussian, wrapping east-west (the map goes round) and clamped at the poles."""
    r = int(sigma * 3)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.pad(a, ((0, 0), (r, r)), mode='wrap')
    a = sum(k[i] * pad[:, i:i + a.shape[1]] for i in range(2 * r + 1))
    pad = np.pad(a, ((r, r), (0, 0)), mode='edge')
    return sum(k[i] * pad[i:i + a.shape[0], :] for i in range(2 * r + 1))


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'moon_albedo.jpg'), 'wb') as f:
        f.write(fetch('lroc_color_2k.jpg'))

    h = np.asarray(Image.open(io.BytesIO(fetch('ldem_3_8bit.jpg'))).convert('L'), dtype=np.float64)
    h = blur(h, 1.2)
    rows, cols = h.shape
    lat = (0.5 - (np.arange(rows) + 0.5) / rows) * np.pi
    # Height per pixel east (the pixels narrow toward the poles) and north (row 0 is the north pole).
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / 2 / np.maximum(np.cos(lat), 0.05)[:, None]
    dy = np.zeros_like(h)
    dy[1:-1] = (h[:-2] - h[2:]) / 2
    slope = np.hypot(dx, dy)
    k = np.tan(np.radians(STEEP_DEG)) / np.percentile(slope, 99)
    n = np.stack([-k * dx, -k * dy, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    img = np.clip(np.round((n * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8)
    Image.fromarray(img, 'RGB').save(os.path.join(OUT, 'moon_normal.jpg'), quality=92)
    print('relief scale', round(k, 3))


if __name__ == '__main__':
    main()
