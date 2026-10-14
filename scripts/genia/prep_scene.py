"""Lays one picture out as a GenIA `image` scene: 0000.png, 0000_mask.png (instance 1 = the figure, 0 = the rest) and
0000_classes.json, in <genia checkout>/demo/data/image/<name>/ (the layout of its bundled scenes).

  python scripts/genia/prep_scene.py <picture> <name> [--genia /workspace/genia/GenIA] [--size 1024] [--cls person] [--cut-below 0.78]

The figure is cut out with BiRefNet (MIT, ZhengPeng7/BiRefNet), run in the `genia` environment on the pod.
"""
import argparse
import json
import os

import numpy as np
import torch
from PIL import Image
from torchvision import transforms
from transformers import AutoModelForImageSegmentation

ap = argparse.ArgumentParser()
ap.add_argument('picture')
ap.add_argument('name')
ap.add_argument('--genia', default='/workspace/genia/GenIA')
ap.add_argument('--size', type=int, default=1024)
ap.add_argument('--cls', default='person')
ap.add_argument('--cut-below', type=float, default=1.0)  # the mask ends at this fraction of the height: 0.78 leaves a head and neck without the shoulders
a = ap.parse_args()

im = Image.open(a.picture).convert('RGB')
im = im.resize((a.size, a.size * im.height // im.width), Image.LANCZOS)
model = AutoModelForImageSegmentation.from_pretrained('ZhengPeng7/BiRefNet', trust_remote_code=True).cuda().eval().half()
tf = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(),
                         transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
with torch.no_grad():
    p = model(tf(im).unsqueeze(0).cuda().half())[-1].sigmoid().float().cpu()[0, 0]
m = Image.fromarray((p.numpy() * 255).astype(np.uint8)).resize(im.size, Image.BILINEAR)
mask = (np.asarray(m) > 127).astype(np.uint8)
mask[int(a.cut_below * mask.shape[0]):] = 0
out = os.path.join(a.genia, 'demo', 'data', 'image', a.name)
os.makedirs(out, exist_ok=True)
im.save(os.path.join(out, '0000.png'))
Image.fromarray(mask).save(os.path.join(out, '0000_mask.png'))
json.dump({'1': {'class': a.cls, 'instance': 1}}, open(os.path.join(out, '0000_classes.json'), 'w'), indent=2)
Image.fromarray(mask * 255).save(os.path.join(out, 'mask_preview.png'))
print('scene', out, 'foreground', round(float(mask.mean()), 3))
