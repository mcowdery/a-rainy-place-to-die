import * as THREE from 'three';

/**
 * The garage: a rented shutter unit in a brick railway arch, at night. The vault (brick, soot-streaked), the
 * back wall with a pegboard of tools, a concrete floor with oil stains, fluorescent tubes on the vault, a
 * workbench, stacked tyres, a red roll cabinet, an oil drum, a retro poster for the passes, and the shutter
 * rolled up over the opening onto the street, where a vending machine glows. The car stands in the middle.
 * Coordinates: the car at the origin facing +z (the opening); the arch runs along z.
 */

const LEN = 11;
const R = 4.3;

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

/** A seeded random, so the scene comes out the same each time. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const bricks = (): THREE.CanvasTexture =>
  canvasTex(
    512,
    512,
    (g) => {
      const r = rng(7);
      g.fillStyle = '#3a2a24';
      g.fillRect(0, 0, 512, 512);
      const bw = 64;
      const bh = 24;
      for (let y = 0; y < 512; y += bh) {
        const off = (y / bh) % 2 ? bw / 2 : 0;
        for (let x = -bw; x < 512; x += bw) {
          const v = 0.75 + r() * 0.3;
          g.fillStyle = `rgb(${Math.round(120 * v)},${Math.round(62 * v)},${Math.round(46 * v)})`;
          g.fillRect(x + off + 2, y + 2, bw - 4, bh - 4);
        }
      }
      // Soot streaks down from the top, and damp near the floor.
      for (let i = 0; i < 40; i++) {
        const x = r() * 512;
        const gr = g.createLinearGradient(0, 0, 0, 512);
        gr.addColorStop(0, 'rgba(10,8,8,0.35)');
        gr.addColorStop(1, 'rgba(10,8,8,0)');
        g.fillStyle = gr;
        g.fillRect(x, 0, 6 + r() * 30, 200 + r() * 300);
      }
    },
    [4, 3],
  );

const concrete = (): THREE.CanvasTexture =>
  canvasTex(
    1024,
    1024,
    (g) => {
      const r = rng(3);
      g.fillStyle = '#5a5a58';
      g.fillRect(0, 0, 1024, 1024);
      for (let i = 0; i < 9000; i++) {
        const v = 70 + r() * 40;
        g.fillStyle = `rgba(${v},${v},${v - 4},0.25)`;
        g.fillRect(r() * 1024, r() * 1024, 2, 2);
      }
      // Oil stains, darkest under where cars have stood.
      for (let i = 0; i < 14; i++) {
        const x = 380 + (r() - 0.5) * 460;
        const y = 380 + (r() - 0.5) * 560;
        const rad = 30 + r() * 110;
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, 'rgba(12,12,14,0.55)');
        gr.addColorStop(1, 'rgba(12,12,14,0)');
        g.fillStyle = gr;
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      // A painted bay outline.
      g.strokeStyle = 'rgba(230,200,60,0.55)';
      g.lineWidth = 8;
      g.strokeRect(310, 250, 404, 560);
    },
  );

const poster = (): THREE.CanvasTexture =>
  canvasTex(256, 360, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 360);
    gr.addColorStop(0, '#1c1840');
    gr.addColorStop(0.55, '#c0507a');
    gr.addColorStop(1, '#ffb070');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 360);
    g.fillStyle = 'rgba(255,230,180,0.95)';
    g.beginPath();
    g.arc(128, 220, 46, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#140c1c';
    g.beginPath();
    g.moveTo(0, 360);
    g.lineTo(0, 250);
    g.lineTo(70, 210);
    g.lineTo(130, 260);
    g.lineTo(200, 200);
    g.lineTo(256, 235);
    g.lineTo(256, 360);
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 40px "Yu Gothic", sans-serif';
    g.textAlign = 'center';
    g.fillText('峠', 128, 70);
    g.font = 'bold 18px Consolas, monospace';
    g.fillText('MIDNIGHT TOUGE', 128, 104);
    g.font = '13px Consolas, monospace';
    g.fillText('KUROKAMI · YUNAGI', 128, 340);
  });

export interface GarageScene {
  readonly group: THREE.Group;
  /** The overhead train (the arch shakes a little and the tubes flicker when it passes); call every frame. */
  update(dt: number): { rumble: number };
}

export function buildGarage(): GarageScene {
  const group = new THREE.Group();
  const brick = new THREE.MeshStandardMaterial({ map: bricks(), roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x6a6e74, metalness: 0.6, roughness: 0.45 });
  // The vault: half a cylinder along z, open at the front.
  const vault = new THREE.Mesh(new THREE.CylinderGeometry(R, R, LEN, 40, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), brick);
  vault.material.side = THREE.BackSide;
  vault.position.set(0, 0.6, -LEN / 2 + 4.5);
  group.add(vault);
  // Straight brick walls up to the spring of the arch.
  for (const sd of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(LEN, 0.6), brick);
    w.position.set(sd * R, 0.3, -LEN / 2 + 4.5);
    w.rotation.y = -sd * (Math.PI / 2);
    group.add(w);
  }
  // Back wall: brick, with a pegboard of tools and a steel door.
  const back = new THREE.Mesh(new THREE.CircleGeometry(R, 40, 0, Math.PI), brick);
  back.position.set(0, 0.6, -LEN + 4.5);
  group.add(back);
  const backLow = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, 0.6), brick);
  backLow.position.set(0, 0.3, -LEN + 4.51);
  group.add(backLow);
  const peg = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 0.03), new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.9 }));
  peg.position.set(-1.6, 1.9, -LEN + 4.55);
  group.add(peg);
  const r = rng(11);
  for (let i = 0; i < 16; i++) {
    const tool = new THREE.Mesh(new THREE.BoxGeometry(0.03 + r() * 0.05, 0.18 + r() * 0.3, 0.03), steel);
    tool.position.set(-2.6 + (i % 8) * 0.28, 1.6 + Math.floor(i / 8) * 0.55, -LEN + 4.6);
    group.add(tool);
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.05, 0.05), new THREE.MeshStandardMaterial({ color: 0x3a4a44, roughness: 0.6, metalness: 0.3 }));
  door.position.set(1.9, 1.03, -LEN + 4.55);
  group.add(door);
  // The floor, and the street beyond the opening.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, LEN).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: concrete(), roughness: 0.8 }));
  floor.position.set(0, 0, -LEN / 2 + 4.5);
  floor.receiveShadow = true;
  group.add(floor);
  const street = new THREE.Mesh(new THREE.PlaneGeometry(40, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.9 }));
  street.position.set(0, -0.01, 14.5);
  group.add(street);
  // The shutter, rolled up in its box over the opening, and the arch's face around it.
  const box = new THREE.Mesh(new THREE.BoxGeometry(R * 1.7, 0.45, 0.45), steel);
  box.position.set(0, R * 0.78, 4.35);
  group.add(box);
  const face = new THREE.Mesh(new THREE.RingGeometry(R, R + 1.2, 40, 1, 0, Math.PI), brick);
  face.position.set(0, 0.6, 4.5);
  group.add(face);
  // Fluorescent tubes along the vault (their light is the scene's key; they flicker when a train passes).
  const tubeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.4, 2.5) });
  const tubes: THREE.PointLight[] = [];
  for (const z of [-3.5, 0.5]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 1.5), tubeMat);
    t.position.set(0, R + 0.45, z);
    group.add(t);
    const l = new THREE.PointLight(0xe8f2ff, 18, 13, 1.3);
    l.position.set(0, R + 0.2, z);
    group.add(l);
    tubes.push(l);
  }
  // A warm work lamp by the bench.
  const lamp = new THREE.PointLight(0xffb070, 3, 4, 1.6);
  lamp.position.set(-3.2, 1.8, -2.6);
  group.add(lamp);
  group.add(new THREE.HemisphereLight(0x3a4050, 0x141210, 0.5));
  // Workbench, roll cabinet, tyres, an oil drum, the poster.
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.85 });
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 2.4), wood);
  bench.position.set(-3.55, 0.92, -2.6);
  group.add(bench);
  for (const z of [-3.7, -1.5]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.06), steel);
    leg.position.set(-3.55, 0.45, z);
    group.add(leg);
  }
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.9), new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.4, metalness: 0.3 }));
  cab.position.set(3.55, 0.5, -3.2);
  group.add(cab);
  const tyre = new THREE.TorusGeometry(0.28, 0.1, 10, 24).rotateX(Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const t = new THREE.Mesh(tyre, dark);
    t.position.set(3.4 - (i > 2 ? 0.7 : 0), 0.1 + (i % 3) * 0.2, -0.6 - (i > 2 ? 0.1 : 0));
    group.add(t);
  }
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.88, 20), new THREE.MeshStandardMaterial({ color: 0x1c4a7a, roughness: 0.5, metalness: 0.4 }));
  drum.position.set(3.5, 0.44, 1.8);
  group.add(drum);
  const post = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.87), new THREE.MeshStandardMaterial({ map: poster(), roughness: 0.8 }));
  post.position.set(R - 0.05, 1.75, -1.2);
  post.rotation.y = -Math.PI / 2;
  group.add(post);
  // Outside: a vending machine across the street, glowing, and a street lamp.
  const vend = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.85, 0.7), new THREE.MeshStandardMaterial({ color: 0xe8e8ec, emissive: 0xa8c8ff, emissiveIntensity: 0.9 }));
  vend.position.set(-4.5, 0.93, 11);
  group.add(vend);
  const vglow = new THREE.PointLight(0xa8c8ff, 8, 9, 1.5);
  vglow.position.set(-4.5, 1.2, 10);
  group.add(vglow);
  const sl = new THREE.PointLight(0xffc890, 12, 16, 1.3);
  sl.position.set(5, 5.5, 9);
  group.add(sl);

  let t = 0;
  let next = 14;
  let rumble = 0;
  return {
    group,
    update(dt: number): { rumble: number } {
      t += dt;
      // A train over the arch every so often: a rumble building and fading over a few seconds.
      if (t > next) {
        next = t + 25 + Math.random() * 25;
        rumble = 4;
      }
      rumble = Math.max(0, rumble - dt);
      const k = Math.sin((Math.min(4, rumble) / 4) * Math.PI);
      for (const l of tubes) l.intensity = 18 * (k > 0.3 && Math.random() < 0.08 * k ? 0.35 : 1);
      return { rumble: k };
    },
  };
}
