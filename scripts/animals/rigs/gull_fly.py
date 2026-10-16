"""The rig for Poly by Google's Flying seagull (poly.pizza/m/6Tpj_vcWP3f, CC-BY 3.0): a gull in flight, wings up in a V, facing +X, wing tips at Y +-45.
Clips: Flap (the wing beat), Glide (wings out, still, a slow rock). Wing beats turn about X (the line of flight): the right
wing (at -Y) takes the opposite sign."""
import math

SRC = "assets/animals/candidates/6Tpj_vcWP3f.glb"
S = math.sin
TAU = 2 * math.pi

BONES = [
    ("body", None, (-30, 0, 8), (30, 0, 10), 14),
    ("head", "body", (22, 0, 10), (36, 0, 9), 7),
    ("tail", "body", (-18, 0, 8), (-46, 0, 8), 9),
    ("wL1", "body", (-2, 7, 13), (-2, 26, 23), 11),
    ("wL2", "wL1", (-2, 26, 23), (-2, 45, 33), 11),
    ("wR1", "body", (-2, -7, 13), (-2, -26, 23), 11),
    ("wR2", "wR1", (-2, -26, 23), (-2, -45, 33), 11),
]


def flap(t):
    # Down fast, up slower: the tips lag the roots.
    a = S(TAU * t)
    return {
        "wL1": ("x", 34 * a - 6),
        "wL2": ("x", 26 * S(TAU * t - 0.8)),
        "wR1": ("x", -(34 * a - 6)),
        "wR2": ("x", -26 * S(TAU * t - 0.8)),
        "body": [("y", -4 * S(TAU * t)), ("move", (0, 0, 2.5 * a))],
        "tail": ("y", 5 * S(TAU * t - 1.2)),
        "head": ("y", 3 * S(TAU * t - 0.6)),
    }


def glide(t):
    r = S(TAU * t)
    return {
        "wL1": ("x", -10 + 3 * r),
        "wL2": ("x", -8 + 4 * S(TAU * t - 0.7)),
        "wR1": ("x", 10 - 3 * r),
        "wR2": ("x", 8 - 4 * S(TAU * t - 0.7)),
        "body": ("x", 3 * r),
        "tail": ("z", 6 * S(TAU * t - 1.0)),
    }


CLIPS = {"Flap": (20, 30, flap), "Glide": (60, 30, glide)}
PREVIEW = [("Flap", 8), ("Glide", 4)]
