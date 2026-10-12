"""Fits a skeleton and clips to a static animal model from its own shape, so one short spec file rigs one model (see rig.py):

    KIND = 'quad' | 'bird' | 'flyer' | 'fish'
    SRC = 'assets/animals/candidates/<id>.glb'
    FORWARD = '-y'            which way it faces in Blender's Z-up space: '-y', '+y', '-x' or '+x' (Poly's models mostly face -Y)
    OPTS = {...}              optional: sit, loaf (quad); peck (bird); see each fit below

The fit reads the vertices: the lowest ones are the paws or feet (split into left and right, front and hind), the highest
forward ones the head, the farthest behind the tail's tip; the rest of the bones are placed between them in the proportions
of a walking animal. It is rough and is meant for the standing, side-on, four-legged and two-legged low-poly models; a model
that sprawls (a lizard, a crab) or is posed mid-stride needs a hand spec like rigs/cat.py. Angles are about the world's
lateral axis (so a leg swings), positive = what hangs below the joint swings back: `Frame.back(deg)` gives the pair.
"""
import math
from mathutils import Vector

S = math.sin
C = math.cos
TAU = 2 * math.pi


class Frame:
    def __init__(self, verts, forward):
        self.sgn = -1 if forward[0] == "-" else 1
        self.fi = 1 if forward[1] == "y" else 0
        self.li = 1 - self.fi
        self.us = [self.sgn * v[self.fi] for v in verts]
        self.ls = [v[self.li] for v in verts]
        self.zs = [v.z for v in verts]
        self.U0, self.U1 = min(self.us), max(self.us)
        self.L = self.U1 - self.U0
        self.Z0, self.Z1 = min(self.zs), max(self.zs)
        self.H = self.Z1 - self.Z0
        self.lc = (min(self.ls) + max(self.ls)) / 2
        self.W = max(self.ls) - min(self.ls)
        self.lat = "x" if self.li == 0 else "y"
        self.fwdaxis = "y" if self.fi == 1 else "x"
        # About the lateral axis, a positive turn swings what hangs down towards +Y (axis x) or -X (axis y): that is
        # backwards if the animal faces -Y or +X.
        self.s = 1 if ((self.fi == 1 and self.sgn == -1) or (self.fi == 0 and self.sgn == 1)) else -1
        self.n = len(verts)

    def P(self, u, l, z):
        v = [0.0, 0.0, z]
        v[self.fi] = self.sgn * u
        v[self.li] = l + self.lc
        return tuple(v)

    def back(self, deg):
        return (self.lat, self.s * deg)

    def idx(self, pred):
        return [i for i in range(self.n) if pred(self.us[i], self.ls[i] - self.lc, self.zs[i])]

    def mean(self, ids):
        if not ids:
            return None
        return (sum(self.us[i] for i in ids) / len(ids), sum(self.ls[i] - self.lc for i in ids) / len(ids), sum(self.zs[i] for i in ids) / len(ids))


def percentile(vals, p):
    v = sorted(vals)
    return v[min(len(v) - 1, int(len(v) * p))]


def paws(f, zfrac=0.22, ends=0.0):
    """The four paws (or two feet): {(side, end): (u, l, z)}; side +1 left (greater l), end +1 front."""
    # (Not on the midline: that is the tail's tip or the nose, which can hang as low as a paw.)
    low = f.idx(lambda u, l, z: z < f.Z0 + zfrac * f.H and f.U0 + ends * f.L < u < f.U1 - ends * f.L and abs(l) > 0.25 * f.W / 2)
    if not low:
        low = f.idx(lambda u, l, z: z < f.Z0 + zfrac * f.H)
    # The split between front and hind legs: the widest gap in u among the low vertices (the belly between the pairs).
    su = sorted(f.us[i] for i in low)
    lo, hi = int(len(su) * 0.1), int(len(su) * 0.9)
    gap = max(range(lo, max(lo + 1, hi)), key=lambda k: su[k + 1] - su[k]) if len(su) > 4 else len(su) // 2
    um = (su[gap] + su[min(gap + 1, len(su) - 1)]) / 2
    out = {}
    for side in (1, -1):
        for end in (1, -1):
            ids = [i for i in low if ((f.ls[i] - f.lc) >= 0) == (side > 0) and (f.us[i] >= um) == (end > 0)]
            m = f.mean(ids)
            out[(side, end)] = m
    # A missing paw takes its mirror's, or its pair's.
    for (side, end), m in list(out.items()):
        if m is None:
            o = out.get((-side, end)) or out.get((side, -end)) or (f.U0 + f.L * (0.7 if end > 0 else 0.3), 0, f.Z0)
            out[(side, end)] = (o[0], abs(o[1]) * side if o[1] else f.W * 0.25 * side, o[2])
    return out


# ---------------------------------------------------------------- quadrupeds

def quad(verts, forward, opts):
    f = Frame(verts, forward)
    L, H = f.L, f.H
    pw = paws(f)
    mid = f.idx(lambda u, l, z: f.U0 + 0.3 * L < u < f.U1 - 0.3 * L)
    zt = percentile([f.zs[i] for i in mid] or f.zs, 0.8)
    hb = zt - f.Z0  # the body's height
    zsp = zt - 0.1 * hb
    zhip = f.Z0 + 0.7 * hb
    zknee = f.Z0 + 0.38 * hb
    zank = f.Z0 + 0.09 * hb
    fu = sum(pw[(s, 1)][0] for s in (1, -1)) / 2
    hu = sum(pw[(s, -1)][0] for s in (1, -1)) / 2
    headv = f.idx(lambda u, l, z: u > f.U1 - 0.18 * L)
    hm = f.mean(headv) or (f.U1 - 0.09 * L, 0, zt)
    neck_u = f.U1 - 0.2 * L
    rump_u = hu - 0.07 * L
    # The tail's tip: the farthest vertex from the rump among those behind it.
    rump = Vector(f.P(rump_u, 0, zsp + 0.04 * H))
    behind = [i for i in range(f.n) if f.us[i] < rump_u and f.zs[i] > zsp - 0.3 * H]
    if behind:
        tipi = min(behind, key=lambda i: f.us[i])
        tip = verts[tipi]
    else:
        tip = Vector(f.P(rump_u - 0.12 * L, 0, zsp + 0.05 * H))
    up = tip.z > zt
    R = lambda frac: H * frac
    BONES = [
        ("pelvis", None, f.P(rump_u + 0.04 * L, 0, zsp), f.P((fu + hu) / 2, 0, zsp), R(0.16)),
        ("chest", "pelvis", f.P((fu + hu) / 2, 0, zsp), f.P(fu + 0.03 * L, 0, zsp), R(0.16)),
        ("neck", "chest", f.P(fu + 0.03 * L, 0, zsp), f.P(neck_u, 0, hm[2] + 0.03 * H), R(0.085), 3),
        ("head", "neck", f.P(neck_u, 0, hm[2] + 0.03 * H), f.P(f.U1, 0, hm[2] - 0.01 * H), R(0.11), 3),
    ]
    for k in range(3):
        a = rump + (tip - rump) * (k / 3)
        b = rump + (tip - rump) * ((k + 1) / 3)
        BONES.append((f"tail{k + 1}", "pelvis" if k == 0 else f"tail{k}", tuple(a), tuple(b), R(0.055)))
    for side, name in ((1, "L"), (-1, "R")):
        for end, pre, parent in ((1, "f", "chest"), (-1, "h", "pelvis")):
            pu, pl, _ = pw[(side, end)]
            if end > 0:
                hip_u, knee_u = pu + 0.02 * L, pu
            else:
                hip_u, knee_u = pu - 0.05 * L, pu - 0.09 * L
            BONES += [
                (f"{pre}{name}_u", parent, f.P(hip_u, pl, zhip), f.P(knee_u, pl, zknee), R(0.1), 4),
                (f"{pre}{name}_l", f"{pre}{name}_u", f.P(knee_u, pl, zknee), f.P(pu, pl, zank), R(0.075), 4),
                (f"{pre}{name}_f", f"{pre}{name}_l", f.P(pu, pl, zank), f.P(pu + 0.07 * L, pl, f.Z0 + 0.03 * hb), R(0.07), 4),
            ]
    B = f.back
    sit_drop = 0.55 * hb
    loaf_drop = 0.24 * H

    def walk(t, amp=1.0):
        pose = {}
        for side, ph in (("L", 0.0), ("R", 0.5)):
            for pre, flip in (("f", 0.0), ("h", 0.5)):
                p = (t + ph + flip) % 1.0
                swing = S(TAU * p)
                lift = max(0.0, -C(TAU * p))
                if pre == "f":
                    pose[f"f{side}_u"] = B(24 * amp * swing)
                    pose[f"f{side}_l"] = B(38 * amp * lift)
                    pose[f"f{side}_f"] = B(-14 * amp * lift)
                else:
                    pose[f"h{side}_u"] = B(26 * amp * swing)
                    pose[f"h{side}_l"] = B(-34 * amp * lift)
                    pose[f"h{side}_f"] = B(18 * amp * lift)
        pose["chest"] = B(3 * amp * S(TAU * t * 2))
        pose["pelvis"] = B(-3 * amp * S(TAU * t * 2))
        pose["neck"] = B(-4 * amp * S(TAU * t * 2 + 1.0))
        pose["tail1"] = [B(-8 if up else 0), ("z", 9 * S(TAU * t))]
        pose["tail2"] = ("z", 14 * S(TAU * t - 0.8))
        pose["tail3"] = ("z", 16 * S(TAU * t - 1.6))
        return pose

    def run(t):
        pose = {}
        for pre in ("f", "h"):
            for side in ("L", "R"):
                ph = (t + (0.0 if pre == "f" else 0.45) + (0.04 if side == "R" else 0.0)) % 1.0
                swing = S(TAU * ph)
                lift = max(0.0, -C(TAU * ph))
                if pre == "f":
                    pose[f"f{side}_u"] = B(40 * swing - 8)
                    pose[f"f{side}_l"] = B(50 * lift)
                    pose[f"f{side}_f"] = B(-20 * lift)
                else:
                    pose[f"h{side}_u"] = B(42 * swing + 6)
                    pose[f"h{side}_l"] = B(-46 * lift)
                    pose[f"h{side}_f"] = B(24 * lift)
        arch = S(TAU * t)
        pose["pelvis"] = B(9 * arch)
        pose["chest"] = B(-9 * arch)
        pose["neck"] = B(6 * arch)
        pose["tail1"] = [B(-50 if up else -10), ("z", 6 * S(TAU * t))]
        pose["tail2"] = [B(-10 + 8 * S(TAU * t) if up else 0)]
        pose["tail3"] = B(12 * S(TAU * t - 1) if up else 0)
        return pose

    def idle(t):
        b = S(TAU * t)
        return {
            "chest": B(1.2 * b),
            "neck": B(-1.5 * b),
            "head": B(2 * S(TAU * t + 1.2)),
            "tail1": [B(-6 if up else 0), ("z", 6 * S(TAU * t))],
            "tail2": ("z", 12 * S(TAU * t - 0.9)),
            "tail3": ("z", 16 * S(TAU * t - 1.8)),
        }

    def sit(t):
        # (The pelvis's drop is a first guess: rig.py slides it till the lowest of the body just touches the floor.)
        tilt = opts.get("tilt", 38)
        pose = {
            "pelvis": [B(-tilt), ("move", (0, 0, -sit_drop))],
            "chest": B(-4),
            "neck": B(tilt - 18),
            "head": B(12),
            # The tail: a standing one goes down along the ground behind; a hanging one is turned back level with the floor.
            "tail1": B(104 if up else tilt + 6),
            "tail2": B(14 if up else 0),
        }
        for side in ("L", "R"):
            pose[f"f{side}_u"] = B(tilt + 6)
            if opts.get("simplesit"):
                # A body whose hind legs are fused to it (a Shiba, a fox, a raccoon): the rump is lowered and the hind legs
                # stay under it, only turned to hang straight, so the haunch stays one piece.
                pose[f"h{side}_u"] = B(-45)
                pose[f"h{side}_l"] = B(125)
                pose[f"h{side}_f"] = B(-95)
            else:
                pose[f"h{side}_u"] = B(-38)
                pose[f"h{side}_l"] = B(165)
                pose[f"h{side}_f"] = B(-150)
        return pose

    # A head carried level with the back (a raccoon, a fox) has little neck to bend: its sniff is smaller.
    rise = max(0.0, (hm[2] - zsp) / H)
    sk = max(0.35, min(1.0, rise / 0.1))

    def sniff(t):
        """Standing, the head down to the ground and moving about."""
        w = S(TAU * t)
        return {
            "neck": B(sk * (34 + 4 * w)),
            "head": B(sk * (26 + 6 * S(TAU * t * 2))),
            "chest": B(4 * sk),
            "tail1": [B(-6 if up else 0), ("z", 10 * S(TAU * t * 2))],
            "tail2": ("z", 16 * S(TAU * t * 2 - 0.8)),
        }

    CLIPS = {"Idle": (60, 30, idle), "Walk": (30, 30, walk), "Run": (16, 30, run), "Sniff": (60, 30, sniff)}
    PREVIEW = [("Walk", 6), ("Run", 6), ("Idle", 2), ("Sniff", 2)]
    out = dict(BONES=BONES, CLIPS=CLIPS, PREVIEW=PREVIEW)
    if opts.get("sit", True):
        CLIPS["Sit"] = (1, 30, sit)
        PREVIEW.append(("Sit", 1))
        out["GROUNDED"] = ("Sit",)
    return out


# ---------------------------------------------------------------- standing birds

def bird(verts, forward, opts):
    f = Frame(verts, forward)
    L, H, W = f.L, f.H, f.W
    # The hips: the lowest height at which the body is as wide as the rest of it.
    bins = 24
    ext = [[1e9, -1e9] for _ in range(bins)]
    for i in range(f.n):
        b = min(bins - 1, int((f.zs[i] - f.Z0) / max(H, 1e-6) * bins))
        e = ext[b]
        e[0] = min(e[0], f.ls[i])
        e[1] = max(e[1], f.ls[i])
    widths = [max(0, e[1] - e[0]) for e in ext]
    wmax = max(widths)
    hb = next((b for b in range(bins) if widths[b] > 0.45 * wmax), 0)
    zhip = f.Z0 + (hb / bins) * H + 0.02 * H
    pw = paws(f, zfrac=max(0.08, (hb / bins) * 0.5 + 0.03), ends=0.0)
    ftu = (pw[(1, 1)][0] + pw[(1, -1)][0] + pw[(-1, 1)][0] + pw[(-1, -1)][0]) / 4
    # A bird's two feet: left and right, whichever end they fall.
    feet = {}
    for side in (1, -1):
        pts = [pw[(side, e)] for e in (1, -1)]
        feet[side] = (sum(p[0] for p in pts) / 2, abs(sum(p[1] for p in pts) / 2) * side or W * 0.12 * side, f.Z0)
    top = f.idx(lambda u, l, z: z > f.Z1 - 0.2 * H)
    hm = f.mean(top) or (f.U1 - 0.2 * L, 0, f.Z1)
    zb = zhip + 0.22 * (f.Z1 - zhip) if (f.Z1 - zhip) < 3 * (hm[2] - zhip) else zhip + 0.18 * (f.Z1 - zhip)
    uc = hm[0] - 0.3 * max(0.1 * L, hm[0] - f.U0 - 0.3 * L) if False else f.U0 + 0.55 * L
    R = lambda frac: H * frac
    BONES = [
        ("body", None, f.P(f.U0 + 0.08 * L, 0, zb), f.P(uc, 0, zb), R(0.3)),
        ("neck", "body", f.P(uc, 0, zb), f.P(hm[0], 0, hm[2] - 0.04 * H), R(0.1)),
        ("head", "neck", f.P(hm[0], 0, hm[2] - 0.04 * H), f.P(f.U1, 0, hm[2] - 0.06 * H), R(0.1)),
    ]
    for side, name in ((1, "L"), (-1, "R")):
        fu_, fl_, _ = feet[side]
        BONES += [
            (f"{name}_leg", "body", f.P(fu_, fl_, zhip), f.P(fu_, fl_, f.Z0 + 0.05 * H), R(0.05), 4),
            (f"{name}_foot", f"{name}_leg", f.P(fu_, fl_, f.Z0 + 0.05 * H), f.P(fu_ + 0.1 * L, fl_, f.Z0 + 0.01 * H), R(0.045), 4),
        ]
    B = f.back

    def walk(t):
        pose = {}
        for name, ph in (("L", 0.0), ("R", 0.5)):
            p = (t + ph) % 1.0
            sw = S(TAU * p)
            lift = max(0.0, -C(TAU * p))
            pose[f"{name}_leg"] = B(26 * sw)
            pose[f"{name}_foot"] = B(-30 * lift + 8)
        pose["body"] = [B(-2 * S(TAU * t * 2)), ("move", (0, 0, 0.012 * H * S(TAU * t * 2 + 1.0)))]
        pose["neck"] = B(-7 * S(TAU * t * 2 + 0.5))
        pose["head"] = B(5 * S(TAU * t * 2 + 1.5))
        return pose

    def run(t):
        pose = {}
        for name, ph in (("L", 0.0), ("R", 0.5)):
            p = (t + ph) % 1.0
            sw = S(TAU * p)
            lift = max(0.0, -C(TAU * p))
            pose[f"{name}_leg"] = B(44 * sw)
            pose[f"{name}_foot"] = B(-50 * lift + 8)
        pose["body"] = [B(-8), ("move", (0, 0, 0.02 * H * S(TAU * t * 2 + 1.0)))]
        pose["neck"] = B(-10 + 6 * S(TAU * t * 2))
        return pose

    def idle(t):
        b = S(TAU * t)
        return {
            "body": B(0.8 * b),
            "neck": [B(-1 * b), ("z", 18 * S(TAU * t * 0.5))],
            "head": [B(1.5 * S(TAU * t + 1)), ("z", 14 * S(TAU * t + 0.7))],
        }

    def peck(t):
        # Two quick dips and up again.
        d = max(0.0, S(TAU * t * 2)) ** 1.5
        return {
            "body": B(12 * d),
            "neck": B(52 * d),
            "head": B(18 * d),
        }

    CLIPS = {"Idle": (60, 30, idle), "Walk": (30, 30, walk), "Run": (14, 30, run), "Peck": (45, 30, peck)}
    PREVIEW = [("Walk", 6), ("Run", 6), ("Peck", 6), ("Idle", 2)]
    return dict(BONES=BONES, CLIPS=CLIPS, PREVIEW=PREVIEW)


# ---------------------------------------------------------------- fliers with their wings out

def flyer(verts, forward, opts):
    f = Frame(verts, forward)
    L, W, H = f.L, f.W, f.H
    ax = f.fwdaxis
    # A wing beat turns about the line of flight; the sign that raises the wing on the side `sl` (+1 greater l).
    raise_ = lambda sl: sl if ax == "x" else -sl
    wing = f.idx(lambda u, l, z: abs(l) > 0.2 * W * 0.5 * 2 * 0.5)
    tipL = f.mean(f.idx(lambda u, l, z: l > 0.4 * W)) or (f.U0 + 0.5 * L, 0.45 * W, f.Z0 + 0.5 * H)
    tipR = f.mean(f.idx(lambda u, l, z: l < -0.4 * W)) or (f.U0 + 0.5 * L, -0.45 * W, f.Z0 + 0.5 * H)
    body = f.idx(lambda u, l, z: abs(l) < 0.08 * W)
    bm = f.mean(body) or (f.U0 + 0.5 * L, 0, f.Z0 + 0.5 * H)
    zc = bm[2]
    R = lambda frac: W * frac
    BONES = [
        ("body", None, f.P(f.U0 + 0.1 * L, 0, zc), f.P(f.U1 - 0.1 * L, 0, zc), R(0.14)),
        ("head", "body", f.P(f.U1 - 0.25 * L, 0, zc), f.P(f.U1, 0, zc), R(0.08)),
        ("tail", "body", f.P(f.U0 + 0.3 * L, 0, zc), f.P(f.U0, 0, zc), R(0.1)),
    ]
    for side, name, tip in ((1, "L", tipL), (-1, "R", tipR)):
        root = f.P(bm[0], 0.06 * W * side, zc)
        mid = f.P((bm[0] + tip[0]) / 2, 0.5 * (0.06 * W + tip[1]) , (zc + tip[2]) / 2)
        BONES += [
            (f"w{name}1", "body", root, mid, R(0.2)),
            (f"w{name}2", f"w{name}1", mid, f.P(tip[0], tip[1], tip[2]), R(0.2)),
        ]
    rate = opts.get("flap", 1.0)

    def flap(t):
        a = S(TAU * t)
        pose = {"body": ("move", (0, 0, 0.02 * W * a))}
        for sl, name in ((1, "L"), (-1, "R")):
            k = raise_(sl)
            pose[f"w{name}1"] = (ax, k * (34 * a - 6))
            pose[f"w{name}2"] = (ax, k * 26 * S(TAU * t - 0.8))
        pose["tail"] = ("z", 5 * S(TAU * t - 1.2))
        return pose

    def glide(t):
        r = S(TAU * t)
        pose = {"tail": ("z", 6 * S(TAU * t - 1.0))}
        for sl, name in ((1, "L"), (-1, "R")):
            k = raise_(sl)
            pose[f"w{name}1"] = (ax, k * (-10 + 3 * r))
            pose[f"w{name}2"] = (ax, k * (-8 + 4 * S(TAU * t - 0.7)))
        return pose

    def hover(t):
        a = S(TAU * t)
        pose = {"body": ("move", (0, 0, 0.01 * W * a))}
        for sl, name in ((1, "L"), (-1, "R")):
            k = raise_(sl)
            pose[f"w{name}1"] = (ax, k * 40 * a)
            pose[f"w{name}2"] = (ax, k * 14 * S(TAU * t - 0.5))
        return pose

    CLIPS = {"Flap": (int(20 / rate), 30, flap), "Glide": (60, 30, glide), "Hover": (6, 30, hover)}
    PREVIEW = [("Flap", 8), ("Glide", 3)]
    return dict(BONES=BONES, CLIPS=CLIPS, PREVIEW=PREVIEW, VIEW_FROM="head")


# ---------------------------------------------------------------- fish

def fish(verts, forward, opts):
    f = Frame(verts, forward)
    L, H = f.L, f.H
    zc = (f.Z0 + f.Z1) / 2
    n = 5
    BONES = []
    for i in range(n):
        u0 = f.U1 - (i / n) * L
        u1 = f.U1 - ((i + 1) / n) * L
        BONES.append((f"s{i}", None if i == 0 else f"s{i - 1}", f.P(u0, 0, zc), f.P(u1, 0, zc), L * 0.17 if i < n - 1 else L * 0.12))

    def swim(t):
        return {f"s{i}": ("z", (4 + 6 * i) * S(TAU * (t - i * 0.12))) for i in range(1, n)}

    def idle(t):
        return {f"s{i}": ("z", (1.5 + 2.5 * i) * S(TAU * (t - i * 0.12))) for i in range(1, n)}

    CLIPS = {"Swim": (40, 30, swim), "Idle": (90, 30, idle)}
    return dict(BONES=BONES, CLIPS=CLIPS, PREVIEW=[("Swim", 6)], VIEW_FROM="top")


# ---------------------------------------------------------------- crawlers: sprawled legs (lizards, turtles, insects, crabs)

def crawler(verts, forward, opts):
    f = Frame(verts, forward)
    L, W, H = f.L, f.W, f.H
    n_legs = opts.get("legs", 2)  # a side's legs, front to back
    lat = opts.get("lat", 0.3)  # a foot is at least this share of the half-width out
    zb = f.Z0 + 0.4 * H
    # Feet: low vertices well out to a side, split into n_legs groups along the length by quantile.
    feet = {}
    for side in (1, -1):
        ids = f.idx(lambda u, l, z: z < f.Z0 + opts.get("zfrac", 0.35) * H and l * side > lat * W * 0.5)
        ids.sort(key=lambda i: -f.us[i])
        for g in range(n_legs):
            chunk = ids[g * len(ids) // n_legs:(g + 1) * len(ids) // n_legs] or ids
            m = f.mean(chunk) if chunk else (f.U0 + L * (0.7 - 0.4 * g / max(1, n_legs - 1)), side * 0.3 * W, f.Z0)
            feet[(side, g)] = m
    # The spine: five bones from the head to the tail along the midline.
    n = 5
    BONES = []
    zc = (f.Z0 + f.Z1) / 2 if opts.get("mid", False) else zb
    for i in range(n):
        u0 = f.U1 - (i / n) * L
        u1 = f.U1 - ((i + 1) / n) * L
        BONES.append((f"s{i}", None if i == 0 else f"s{i - 1}", f.P(u0, 0, zc), f.P(u1, 0, zc), L * 0.16))
    Ff = Vector((0, 0, 0))
    Ff[f.fi] = f.sgn
    legs = []
    r = min(W, L) * opts.get("r", 0.2)
    for (side, g), (fu, fl, fz) in feet.items():
        name = f"{'L' if side > 0 else 'R'}{g}"
        # Which spine bone it hangs from, by where along the length it is.
        k = max(0, min(n - 1, int((f.U1 - fu) / L * n)))
        hip = f.P(fu, side * 0.12 * W, zc)
        foot = f.P(fu, fl, fz)
        BONES.append((f"leg{name}", f"s{k}", hip, foot, r, 4))
        rel = Vector(foot) - Vector(hip)
        kfwd = -rel.y * Ff.x + rel.x * Ff.y
        legs.append((name, side, g, 1.0 if kfwd >= 0 else -1.0))
    amp = opts.get("amp", 28)
    wig = opts.get("wiggle", 10)

    def walk(t, speed=1.0, amp_=1.0):
        pose = {}
        for name, side, g, sgn in legs:
            # Alternate legs: the front left with the hind right, and so on; a row of legs a half step apart.
            ph = (t + (0.0 if (g + (0 if side > 0 else 1)) % 2 == 0 else 0.5)) % 1.0
            pose[f"leg{name}"] = ("z", sgn * amp * amp_ * S(TAU * ph))
        for i in range(n):
            pose[f"s{i}"] = ("z", wig * amp_ * S(TAU * (t - i * 0.14)) * (0.5 + i / n))
        return pose

    def run(t):
        return walk(t, 1.0, 1.5)

    def idle(t):
        b = S(TAU * t)
        return {"s0": ("z", 10 * S(TAU * t * 0.5)), "s1": ("z", 4 * S(TAU * t * 0.5 + 1)), "s2": ("z", 1.5 * b), "s4": ("z", 8 * S(TAU * t - 1.0))}

    CLIPS = {"Idle": (80, 30, idle), "Walk": (30, 30, walk), "Run": (16, 30, run)}
    return dict(BONES=BONES, CLIPS=CLIPS, PREVIEW=[("Walk", 6), ("Idle", 2)], VIEW_FROM="top")


# ---------------------------------------------------------------- a body in a row of bones: frogs hop, snails glide

def chain(verts, forward, opts):
    f = Frame(verts, forward)
    L, H = f.L, f.H
    n = opts.get("bones", 4)
    zc = f.Z0 + opts.get("zfrac", 0.4) * H
    BONES = []
    for i in range(n):
        u0 = f.U1 - (i / n) * L
        u1 = f.U1 - ((i + 1) / n) * L
        BONES.append((f"s{i}", None if i == 0 else f"s{i - 1}", f.P(u0, 0, zc), f.P(u1, 0, zc), L * 0.2))
    B = f.back
    hop = opts.get("hop", 0.0)  # a hop's height as a share of the body's height

    def move(t):
        if hop:
            # Crouch (0-0.3), spring (0.3-0.5), up and over, land (0.8-1).
            h = max(0.0, S(TAU * max(0.0, (t - 0.3) / 0.5) / 2)) if 0.3 <= t <= 0.8 else 0.0
            crouch = max(0.0, S(TAU * min(t, 0.3) / 0.6)) * (1 if t < 0.3 else 0) + (max(0.0, 1 - (t - 0.8) / 0.2) * 0.8 if t > 0.8 else 0)
            pose = {"s0": [("move", (0, 0, H * hop * h - 0.12 * H * crouch)), B(-18 * h + 10 * crouch)]}
            pose["s1"] = B(14 * h - 8 * crouch)
            pose["s2"] = B(-10 * h)
            return pose
        w = opts.get("wave", 6)
        pose = {}
        for i in range(1, n):
            pose[f"s{i}"] = ("z", w * S(TAU * (t - i * 0.18)))
        pose["s0"] = B(opts.get("bob", 4) * S(TAU * t * 2))
        return pose

    def idle(t):
        b = S(TAU * t)
        return {"s0": B(2 * b), f"s{n - 1}": ("z", 3 * S(TAU * t + 1))}

    CLIPS = {"Idle": (80, 30, idle)}
    CLIPS["Hop" if hop else "Glide"] = (36 if hop else 60, 30, move)
    return dict(BONES=BONES, CLIPS=CLIPS, PREVIEW=[("Hop" if hop else "Glide", 6)])


KINDS = {"quad": quad, "bird": bird, "flyer": flyer, "fish": fish, "crawler": crawler, "chain": chain}


def generate(kind, verts, forward, opts):
    return KINDS[kind](verts, forward, opts or {})
