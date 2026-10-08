# Statues: where each came from

A statue here is a loaded model (`src/poc3d/models/statues.ts`), made in three steps from a picture of the
project's own. Nothing in one is anybody else's work; the tools are listed in the root `CREDITS.md` (section 5).

1. **The picture**: generated in the developer's Krea Studio for the purpose (brief in `assets/ads/briefs/`).
2. **The shape**: Hi3DGen, on the Studio's RunPod endpoint (`node scripts/props/mesh_endpoint.mjs`; MIT code and
   weights, shape only).
3. **The prop**: `scripts/blender/prop_from_mesh.py` reduces the shape, bakes its detail into a normal map, and
   paints it with the picture from the front and the picture's edge colours behind.

Candidates until the user approves them in the model showroom (`models.html`, the Mega-sign group).

## `tanuki.glb` (candidate, made 2026-10-06)

For the roof of Kaburo's mega-sign in time, the dragon moved elsewhere. 11,998 triangles, a 1024² colour texture
and a 1024² normal map, 2.3 MB; a metre tall as stored.

| What | File | How |
| --- | --- | --- |
| The picture | `source/tanuki_picture.png` | Krea 2 Turbo, 12 steps, seed 820773922, no LoRA; brief `prop-tanuki-test`, variant 2. Prompt: "product photograph for a catalogue, soft even studio lighting, sharp focus, a single glazed ceramic tanuki statue of the kind that stands outside Japanese restaurants, standing upright, round belly, straw hat on its back, a sake flask in one paw, big friendly eyes, the whole figure in frame from hat to feet, seen straight on from the front at eye level, centred, isolated on a plain light grey seamless background, no other objects, no ground shadow, no text, no lettering, no logos, no watermark" |
| The cut-out the shape was made from | `source/tanuki_cutout.png` | the endpoint's own (BiRefNet), returned with the mesh |
| The shape | not kept (`debug-shots/image_to_3d/tanuki_hi3dgen/`) | Hi3DGen, seed 0, defaults; 683,000 triangles as generated, 200,000 as sent back |
| The prop | `tanuki.glb` | `prop_from_mesh.py -- <shape> source/tanuki_cutout.png assets/props/tanuki.glb` (12,000 triangles, 1024 px, roughness 0.35) |

To look at before it's approved: the flask carries the generator's made-up lettering (it reads as nothing, and
would be painted out or replaced with the game's own); the back is plain, the picture never having shown it.
