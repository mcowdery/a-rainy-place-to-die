"""The rig for Poly by Google's Cat (poly.pizza/m/6dM1J6f6pm9, CC-BY 3.0): a standing cat facing -Y, 84 units long, feet at Z -35.6.
Clips: Idle (it breathes, the tail sways), Walk, Run, Sit, Loaf. Angles are about the world X axis: a positive turn swings
what hangs below a joint towards +Y (backwards: it faces -Y), so a leg reaching forward is a negative one."""
import math

SRC = "assets/animals/candidates/6dM1J6f6pm9.glb"
XL = 4.8
S = math.sin
C = math.cos
TAU = 2 * math.pi


def leg(prefix, x, hip, knee, paw, toe, r_hip, r_leg):
    return [
        (f"{prefix}_u", None, (x, *hip), (x, *knee), r_hip),
        (f"{prefix}_l", f"{prefix}_u", (x, *knee), (x, *paw), r_leg),
        (f"{prefix}_f", f"{prefix}_l", (x, *paw), (x, *toe), r_leg),
    ]


BONES = [
    ("pelvis", None, (0, 27, -2), (0, 7, 0), 13),
    ("chest", "pelvis", (0, 7, 0), (0, -18, 0), 13),
    ("neck", "chest", (0, -18, 0), (0, -27, 3.5), 7),
    ("head", "neck", (0, -27, 3.5), (0, -41, 2), 9),
    ("tail1", "pelvis", (0, 31, 4.8), (0, 34, 12), 3.6),
    ("tail2", "tail1", (0, 34, 12), (0, 37, 21), 3.6),
    ("tail3", "tail2", (0, 37, 21), (0, 40.6, 34.8), 3.6),
]
for side, x in (("L", XL), ("R", -XL)):
    for b in leg(f"f{side}", x, (-11, -6), (-12.5, -20), (-13.4, -33.2), (-19, -35), 6, 4.5):
        BONES.append(b)
    for b in leg(f"h{side}", x, (25, -6), (29, -17), (21, -31), (14, -35), 6, 4.5):
        BONES.append(b)
# (The legs hang from the spine: fix their parents.)
_parents = {"fL_u": "chest", "fR_u": "chest", "hL_u": "pelvis", "hR_u": "pelvis"}
BONES = [(n, _parents.get(n, p), h, t, r) for n, p, h, t, r in BONES]


def walk(t, amp=1.0, bob=1.0):
    """The diagonal gait: front left with hind right, then front right with hind left."""
    pose = {}
    for side, ph in (("L", 0.0), ("R", 0.5)):
        for pre, flip in (("f", 0.0), ("h", 0.5)):
            p = (t + ph + flip) % 1.0
            swing = S(TAU * p)  # +: leg back
            lift = max(0.0, -C(TAU * p))  # the forward-moving half
            if pre == "f":
                pose[f"f{side}_u"] = ("x", 24 * amp * swing)
                pose[f"f{side}_l"] = ("x", 38 * amp * lift)
                pose[f"f{side}_f"] = ("x", -14 * amp * lift)
            else:
                pose[f"h{side}_u"] = ("x", 26 * amp * swing)
                pose[f"h{side}_l"] = ("x", -34 * amp * lift)
                pose[f"h{side}_f"] = ("x", 18 * amp * lift)
    pose["chest"] = ("x", 3 * amp * S(TAU * t * 2))
    pose["pelvis"] = ("x", -3 * amp * S(TAU * t * 2))
    pose["neck"] = ("x", -4 * amp * S(TAU * t * 2 + 1.0))
    pose["tail1"] = [("x", -8), ("z", 9 * S(TAU * t))]
    pose["tail2"] = ("z", 14 * S(TAU * t - 0.8))
    pose["tail3"] = ("z", 16 * S(TAU * t - 1.6))
    return pose


def run(t):
    """A bound: the front legs reach together and the hind legs drive together, the back arching."""
    pose = {}
    for pre in ("f", "h"):
        for side in ("L", "R"):
            ph = (t + (0.0 if pre == "f" else 0.45) + (0.04 if side == "R" else 0.0)) % 1.0
            swing = S(TAU * ph)
            lift = max(0.0, -C(TAU * ph))
            if pre == "f":
                pose[f"f{side}_u"] = ("x", 40 * swing - 8)
                pose[f"f{side}_l"] = ("x", 50 * lift)
                pose[f"f{side}_f"] = ("x", -20 * lift)
            else:
                pose[f"h{side}_u"] = ("x", 42 * swing + 6)
                pose[f"h{side}_l"] = ("x", -46 * lift)
                pose[f"h{side}_f"] = ("x", 24 * lift)
    arch = S(TAU * t)
    pose["pelvis"] = ("x", 9 * arch)
    pose["chest"] = ("x", -9 * arch)
    pose["neck"] = ("x", 6 * arch)
    pose["tail1"] = ("x", -50)
    pose["tail2"] = ("x", -10 + 8 * S(TAU * t))
    pose["tail3"] = ("x", 12 * S(TAU * t - 1))
    return pose


def idle(t):
    b = S(TAU * t)
    return {
        "chest": ("x", 1.2 * b),
        "neck": ("x", -1.5 * b),
        "head": ("x", 2 * S(TAU * t + 1.2)),
        "tail1": [("x", -6), ("z", 6 * S(TAU * t))],
        "tail2": ("z", 12 * S(TAU * t - 0.9)),
        "tail3": ("z", 16 * S(TAU * t - 1.8)),
    }


def sit(t):
    """On its haunches, the forelegs straight, the head up, the tail along the ground."""
    pose = {
        "pelvis": [("x", -44), ("move", (0, 0, -22))],
        "chest": ("x", -4),
        "neck": ("x", 22),
        "head": ("x", 12),
        "tail1": ("x", 104),
        "tail2": ("x", 14),
        "tail3": ("x", 0),
    }
    for side in ("L", "R"):
        # (The forelegs hang from the chest, which is turned up: they turn back to hang straight.)
        pose[f"f{side}_u"] = ("x", 44)
        pose[f"h{side}_u"] = ("x", -38)
        pose[f"h{side}_l"] = ("x", 165)
        pose[f"h{side}_f"] = ("x", -150)
    return pose


def loaf(t):
    """Lying with the paws tucked under it, the head up, the tail wrapped round."""
    pose = {
        "pelvis": [("x", 0), ("move", (0, 0, -17))],
        "chest": ("x", 0),
        "neck": ("x", 4),
        "head": ("x", 8),
        "tail1": ("x", 118),
        "tail2": ("x", 20),
        "tail3": ("x", 10),
    }
    for side in ("L", "R"):
        pose[f"h{side}_u"] = ("x", -80)
        pose[f"h{side}_l"] = ("x", 165)
        pose[f"h{side}_f"] = ("x", -90)
        pose[f"f{side}_u"] = ("x", -75)
        pose[f"f{side}_l"] = ("x", 150)
        pose[f"f{side}_f"] = ("x", -60)
    return pose


CLIPS = {
    "Idle": (60, 30, idle),
    "Walk": (30, 30, walk),
    "Run": (16, 30, run),
    "Sit": (1, 30, sit),
    "Loaf": (1, 30, loaf),
}
PREVIEW = [("Walk", 6), ("Sit", 1), ("Loaf", 1)]
VIEW = 1.6
