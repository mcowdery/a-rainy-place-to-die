"""
The pistol's recorded shots, cut from the Free Firearm Sound Library (CC0: Ben Jaszczak, Brian Nelson, Kevin Heras,
Matthew Nanney; https://opengameart.org/content/the-free-firearm-sound-library, "Prepared SFX Library.7z").

Each of the library's files is one gun from one microphone position (96 kHz, 24 bit, stereo), a few single shots some
seconds apart, each with the range's own tail. This cuts every shot out on its own (from just before its first
sample to where its tail has died, faded out), brings it to 48 kHz and writes it as Ogg Opus into
assets/audio/guns/ as <pistol|shotgun>_<voice>_<near|far>_<n>.ogg (and the handling sounds as foley_<name>.ogg), with CREDITS.md beside them, and a page to listen to them
all in debug-shots/guns/recorded.html (/debug-shots/guns/recorded.html on the dev server). It prints each one's
length and where its energy is. race/gunSound.ts plays them (`GUN_VOICES`).

Run with ACE-Step's Python (it has soundfile, which writes Ogg Opus), on the library unpacked somewhere:
  ../ACE-Step-1.5/.venv/Scripts/python.exe scripts/audio/cut_guns.py "<folder>/Prepared SFX Library" ["<folder with reload.wav and clicks3.wav>"]
(Windows' own tar unpacks the .7z: C:\\Windows\\System32\\tar.exe -xf "Prepared SFX Library.7z".)
"""
import os
import struct
import sys

import numpy as np
import soundfile as sf

# <kind>_<voice>: (the library's folder, its near file, its mid-distance file, what it is)
VOICES = {
    'pistol_9mm': ('Walther PPQ', 'X_39P.wav', 'X_31P.wav', 'a 9 mm pistol'),
    'pistol_45': ('1911', 'A_42P.wav', 'A_34P.wav', 'a .45 pistol'),
    'pistol_380': ('Bersa', 'F_47P.wav', 'F_41P.wav', 'a .380 pistol'),
    'pistol_tokarev': ('PPSh', 'P_30P.wav', 'P_16P.wav', "single shots of a submachine gun in the Type 54's own cartridge, 7.62x25"),
    'shotgun_a': ('Model 12', 'K_22P.wav', 'K_17P.wav', 'a 12 gauge pump shotgun'),
    'shotgun_b': ('Nova', 'O_21P.wav', 'O_17P.wav', 'another 12 gauge pump shotgun'),
}
# The handling sounds (a second folder, optional): file -> [(name, from s, to s, what)]. reload.wav is "handgun reload sound
# effect" by zer0_sol (CC0, https://opengameart.org/content/handgun-reload-sound-effect): the magazine's catch, a fresh
# magazine going home, the slide racked. clicks3.wav is "Equipment Clicks III" by LFA (CC0,
# https://opengameart.org/content/equipment-clicks-iii): a bolt action worked, among other clicks; one of its longer
# ones stands for the shotgun's lever (picked by its shape, unheard: the candidates are on the listening page).
FOLEY = {
    'reload.wav': [('mag_out', 0.085, 0.3, "a pistol magazine's catch"), ('mag_in', 0.585, 0.95, 'a magazine pushed home'), ('slide', 1.015, 1.5, 'a pistol slide racked'), ('click', 0.085, 0.2, 'the same catch, as a dry click')],
    'clicks3.wav': [('lever', 13.1, 13.6, 'an action worked'), ('lever_b', 14.62, 15.0, 'an action worked (candidate)'), ('lever_c', 18.92, 19.3, 'an action worked (candidate)'), ('lever_d', 16.18, 16.55, 'an action worked (candidate)')],
}
FOLEY_SOURCE = {'reload.wav': 'handgun reload sound effect, zer0_sol, CC0, https://opengameart.org/content/handgun-reload-sound-effect', 'clicks3.wav': 'Equipment Clicks III, LFA, CC0, https://opengameart.org/content/equipment-clicks-iii'}
OUT_RATE = 48000
# A shot's cut: how long before its first sample, the longest it may run, and where its tail counts as gone (dB under its peak).
PRE = 0.002
LONGEST = 2.6
GONE = -56
FADE = 0.08


def read_wav(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'RIFF' and b[8:12] == b'WAVE', path
    i, fmt, data = 12, None, None
    while i + 8 <= len(b):
        cid, n = b[i:i + 4], struct.unpack('<I', b[i + 4:i + 8])[0]
        if cid == b'fmt ':
            fmt = struct.unpack('<HHIIHH', b[i + 8:i + 24])
        if cid == b'data':
            data = b[i + 8:i + 8 + n]
            break
        i += 8 + n + (n & 1)
    _, ch, rate, _, _, bits = fmt
    if bits == 16:
        x = np.frombuffer(data, '<i2').astype(np.float32) / 32768
    elif bits == 24:
        a = np.frombuffer(data[:len(data) // 3 * 3], np.uint8).reshape(-1, 3).astype(np.int32)
        v = a[:, 0] | (a[:, 1] << 8) | (a[:, 2] << 16)
        x = np.where(v >= 1 << 23, v - (1 << 24), v).astype(np.float32) / (1 << 23)
    else:
        raise ValueError(f'{path}: {bits} bit')
    return rate, x[:len(x) // ch * ch].reshape(-1, ch)


def halve(x):
    """96 kHz to 48: a windowed-sinc low-pass at 21 kHz, then every other sample."""
    n = np.arange(-63, 64)
    h = np.sinc(n * 0.4375) * 0.4375 * np.blackman(len(n))
    h /= h.sum()
    return np.stack([np.convolve(x[:, c], h, mode='same')[::2] for c in range(x.shape[1])], axis=1).astype(np.float32)


def shots(rate, x):
    """Each single shot's (start, end) in samples: onsets over a fifth of the file's peak, at least 1.5 s apart."""
    m = np.abs(x).max(axis=1)
    w = rate // 200
    env = m[:len(m) // w * w].reshape(-1, w).max(axis=1)
    on, last = [], -1e9
    for i, v in enumerate(env):
        t = i * w / rate
        if v > env.max() * 0.2:
            if t - last > 1.5:
                on.append(i * w)
            last = t
    out = []
    for k, o in enumerate(on):
        peak = m[o:o + rate // 10].max()
        back = max(0, o - rate // 20)
        first = back + int(np.argmax(m[back:o + w] > peak * 0.02))
        start = max(0, first - int(PRE * rate))
        limit = min(len(m), start + int(LONGEST * rate), (on[k + 1] - rate // 4) if k + 1 < len(on) else len(m))
        # The tail: the last 20 ms stretch still over GONE.
        step = rate // 50
        end = limit
        for j in range(start + step, limit, step):
            if np.sqrt(np.mean(x[j:j + step] ** 2)) > peak * 10 ** (GONE / 20):
                end = min(limit, j + step * 6)
        out.append((start, max(end, start + rate // 3)))
    return out


def centre(x, rate, n):
    """The spectral centre of the first n samples (Hz), and the share of energy under 150, to 500, to 2k, to 6k, over."""
    seg = x[:n, 0] * np.hanning(min(n, len(x)))[:len(x[:n])]
    p = np.abs(np.fft.rfft(seg, 16384)) ** 2
    f = np.fft.rfftfreq(16384, 1 / rate)
    bands = [p[(f >= a) & (f < b)].sum() for a, b in [(20, 150), (150, 500), (500, 2000), (2000, 6000), (6000, 24000)]]
    return int((p * f).sum() / p.sum()), [int(round(100 * b / sum(bands))) for b in bands]


def main():
    lib = sys.argv[1]
    root = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
    out = os.path.join(root, 'assets', 'audio', 'guns')
    os.makedirs(out, exist_ok=True)
    made = []
    for voice, (folder, near, far, what) in VOICES.items():
        for where, name in (('near', near), ('far', far)):
            rate, x = read_wav(os.path.join(lib, folder, name))
            for k, (a, b) in enumerate(shots(rate, x)):
                cut = x[a:b].copy()
                if rate == 96000:
                    cut = halve(cut)
                elif rate != OUT_RATE:
                    raise ValueError(f'{name}: {rate} Hz')
                fade = int(FADE * OUT_RATE)
                cut[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
                cut[:24] *= np.linspace(0, 1, 24)[:, None]
                cut *= 0.97 / max(1e-6, np.abs(cut).max())
                file = f'{voice}_{where}_{k + 1}.ogg'
                sf.write(os.path.join(out, file), cut, OUT_RATE, format='OGG', subtype='OPUS')
                c30, b30 = centre(cut, OUT_RATE, 1440)
                tail = np.sqrt(np.mean(cut[2400:9600] ** 2)) / max(1e-6, np.sqrt(np.mean(cut[:2400] ** 2)))
                print(f'{file:30s} {len(cut) / OUT_RATE:4.2f} s  first 30 ms centre {c30:5d} Hz {b30}  50-200 ms against the first 50: {20 * np.log10(tail):5.1f} dB  {os.path.getsize(os.path.join(out, file)) // 1024} KB')
                made.append((file, voice, where, folder, name, what))
    foley = []
    for name, cuts in (FOLEY.items() if len(sys.argv) > 2 else []):
        rate, x = read_wav(os.path.join(sys.argv[2], name))
        for label, a, b, what in cuts:
            cut = x[int(a * rate):int(b * rate)].copy()
            if cut.shape[1] == 1:
                cut = np.repeat(cut, 2, axis=1)
            fade = int(0.05 * rate)
            cut[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
            cut[:32] *= np.linspace(0, 1, 32)[:, None]
            cut *= 0.9 / max(1e-6, np.abs(cut).max())
            file = f'foley_{label}.ogg'
            sf.write(os.path.join(out, file), cut, rate, format='OGG', subtype='VORBIS')
            print(f'{file:30s} {len(cut) / rate:4.2f} s')
            foley.append((file, name, what))
    with open(os.path.join(out, 'CREDITS.md'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('# Recorded gunshots\n\nCut from **The Free Firearm Sound Library** (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney), released CC0:\n'
                '"CC0 NO RIGHTS RESERVED for this library. It may be used without royalty or credit ... for any application, personal or professional."\n'
                'https://opengameart.org/content/the-free-firearm-sound-library ("Prepared SFX Library.7z")\n\n'
                'Each file here is one shot of one of the library\'s recordings, cut, brought to 48 kHz and encoded as Ogg Opus by `scripts/audio/cut_guns.py`.\n\n'
                '| File | From | What |\n|---|---|---|\n')
        for file, voice, where, folder, name, what in made:
            f.write(f'| `{file}` | {folder}/{name} | {what}, {"close" if where == "near" else "mid distance"} |\n')
        if foley:
            f.write('\n## Handling sounds\n\n| File | From | What |\n|---|---|---|\n')
            for file, name, what in foley:
                f.write(f'| `{file}` | {FOLEY_SOURCE[name]} | {what} |\n')
    page = os.path.join(root, 'debug-shots', 'guns')
    os.makedirs(page, exist_ok=True)
    with open(os.path.join(page, 'recorded.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('<!doctype html><meta charset="utf-8"><title>Recorded gunshots</title><body style="background:#111;color:#ddd;font:14px sans-serif;padding:20px"><h3>Recorded gunshots (assets/audio/guns)</h3>')
        for voice, (_, _, _, what) in VOICES.items():
            f.write(f'<h4>{voice}: {what}</h4>')
            for file, v, where, *_ in made:
                if v == voice:
                    f.write(f'<p>{file}<br><audio controls preload="none" src="/assets/audio/guns/{file}"></audio></p>')
        f.write('<h4>handling</h4>')
        for file, name, what in foley:
            f.write(f'<p>{file}: {what}<br><audio controls preload="none" src="/assets/audio/guns/{file}"></audio></p>')
        f.write('</body>')
    print(f'{len(made)} shots into {out}')


main()
