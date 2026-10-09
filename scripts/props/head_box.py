"""Where a head close-up's figure lies in the body picture's pixels, for stitch_head.py: by the two faces' own
landmarks (the ears' and eyes' spread gives the scale, the nose the place).
  python head_box.py <body marks.json> <head marks.json>   (both from scripts/props/figure_landmarks.py)
Prints: <body box> <head box in body pixels> <neckline y> <the head piece's lower edge y>"""
import json, sys
import numpy as np
b, h = (json.load(open(p, encoding='utf8')) for p in sys.argv[1:3])
def px(m, name):
    x0, x1, y0, y1 = m['box']; j = m['joints'][name]
    return np.array([x0 + j['u'] * (x1 - x0), y0 + j['v'] * (y1 - y0)])
pairs = [('left_ear', 'right_ear'), ('left_eye_outer', 'right_eye_outer'), ('mouth_left', 'mouth_right'), ('left_eye', 'mouth_left'), ('right_eye', 'mouth_right')]
ratios = [np.linalg.norm(px(b, a) - px(b, c)) / np.linalg.norm(px(h, a) - px(h, c)) for a, c in pairs]
k = float(np.median(ratios))
nb, nh = px(b, 'nose'), px(h, 'nose')
hx0, hx1, hy0, hy1 = h['box']
box = [nb[0] + (hx0 - nh[0]) * k, nb[0] + (hx1 - nh[0]) * k, nb[1] + (hy0 - nh[1]) * k, nb[1] + (hy1 - nh[1]) * k]
mouth = (px(b, 'mouth_left')[1] + px(b, 'mouth_right')[1]) / 2
shoulder = (px(b, 'left_shoulder')[1] + px(b, 'right_shoulder')[1]) / 2
neck = mouth + 0.62 * (shoulder - mouth)
bx0, bx1, by0, by1 = b['box']
print('ratios', [round(r, 3) for r in ratios], 'scale', round(k, 4), file=sys.stderr)
print(f"{bx0},{bx1},{by0},{by1} {box[0]:.0f},{box[1]:.0f},{box[2]:.0f},{box[3]:.0f} {neck:.0f} {box[3] - 4:.0f}")
