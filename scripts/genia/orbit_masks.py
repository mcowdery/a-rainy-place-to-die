"""BiRefNet cut-outs of every frame of a DiffPortrait360 orbit: <orbit dir>/masks/NNN.png (255 = the head). GPU, `genia` env."""
import os
import sys

import numpy as np
import torch
from PIL import Image
from torchvision import transforms
from transformers import AutoModelForImageSegmentation

d = sys.argv[1]
model = AutoModelForImageSegmentation.from_pretrained('ZhengPeng7/BiRefNet', trust_remote_code=True).cuda().eval().half()
tf = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
os.makedirs(os.path.join(d, 'masks'), exist_ok=True)
for f in sorted(os.listdir(os.path.join(d, 'frames'))):
    im = Image.open(os.path.join(d, 'frames', f)).convert('RGB')
    with torch.no_grad():
        p = model(tf(im).unsqueeze(0).cuda().half())[-1].sigmoid().float().cpu()[0, 0]
    m = Image.fromarray((p.numpy() * 255).astype(np.uint8)).resize(im.size, Image.BILINEAR)
    Image.fromarray(((np.asarray(m) > 127) * 255).astype(np.uint8)).save(os.path.join(d, 'masks', f))
print('masks for', len(os.listdir(os.path.join(d, 'masks'))), 'frames')
