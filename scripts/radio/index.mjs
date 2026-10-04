// The radio's track lengths: reads every music file under assets/radio/<station>/ and writes
// assets/radio/durations.json ({ "<station>/<file>": seconds }), which the stations' clock needs
// (src/poc3d/district/radio.ts). Run it after adding, replacing or removing a track: npm run radio:index.
// It also says which files content/radio/stations.yaml doesn't list, and which listed tracks have no file.
// Reads Ogg (Opus, Vorbis) and MP3 itself, so it needs no ffmpeg.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'assets/radio');

/** An Ogg file's length: the last page's granule position over the sample rate (Opus: 48 kHz, less its pre-skip). */
function oggSeconds(buf) {
  const opus = buf.indexOf('OpusHead');
  const vorbis = buf.indexOf('\x01vorbis');
  let rate = 0;
  let skip = 0;
  if (opus >= 0 && opus < 200) {
    rate = 48000;
    skip = buf.readUInt16LE(opus + 10);
  } else if (vorbis >= 0 && vorbis < 200) rate = buf.readUInt32LE(vorbis + 12);
  else return null;
  const last = buf.lastIndexOf('OggS');
  if (last < 0) return null;
  const granule = Number(buf.readBigUInt64LE(last + 6));
  return (granule - skip) / rate;
}

const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** An MP3's length: from its Xing/Info frame count when it has one, else from its size at the first frame's bitrate. */
function mp3Seconds(buf) {
  let at = 0;
  if (buf.toString('latin1', 0, 3) === 'ID3') at = 10 + ((buf[6] & 0x7f) << 21) + ((buf[7] & 0x7f) << 14) + ((buf[8] & 0x7f) << 7) + (buf[9] & 0x7f);
  for (; at < buf.length - 4; at++) {
    if (buf[at] !== 0xff || (buf[at + 1] & 0xe0) !== 0xe0) continue;
    const version = (buf[at + 1] >> 3) & 3; // 3: MPEG1, 2: MPEG2, 0: MPEG2.5
    const layer = (buf[at + 1] >> 1) & 3; // 1: layer III
    const bitrate = BITRATES[version === 3 ? 1 : 2][buf[at + 2] >> 4];
    const rate = RATES[version]?.[(buf[at + 2] >> 2) & 3];
    if (layer !== 1 || !bitrate || !rate) continue;
    const mono = buf[at + 3] >> 6 === 3;
    const samples = version === 3 ? 1152 : 576;
    const side = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const tag = buf.toString('latin1', at + 4 + side, at + 8 + side);
    if ((tag === 'Xing' || tag === 'Info') && buf.readUInt32BE(at + 8 + side) & 1) return (buf.readUInt32BE(at + 12 + side) * samples) / rate;
    return ((buf.length - at) * 8) / (bitrate * 1000);
  }
  return null;
}

const seconds = (file) => {
  const buf = fs.readFileSync(file);
  return /\.(ogg|opus)$/i.test(file) ? oggSeconds(buf) : /\.mp3$/i.test(file) ? mp3Seconds(buf) : null;
};

const durations = {};
const problems = [];
for (const station of fs.existsSync(DIR) ? fs.readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : []) {
  for (const file of fs.readdirSync(path.join(DIR, station)).sort()) {
    if (!/\.(ogg|opus|mp3)$/i.test(file)) {
      if (/\.(m4a|wav|flac|aac)$/i.test(file)) problems.push(`${station}/${file}: only .ogg, .opus and .mp3 can be read here; convert it`);
      continue;
    }
    const s = seconds(path.join(DIR, station, file));
    if (s && s > 1) durations[`${station}/${file}`] = Math.round(s * 100) / 100;
    else problems.push(`${station}/${file}: couldn't read its length`);
  }
}
fs.writeFileSync(path.join(DIR, 'durations.json'), JSON.stringify(durations, null, 2) + '\n');

const doc = YAML.parse(fs.readFileSync(path.join(ROOT, 'content/radio/stations.yaml'), 'utf8'));
const listed = new Set();
for (const s of doc?.stations ?? []) {
  let total = 0;
  for (const t of s.tracks ?? []) {
    const key = `${s.id}/${t.file}`;
    listed.add(key);
    if (durations[key]) total += durations[key];
    else problems.push(`stations.yaml lists ${key}, but there's no such file`);
  }
  console.log(`${s.id}: ${(s.tracks ?? []).length} tracks, ${Math.floor(total / 60)} min ${Math.round(total % 60)} s`);
}
for (const key of Object.keys(durations)) if (!listed.has(key)) problems.push(`${key} isn't in stations.yaml (it won't play)`);
console.log(`wrote assets/radio/durations.json (${Object.keys(durations).length} files)`);
for (const p of problems) console.log(`! ${p}`);
process.exitCode = problems.length ? 1 : 0;
