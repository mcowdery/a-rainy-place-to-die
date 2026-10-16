"""How coarse a mesh is, as numbers: python scripts/props/mesh_rough.py <a.glb> [<b.glb> ...]

Faceting shows as large flat triangles. Prints the triangle count, the median and 95th-percentile edge length (in the file's units: the
figures are about 0.9 tall), and the mean angle between neighbouring faces (a smooth surface has small ones; a faceted one big ones, a rough
one both). Reads the first mesh primitive's POSITION and indices from the .glb itself, no other library.
"""
import json
import struct
import sys

import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def load(path):
    d = open(path, 'rb').read()
    n = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20 : 20 + n])
    off = 20 + n
    blen = struct.unpack('<I', d[off : off + 4])[0]
    blob = d[off + 8 : off + 8 + blen]

    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        cnt = NC[a['type']]
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        return np.frombuffer(blob, CT[a['componentType']], a['count'] * cnt, start).reshape(a['count'], cnt)

    p = j['meshes'][0]['primitives'][0]
    return acc(p['attributes']['POSITION']).astype(np.float64), acc(p['indices']).reshape(-1, 3).astype(np.int64)


for path in sys.argv[1:]:
    V, F = load(path)
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    L = np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1)
    tri = V[F]
    nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    area = np.linalg.norm(nrm, axis=1)
    nrm /= np.maximum(area[:, None], 1e-12)
    # neighbouring faces by shared edge
    key = np.sort(e, axis=1)
    order = np.lexsort((key[:, 1], key[:, 0]))
    ks = key[order]
    same = np.all(ks[1:] == ks[:-1], axis=1)
    fa = (order[:-1][same]) % len(F)
    fb = (order[1:][same]) % len(F)
    ang = np.degrees(np.arccos(np.clip((nrm[fa] * nrm[fb]).sum(axis=1), -1, 1)))
    print(f'{path.split("/")[-1]:24s} tris {len(F):7d}  edge median {np.median(L):.5f} p95 {np.percentile(L, 95):.5f}  neighbour angle mean {ang.mean():.2f} p95 {np.percentile(ang, 95):.1f} deg')
