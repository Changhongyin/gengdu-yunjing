# Cuts the 12 poses out of the user's character reference sheet.
# Development tool (not packaged). Needs Pillow and numpy.
# Usage: python -I scripts/build-pet-assets.py <character-reference.jpg> <pose-out-dir> [--sheet <runtime-sheet.png>] [--debug]
# The runtime sheet is assets/pet/azhang-poses.png: 4 columns x 3 rows of 256 x 304 cells,
# in the order of POSES below (components/village-pet/index.js uses the same order).
# Method (no generative step, no enlargement of the artwork):
#   1. Fixed crop boxes per pose (captions, dividers and the sheet margin are outside).
#   2. "Passable" = pixel looks like the sheet paper or the soft ground shadow
#      (near-neutral cream, see passable()). Flood fill from the crop border through
#      passable pixels eroded by R px, so gaps narrower than 2R+1 px cannot leak into
#      the cream body; then grow back by R px inside the passable set.
#   3. Alpha = 0 on the flooded background, 1 elsewhere, with a 1 px anti-aliased rim
#      whose colour is decontaminated against the paper colour.
#   4. Each pose is placed on a common canvas: feet baseline and body centre aligned.
import sys, os, json, hashlib
from collections import deque
from PIL import Image, ImageFilter
import numpy as np

SRC, OUT = sys.argv[1], sys.argv[2]
DEBUG = '--debug' in sys.argv
SHEET = sys.argv[sys.argv.index('--sheet') + 1] if '--sheet' in sys.argv else None
os.makedirs(OUT, exist_ok=True)

# name, caption on the sheet, crop box (left, top, right, bottom) in source pixels
POSES = [
    ('greet',     '1 greeting',          (14, 14, 240, 306)),
    ('cheer',     '2 encouragement',     (240, 14, 458, 306)),
    ('think',     '3 thinking',          (456, 14, 640, 306)),
    ('read',      '4 reading',           (656, 14, 858, 306)),
    ('scroll',    '5 holding a scroll',  (860, 14, 1058, 306)),
    ('walk',      '6 happy walking',     (1058, 14, 1272, 306)),
    ('point',     '7 pointing',          (6, 398, 214, 678)),
    ('fish',      '8 hugging a fish',    (234, 398, 428, 678)),
    ('approve',   '9 approval',          (438, 398, 648, 678)),
    ('shy',       '10 shy affection',    (650, 398, 846, 678)),
    ('sleep',     '11 sleeping',         (850, 398, 1044, 678)),
    ('celebrate', '12 celebration',      (1044, 398, 1272, 678)),
]
R = 2            # leak guard radius (px)
CELL = (256, 304)  # common canvas (w, h); baseline at y = 296
BASE_Y = 296

sheet = Image.open(SRC).convert('RGB')
full = np.asarray(sheet).astype(np.int32)

def passable(a, paper, ground_from=None):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    pr, pg, pb = paper
    lum = (r * 3 + g * 6 + b) / 10.0
    plum = (pr * 3 + pg * 6 + pb) / 10.0
    warm = (r - b) - (pr - pb)          # the cream body is warmer than paper or its shadow
    tint = (r - g) - (pr - pg)
    near = (np.abs(r - pr) + np.abs(g - pg) + np.abs(b - pb)) <= 14
    shadow = (lum > plum - 52) & (lum <= plum + 3) & (np.abs(warm) <= 7) & (np.abs(tint) <= 5)
    ok = near | shadow
    if ground_from is not None:
        # the darker contact shadow exists only around the feet: a looser rule there
        deep = (lum > plum - 96) & (lum <= plum + 3) & (np.abs(warm) <= 9) & (np.abs(tint) <= 6)
        rows = np.arange(a.shape[0])[:, None] >= ground_from
        ok = ok | (deep & rows)
    return ok

def erode(m, r):
    out = m.copy()
    for _ in range(r):
        p = np.pad(out, 1, constant_values=True)
        out = p[1:-1, 1:-1] & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:] & p[:-2, :-2] & p[:-2, 2:] & p[2:, :-2] & p[2:, 2:]
    return out

def dilate(m, r, within=None):
    out = m.copy()
    for _ in range(r):
        p = np.pad(out, 1, constant_values=False)
        out = p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:] | p[:-2, :-2] | p[:-2, 2:] | p[2:, :-2] | p[2:, 2:]
        if within is not None: out &= within
    return out

def erode_fg(m):
    p = np.pad(m, 1, constant_values=False)
    return p[1:-1, 1:-1] & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]

def flood_from_border(ok):
    h, w = ok.shape
    seen = np.zeros_like(ok)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if ok[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if ok[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and ok[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    return seen

def components(mask):
    h, w = mask.shape
    label = np.zeros((h, w), np.int32)
    sizes = [0]
    for sy in range(h):
        for sx in range(w):
            if mask[sy, sx] and not label[sy, sx]:
                n = len(sizes); sizes.append(0)
                label[sy, sx] = n; q = deque([(sy, sx)])
                while q:
                    y, x = q.popleft(); sizes[n] += 1
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx = y + dy, x + dx
                            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not label[ny, nx]:
                                label[ny, nx] = n; q.append((ny, nx))
    return label, sizes

report = []
cells = {}
for name, caption, box in POSES:
    l, t, r, b = box
    a = full[t:b, l:r]
    # paper colour: median of the pixels on the crop border that look like paper
    edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    paper = np.median(edge[(edge.sum(axis=1) > 700)], axis=0)
    ok = passable(a, paper)
    core = flood_from_border(erode(ok, R))
    bg = dilate(core, R + 1, within=ok)
    # second pass: find the feet line, then also clear the contact shadow below it
    first_label, first_sizes = components(~bg)
    feet = int(np.nonzero(first_label == int(np.argmax(first_sizes)))[0].max())
    ok = passable(a, paper, ground_from=feet - 24)
    core = flood_from_border(erode(ok, R))
    bg = dilate(core, R + 1, within=ok)
    fg = ~bg
    # drop specks: tiny foreground islands (JPEG noise in the paper), keep real decorations
    label, sizes = components(fg)
    keep = np.zeros_like(fg)
    body = int(np.argmax(sizes))
    for n in range(1, len(sizes)):
        if sizes[n] >= 14: keep |= label == n
    # Peel the outermost pixel: it carries the JPEG halo of the paper and 1 px spurs.
    fg = erode_fg(keep)
    # Feathered edge: a 0.7 px Gaussian of the mask. Pixels in the feather that lie
    # outside the mask take the mean colour of their foreground neighbours, so no
    # paper colour is mixed back in.
    rgb = a.astype(np.float32)
    p = np.pad(rgb * fg[..., None], ((1, 1), (1, 1), (0, 0)))
    c = np.pad(fg.astype(np.float32), 1)
    acc = np.zeros_like(rgb); cnt = np.zeros(fg.shape, np.float32)
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            acc += p[dy:dy + fg.shape[0], dx:dx + fg.shape[1]]; cnt += c[dy:dy + fg.shape[0], dx:dx + fg.shape[1]]
    ring = (~fg) & (cnt > 0)
    rgb[ring] = acc[ring] / cnt[ring][:, None]
    soft = np.asarray(Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))).astype(np.float32) / 255.0
    alpha = np.where(fg | ring, soft, 0.0)
    alpha[alpha < 0.04] = 0
    rgba = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).round().astype(np.uint8)
    label, sizes = components(fg)
    body = int(np.argmax(sizes))
    ys, xs = np.nonzero(label == body)
    by0, by1, bx0, bx1 = ys.min(), ys.max(), xs.min(), xs.max()
    # body centre: centroid of the lowest 45% of the body (torso and feet), robust to raised arms
    low = ys >= by0 + (by1 - by0) * 0.55
    cx = float(xs[low].mean())
    ays, axs = np.nonzero(fg)
    cells[name] = dict(rgba=rgba, cx=cx, base=int(by1), box=box, caption=caption,
                       bbox=[int(axs.min()), int(ays.min()), int(axs.max()), int(ays.max())],
                       body=[int(bx0), int(by0), int(bx1), int(by1)], paper=[float(v) for v in paper],
                       islands=int(sum(1 for n in range(1, len(sizes)) if sizes[n] >= 14)),
                       specks=int(sum(1 for n in range(1, len(sizes)) if sizes[n] < 14)))

files = {}
for name, caption, box in POSES:
    c = cells[name]
    im = Image.fromarray(c['rgba'], 'RGBA')
    canvas = Image.new('RGBA', CELL, (0, 0, 0, 0))
    ox = int(round(CELL[0] / 2 - c['cx']))
    oy = BASE_Y - c['base']
    canvas.alpha_composite(im, (ox, oy)) if (ox >= 0 and oy >= 0 and ox + im.width <= CELL[0] and oy + im.height <= CELL[1]) else canvas.paste(im, (ox, oy), im)
    # anything that fell outside the canvas would be a layout error
    placed = np.asarray(canvas)[..., 3]
    lost = int((c['rgba'][..., 3] > 0).sum() - (placed > 0).sum())
    path = os.path.join(OUT, 'pose-' + name + '.png')
    canvas.save(path, optimize=True)
    files[name] = canvas
    report.append(dict(pose=name, sheetCaption=caption, sourceBox=list(box), offsetInCell=[ox, oy], opaquePixelsLostToCanvas=lost,
                       foregroundBBoxInCrop=c['bbox'], bodyBBoxInCrop=c['body'], paperColour=[round(v, 1) for v in c['paper']],
                       keptIslands=c['islands'], droppedSpecks=c['specks'], file='pose-' + name + '.png',
                       sha256=hashlib.sha256(open(path, 'rb').read()).hexdigest(), bytes=os.path.getsize(path)))

json.dump(dict(source=os.path.basename(SRC), sourceSha256=hashlib.sha256(open(SRC, 'rb').read()).hexdigest(), sourceSize=list(sheet.size),
               cell=list(CELL), baselineY=BASE_Y, leakGuardRadius=R, poses=report), open(os.path.join(OUT, 'cutout-report.json'), 'w'), indent=1)
for row in report: print(row['pose'], row['offsetInCell'], 'lost', row['opaquePixelsLostToCanvas'], 'islands', row['keptIslands'], 'specks', row['droppedSpecks'], row['bytes'])

if SHEET:
    os.makedirs(os.path.dirname(os.path.abspath(SHEET)), exist_ok=True)
    out = Image.new('RGBA', (CELL[0] * 4, CELL[1] * 3), (0, 0, 0, 0))
    for i, (name, _, _) in enumerate(POSES):
        out.alpha_composite(files[name], ((i % 4) * CELL[0], (i // 4) * CELL[1]))
    out.save(SHEET, optimize=True)
    print('sheet', SHEET, out.size, os.path.getsize(SHEET), hashlib.sha256(open(SHEET, 'rb').read()).hexdigest())

if DEBUG:
    for tag, colour in (('dark', (23, 42, 37, 255)), ('magenta', (255, 0, 255, 255)), ('ivory', (245, 241, 232, 255))):
        sheet_im = Image.new('RGBA', (CELL[0] * 4, CELL[1] * 3), colour)
        for i, (name, _, _) in enumerate(POSES):
            sheet_im.alpha_composite(files[name], ((i % 4) * CELL[0], (i // 4) * CELL[1]))
        sheet_im.convert('RGB').save(os.path.join(OUT, 'debug-' + tag + '.png'))
