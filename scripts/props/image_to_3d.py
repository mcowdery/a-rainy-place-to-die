"""
Turns one picture of an object (a prop, a statue) into a rough textured mesh (.glb) on this machine with TripoSR,
as a starting point to clean up in Blender. Tooling only: nothing it makes goes into the game by itself (a new
model is reviewed in a showroom first), and it is for one-off props and statues, not for filling the city.

Licences (read 2026-10-06; quote them again in CREDITS.md if a mesh made with this ships):
  TripoSR's code       MIT, (c) 2024 Tripo AI & Stability AI   https://github.com/VAST-AI-Research/TripoSR
  TripoSR's weights    MIT (the model card's `license: mit`)   https://huggingface.co/stabilityai/TripoSR
  background removal   rembg (MIT) with the U-2-Net model (Apache-2.0) ONLY. Newer rembg versions default to
                       BRIA's RMBG-2.0, which needs a paid agreement for commercial use: rembg is pinned below to
                       a version from before that, and this script names "u2net" itself and takes no other model.
  marching cubes       PyMCubes (BSD-3) in place of TripoSR's torchmcubes (which needs a C++ build; see below)
  the rest             PyTorch (BSD-3), transformers (Apache-2.0; only the ViT's architecture and the config.json of
                       facebook/dino-vitb16, Apache-2.0: its weights are in TripoSR's checkpoint), xatlas (MIT),
                       moderngl (MIT), trimesh (MIT), fast-simplification (MIT)
The picture you feed it has to be the project's own (or one it may use): the mesh is a derivative of it.

TripoSR's checkout and its own Python environment sit beside this repo (../TripoSR, or TRIPOSR_ROOT), like
ACE-Step's. To set it up again:

  git clone https://github.com/VAST-AI-Research/TripoSR ../TripoSR        (tested at commit 107cefd)
  python -m venv ../TripoSR/.venv
  ../TripoSR/.venv/Scripts/python.exe -m pip install torch==2.7.1 --index-url https://download.pytorch.org/whl/cu128
  ../TripoSR/.venv/Scripts/python.exe -m pip install "numpy<2" omegaconf==2.3.0 einops==0.7.0 transformers==4.40.2
      trimesh==4.0.5 huggingface-hub "imageio[ffmpeg]" xatlas==0.0.9 moderngl==5.10.0 PyMCubes scipy
      fast-simplification rembg==2.0.57 onnxruntime
  (not TripoSR's requirements.txt: it wants torchmcubes built from source, which needs a C++ compiler this
  machine doesn't have, an unpinned rembg, and gradio, which isn't needed)

The weights (1.7 GB) and U-2-Net (170 MB) are fetched on the first run into ~/.cache/huggingface and ~/.u2net.

Run it with TripoSR's Python:

  ../TripoSR/.venv/Scripts/python.exe scripts/props/image_to_3d.py <picture> [--name tanuki]
      [--out dir]            where it goes: <dir>/<name>/ (default debug-shots/image_to_3d, git-ignored)
      [--device auto|cuda|cpu]  auto: the GPU if 3.4 GB of its memory is free (the game can take 7 of its 8 GB),
                             the CPU otherwise. On the GTX 1070 Ti the model and the mesh take ~6 s (~75 s on
                             the CPU, on half its cores); unwrapping the full mesh (~130k triangles) takes another
                             70 s either way, a --faces 8000 one well under half a minute
      [--faces N]            reduce to about N triangles before unwrapping and baking (0, the default: as extracted)
      [--texture N]          texture size (default 1024); 0 for vertex colours and no texture
      [--mc-resolution N]    the marching-cubes grid (default 256; lower is coarser and quicker)
      [--threshold X]        the density the surface is taken at (default 25; lower is fatter, higher thinner)
      [--foreground-ratio X] how much of the frame the object fills as the model sees it (default 0.85)
      [--no-remove-bg]       the picture is already the object on plain mid-grey: use it as it is
      [--keep-floaters]      keep the small loose pieces (they're dropped otherwise)
      [--threads N]          CPU threads on a CPU run (default: half the cores, so the game keeps its share)

A picture with its own transparency is used as cut out; otherwise the background is removed (U-2-Net). Best: one
whole object, evenly lit, nothing cut off by the frame, seen from the front or three-quarters on with the camera
level with its middle: the mesh is built in the camera's frame, so a picture taken from above gives an object
leaning toward you (the test tanuki, seen from 14 degrees up, came out tipped forward by about that).

It writes <name>.glb (Y up, the side the picture shows on +Z; about one unit tall, whatever its real size, so scale it),
input.png (the picture as the model saw it: look at it first when the result is wrong) and report.json (settings,
seconds per stage, counts). A GPU run takes the repo's GPU queue exclusively (scripts/gpu_lock.py) and is capped
to the memory that was free when it started, less a reserve, so it fails rather than squeeze the game; a CPU run
takes the queue only for the texture bake, which rasterizes with OpenGL.

What to expect: the shape is a guess from one view (the back is invented, thin parts fuse or vanish), the surface
is marching-cubes triangles (dense, uniform, no edge flow, stair-stepping at this grid size), the UVs are an
automatic atlas of many small charts, and the colours are the picture's with its lighting baked in, soft, and
made up on the unseen side.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import types

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TRIPOSR = os.environ.get("TRIPOSR_ROOT") or os.path.abspath(os.path.join(REPO, "..", "TripoSR"))
MODEL = "stabilityai/TripoSR"
# The only background remover this may use (Apache-2.0). Not rembg's newer default: see the header.
MATTING = "u2net"
# Free GPU memory (MiB) below which `auto` uses the CPU. TripoSR's README says about 6 GB at its defaults; measured
# here (GTX 1070 Ti, float32, the 256 grid, a 1024 texture) PyTorch's peak was 2379 MiB, and the run fitted under a
# cap of 3168. report.json records each GPU run's peak (gpuPeakMiB): raise this if a bigger grid needs more.
NEED_MIB = 3400
# What a GPU run leaves alone of the memory that was free when it started (MiB): CUDA's own context comes out of
# it, and the rest is slack. PyTorch is capped at free - RESERVE_MIB, so a run that needs more stops with "out
# of GPU memory" instead of spilling into shared memory (Windows lets it) and dragging the game down with it.
RESERVE_MIB = 600


def vram_mib():
    """(free, total) GPU memory, or (None, None). Asked of nvidia-smi, not of torch: asking torch starts a CUDA
    context, which itself takes GPU memory."""
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=20,
        ).stdout
        free, total = (int(v) for v in out.strip().splitlines()[0].split(","))
        return free, total
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None, None


def marching_cubes_shim():
    """TripoSR imports torchmcubes, a C++ extension built at install time. PyMCubes (the code it was ported from)
    has wheels, so it stands in. torchmcubes gives a vertex as the grid's (k, j, i); PyMCubes as (i, j, k)."""
    import mcubes
    import numpy as np
    import torch

    def marching_cubes(level, threshold):
        verts, faces = mcubes.marching_cubes(level.detach().cpu().numpy().astype(np.float32), float(threshold))
        return (
            torch.from_numpy(np.ascontiguousarray(verts[:, ::-1]).astype(np.float32)),
            torch.from_numpy(faces.astype(np.int64)),
        )

    module = types.ModuleType("torchmcubes")
    module.marching_cubes = marching_cubes
    sys.modules["torchmcubes"] = module


def cut_out(path, remove_bg, ratio):
    """The picture as the model wants it: the object alone, filling `ratio` of a square, on mid-grey."""
    import numpy as np
    from PIL import Image
    from tsr.utils import resize_foreground

    image = Image.open(path)
    if not remove_bg:
        return image.convert("RGB"), "as given"
    how = "its own transparency"
    if not (image.mode == "RGBA" and image.getextrema()[3][0] < 255):
        import rembg

        image = rembg.remove(image.convert("RGB"), session=rembg.new_session(MATTING, providers=["CPUExecutionProvider"]))
        how = f"rembg {MATTING}"
    if np.array(image)[..., 3].max() == 0:
        sys.exit("Nothing left of the picture once its background was removed: cut the object out by hand (a PNG with transparency).")
    rgba = np.array(resize_foreground(image, ratio)).astype(np.float32) / 255.0
    rgb = rgba[:, :, :3] * rgba[:, :, 3:4] + (1 - rgba[:, :, 3:4]) * 0.5
    return Image.fromarray((rgb * 255.0).astype(np.uint8)), how


def tidy(mesh, keep_floaters, faces):
    """Outward-facing, without the loose crumbs marching cubes leaves, and thinned if asked."""
    import numpy as np
    import trimesh

    if mesh.volume < 0:
        mesh.invert()
    if not keep_floaters:
        parts = trimesh.graph.connected_components(mesh.face_adjacency, nodes=np.arange(len(mesh.faces)), min_len=1)
        if len(parts) > 1:
            biggest = max(len(p) for p in parts)
            keep = np.concatenate([p for p in parts if len(p) >= 0.02 * biggest])
            mask = np.zeros(len(mesh.faces), dtype=bool)
            mask[keep] = True
            mesh.update_faces(mask)
            mesh.remove_unreferenced_vertices()
    if faces and len(mesh.faces) > faces:
        import fast_simplification

        v, f = fast_simplification.simplify(mesh.vertices.astype(np.float32), mesh.faces.astype(np.int32), target_count=faces)
        mesh = trimesh.Trimesh(vertices=v, faces=f, process=True)
    return mesh


def colours_at(model, scene_code, points):
    """The field's colour at each point (N, 3), on whichever device the model is on."""
    import torch

    with torch.no_grad():
        p = torch.as_tensor(points, dtype=torch.float32, device=scene_code.device)
        return model.renderer.query_triplane(model.decoder, p, scene_code)["color"].float().cpu().numpy()


def bake(mesh, model, scene_code, size):
    """An atlas (xatlas) and the field's colour at each of its texels: TripoSR's own bake, but asking only for the
    texels that are on the mesh, on the model's device, and with the gaps between charts filled from their
    nearest texel so nothing dark bleeds in at the seams."""
    import numpy as np
    from PIL import Image
    from scipy import ndimage
    from tsr.bake_texture import make_atlas, rasterize_position_atlas

    padding = round(max(2, size / 256))
    atlas = make_atlas(mesh, size, padding)
    positions = rasterize_position_atlas(mesh, atlas["vmapping"], atlas["indices"], atlas["uvs"], size, padding)
    filled = positions[..., 3] > 0
    rgb = np.zeros((size, size, 3), dtype=np.float32)
    rgb[filled] = colours_at(model, scene_code, positions[..., :3][filled])
    if not filled.all():
        _, (iy, ix) = ndimage.distance_transform_edt(~filled, return_indices=True)
        rgb = rgb[iy, ix]
    image = Image.fromarray((np.clip(rgb, 0, 1) * 255.0).astype(np.uint8)).transpose(Image.FLIP_TOP_BOTTOM)
    return atlas, image, int(filled.sum())


def main():
    ap = argparse.ArgumentParser(description="One picture of an object to a rough textured .glb (TripoSR).")
    ap.add_argument("image")
    ap.add_argument("--name")
    ap.add_argument("--out", default=os.path.join(REPO, "debug-shots", "image_to_3d"))
    ap.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    ap.add_argument("--faces", type=int, default=0)
    ap.add_argument("--texture", type=int, default=1024)
    ap.add_argument("--mc-resolution", type=int, default=256)
    ap.add_argument("--threshold", type=float, default=25.0)
    ap.add_argument("--foreground-ratio", type=float, default=0.85)
    ap.add_argument("--no-remove-bg", action="store_true")
    ap.add_argument("--keep-floaters", action="store_true")
    ap.add_argument("--threads", type=int, default=0)
    args = ap.parse_args()

    if not os.path.isdir(os.path.join(TRIPOSR, "tsr")):
        sys.exit(f"TripoSR isn't at {TRIPOSR}: see this script's header for the install (or set TRIPOSR_ROOT).")
    if not os.path.isfile(args.image):
        sys.exit(f"No such picture: {args.image}")
    name = re.sub(r"[^a-z0-9_]+", "_", (args.name or os.path.splitext(os.path.basename(args.image))[0]).lower()).strip("_") or "object"
    out_dir = os.path.join(os.path.abspath(args.out), name)
    os.makedirs(out_dir, exist_ok=True)

    sys.path.insert(0, os.path.join(REPO, "scripts"))
    sys.path.insert(0, TRIPOSR)
    import gpu_lock

    device = args.device
    free, total = vram_mib()
    if device == "auto":
        device = "cuda" if free is not None and free >= NEED_MIB else "cpu"
        why = "no NVIDIA GPU found" if free is None else f"{free} MiB of GPU memory free, {NEED_MIB} wanted"
        print(f"Device: {device} ({why})", flush=True)
    if device == "cuda":
        gpu_lock.exclusive("image to 3d")
        free, total = vram_mib()  # again: what the runs it waited for held is free now

    import numpy as np
    import torch
    import trimesh

    if device == "cuda":
        if not torch.cuda.is_available() or free is None:
            sys.exit("--device cuda, but there is no CUDA device (or no nvidia-smi to ask about it).")
        cap = free - RESERVE_MIB
        if cap < 1024:
            sys.exit(f"Only {free} MiB of GPU memory free: run it with --device cpu, or when the game isn't running.")
        torch.cuda.set_per_process_memory_fraction(min(1.0, cap / total))
        print(f"GPU: {free} MiB free, capped at {cap} MiB", flush=True)
    if device == "cpu":
        torch.set_num_threads(args.threads or max(1, (os.cpu_count() or 2) // 2))
    marching_cubes_shim()
    from tsr.system import TSR

    seconds = {}
    clock = [time.time()]

    def lap(stage):
        if device == "cuda":
            torch.cuda.synchronize()
        now = time.time()
        seconds[stage] = round(now - clock[0], 2)
        print(f"{stage}: {seconds[stage]} s", flush=True)
        clock[0] = now

    started = time.time()
    image, matting = cut_out(args.image, not args.no_remove_bg, args.foreground_ratio)
    image.save(os.path.join(out_dir, "input.png"))
    lap("picture")

    model = TSR.from_pretrained(MODEL, config_name="config.yaml", weight_name="model.ckpt")
    model.renderer.set_chunk_size(8192)
    model.to(device)
    model.eval()
    lap("model loaded")

    try:
        with torch.no_grad():
            scene_codes = model([image], device=device)
        lap("model run")
        mesh = model.extract_mesh(scene_codes, False, resolution=args.mc_resolution, threshold=args.threshold)[0]
    except torch.OutOfMemoryError:
        sys.exit("Out of GPU memory: run it again with --device cpu, or when the game isn't running.")
    extracted = len(mesh.faces)
    if extracted == 0:
        sys.exit("No surface came out (an empty mesh): look at input.png, or try a lower --threshold.")
    lap("mesh extracted")

    mesh = tidy(mesh, args.keep_floaters, args.faces)
    lap("mesh tidied")

    texels = 0
    if args.texture > 0:
        if device != "cuda":
            gpu_lock.exclusive("image to 3d (texture bake)")
        atlas, texture, texels = bake(mesh, model, scene_codes[0], args.texture)
        normals = np.nan_to_num(np.array(mesh.vertex_normals[atlas["vmapping"]], dtype=np.float64))
        # (A vertex left on a collapsed triangle by --faces has no normal: trimesh would write it as NaN, which
        # isn't JSON, and the .glb wouldn't load. It gets "up", and everything is made unit length.)
        length = np.linalg.norm(normals, axis=1, keepdims=True)
        normals = np.where(length > 1e-6, normals / np.maximum(length, 1e-6), [0.0, 1.0, 0.0])
        mesh = trimesh.Trimesh(
            vertices=mesh.vertices[atlas["vmapping"]],
            faces=atlas["indices"],
            vertex_normals=normals,
            visual=trimesh.visual.TextureVisuals(
                uv=atlas["uvs"],
                material=trimesh.visual.material.PBRMaterial(baseColorTexture=texture, metallicFactor=0.0, roughnessFactor=1.0),
            ),
            process=False,
        )
        lap("texture baked")
    else:
        rgb = colours_at(model, scene_codes[0], mesh.vertices)
        mesh.visual.vertex_colors = np.concatenate([np.clip(rgb, 0, 1) * 255.0, np.full((len(rgb), 1), 255.0)], axis=1).astype(np.uint8)
        lap("vertices coloured")

    # TripoSR's space is Z up; glTF is Y up with an asset's front on +Z (its own demo turns the front to -Z).
    mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [0, 1, 0]))
    glb = os.path.join(out_dir, f"{name}.glb")
    mesh.export(glb)
    lap("written")

    report = {
        "picture": os.path.abspath(args.image),
        "background": matting,
        "model": MODEL,
        "device": device if device == "cpu" else torch.cuda.get_device_name(0),
        "gpuPeakMiB": round(torch.cuda.max_memory_allocated() / 2**20) if device == "cuda" else None,
        "gpuFreeBeforeMiB": free,
        "mcResolution": args.mc_resolution,
        "threshold": args.threshold,
        "foregroundRatio": args.foreground_ratio,
        "trianglesExtracted": extracted,
        "triangles": int(len(mesh.faces)),
        "vertices": int(len(mesh.vertices)),
        "texture": args.texture,
        "texelsOnMesh": texels,
        "size": [round(float(v), 3) for v in mesh.extents],
        "bytes": os.path.getsize(glb),
        "seconds": seconds,
        "secondsInAll": round(time.time() - started, 2),
    }
    with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"{glb}: {report['triangles']} triangles, {report['vertices']} vertices, "
          f"{'texture ' + str(args.texture) if args.texture else 'vertex colours'}, {report['bytes'] / 1e6:.1f} MB, "
          f"{report['secondsInAll']} s on {report['device']}", flush=True)


if __name__ == "__main__":
    main()
