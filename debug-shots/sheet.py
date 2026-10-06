# A contact sheet of PNGs: python debug-shots/sheet.py <out.png> <cols> <cell px> <files...>
import sys
from PIL import Image
out, cols, cell = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * cell, rows * cell), (0, 0, 0))
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB')
    im = im.resize((cell, cell), Image.LANCZOS)
    sheet.paste(im, ((i % cols) * cell, (i // cols) * cell))
sheet.save(out)
