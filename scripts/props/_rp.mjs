import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('../Trame/trame-studio/.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
const key = env.RUNPOD_API_KEY, id = env.RUNPOD_MESH_PIXAL3D_ENDPOINT_ID;
const H = { Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const gpus = (process.argv[2] ?? '').split(',').filter(Boolean);
if (gpus.length) {
  const r = await fetch(`https://rest.runpod.io/v1/endpoints/${id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ gpuTypeIds: gpus }) });
  console.log('patch', r.status, gpus.join(' | '));
}
await new Promise((res) => setTimeout(res, Number(process.argv[3] ?? 0) * 1000));
console.log(new Date().toISOString(), JSON.stringify(await (await fetch(`https://api.runpod.ai/v2/${id}/health`, { headers: { Authorization: `Bearer ${key}` } })).json()));
const r = await (await fetch(`https://rest.runpod.io/v1/endpoints/${id}?includeWorkers=true`, { headers: { Authorization: `Bearer ${key}` } })).json();
console.log('gpuTypeIds', JSON.stringify(r.gpuTypeIds));
for (const w of r.workers ?? []) {
  const g = await (await fetch(`https://api.runpod.io/graphql?api_key=${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: `query { pod(input:{podId:"${w.id}"}) { machine { gpuDisplayName location } } }` }) })).json();
  console.log(w.id, w.desiredStatus, w.lastStatusChange.slice(0, 60), g.data?.pod?.machine?.gpuDisplayName);
}
