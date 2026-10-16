// Prints Hotel Rouge's door nodes (the swing doors and the spawns that depend on the plan) for content/world3d/stamps/hotel_rouge.yaml.
//   node scripts/rougePlanNodes.mjs
import { readFileSync } from 'fs';
const plan = JSON.parse(readFileSync(new URL('../content/world3d/rouge_plan.json', import.meta.url), 'utf8'));
const f = (n) => Math.round(n * 1000) / 1000;
const lines = [];
for (const r of plan.rooms) {
  const front = r.door.wall === 't1';
  const slab = front ? [r.rect[3], r.rect[3] + 0.1] : [r.rect[2] - 0.1, r.rect[2]];
  const gap = [f(r.door.u - 0.65), f(r.door.u + 0.65), f(slab[0] - 0.1), f(slab[1] + 0.1)];
  const t = front ? slab[1] + 0.55 : slab[0] - 0.55; // on the corridor (or hall) side of the door
  const label = r.kind === 'guest' ? `Room ${r.no} · ${r.name}` : r.name;
  lines.push(`  door_${r.no}: { kind: hotspot, name: ${label}, at: [${f(r.door.u)}, ${f(-t)}], floor: ${r.floor}, swing: true, gap: [${gap.join(', ')}] }`);
}
// The baths' glass doors (a layout's `bathDoor`, in the bath's west glass wall), worked from the room's side.
for (const r of plan.rooms) {
  const lay = plan.layouts[r.layout ?? ''];
  if (!lay?.bath || !lay.bathDoor) continue;
  const front = r.door.wall === 't1';
  const W = r.rect[1] - r.rect[0];
  const num = (v) => (typeof v === 'string' ? (v === 'W' ? W : W + parseFloat(v.slice(1))) : v);
  const T = (b) => (front ? r.rect[2] + b : r.rect[3] - b);
  const a0 = num(lay.bath[0]);
  const [d0, d1] = lay.bathDoor;
  const ts = [T(d0), T(d1)].sort((x, y) => x - y);
  const gap = [f(r.rect[0] + a0 - 0.1), f(r.rect[0] + a0 + 0.1), f(ts[0]), f(ts[1])];
  lines.push(`  bath_${r.no}: { kind: hotspot, name: Room ${r.no} · bath, at: [${f(r.rect[0] + a0 - 0.6)}, ${f(-(ts[0] + ts[1]) / 2)}], floor: ${r.floor}, swing: true, gap: [${gap.join(', ')}] }`);
}
console.log(lines.join('\n'));
