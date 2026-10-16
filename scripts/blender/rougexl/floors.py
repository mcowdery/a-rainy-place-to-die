"""Hotel Rouge: an upper floor's fixed parts (the corridor, the stair hall) and one floor's whole build."""
from common import (  # noqa: F401
    BLACK, CARPET, CEIL, CEILING, CORR, DAMASK, F, G_GREEN, G_WARM, GOLD, GOLD_T, IN, M, PLAN, RM, ROOF, STAIR, WOOD, box, cyl, glow, rooms,
)
import ground as G
import rooms as GR
import service as SV

U0, U1, T0, T1 = IN['u0'], IN['u1'], IN['t0'], IN['t1']


def spans(y, wall):
    """The door spans on one side of the corridor ('t1' rooms are in front of it, 't0' rooms behind it)."""
    out = []
    for r in rooms(y):
        if r['door']['wall'] == wall and (r['rect'][3] == 12.3 if wall == 't1' else r['rect'][2] == 15.0):
            out.append((r['door']['u'] - 0.71, r['door']['u'] + 0.71))
    return sorted(out)


def runs(spans_):
    cur = U0
    for a, b in spans_:
        if a > cur:
            yield cur, a
        cur = max(cur, b)
    if cur < U1:
        yield cur, U1


def slabs(y):
    """The floor's carpet and ceiling slab (the stair shaft is open, with treads for a floor)."""
    s = G.SH
    for a, b, c, e in ((U0, U1, T0, s[2]), (U0, s[0], s[2], T1), (s[0], U1, s[3], T1)):
        box(a, b, c, e, y - 0.05, y + 0.02, CARPET, 0, 'carpet')
        box(a, b, c, e, y + CEIL, min(y + 5.0, ROOF), CEILING, 0, 'ceiling')


def corridor(y):
    c0, c1 = CORR['t0'], CORR['t1']
    front = spans(y, 't1')
    # (the stair hall opens off the corridor's back side: no rail runs across its mouth)
    back = sorted(spans(y, 't0') + [(STAIR['hall'][0], STAIR['hall'][1])])
    for z0, z1 in ((0.0, 0.14), (0.95, 1.0)):
        for a, b in runs(front):
            F(a, b, c0, c0 + 0.03, z0, z1, GOLD_T, y, 0.003, 'rail')
        for a, b in runs(back):
            F(a, b, c1 - 0.03, c1, z0, z1, GOLD_T, y, 0.003, 'rail')
    for u in (12.35, 21.45):
        F(u - 0.1, u + 0.1, c0, c0 + 0.1, 1.9, 2.2, G_WARM, y, 0.004, 'sconce')
        F(u - 0.1, u + 0.1, c1 - 0.1, c1, 1.9, 2.2, G_WARM, y, 0.004, 'sconce')
    u = 5.0
    while u < U1 - 0.5:
        cyl(u, (c0 + c1) / 2, y + CEIL - 0.02, y + CEIL, 0.1, G_WARM, 14, name='downlight')
        u += 3.0
    F(U1 - 0.08, U1 - 0.04, (c0 + c1) / 2 - 0.4, (c0 + c1) / 2 + 0.4, 2.55, 2.75, G_GREEN, y, 0, 'exit')
    # The end walls of the corridor: gold skirting and a dado on both.
    for z0, z1 in ((0.0, 0.14), (0.95, 1.0)):
        F(U0, U0 + 0.03, c0, c1, z0, z1, GOLD_T, y, 0.003, 'rail')
        F(U1 - 0.03, U1, c0, c1, z0, z1, GOLD_T, y, 0.003, 'rail')


def stair_hall(y):
    """The stair hall's west wall: the back of the room beside it, which had shown bare (that room's own colour) from
    the hall. Damask, with the corridor's skirting and dado."""
    h0 = STAIR['hall'][0]
    c1 = CORR['t1']
    n = min(r['rect'][2] for r in rooms(y) if r['rect'][0] >= h0 and r['door']['wall'] == 't0') - 0.1
    F(h0 - 0.1, h0, c1 + 0.1, n, 0, CEIL, DAMASK, y, 0, 'hall_wall')
    for z0, z1 in ((0.0, 0.14), (0.95, 1.0)):
        F(h0, h0 + 0.03, c1 + 0.1, n, z0, z1, GOLD_T, y, 0, 'rail')
    F(h0 + 0.02, h0 + 0.1, (c1 + n) / 2 - 0.1, (c1 + n) / 2 + 0.1, 1.9, 2.2, G_WARM, y, 0, 'sconce')


def build(y):
    """One storey's fixed parts and all its rooms."""
    slabs(y)
    corridor(y)
    stair_hall(y)
    for r in rooms(y):
        if r['kind'] == 'guest':
            GR.guest(r)
        else:
            SV.service(r)


def floor_lights(y, point):
    c0, c1 = CORR['t0'], CORR['t1']
    u = 5.0
    while u < U1 - 0.5:
        point(u, (c0 + c1) / 2, y + CEIL - 0.3, (1.0, 0.7, 0.5), 45, 0.15, 'corridor')
        u += 3.0
    point(23.2, 16.4, y + CEIL - 0.3, (1.0, 0.8, 0.6), 40, 0.15, 'stair_hall')
    point(STAIR['hall'][0] + 0.9, 16.45, y + 2.2, (1.0, 0.7, 0.45), 10, 0.1, 'hall_sconce')
    point(U1 - 0.3, (c0 + c1) / 2, y + 2.7, (0.2, 1.0, 0.4), 6, 0.05, 'exit')
    for r in rooms(y):
        R = RM(r)
        if r['kind'] == 'guest':
            GR.room_lights(R, r['theme'], point)
        else:
            SV.service_lights(R, point)
