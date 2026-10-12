// Cuts a PNG out of the ad audit's map (tests/audit/ads.audit.ts): node debug-shots/adcrop.mjs <name> <x> <y> <w> <h> [scale], in metres from the map's north-west corner.
import sharp from 'sharp';
const [,, name, x, y, w, h, scale = '1'] = process.argv;
const dir = 'debug-shots/ad-audit/';
await sharp(dir + 'map.svg', { limitInputPixels: false, density: 72 * +scale }).extract({ left: Math.round(+x * +scale), top: Math.round(+y * +scale), width: Math.round(+w * +scale), height: Math.round(+h * +scale) }).png().toFile(dir + name + '.png');
console.log('wrote', name);
