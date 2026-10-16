// Reads an F10 trace of the car and the chase camera (debug/trace.ts: debug-shots/<when>_district-trace.json) and
// says what moved frame to frame: the camera against the car (in the car's frame), the camera's turn, the body's
// pitch and roll, the frame's time. node debug-shots/tracestats.mjs [file] [--rows]  (default: the newest trace)
import { readdirSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const showRows = args.includes('--rows');
let file = args.find((a) => !a.startsWith('--'));
if (!file) {
  const files = readdirSync('debug-shots').filter((f) => f.endsWith('_district-trace.json')).sort();
  file = `debug-shots/${files[files.length - 1]}`;
}
const { rows, url } = JSON.parse(readFileSync(file, 'utf8'));
console.log(file, url, rows.length, 'frames');
const R = rows.map((r) => {
  const dx = r.cx - r.ox;
  const dz = r.cz - r.oz;
  const h = r.sh;
  return { ...r, along: dx * Math.sin(h) + dz * Math.cos(h), side: dx * Math.cos(h) - dz * Math.sin(h), up: r.cy - r.oy, relYaw: Math.atan2(Math.sin(r.cyaw - h), Math.cos(r.cyaw - h)) };
});
const d2 = (k) => {
  const v = [];
  for (let i = 2; i < R.length; i++) v.push(Math.abs(R[i][k] - 2 * R[i - 1][k] + R[i - 2][k]));
  const s = [...v].sort((a, b) => a - b);
  return { med: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1], v };
};
const d1 = (k) => {
  const v = [];
  for (let i = 1; i < R.length; i++) v.push(Math.abs(R[i][k] - R[i - 1][k]));
  const s = [...v].sort((a, b) => a - b);
  return { med: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1], v };
};
const f = (x, n = 4) => (x === undefined ? '-' : x.toFixed(n));
const line = (name, s, n) => console.log(`${name.padEnd(22)} med ${f(s.med, n)}  p95 ${f(s.p95, n)}  max ${f(s.max, n)}`);
console.log(`view ${R[0].view}  zoom ${f(R[0].zoom, 2)}  speed ${f(R[0].su, 1)}-${f(R[R.length - 1].su, 1)} m/s  fov ${f(R[0].fov, 1)}-${f(R[R.length - 1].fov, 1)}  lookYaw ${f(R[0].lookYaw, 2)}`);
line('frame ms (d1)', { med: d1('t').med, p95: d1('t').p95, max: d1('t').max }, 1);
console.log('-- second differences, frame to frame (a steady motion gives ~0):');
line('cam-car along (m)', d2('along'));
line('cam-car side (m)', d2('side'));
line('cam-car up (m)', d2('up'));
line('cam yaw rel car (rad)', d2('relYaw'));
line('cam pitch (rad)', d2('cpitch'));
line('body pitch orx (rad)', d2('orx'));
line('body roll orz (rad)', d2('orz'));
line('body yaw ory (rad)', d2('ory'));
line('sim heading sh (rad)', d2('sh'));
line('body y oy (m)', d2('oy'));
line('camT', d2('camT'));
line('fov', d2('fov'));
line('speed su', d2('su'));
line('lateral sw', d2('sw'));
line('sim ax', d2('sax'));
line('sim ay', d2('say'));
console.log('-- first differences:');
line('camT (d1)', d1('camT'));
line('fov (d1)', d1('fov'));
line('body pitch (d1)', d1('orx'));
line('body roll (d1)', d1('orz'));
console.log('-- obj vs sim place (should be 0):', f(Math.max(...R.map((r) => Math.hypot(r.ox - r.sx, r.oz - r.sz)))));
if (showRows) {
  console.log('i  dt   along   side    relYaw  cpitch  orx     orz     camT   fov   su');
  for (let i = 1; i < R.length; i++) {
    const r = R[i];
    console.log(`${String(i).padStart(3)} ${f(r.t - R[i - 1].t, 1).padStart(5)} ${f(r.along, 3)} ${f(r.side, 3)} ${f(r.relYaw)} ${f(r.cpitch)} ${f(r.orx)} ${f(r.orz)} ${f(r.camT, 3)} ${f(r.fov, 2)} ${f(r.su, 2)}`);
  }
}
