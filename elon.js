// elon.js — the "ElonVerse" world setting: Starlink-centred comms on the same planet.
// Dense LEO shell with a laser mesh, a fresh launch train, user dishes, Direct to Cell,
// gateways, and a Starship that launches from a pad. HAPS and the generic LEO are hidden.

const buildElon = (scene, W, C) => {
  const grp = new THREE.Group(); grp.visible = false; scene.add(grp);
  const add = o => (grp.add(o), o);

  // ---------- constellation ----------
  const plane = (inc, raan) => {
    const i = inc * Math.PI / 180, o = raan * Math.PI / 180;
    return { u: V3(Math.cos(o), 0, Math.sin(o)), v: V3(-Math.sin(o) * Math.cos(i), Math.sin(i), Math.cos(o) * Math.cos(i)) };
  };
  const NP = 8, NPS = 10, sats = [];
  for (let k = 0; k < NP; k++) {
    const pl = plane(53, k * 360 / NP);
    for (let j = 0; j < NPS; j++) sats.push({ pl, r: R + 210, per: 170, ph: j / NPS * Math.PI * 2 + k * 0.35, p: V3() });
  }
  const trainPl = plane(43, 200);
  for (let j = 0; j < 12; j++) sats.push({ pl: trainPl, r: R + 130, per: 120, ph: j * 0.03, p: V3(), train: true });
  const NS = sats.length;
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.25, 1.6), lam('#d6dae2'), NS);
  const wing = new THREE.InstancedMesh(new THREE.BoxGeometry(9, 0.06, 2.2), lam('#2b3f86'), NS);
  [body, wing].forEach(m => { m.frustumCulled = false; add(m); });
  const posAt = (s, t) => { const a = s.ph + t * 2 * Math.PI / s.per; return s.pl.u.clone().multiplyScalar(Math.cos(a) * s.r).addScaledVector(s.pl.v, Math.sin(a) * s.r); };
  const NL = NP * NPS * 2, lp = new Float32Array(NL * 6);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  const lasers = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#ff4d4d', transparent: true, opacity: 0.45, fog: false }));
  lasers.frustumCulled = false; add(lasers);
  const vis = (g, p, minEl) => p.clone().sub(g).normalize().dot(g.clone().normalize()) > minEl;
  const nearest = (g, minEl) => {
    let b = null, bd = 1e9;
    sats.forEach(s => { if (!s.train && vis(g, s.p, minEl)) { const d = s.p.distanceTo(g); if (d < bd) { bd = d; b = s; } } });
    return b;
  };
  const proxy0 = add(new THREE.Object3D()), proxyT = add(new THREE.Object3D());

  // ---------- user dishes (phased array, flat) ----------
  const dishSpots = [
    wp(W.home, 1.2, 3.9, -1.8), wp(W.farm, -1.5, 4.4, 2), wp(C.mast, 1.5, 0, 1.5),
    wp(C.stB.g, 2, 4.3, 1), wp(W.edge, 1.5, 4, 1)
  ];
  const dishes = dishSpots.map(p => {
    const up = p.clone().normalize(), g = add(new THREE.Group());
    g.position.copy(p); g.quaternion.copy(basisQ(up, northAt(up)));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5).translate(0, 0.25, 0), lam('#999')));
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.38), lam('#f7f7f7')); plate.position.y = 0.52; plate.rotation.x = -0.25; g.add(plate);
    return { p: p.clone().addScaledVector(up, 0.55), beam: makeBeam(grp, '#e8f3ff', { opacity: 0.12, speed: 30, size: 0.06, maxSize: 0.6 }) };
  });
  const gwBeam = makeBeam(grp, '#ffcf4a');
  const d2c = [];
  const hikerPhone = wp(W.hike, 2.7, 1.55, 0.9);
  D2D_USERS.push({ p: () => hikerPhone, modes: ['elon'] });

  // ---------- Starship on a pad ----------
  const pad = add(placeOn(new THREE.Group(), PAD, 0));
  pad.add(new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 0.3, 32).translate(0, 0.15, 0), lam('#9aa0aa')));
  const tower = box(2.2, 38, 2.2, lam('#5b6070')); tower.position.x = 6; pad.add(tower);
  [26, 31].forEach(y => { const arm = box(4.6, 0.6, 0.5, lam('#5b6070')); arm.position.set(3.5, y, 1.2); pad.add(arm); });
  const steel = new THREE.MeshPhongMaterial({ color: '#c9ccd3', shininess: 90, flatShading: true });
  const ship = new THREE.Group(); pad.add(ship);
  ship.add(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 18, 16).translate(0, 9.3, 0), steel));
  ship.add(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 12, 16).translate(0, 24.3, 0), steel));
  ship.add(new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.4, 16).translate(0, 32, 0), steel));
  [0, 1, 2, 3].forEach(i => { const f = box(0.9, 1.6, 0.1, lam('#3a3d45')); f.position.set(Math.sin(i * 1.57) * 1.15, 27, Math.cos(i * 1.57) * 1.15); f.rotation.y = i * 1.57; ship.add(f); });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(1.3, 9, 12).rotateX(Math.PI).translate(0, -4.2, 0), glow('#ff8a3d', 0.7));
  ship.add(flame);
  const LCYC = 150;

  // ---------- boards ----------
  makeBoard('ElonVerse setting', [
    'Same planet, Starlink-centred comms:',
    'White beams: user dishes (home, farm,',
    '  village, landing station, edge DC).',
    'Green: Direct to Cell, normal phones.',
    'Gold: gateway to the internet.',
    'Red: laser mesh between satellites.',
    'No HAPS. Starship launches new sats.',
    '# Hub button "World" switches back.'
  ], { at: townPos(10, -11), lift: 2.4, range: 14, color: '#ff5fa2', mode: 'elon' });
  makeBoard('Starlink shell', [
    '~9,800 working Starlink sats (Nov 2026).',
    'Drawn: 80 in 8 planes, laser mesh (red).',
    'Lasers move data sat to sat, so a',
    'signal can cross an ocean in space.',
    'V3 sat: 1 Tbit/s down, 160 Gbit/s up,',
    '2,048 beams. First operational V3s:',
    'Starship flight 14, 28 Sep 2026.',
    '# User dish: flat phased array, steers',
    '# its beam with no moving parts.'
  ], { anchor: proxy0, lift: 8, range: 140, w: 26, color: '#ff5fa2', mode: 'elon' });
  makeBoard('Launch train', [
    'New sats fly in a line after launch,',
    'then raise their orbits to the shell.',
    'They are bright at dusk: "Starlink train".'
  ], { anchor: proxyT, lift: 6, range: 120, w: 20, color: '#ff5fa2', mode: 'elon' });
  makeBoard('Starship', [
    'Fully reusable rocket, ~120 m tall',
    '(drawn smaller). It launches here every',
    '150 s in this world.',
    'Flight 14 put 26 Starlink V3 sats in',
    'orbit. Target: ~60 V3 per launch, so',
    'one launch adds ~60 Tbit/s.',
    '# Falcon 9 still launches most sats today.'
  ], { at: wp(pad), lift: 40, range: 90, w: 10, color: '#ff5fa2', mode: 'elon' });
  makeBoard('Direct to Cell', [
    'Normal phones talk to Starlink sats.',
    'Now "Starlink Mobile", ~650 sats.',
    'Next: V2 sats on 2 GHz spectrum bought',
    'from EchoStar. Target: up to 150 Mbit/s.',
    'Commercial use of that spectrum after',
    'the deal closes (expected 2027).'
  ], { at: hikerPhone.clone(), lift: 4, range: 30, w: 5, color: '#ff5fa2', mode: 'elon' });

  // ---------- update ----------
  const M = new THREE.Matrix4(), S1 = V3(1.4, 1.4, 1.4), off = V3();
  const update = (t, dt, on) => {
    grp.visible = on;
    if (!on) return;
    sats.forEach((s, i) => {
      s.p.copy(posAt(s, t));
      const up = s.p.clone().normalize(), q = basisQ(up, posAt(s, t + 0.5).sub(s.p).normalize());
      body.setMatrixAt(i, M.compose(s.p, q, S1));
      off.set(7.2, 0.3, 0).applyQuaternion(q).add(s.p);
      wing.setMatrixAt(i, M.compose(off, q, S1));
    });
    body.instanceMatrix.needsUpdate = wing.instanceMatrix.needsUpdate = true;
    for (let k = 0; k < NP; k++) for (let j = 0; j < NPS; j++) {
      const i = k * NPS + j, a = sats[i].p, b = sats[k * NPS + (j + 1) % NPS].p, c = sats[((k + 1) % NP) * NPS + j].p;
      lp.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 12); lp.set([a.x, a.y, a.z, c.x, c.y, c.z], i * 12 + 6);
    }
    lg.attributes.position.needsUpdate = true;
    proxy0.position.copy(sats[0].p); proxyT.position.copy(sats[NS - 6].p);
    dishes.forEach(d => { const s = nearest(d.p, 0.42); d.beam.set(d.p, s ? s.p : d.p, 0.02, t, !!s); });
    const sg = nearest(W.gwP, 0.3); gwBeam.set(W.gwP, sg ? sg.p : W.gwP, 0.02, t, !!sg);
    const users = D2D_USERS.filter(u => u.modes.includes('elon'));
    while (d2c.length < users.length) d2c.push(makeBeam(grp, '#7dff9a', { opacity: 0.12 }));
    d2c.forEach((b, i) => { const p = users[i].p(), s = nearest(p, 0.25); b.set(s ? s.p : p, p, 0.1, t, !!s); });
    const c = t % LCYC, flying = c > 40;
    const h = flying ? 0.4 * (c - 40) * (c - 40) : 0;
    ship.position.y = h; ship.visible = h < 1200; flame.visible = flying;
    flame.scale.set(1, 0.8 + Math.random() * 0.4, 1);
  };
  return { update, sats };
};
