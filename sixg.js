// sixg.js — the 6G (IMT-2030) world: radio sites, users, links, sky and space layers.
// Simple physics: free-space path loss + array gain + Shannon bound. The planet is scaled,
// so every link has a "real-scale" factor K to turn world metres into real metres.

const C0 = 299792458;
const dB = x => 10 * Math.log10(x);
const fspl = (d, f) => 20 * Math.log10(Math.max(d, 0.1)) + 20 * Math.log10(f) - 147.55;
const fmtR = r => r >= 1e9 ? (r / 1e9).toFixed(1) + ' Gbit/s' : r >= 1e6 ? (r / 1e6).toFixed(0) + ' Mbit/s' : (r / 1e3).toFixed(0) + ' kbit/s';
const fmtD = d => d >= 1000 ? (d / 1000).toFixed(1) + ' km' : d.toFixed(0) + ' m';
const fmtF = f => f >= 1e9 ? (f / 1e9).toFixed(f < 1e10 ? 1 : 0) + ' GHz' : (f / 1e6).toFixed(0) + ' MHz';
const fmtT = s => s >= 1e-3 ? (s * 1e3).toFixed(2) + ' ms' : (s * 1e6).toFixed(1) + ' us';
const beamW = n => (102 / n) * Math.PI / 180;      // half-power beam width of n elements at lambda/2 (rad)

// link budget: o = {d, f, bw, ptx, gtx, grx, nf, loss, layers}
const budget = o => {
  const pl = fspl(o.d, o.f) + (o.loss || 0);
  const prx = o.ptx + o.gtx + o.grx - pl;
  const snr = prx - (-174 + dB(o.bw) + (o.nf ?? 7));
  const L = o.layers || 1, lay = snr > 18 ? L : snr > 8 ? Math.min(2, L) : 1;
  const rate = snr > -6 ? lay * o.bw * Math.log2(1 + Math.pow(10, Math.min(snr, 30) / 10)) : 0;
  return { pl, prx, snr, lay, rate, delay: o.d / C0 };
};
const budgetLines = (b, o) => [
  `# f ${fmtF(o.f)}  BW ${fmtF(o.bw)}  d ${fmtD(o.d)}`,
  `path loss ${b.pl.toFixed(0)} dB  Rx ${b.prx.toFixed(0)} dBm`,
  `> SNR ${b.snr.toFixed(1)} dB  x${b.lay} layers`,
  `> rate ${fmtR(b.rate)} (Shannon)`
];

// ---------- visual primitives ----------
const CONE = (() => { const g = new THREE.CylinderGeometry(1, 0, 1, 20, 1, true); g.translate(0, 0.5, 0); g.rotateX(Math.PI / 2); return g; })();
const BALL = new THREE.SphereGeometry(1, 8, 6);

// beam cone a->b with packets (down: colour, up: white)
const makeBeam = (scene, color, o = {}) => {
  const mesh = new THREE.Mesh(CONE, glow(color, o.opacity ?? 0.2));
  const nD = o.n ?? 7, nU = o.up === false ? 0 : 3;
  const dl = new THREE.InstancedMesh(BALL, new THREE.MeshBasicMaterial({ color, fog: false }), Math.max(nD, 1));
  const ul = new THREE.InstancedMesh(BALL, new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }), Math.max(nU, 1));
  [mesh, dl, ul].forEach(m => { m.frustumCulled = false; scene.add(m); });
  ul.visible = nU > 0;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = V3(), P = V3();
  const set = (a, b, bw, t, on = true) => {
    mesh.visible = on; dl.visible = on && nD > 0; ul.visible = on && nU > 0;
    if (!on) return;
    const L = a.distanceTo(b), w = Math.max(L * Math.tan(bw / 2), 0.04);
    mesh.position.copy(a); mesh.lookAt(b); mesh.scale.set(w, w, L);
    a = a.clone(); b = b.clone();
    const v = o.speed ?? 14, s = Math.min(o.maxSize ?? 1.2, Math.max(o.size ?? 0.1, L * 0.006));
    if (o.rev) [a, b] = [b, a];
    for (let i = 0; i < nD; i++) {
      P.lerpVectors(a, b, ((t * v / L) + i / nD) % 1); S.setScalar(s);
      dl.setMatrixAt(i, M.compose(P, Q, S));
    }
    for (let i = 0; i < nU; i++) {
      P.lerpVectors(b, a, ((t * v * 0.7 / L) + i / nU) % 1); S.setScalar(s * 0.7);
      ul.setMatrixAt(i, M.compose(P, Q, S));
    }
    dl.instanceMatrix.needsUpdate = ul.instanceMatrix.needsUpdate = true;
  };
  return { set, mesh };
};
const makeLine = (scene, color, dashed = false) => {
  const g = new THREE.BufferGeometry().setFromPoints([V3(), V3(0, 1, 0)]);
  const m = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.8, gapSize: 0.6, fog: false })
                   : new THREE.LineBasicMaterial({ color, fog: false, transparent: true, opacity: 0.9 });
  const l = new THREE.Line(g, m); l.frustumCulled = false; scene.add(l);
  const set = (a, b, on = true) => {
    l.visible = on; if (!on) return;
    g.attributes.position.setXYZ(0, a.x, a.y, a.z); g.attributes.position.setXYZ(1, b.x, b.y, b.z);
    g.attributes.position.needsUpdate = true; if (dashed) l.computeLineDistances();
  };
  return { set, line: l };
};
const wp = (obj, x = 0, y = 0, z = 0) => obj.localToWorld(V3(x, y, z));
const canvasTex = (w, h, draw) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};
const person = (color) => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.9, 3, 8), lam(color)); body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), lam('#f1c27d')); head.position.y = 1.55;
  g.add(body, head); return g;
};
// ribbon (road) along local path fn(u) -> [e, n], u in 0..1
const ribbon = (fn, n, w, color, lift = 0.05) => {
  const pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, [e, nn] = fn(u), [e2, n2] = fn(u + 0.001);
    const tx = e2 - e, ty = n2 - nn, l = Math.hypot(tx, ty), sx = -ty / l * w / 2, sy = tx / l * w / 2;
    [[e + sx, nn + sy], [e - sx, nn - sy]].forEach(([a, b]) => pos.push(...townPos(a, b, lift).toArray()));
    if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, lam(color, { side: THREE.DoubleSide }));
};

// ================= build the world =================
const buildSixG = scene => {
  const ups = [];               // per-frame updaters (t, dt, ctx)
  const lives = [];             // [board, fn] live text at ~4 Hz
  const live = (b, fn) => lives.push([b, fn]);
  const K_GROUND = 8;           // 1 world m = 8 real m on the ground
  const add = o => (scene.add(o), o);

  // ---------- macro site: extreme massive MIMO ----------
  const NEL = 32;               // 32 x 32 = 1024 elements per panel
  const tower = add(placeLocal(new THREE.Group(), 0, 0, 0, 0));
  tower.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.55, 22, 8).translate(0, 11, 0), lam('#e8e8f0')));
  tower.add(box(1.6, 1.8, 1.0, lam('#8090a8')).translateX(1.5));          // O-RU/DU cabinet
  const dots = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#0b1830'; c.fillRect(0, 0, w, h); c.fillStyle = '#4fe3ff';
    for (let i = 0; i < NEL; i++) for (let j = 0; j < NEL; j++) c.fillRect(4 + i * 7.8, 4 + j * 7.8, 3.6, 3.6);
  });
  const panels = [0, 120, 240].map(deg => {
    const p = new THREE.Group(), a = deg * Math.PI / 180;
    p.position.set(Math.sin(a) * 0.75, 19.5, -Math.cos(a) * 0.75); p.rotation.y = -a + Math.PI;
    p.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 0.2), lam('#1d2a44')));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1), new THREE.MeshBasicMaterial({ map: dots }));
    face.position.z = 0.11; p.add(face); tower.add(p); return p;
  });
  const topLight = new THREE.Mesh(BALL, new THREE.MeshBasicMaterial({ color: '#ff3355' }));
  topLight.scale.setScalar(0.25); topLight.position.y = 22.3; tower.add(topLight);
  tower.updateMatrixWorld(true);
  // origin of a beam: the panel that faces the target best
  const panelFor = target => {
    let best = null, bd = -2;
    panels.forEach(p => {
      const c = wp(p), nrm = wp(p, 0, 0, 1).sub(c).normalize(), d = target.clone().sub(c).normalize().dot(nrm);
      if (d > bd) { bd = d; best = c; }
    });
    return best;
  };
  ups.push(t => topLight.material.color.set(Math.sin(t * 4) > 0 ? '#ff3355' : '#400'));
  const towerB = makeBoard('6G macro site (gNB)', [
    'Panel: 32 x 32 = 1024 antenna elements',
    'Band: FR3 upper mid-band, ~7 GHz',
    `Beam width ~ 102/N deg = ${(102 / NEL).toFixed(1)} deg`,
    `Array gain 10 log10(1024) = ${dB(1024).toFixed(0)} dB`,
    'Each cone = one beam to one user.',
    'Coloured dots: downlink packets.',
    'White dots: uplink packets.',
    '# Extreme MIMO: many beams at the same',
    '# time on the same frequency (MU-MIMO).'
  ], { at: townPos(0, 0), lift: 6, range: 26, w: 4 });

  // ---------- road, a platoon of connected cars, V2X sidelink ----------
  const RR = 30, GAP = 9, VMAX = 9;              // world m/s; shown as real km/h with x2
  add(ribbon(u => [RR * Math.sin(u * 2 * Math.PI), RR * Math.cos(u * 2 * Math.PI)], 96, 5, '#3a3f58'));
  add(ribbon(u => [RR * Math.sin(u * 2 * Math.PI), RR * Math.cos(u * 2 * Math.PI)], 96, 0.2, '#f4f0d0', 0.07));
  const mkCar = col => {
    const g = add(new THREE.Group());
    g.add(box(1.9, 0.8, 4.6, lam(col)).translateY(0.3));
    g.add(box(1.7, 0.55, 2.3, lam('#1c2233')).translateY(1.1).translateZ(0.2));
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, z]) => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10).rotateZ(Math.PI / 2), lam('#222'));
      w.position.set(x * 0.95, 0.36, z * 1.45); g.add(w);
    });
    const ant = new THREE.Mesh(BALL, new THREE.MeshBasicMaterial({ color: '#4fe3ff' })); ant.scale.setScalar(0.12);
    ant.position.set(0, 1.72, 0.6); g.add(ant);
    const brakeM = new THREE.MeshBasicMaterial({ color: '#550000' });
    [-0.65, 0.65].forEach(x => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.05), brakeM); b.position.set(x, 0.85, 2.32); g.add(b); });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), glow('#7dff9a', 0.5));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; g.add(ring);
    return { g, ant, brakeM, ring, ph: Math.random() };
  };
  const cars = ['#f3f3f6', '#e2453c', '#3d7bff', '#ffd23f'].map(mkCar);
  const car = cars[0].g, carAnt = cars[0].ant;
  const P = { s: 0, v: VMAX, brake: false };
  const CYC = 16, vAt = c => c < 10 ? VMAX : c < 11.2 ? lerp(VMAX, 2, (c - 10) / 1.2) : lerp(2, VMAX, (c - 11.2) / 4.8);
  const posAt = s => { const a = s / RR; return [RR * Math.sin(a), RR * Math.cos(a)]; };
  const carBeam = makeBeam(scene, '#4fe3ff');
  const carPred = makeBeam(scene, '#ffffff', { opacity: 0.07, n: 0, up: false });
  const side = cars.slice(1).map(() => makeBeam(scene, '#7dff9a', { opacity: 0.35, speed: 10, size: 0.07 }));
  const rsu = add(placeLocal(new THREE.Group(), 4.5, -34, 0, 0));
  rsu.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6).translate(0, 2, 0), lam('#888')));
  rsu.add(box(0.5, 0.4, 0.3, lam('#e8e8f0')).translateY(4));
  rsu.updateMatrixWorld(true);
  const rsuP = wp(rsu, 0, 4.2, 0), rsuBeam = makeBeam(scene, '#7dff9a', { opacity: 0.25, speed: 8, size: 0.07 });
  const carB = makeBoard('Connected car', [], { anchor: car, lift: 4.5, range: 22 });
  const carState = { d: 0 };
  ups.push((t, dt) => {
    const c = t % CYC; P.v = vAt(c); P.brake = c >= 10 && c < 11.2; P.s += P.v * dt;
    cars.forEach((k, i) => {
      const [e, n] = posAt(P.s - i * GAP), [e2, n2] = posAt(P.s - i * GAP + 0.3);
      const d = localDir(TOWN, e, n), d2 = localDir(TOWN, e2, n2);
      placeOn(k.g, d, 0, d2.sub(d)); k.g.updateMatrixWorld();
      k.brakeM.color.set(P.brake ? '#ff2020' : '#550000');
      const f = (t * 1.2 + k.ph) % 1;
      k.ring.scale.setScalar(1 + f * 11); k.ring.material.opacity = 0.45 * (1 - f);
      k.ring.material.color.set(P.brake ? '#ff3355' : '#7dff9a');
    });
    side.forEach((b, i) => { b.set(wp(cars[i].ant), wp(cars[i + 1].ant), 0.15, t); b.mesh.material.color.set(P.brake ? '#ff3355' : '#7dff9a'); });
    const near = cars.map(k => wp(k.ant)).sort((a, b) => a.distanceTo(rsuP) - b.distanceTo(rsuP))[0];
    rsuBeam.set(rsuP, near, 0.12, t, near.distanceTo(rsuP) < 16);
    const tgt = wp(carAnt), src = panelFor(tgt);
    carBeam.set(src, tgt, beamW(NEL), t);
    const [pe, pn] = posAt(P.s + P.v * 1.0); carPred.set(src, townPos(pe, pn, 1.7), beamW(NEL), t);
    carState.d = src.distanceTo(tgt) * K_GROUND;
  });
  live(carB, () => {
    const o = { d: carState.d, f: 7e9, bw: 400e6, ptx: 43, gtx: dB(NEL * NEL) + 5, grx: 8, layers: 4 };
    const b = budget(o), v = P.v * 2;
    return [
      `Speed ${(v * 3.6).toFixed(0)} km/h. Beam follows the car.`,
      ...budgetLines(b, o),
      `Doppler at 7 GHz: ${(7e9 * v / C0).toFixed(0)} Hz max`,
      'White ghost cone: AI/ML beam prediction',
      '# The model predicts the beam 1 s ahead,',
      '# so the site sweeps fewer beams.'
    ];
  });
  const v2xB = makeBoard('V2X: cars talk direct', [], { at: townPos(-2, -36), lift: 3.2, range: 18 });
  live(v2xB, () => {
    const v = VMAX * 2, kmh = (v * 3.6).toFixed(0);
    return [
      'Green links: sidelink (PC5), car to car,',
      'no tower in the path. ITS band 5.9 GHz.',
      'Rings: each car sends position + speed',
      'about 10 times per second.',
      P.brake ? '> LEAD CAR BRAKES: all cars brake now' : '> watch: every 16 s the lead car brakes',
      `At ${kmh} km/h, before the brakes go on:`,
      `  human sees brake light (1.5 s): ${(v * 1.5).toFixed(0)} m`,
      `  V2X warning (~10 ms):           ${(v * 0.01).toFixed(1)} m`,
      '# Pole = roadside unit (V2I): signals,',
      '# hazards. 6G adds better sidelink + position.'
    ];
  });

  // ---------- pedestrian with holographic call ----------
  const pedA = add(person('#ff8a3d'));
  const phoneA = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.02), new THREE.MeshBasicMaterial({ color: '#4fe3ff' }));
  phoneA.position.set(0.2, 1.55, -0.05); pedA.add(phoneA);
  const holo = person('#4fe3ff'); holo.traverse(m => m.material && (m.material = glow('#4fe3ff', 0.35)));
  holo.scale.setScalar(0.35); holo.position.set(0.7, 1.4, -0.5); pedA.add(holo);
  const pedBeam = makeBeam(scene, '#ffd23f');
  const pedB = makeBoard('Immersive call', [], { anchor: pedA, lift: 3, range: 16 });
  const pedS = { d: 0 };
  ups.push(t => {
    const u = 0.5 - 0.5 * Math.cos(t * 0.15), [e, n] = [lerp(8, 15, u), lerp(5, 17, u)];
    const dir = Math.sin(t * 0.15) >= 0 ? 1 : -1;
    const d = localDir(TOWN, e, n), d2 = localDir(TOWN, e + 0.7 * dir, n + 1.2 * dir);
    placeOn(pedA, d, 0, d2.sub(d)); pedA.updateMatrixWorld();
    holo.rotation.y = t; holo.position.y = 1.4 + Math.sin(t * 2) * 0.05;
    const tg = wp(phoneA), s = panelFor(tg); pedBeam.set(s, tg, beamW(NEL), t);
    pedS.d = s.distanceTo(tg) * K_GROUND;
  });
  live(pedB, () => {
    const o = { d: pedS.d, f: 7e9, bw: 400e6, ptx: 43, gtx: dB(1024) + 5, grx: 3, layers: 4 };
    return [
      'Usage scenario: Immersive communication',
      'A 3D holographic call needs high rate',
      'AND low latency at the same time.',
      ...budgetLines(budget(o), o),
      '# IMT-2030 target: user rate 300-500',
      '# Mbit/s, latency 0.1-1 ms (M.2160).'
    ];
  });

  // ---------- home: FWA to the roof, sub-THz inside ----------
  const home = add(placeLocal(new THREE.Group(), -18, 14, 0, 160));
  const wallM = lam('#f0e6d8'), roofM = lam('#7e5a8c');
  home.add(box(8, 0.15, 6, lam('#c9b49a')));
  home.add(box(8, 3.6, 0.2, wallM).translateZ(3));
  home.add(box(0.2, 3.6, 6, wallM).translateX(-4));
  home.add(box(0.2, 3.6, 6, wallM).translateX(4));
  home.add(box(8.4, 0.3, 6.4, roofM).translateY(3.6));
  const cpe = box(0.5, 0.4, 0.5, lam('#ffffff')); cpe.position.set(2.5, 3.9, 1.5); home.add(cpe);
  const ap = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16), new THREE.MeshBasicMaterial({ color: '#ff5fd2' }));
  ap.position.set(0, 3.45, 0.5); home.add(ap);
  const tv = box(2.2, 1.2, 0.1, lam('#111')); tv.position.set(0, 1.2, 2.85); home.add(tv);
  const tvS = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.1), new THREE.MeshBasicMaterial({ color: '#2b6fff' }));
  tvS.position.set(0, 1.8, 2.79); tvS.rotation.y = Math.PI; home.add(tvS);
  home.add(box(2.4, 0.5, 0.9, lam('#5b6bbf')).translateZ(0.6).translateX(-1));     // sofa
  const table = box(1.2, 0.75, 0.7, lam('#a0785a')); table.position.set(2.2, 0, -0.5); home.add(table);
  const laptop = box(0.4, 0.25, 0.02, lam('#cccccc')); laptop.position.set(2.2, 0.76, -0.5); home.add(laptop);
  const gamer = person('#57d68d'); gamer.position.set(-1.6, 0, -1.2); gamer.rotation.y = Math.PI; home.add(gamer);
  const hmd = box(0.3, 0.14, 0.16, lam('#222')); hmd.position.set(0, 1.5, 0.12); gamer.add(hmd);
  const sensorDots = [[-3.5, 2.5, -2.5], [3.5, 0.6, 2.5], [-3.6, 1.2, 1.5]].map(([x, y, z]) => {
    const s = new THREE.Mesh(BALL, new THREE.MeshBasicMaterial({ color: '#7dff9a' })); s.scale.setScalar(0.06); s.position.set(x, y, z); home.add(s); return s;
  });
  home.updateMatrixWorld(true);
  const fwa = makeBeam(scene, '#4fe3ff');
  const thz = [makeBeam(scene, '#ff5fd2', { size: 0.03, speed: 4 }), makeBeam(scene, '#ff5fd2', { size: 0.03, speed: 4 }), makeBeam(scene, '#ff5fd2', { size: 0.03, speed: 4 })];
  const homeB = makeBoard('Home: sub-THz + FWA', [], { at: wp(home, 0, 0, -3.5), lift: 5, range: 18 });
  ups.push(t => {
    const c = wp(cpe, 0, 0.4, 0); fwa.set(panelFor(c), c, beamW(NEL), t);
    const a = wp(ap); [wp(hmd), wp(tv, 0, 0.6, -0.1), wp(laptop, 0, 0.12, 0)].forEach((p, i) => thz[i].set(a, p, beamW(16), t));
    sensorDots.forEach((s, i) => s.visible = Math.sin(t * 3 + i * 2) > 0.6);
  });
  live(homeB, () => {
    const d = wp(ap).distanceTo(wp(hmd));
    const o = { d, f: 140e9, bw: 2e9, ptx: 10, gtx: dB(256) + 3, grx: dB(64) + 3, layers: 2 };
    return [
      'Roof unit: fixed wireless from the tower.',
      'Ceiling AP: sub-THz, 140 GHz (D-band).',
      ...budgetLines(budget(o), o),
      'Very wide band, very short range.',
      'A wall blocks sub-THz almost fully, so',
      'each room needs its own access point.',
      '# Green dots: low-power sensors.'
    ];
  });

  // ---------- RIS: go around a blocking building ----------
  add(placeLocal(box(6, 14, 6, lam('#8d7fb8')), 27, -24, -0.2, 48));
  const risPole = add(placeLocal(new THREE.Group(), 45, -14, 0, 0));
  risPole.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 6).translate(0, 3, 0), lam('#777')));
  risPole.updateMatrixWorld(true);
  const risC = wp(risPole, 0, 7, 0);
  const pedB0 = add(person('#ff5fa2'));
  const phoneB = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.02), new THREE.MeshBasicMaterial({ color: '#4fe3ff' }));
  phoneB.position.set(0.2, 1.55, -0.05); pedB0.add(phoneB);
  const pedBpos = t => localDir(TOWN, 44 + 2 * Math.sin(t * 0.2), -40 + 2 * Math.cos(t * 0.2));
  placeOn(pedB0, pedBpos(0), 0); pedB0.updateMatrixWorld();
  // RIS panel faces the bisector between tower and user
  const towerTop = townPos(0, 0, 19.5);
  const risN = towerTop.clone().sub(risC).normalize().add(wp(phoneB).sub(risC).normalize()).normalize();
  const NR = 12, ris = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.24, 0.06), new THREE.MeshBasicMaterial({ color: '#fff' }), NR * NR);
  const risG = new THREE.Group(); risG.position.copy(risC); risG.up.copy(risC.clone().normalize()); risG.lookAt(risC.clone().add(risN));
  const o3 = new THREE.Object3D();
  for (let i = 0; i < NR; i++) for (let j = 0; j < NR; j++) {
    o3.position.set((i - NR / 2 + 0.5) * 0.27, (j - NR / 2 + 0.5) * 0.27, 0); o3.updateMatrix(); ris.setMatrixAt(i * NR + j, o3.matrix);
  }
  risG.add(ris, new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.4, 0.05), lam('#1d2a44')).translateZ(-0.06));
  add(risG);
  const risIn = makeBeam(scene, '#4fe3ff'), risOut = makeBeam(scene, '#9ff3ff');
  const blocked = makeLine(scene, '#ff3355', true);
  const risB = makeBoard('RIS: smart mirror', [], { at: risC.clone(), lift: 3.5, range: 24 });
  const col = new THREE.Color(), risS = { d1: 0, d2: 0, dd: 0 };
  ups.push(t => {
    placeOn(pedB0, pedBpos(t), 0, pedBpos(t + 0.1).sub(pedBpos(t))); pedB0.updateMatrixWorld();
    const p = wp(phoneB), s = panelFor(risC);
    risIn.set(s, risC, beamW(NEL), t); risOut.set(risC, p, beamW(NR * 2), t);
    blocked.set(panelFor(p), p);
    for (let i = 0; i < NR; i++) for (let j = 0; j < NR; j++)   // phase gradient shown as colour
      ris.setColorAt(i * NR + j, col.setHSL(((i * 0.11 + j * 0.03 - t * 0.3) % 1 + 1) % 1, 0.8, 0.55));
    ris.instanceColor.needsUpdate = true;
    risS.d1 = s.distanceTo(risC) * K_GROUND; risS.d2 = risC.distanceTo(p) * K_GROUND; risS.dd = panelFor(p).distanceTo(p) * K_GROUND;
  });
  live(risB, () => {
    const base = { f: 7e9, bw: 400e6, ptx: 43, gtx: dB(1024) + 5, grx: 3, layers: 4 };
    const dir = budget({ ...base, d: risS.dd, loss: 35 });
    const via = budget({ ...base, d: risS.d1 + risS.d2, loss: 6 });
    return [
      'The building blocks the direct path.',
      `> direct: ${dir.snr.toFixed(0)} dB SNR, ${fmtR(dir.rate)}`,
      `> via RIS: ${via.snr.toFixed(0)} dB SNR, ${fmtR(via.rate)}`,
      'RIS = 144 passive cells. Each cell sets',
      'a phase shift (colours). Together they',
      'steer the reflection to the user.',
      'No amplifier, very low power.',
      '# Model: large RIS acts like a mirror,',
      '# loss ~ FSPL(d1+d2) + 6 dB.'
    ];
  });

  // ---------- drone + ISAC (sensing) ----------
  const drone = add(new THREE.Group());
  drone.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), lam('#333')));
  const rotors = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.7), lam('#555')); arm.position.set(x * 0.25, 0, z * 0.25); arm.rotation.y = Math.atan2(x, z); drone.add(arm);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 12), glow('#ffffff', 0.25)); r.position.set(x * 0.45, 0.1, z * 0.45); drone.add(r); return r;
  });
  const pkg = box(0.3, 0.25, 0.3, lam('#c8a060')); pkg.position.y = -0.4; drone.add(pkg);
  const droneAt = t => localDir(TOWN, -25 + 12 * Math.sin(t * 0.25), -28 + 12 * Math.sin(t * 0.5));
  const droneH = t => 18 + 2 * Math.sin(t * 0.7);
  const droneBeam = makeBeam(scene, '#b06cff');
  const shell = add(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: '#ffd23f', wireframe: true, transparent: true, opacity: 0.1, depthWrite: false, fog: false })));
  shell.position.copy(towerTop);
  const echo = () => { const b = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#ffd23f', transparent: true, fog: false })); scene.add(b); return b; };
  const carEcho = echo(), droneEcho = echo();
  carEcho.scale.set(2.6, 2, 5.4); droneEcho.scale.set(1.6, 1, 1.6);
  const trailN = 40, trailP = new Float32Array(trailN * 3);
  const trailG = new THREE.BufferGeometry(); trailG.setAttribute('position', new THREE.BufferAttribute(trailP, 3));
  const trail = new THREE.Points(trailG, new THREE.PointsMaterial({ color: '#ffd23f', size: 0.35, fog: false })); trail.frustumCulled = false; scene.add(trail);
  let trailI = 0, lastPulse = -1;
  const PULSE = 2.4, RMAX = 75;
  const isacB = makeBoard('ISAC: the network can see', [], { at: townPos(-6, 6), lift: 4, range: 22 });
  const isacS = { dc: 0, dd: 0, hd: 0 };
  ups.push(t => {
    const dd = droneAt(t), dd2 = droneAt(t + 0.1);
    drone.position.copy(dd).multiplyScalar(groundR(dd) + droneH(t)); drone.quaternion.copy(basisQ(dd, tangent(dd2.sub(dd), dd)));
    rotors.forEach(r => r.rotation.y = t * 40); drone.updateMatrixWorld();
    const dp = drone.position.clone(); droneBeam.set(panelFor(dp), dp, beamW(NEL), t);
    // sensing pulse: a wave goes out, echoes come back from the car and the drone
    const f = (t % PULSE) / PULSE, r = f * RMAX;
    shell.scale.setScalar(Math.max(r, 0.1)); shell.material.opacity = 0.14 * (1 - f) * (1 - f);
    const cp = wp(car, 0, 0.9, 0), dc = cp.distanceTo(towerTop), ddr = dp.distanceTo(towerTop);
    [[carEcho, car, cp, dc], [droneEcho, drone, dp, ddr]].forEach(([e, o, p, d]) => {
      e.position.copy(p); e.quaternion.copy(o.quaternion);
      e.material.opacity = Math.max(0, 1 - Math.abs(r - d) / 6) * 0.9 + 0.1;
    });
    const k = Math.floor(t / PULSE);
    if (k !== lastPulse) { lastPulse = k; trailP.set(cp.toArray(), (trailI++ % trailN) * 3); trailG.attributes.position.needsUpdate = true; }
    isacS.dc = dc * K_GROUND; isacS.dd = ddr * K_GROUND; isacS.hd = droneH(t) * K_GROUND / 4;
  });
  live(isacB, () => {
    const v = P.v * 2;
    return [
      'The same 6G signal works as a radar.',
      'Yellow wave = sensing pulse from site.',
      'Echo boxes light up when it hits.',
      `> car: range ${fmtD(isacS.dc)}, v ${(v * 3.6).toFixed(0)} km/h`,
      `  2-way Doppler ${(2 * 7e9 * v / C0).toFixed(0)} Hz at 7 GHz`,
      `> drone: range ${fmtD(isacS.dd)}, alt ${isacS.hd.toFixed(0)} m`,
      `Range res. c/2B = ${(C0 / 2 / 400e6).toFixed(2)} m at 400 MHz`,
      '# Usage scenario: ISAC (new in 6G).',
      '# Yellow dots: tracked car positions.'
    ];
  });

  // ---------- massive IoT field ----------
  const iot = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) {
    const g = add(placeLocal(new THREE.Group(), 22 + i * 3.4 + (j % 2) * 1.5, 12 + j * 3.6, 0, 0));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 5).translate(0, 0.35, 0), lam('#999')));
    const led = new THREE.Mesh(BALL, new THREE.MeshBasicMaterial({ color: '#2a5' })); led.scale.setScalar(0.09); led.position.y = 0.75; g.add(led);
    g.updateMatrixWorld(true); iot.push({ led, p: wp(g, 0, 0.75, 0), ph: Math.random() * 10, per: 3 + Math.random() * 5 });
  }
  const iotPos = new Float32Array(iot.length * 6);
  const iotG = new THREE.BufferGeometry(); iotG.setAttribute('position', new THREE.BufferAttribute(iotPos, 3));
  const iotL = new THREE.LineSegments(iotG, new THREE.LineBasicMaterial({ color: '#7dff9a', transparent: true, opacity: 0.7, fog: false }));
  iotL.frustumCulled = false; scene.add(iotL);
  ups.push(t => iot.forEach((s, i) => {
    const on = ((t + s.ph) % s.per) < 0.25;
    s.led.material.color.set(on ? '#7dff9a' : '#1b4d2a');
    iotPos.set(s.p.toArray(), i * 6); iotPos.set((on ? towerTop : s.p).toArray(), i * 6 + 3);
    iotG.attributes.position.needsUpdate = true;
  }));
  makeBoard('Massive IoT / Ambient IoT', [
    '30 soil sensors. Each sends a few bytes',
    'now and then (green flash).',
    'Ambient IoT tags have no battery: they',
    'harvest energy from the radio wave and',
    'reflect it back (backscatter).',
    '> IMT-2030 target: 1e6 - 1e8 devices/km2',
    '# Usage scenario: Massive communication'
  ], { at: townPos(30, 20), lift: 3.5, range: 20 });

  // ---------- edge computing over fiber ----------
  const edge = add(placeLocal(new THREE.Group(), -36, -6, 0, 90));
  edge.add(box(6, 4, 4, lam('#5e6b7f')));
  const racks = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.18), new THREE.MeshBasicMaterial({ color: '#4fe3ff' }));
    l.position.set(-2 + i * 1.3, 1 + j * 0.8, 2.01); edge.add(l); racks.push(l);
  }
  const fPts = [[1, 0], [-8, -2], [-18, -6], [-28, -6], [-33, -6]].map(([e, n]) => townPos(e, n, 0.1));
  const fiber = new THREE.CatmullRomCurve3(fPts);
  add(new THREE.Mesh(new THREE.TubeGeometry(fiber, 60, 0.08, 6), new THREE.MeshBasicMaterial({ color: '#ff9f43' })));
  const fpk = new THREE.InstancedMesh(BALL, new THREE.MeshBasicMaterial({ color: '#fff3c0' }), 10); fpk.frustumCulled = false; add(fpk);
  ups.push(t => {
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = V3(0.16, 0.16, 0.16);
    for (let i = 0; i < 10; i++) fpk.setMatrixAt(i, M.compose(fiber.getPointAt(((t * 0.35 + i / 10) * (i % 2 ? 1 : -1) % 1 + 1) % 1), Q, S));
    fpk.instanceMatrix.needsUpdate = true;
    racks.forEach((l, i) => l.visible = Math.sin(t * 7 + i * 1.7) > -0.3);
  });
  const edgeB = makeBoard('Edge computing', [], { at: townPos(-36, -6), lift: 6, range: 20 });
  live(edgeB, () => {
    const air = 0.1e-3, fib = fiber.getLength() * K_GROUND / 2e8, proc = 0.5e-3;
    return [
      'Fiber (orange) links the site to a small',
      'data centre close to the users.',
      `air interface   ${fmtT(air)}  (6G target)`,
      `fiber ${fmtD(fiber.getLength() * K_GROUND)}     ${fmtT(fib)}  (5 us/km)`,
      `edge compute    ${fmtT(proc)}`,
      `> round trip    ${fmtT(2 * (air + fib) + proc)}`,
      '> far cloud: +20-50 ms round trip',
      '# Car safety, XR and robots need the',
      '# edge. Usage scenario: HRLLC.'
    ];
  });

  // ---------- spectrum ladder ----------
  const spec = add(placeLocal(new THREE.Group(), -10, -26, 0, 0));
  spec.add(new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.2, 32).translate(0, 0.1, 0), lam('#4a4f6a')));
  [['#ff9f43', 4.5, -4.5, 0.45], ['#4fe3ff', 2.2, 1.5, 2.0], ['#ff5fd2', 0.8, 5.2, 4.5]].forEach(([c, r, x, bar]) => {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glow(c, 0.22));
    dome.position.set(x, 0.2, 0); spec.add(dome);
    const b = box(0.5, bar, 0.5, new THREE.MeshBasicMaterial({ color: c })); b.position.set(x, 0.2, -5.5); spec.add(b);
  });
  makeBoard('Spectrum: range vs bandwidth', [
    'Domes = coverage, bars = bandwidth.',
    '# (not to scale)',
    'Orange  700 MHz   20 MHz   km range',
    'Cyan    7 GHz     400 MHz  100s of m',
    'Pink    140 GHz   2+ GHz   few metres',
    'Free-space loss grows 20 dB per 10x f.',
    'Big arrays win back that loss: at high f',
    'the elements are small, so more fit.',
    '# FR3 7-24 GHz: key new 6G band (WRC-27)'
  ], { at: townPos(-10, -26), lift: 4, range: 20 });

  // ---------- spawn: overview boards ----------
  makeBoard('IMT-2030 = 6G', [
    'ITU-R M.2160 (2023): six usage scenarios',
    '> Immersive comm.  > HRLLC',
    '> Massive comm.    > Ubiquitous connect.',
    '> AI + comm.       > Sensing (ISAC)',
    '3GPP Rel-20: 6G study (2025-2027)',
    '3GPP Rel-21: 6G specs, Mar 2027-end 2028',
    'First networks: around 2030',
    '# Walk to each site. Board the craft (A)',
    '# to see the sky and space layers.'
  ], { at: townPos(-3, -10), lift: 2.2, range: 14, color: '#ffd23f' });
  makeBoard('Research targets (M.2160)', [
    'Peak data rate        50-200 Gbit/s',
    'User data rate        300-500 Mbit/s',
    'Latency (air)         0.1-1 ms',
    'Reliability           1-1e-5 .. 1-1e-7',
    'Connection density    1e6-1e8 /km2',
    'Mobility              500-1000 km/h',
    'Positioning           1-10 cm',
    '# Final minimum requirements: ITU-R SG5,',
    '# approval planned December 2026.'
  ], { at: townPos(3, -10), lift: 2.2, range: 14, color: '#ffd23f' });

  // ================= sky layer: HAPS =================
  const GW = dirLL(32, 34), FARM = dirLL(40, 42), HIKE = dirLL(30, -8), CAMP = dirLL(-38, 150);
  const K_HAPS = 250, K_LEO = 1830;
  const gw = add(placeOn(new THREE.Group(), GW, 0));
  [[-3, 0], [3, 1]].forEach(([x, z]) => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 8, 0, Math.PI * 2, 0, 1.0), lam('#f0f0f0', { side: THREE.DoubleSide }));
    d.rotation.x = Math.PI; d.position.set(x, 4.4, z); gw.add(d);
    gw.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 2.6, 6).translate(x, 1.3, z), lam('#999')));
  });
  gw.add(box(4, 2.5, 3, lam('#5e6b7f')).translateZ(-4));
  gw.updateMatrixWorld(true);
  const gwP = wp(gw, 0, 4, 0);
  makeBoard('Gateway (ground station)', [
    'Connects the sky and space layers to',
    'the core network on the ground.',
    'Feeder links: Ka band, ~20-30 GHz,',
    'big dishes with high gain.',
    '# Gold: links to LEO satellites.',
    '# Blue: link to the HAPS.'
  ], { at: gwP.clone(), lift: 4, range: 30, w: 5 });

  const farm = add(placeOn(new THREE.Group(), FARM, 0));
  farm.add(box(6, 4, 8, lam('#c0453a')), box(6.4, 0.4, 8.4, lam('#eee')).translateY(4));
  farm.add(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 7, 10).translate(5, 3.5, 0), lam('#ccc')));
  const tractor = box(1.6, 1.4, 2.6, lam('#3bb54a')); farm.add(tractor);
  const tractAnt = new THREE.Mesh(BALL, new THREE.MeshBasicMaterial({ color: '#4fe3ff' })); tractAnt.scale.setScalar(0.12); tractAnt.position.y = 1.6; tractor.add(tractAnt);
  const hike = add(placeOn(new THREE.Group(), HIKE, 0));
  hike.add(new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.8, 4).translate(0, 0.9, 0), lam('#ffb52e')));
  const hk = [person('#3d7bff'), person('#ff3d6e')]; hk[0].position.set(2.5, 0, 1); hk[1].position.set(-2, 0, 1.6); hike.add(...hk);
  hike.updateMatrixWorld(true);

  const blimp = () => {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), lam('#eef2f7')); hull.scale.set(3, 3, 10); g.add(hull);
    const sol = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, 0.6), lam('#1d3a7a')); sol.scale.set(3.05, 3.05, 7); sol.rotation.x = -Math.PI / 2; sol.rotation.z = Math.PI / 2; g.add(sol);
    [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([x, y]) => { const f = new THREE.Mesh(new THREE.BoxGeometry(x ? 3 : 0.15, y ? 3 : 0.15, 2.5), lam('#d0d6e0')); f.position.set(x * 2.4, y * 2.4, 8.5); g.add(f); });
    g.add(box(1, 0.8, 2.4, lam('#888')).translateY(-3.6));
    scene.add(g); return g;
  };
  const haps = [{ c: FARM, alt: 80, ph: 0 }, { c: HIKE, alt: 85, ph: 2 }].map(h => ({ ...h, g: blimp(), down: makeBeam(scene, '#7dd3ff', { opacity: 0.12 }), back: makeBeam(scene, '#4f8cff', { up: false }) }));
  makeBoard('HAPS at 20 km', [
    'High-altitude platform: a solar airship',
    'that stays over one area for months.',
    'One wide beam covers a big rural area.',
    'Farm: autonomous tractor, sensors.',
    'Hikers: phone coverage far from towers.',
    'Back link: to a gateway, or by laser',
    'to a LEO satellite (dashed relay).',
    '# Part of NTN (non-terrestrial network):',
    '# usage scenario Ubiquitous connectivity'
  ], { anchor: haps[0].g, lift: 9, range: 70, w: 12 });
  const hapsB = makeBoard('HAPS link to the tractor', [], { anchor: haps[0].g, lift: -12, range: 70, w: 12 });
  const hapsS = { d: 0 };
  makeBoard('Farm (served by HAPS)', ['No tower here. The airship above', 'gives coverage to the tractor and', 'the farm sensors.'], { at: wp(farm, 0, 0, 0), lift: 9, range: 30, w: 5, mode: '6g' });
  makeBoard('Hikers (served by HAPS)', ['Far from any tower. The airship', 'covers them with one wide beam.', 'Its backhaul goes by laser to a', 'LEO satellite.'], { at: wp(hike), lift: 5, range: 30, w: 5, mode: '6g' });

  // ================= space layer: LEO =================
  const RO = R + 300, PER = 220, NS = 7;
  const planes = [[53, 20], [97, 110]].map(([inc, raan]) => {
    const i = inc * Math.PI / 180, o = raan * Math.PI / 180;
    const u = V3(Math.cos(o), 0, Math.sin(o));
    const v = V3(-Math.sin(o) * Math.cos(i), Math.sin(i), Math.cos(o) * Math.cos(i));
    return { u, v };
  });
  const sat = () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1.4), lam('#c9ced8')));
    [-1, 1].forEach(s => { const p = new THREE.Mesh(new THREE.BoxGeometry(6, 0.08, 2), lam('#2a4fa8')); p.position.x = s * 4.2; g.add(p); });
    const a = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 1.2), lam('#ffffff')); a.position.y = -0.55; g.add(a);
    g.scale.setScalar(2.5); scene.add(g); return g;
  };
  const sats = [];
  planes.forEach((pl, k) => { for (let j = 0; j < NS; j++) sats.push({ pl, k, ph: j / NS * Math.PI * 2 + k * 0.4, g: sat(), p: V3() }); });
  const isl = sats.map(() => makeLine(scene, '#ff4d4d')); isl.forEach(l => l.line.material.opacity = 0.5);
  const gwLink = makeBeam(scene, '#ffcf4a', { up: true });
  const d2dB = [];                       // one beam per direct-to-device phone
  const relay = makeLine(scene, '#ff4d4d', true);
  const satAt = (s, t) => { const a = s.ph + t * 2 * Math.PI / PER; return s.pl.u.clone().multiplyScalar(Math.cos(a) * RO).addScaledVector(s.pl.v, Math.sin(a) * RO); };
  const visible = (g, p, minEl = 0.2) => p.clone().sub(g).normalize().dot(g.clone().normalize()) > minEl;
  const nearestVis = (g, minEl) => sats.filter(s => visible(g, s.p, minEl)).sort((a, b) => a.p.distanceTo(g) - b.p.distanceTo(g))[0];
  const camp = add(placeOn(new THREE.Group(), CAMP, 0));
  camp.add(new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.6, 5).translate(0, 0.8, 0), lam('#38c172')));
  const camper = person('#ffd23f'); camper.position.set(2, 0, 0); camp.add(camper);
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 6).translate(0, 0.35, 0), new THREE.MeshBasicMaterial({ color: '#ff7a1a' })); fire.position.set(0, 0, 2.5); camp.add(fire);
  camp.updateMatrixWorld(true);
  const campP = wp(camper, 0.2, 1.55, 0);
  D2D_USERS.push({ p: () => campP, modes: ['6g', 'elon'] });
  makeBoard('Camper: phone direct to satellite', ['No tower, no HAPS. A normal phone', 'talks direct to a LEO satellite', '(direct-to-device, NTN in 3GPP).', 'Low rate, but it works everywhere.', '# Green beam: satellite spot beam.'], { at: wp(camp), lift: 4, range: 30, w: 5 });
  const satB = makeBoard('LEO satellite at 550 km', [], { anchor: sats[0].g, lift: 8, range: 140, w: 26 });
  const satB2 = makeBoard('LEO constellation', [
    '14 satellites in 2 orbit planes.',
    'Red lines: laser inter-satellite links.',
    'Data hops sat-to-sat in space, then',
    'goes down at a gateway (gold beam).',
    'Light is ~1.5x faster in vacuum than in',
    'fiber, so long paths can be faster.',
    '# Orbit: 550 km, ~95 min (here: 220 s).',
    '# Real Doppler up to ~+/-50 kHz at 2 GHz.'
  ], { anchor: sats[NS].g, lift: 8, range: 140, w: 26 });
  const satS = { el: 0, d: 0, vr: 0, has: false };
  ups.push((t, dt, o) => {
    const std = !o || o.world !== 'elon';
    sats.forEach(s => {
      s.p.copy(satAt(s, t)); s.g.position.copy(s.p); s.g.visible = std;
      const fwd = satAt(s, t + 0.5).sub(s.p).normalize(); s.g.quaternion.copy(basisQ(s.p.clone().normalize(), fwd));
    });
    sats.forEach((s, i) => { const n = sats[(i % NS === NS - 1) ? i - NS + 1 : i + 1]; isl[i].set(s.p, n.p, std); });
    const sg = nearestVis(gwP, 0.25); gwLink.set(gwP, sg ? sg.p : gwP, 0.02, t, !!sg && std);
    const users = D2D_USERS.filter(u => u.modes.includes('6g'));
    while (d2dB.length < users.length) d2dB.push(makeBeam(scene, '#7dff9a', { opacity: 0.12 }));
    d2dB.forEach((b, i) => {
      const u = users[i], p = u && u.p(), sc = u && nearestVis(p, 0.2);
      b.set(sc ? sc.p : V3(), p || V3(), 0.12, t, !!sc && std);
    });
    haps.forEach((h, k) => {
      const a = t * 0.05 + h.ph, cd = h.c.clone();
      const off = eastAt(cd).multiplyScalar(Math.cos(a) * 12).add(northAt(cd).multiplyScalar(Math.sin(a) * 12));
      const p = cd.clone().multiplyScalar(groundR(cd) + h.alt).add(off);
      h.g.position.copy(p); h.g.quaternion.copy(basisQ(p.clone().normalize(), tangent(V3().crossVectors(p, off), p.clone().normalize())));
      h.g.visible = std;
      const bottom = p.clone().addScaledVector(p.clone().normalize(), -3.6);
      if (k === 0) {
        tractor.position.set(Math.sin(t * 0.1) * 12, 0, -14 + Math.cos(t * 0.1) * 5); farm.updateMatrixWorld();
        const tp = wp(tractAnt); h.down.set(bottom, tp, 0.9, t, std); h.back.set(bottom, gwP, 0.03, t, std);
        hapsS.d = bottom.distanceTo(tp) * K_HAPS;
      } else {
        h.down.set(bottom, wp(hike, 0, 1, 0), 0.9, t, std); h.back.set(bottom, bottom, 0.01, t, false);
        const sr = nearestVis(p, 0.1); relay.set(p, sr ? sr.p : p, !!sr && std);
      }
    });
    const s0 = sats[0], rel = s0.p.clone().sub(gwP);
    satS.has = visible(gwP, s0.p, 0); satS.d = rel.length() * K_LEO;
    satS.el = Math.asin(clamp(rel.clone().normalize().dot(gwP.clone().normalize()), -1, 1)) * 180 / Math.PI;
    const vw = satAt(s0, t + 0.05).sub(s0.p).divideScalar(0.05);            // world velocity
    satS.vr = vw.dot(rel.clone().normalize()) * (7600 / (2 * Math.PI * RO / PER));
  });
  live(satB, () => {
    const o = { d: Math.max(satS.d, 550e3), f: 20e9, bw: 500e6, ptx: 40, gtx: 38, grx: 45, nf: 3 };
    const p = { d: 700e3, f: 2e9, bw: 5e6, ptx: 30, gtx: 30, grx: 0 };
    return [
      `Seen from gateway: el ${satS.el.toFixed(0)} deg, ${fmtD(satS.d)}`,
      `> Doppler at 20 GHz: ${(20e9 * satS.vr / C0 / 1e3).toFixed(0)} kHz`,
      `One-way delay ${fmtT(satS.d / C0)}`,
      'Feeder link (Ka, dish):',
      `> ${fmtR(budget(o).rate)} at ${budget(o).snr.toFixed(0)} dB SNR`,
      'Phone direct (2 GHz, 700 km):',
      `> ${fmtR(budget(p).rate)}, shared in the beam`,
      '# 6G aims at one system: ground, HAPS',
      '# and satellites under one standard.'
    ];
  });
  live(hapsB, () => {
    const o = { d: hapsS.d, f: 2e9, bw: 20e6, ptx: 40, gtx: 22, grx: 3, layers: 2 };
    return [`Tractor below the airship:`, ...budgetLines(budget(o), o), `One-way delay ${fmtT(hapsS.d / C0)}`, '# vs LEO ~2 ms, vs GEO ~120 ms'];
  });

  // ---------- update ----------
  let acc = 0;
  const update = (t, dt, o) => {
    ups.forEach(f => f(t, dt, o));
    acc += dt;
    if (acc > 0.25) { acc = 0; lives.forEach(([b, fn]) => b.mesh.visible && b.draw(fn())); }
  };
  // prime live boards once
  update(0, 0); lives.forEach(([b, fn]) => b.draw(fn()));
  return { update, sats, haps, towerTop, home, cpe, edge, farm, hike, gwP, gw, nearestVis, panelFor, cars, P };
};
