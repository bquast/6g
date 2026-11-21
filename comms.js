// comms.js — the rest of the comms world, beyond 6G radio:
// submarine cable, landing stations, backbone fiber, internet exchange, microwave backhaul,
// GEO satellite with a TV dish, and a boat that uses phone-to-satellite.

const slerpDir = (a, b, f) => {
  const ang = Math.acos(clamp(a.dot(b), -1, 1));
  return ang < 1e-6 ? a.clone() : a.clone().applyAxisAngle(V3().crossVectors(a, b).normalize(), ang * f);
};
// points along the ground through a list of unit directions
const groundPath = (dirs, lift, step = 3) => {
  const pts = [];
  for (let i = 0; i < dirs.length - 1; i++) {
    const n = Math.max(2, Math.ceil(Math.acos(clamp(dirs[i].dot(dirs[i + 1]), -1, 1)) * R / step));
    for (let k = 0; k < n; k++) { const d = slerpDir(dirs[i], dirs[i + 1], k / n); pts.push(d.multiplyScalar(groundR(d) + lift)); }
  }
  const e = dirs[dirs.length - 1]; pts.push(e.clone().multiplyScalar(groundR(e) + lift));
  return pts;
};
// light pulses that run along a curve, both directions
const flow = (parent, curve, color, n, size, speed) => {
  const m = new THREE.InstancedMesh(BALL, new THREE.MeshBasicMaterial({ color, fog: false }), n);
  m.frustumCulled = false; parent.add(m);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = V3(size, size, size), L = curve.getLength();
  return t => {
    for (let i = 0; i < n; i++) {
      const f = ((t * speed / L + i / n) % 1 + 1) % 1;
      m.setMatrixAt(i, M.compose(curve.getPointAt(i % 2 ? f : 1 - f), Q, S));
    }
    m.instanceMatrix.needsUpdate = true;
  };
};
const house = (col) => {
  const g = new THREE.Group();
  g.add(box(4, 2.6, 3.4, lam(col)));
  g.add(new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.6, 4).rotateY(Math.PI / 4).translate(0, 3.4, 0), lam('#9a4a5a')));
  return g;
};

const buildComms = (scene, W) => {
  const ups = [], lives = [];
  const live = (b, fn) => lives.push([b, fn]);
  const add = o => (scene.add(o), o);

  // ---------- submarine cable between two landing stations ----------
  const station = d => {
    const g = add(placeOn(new THREE.Group(), d, 0, slerpDir(d, OCEAN, 0.1).sub(d)));
    g.add(box(7, 4, 5, lam('#eef1f5')), box(7.2, 0.3, 5.2, lam('#2a8f86')).translateY(4));
    const pfe = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshBasicMaterial({ color: '#ffb52e' }));
    pfe.position.set(0, 3, -2.51); pfe.rotation.y = Math.PI; g.add(pfe);
    g.add(box(1.2, 0.3, 1.2, lam('#555')).translateZ(-6));          // beach manhole
    g.updateMatrixWorld(true);
    return { g, pfe, p: wp(g, 0, 0, -6) };
  };
  const stA = station(LAND_A), stB = station(LAND_B);
  const cpts = [stA.p, ...groundPath([slerpDir(LAND_A, LAND_B, 0.02), slerpDir(LAND_A, LAND_B, 0.98)], 0.3, 2), stB.p];
  const cable = new THREE.CatmullRomCurve3(cpts);
  add(new THREE.Mesh(new THREE.TubeGeometry(cable, 260, 0.4, 6), new THREE.MeshBasicMaterial({ color: '#2fd4c4' })));
  const cableFlow = flow(scene, cable, '#ffffff', 40, 0.7, 18);
  const NREP = 12, reps = [];
  for (let i = 0; i < NREP; i++) {
    const f = (i + 1) / (NREP + 1), p = cable.getPointAt(f), tng = cable.getTangentAt(f);
    const r = new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 2.2, 3, 8).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#f2c14e' }));
    r.position.copy(p); r.lookAt(p.clone().add(tng)); add(r); reps.push(r);
  }
  const LW = cable.getLength(), K_SEA = 6000e3 / LW;      // drawn as a 6000 km ocean crossing
  ups.push(t => {
    cableFlow(t);
    reps.forEach((r, i) => r.material.color.set(Math.sin(t * 3 - i * 0.6) > 0.3 ? '#ffe08a' : '#a8812e'));
    [stA, stB].forEach(s => s.pfe.material.color.set(Math.sin(t * 2) > 0 ? '#ffb52e' : '#7a5410'));
  });
  makeBoard('Cable landing station', [
    'The submarine cable comes on land here.',
    'Inside: line terminal equipment (light',
    'in and out) and power feed equipment.',
    'PFE: DC power, ~10 kV, sent down the',
    'copper in the cable to every repeater.',
    'All repeaters are powered in series.',
    '> Light: coherent optics, phase + amplitude',
    '# A PFE at each end: if one fails, the',
    '# other can feed the full voltage.'
  ], { at: stA.p.clone(), lift: 6, range: 22, w: 4 });
  const seaB = makeBoard('Submarine cable', [], { at: cable.getPointAt(0.5), lift: 45, range: 110, w: 16 });
  live(seaB, () => [
    `Drawn: ${fmtD(LW)}. Here it stands for ${fmtD(6000e3)}.`,
    'Yellow capsules: repeaters (optical',
    'amplifiers). Real: one per ~50-90 km,',
    `so ~${Math.round(6000 / 70)} on this cable (12 drawn).`,
    'New cables: 12+ fiber pairs (SDM),',
    '200+ Tbit/s per cable.',
    `> one-way delay in glass: ${fmtT(6000e3 / 2.04e8)}`,
    '# Almost all traffic between continents',
    '# goes by cable, not by satellite.'
  ]);

  // ---------- backbone fiber: edge DC -> internet exchange -> landing station ----------
  const IXP = towardDir(TOWN, LAND_A, 62 / R);
  const ixp = add(placeOn(new THREE.Group(), IXP, 0, slerpDir(IXP, TOWN, 0.1).sub(IXP)));
  ixp.add(box(12, 5, 8, lam('#4d5870')), box(12.3, 0.3, 8.3, lam('#ff9f43')).translateY(5));
  const ixLeds = [];
  for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshBasicMaterial({ color: '#7dff9a' }));
    l.position.set(-5 + i * 1.4, 1.2 + j * 1.1, -4.01); l.rotation.y = Math.PI; ixp.add(l); ixLeds.push(l);
  }
  const edgeD = W.edge.position.clone().normalize();
  const bb = new THREE.CatmullRomCurve3(groundPath([edgeD, IXP, slerpDir(IXP, LAND_A, 0.97)], 0.12, 2));
  add(new THREE.Mesh(new THREE.TubeGeometry(bb, 200, 0.12, 6), new THREE.MeshBasicMaterial({ color: '#ff9f43' })));
  const bbFlow = flow(scene, bb, '#fff3c0', 24, 0.2, 10);
  ups.push(t => { bbFlow(t); ixLeds.forEach((l, i) => l.visible = Math.sin(t * 9 + i * 2.3) > -0.4); });
  makeBoard('Internet exchange + core', [
    'Many networks meet in this building and',
    'swap traffic (peering). Routers choose',
    'paths with BGP.',
    'The mobile core runs here as software:',
    'it handles login, mobility, sessions and',
    'slices for the radio sites.',
    'Orange: backbone fiber to the edge DC',
    'and on to the cable landing station.',
    '# Cloud data centres connect here too.'
  ], { at: wp(ixp), lift: 8, range: 24, w: 4 });

  // ---------- microwave backhaul to a village (pick a bearing with clear line of sight) ----------
  const towerDish = townPos(0, 0, 15);
  let best = null;
  for (let b = 0; b < 360; b += 15) {
    const a = b * Math.PI / 180, d = localDir(TOWN, 150 * Math.sin(a), 150 * Math.cos(a));
    if (groundR(d) < WATER + 1.5 || FLAT.some(f => d.dot(f.d) > Math.cos((f.m1 + 25) / R))) continue;
    const top = d.clone().multiplyScalar(groundR(d) + 16);
    let clr = 1e9;
    for (let k = 2; k < 29; k++) { const p = towerDish.clone().lerp(top, k / 30); clr = Math.min(clr, p.length() - groundR(p.clone().normalize())); }
    if (!best || clr > best.clr) best = { d, top, clr };
  }
  const vd = best.d;
  const mast = add(placeOn(new THREE.Group(), vd, 0));
  mast.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 17, 6).translate(0, 8.5, 0), lam('#e8e8f0')));
  mast.add(box(0.8, 1.2, 0.3, lam('#1d2a44')).translateY(14).translateZ(-0.4));
  [[9, 4, '#f0e6d8'], [-8, 6, '#e8d8f0'], [3, -10, '#d8f0e6']].forEach(([e, n, c]) => {
    const dd = localDir(vd, e, n); add(placeOn(house(c), dd, 0, headingFwd(dd, e * 10)));
  });
  const dishAt = (p, target) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.25, 14).rotateX(Math.PI / 2), lam('#f4f4f4'));
    m.position.copy(p); m.lookAt(target); add(m); return m;
  };
  dishAt(towerDish, best.top); dishAt(best.top, towerDish);
  const mw = makeBeam(scene, '#ffa94d', { opacity: 0.3, speed: 30, size: 0.12 });
  ups.push(t => mw.set(towerDish, best.top, 0.02, t));
  makeBoard('Village: microwave backhaul', [
    'No fiber to this village. A point-to-',
    'point radio link carries the traffic',
    'from the town site (orange beam).',
    'E-band, 70/80 GHz: 10+ Gbit/s over a',
    'few km, very narrow beam.',
    'It needs clear line of sight: the masts',
    'are tall to look over the curve.',
    `# Clearance over the ground here: ${best.clr.toFixed(0)} m`
  ], { at: wp(mast), lift: 19, range: 30, w: 4 });

  // ---------- GEO satellite and a TV dish on the home ----------
  const GEO_D = dirLL(0, 20), GEO_P = GEO_D.clone().multiplyScalar(R * 6.6);
  const geo = add(new THREE.Group());
  geo.add(new THREE.Mesh(new THREE.BoxGeometry(3, 3, 4), lam('#d9b44a')));
  [-1, 1].forEach(s => { const w = new THREE.Mesh(new THREE.BoxGeometry(16, 0.1, 3), lam('#2a4fa8')); w.position.x = s * 9.5; geo.add(w); });
  const gd = new THREE.Mesh(new THREE.SphereGeometry(2.2, 14, 7, 0, Math.PI * 2, 0, 0.9), lam('#f4f4f4', { side: THREE.DoubleSide }));
  gd.position.y = -2; gd.rotation.x = Math.PI; geo.add(gd);
  geo.scale.setScalar(3); geo.position.copy(GEO_P); geo.quaternion.copy(basisQ(GEO_D, northAt(GEO_D)));
  const tvDishP = wp(W.home, -2.6, 4.4, -1.6);
  const tvDish = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 6, 0, Math.PI * 2, 0, 0.9).rotateX(-Math.PI / 2), lam('#f4f4f4', { side: THREE.DoubleSide }));
  tvDish.position.copy(tvDishP); tvDish.lookAt(GEO_P); add(tvDish);
  const geoBeam = makeBeam(scene, '#ffcf4a', { opacity: 0.1, rev: true, up: false, speed: 160, size: 0.15, maxSize: 3 });
  ups.push(t => geoBeam.set(tvDishP, GEO_P, 0.025, t));
  makeBoard('GEO satellite, 35,786 km', [
    'It goes round once per day, so it stays',
    'above one point. Dishes on the ground',
    'do not move.',
    '3 GEO satellites can cover most of Earth.',
    '> up + down: ~240 ms',
    '> internet round trip: ~500-600 ms',
    'Good for TV (one-way broadcast).',
    'Poor for calls and games: compare LEO',
    '# at ~550 km: a few ms. (Not to scale.)'
  ], { anchor: geo, lift: 90, range: 600, w: 90 });
  makeBoard('TV dish', ['Fixed dish, aimed at a GEO satellite.', 'Yellow beam: TV comes down from GEO.', '> one way: ~120 ms. Fine for TV.'], { at: tvDishP.clone(), lift: 1.8, range: 9, w: 2.2 });

  // ---------- boat at sea: phone direct to satellite ----------
  const boat = add(new THREE.Group());
  boat.add(box(1.8, 0.9, 5, lam('#f4f4f4')).translateY(-0.3));
  boat.add(new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 4).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4).translate(0, 0.15, -3.3), lam('#f4f4f4')));
  boat.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7, 6).translate(0, 4, -0.5), lam('#8a6a4a')));
  const sailS = new THREE.Shape(); sailS.moveTo(0, 0.2); sailS.lineTo(0, 6); sailS.lineTo(-2.6, 0.2); sailS.lineTo(0, 0.2);
  const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailS), lam('#ffffff', { side: THREE.DoubleSide }));
  sail.rotation.y = Math.PI / 2; sail.position.set(0, 1.2, -0.5); boat.add(sail);
  const sailor = person('#ff8a3d'); sailor.position.set(0.3, 0.15, 1.4); boat.add(sailor);
  const bPhone = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.02), new THREE.MeshBasicMaterial({ color: '#7dff9a' }));
  bPhone.position.set(0.2, 1.55, -0.05); sailor.add(bPhone);
  const boatAt = t => { const a = t * 0.02; return localDir(OCEAN, 45 * Math.sin(a), 45 * Math.cos(a)); };
  D2D_USERS.push({ p: () => wp(bPhone), modes: ['6g', 'elon'] });
  ups.push(t => {
    const d = boatAt(t), d2 = boatAt(t + 1);
    boat.position.copy(d).multiplyScalar(WATER + 0.25 + Math.sin(t * 1.3) * 0.12);
    boat.quaternion.copy(basisQ(d, tangent(d2.sub(d), d)));
    boat.rotateZ(Math.sin(t * 0.9) * 0.05); boat.updateMatrixWorld();
  });
  makeBoard('Boat at sea', [
    'No towers out here. The phone talks',
    'direct to a satellite (green beam).',
    '3GPP added NTN in Rel-17 (2022).',
    '6G plans it in the base design: one',
    'system for ground and space.',
    '# Same for the camper on the far side.'
  ], { anchor: boat, lift: 9, range: 40, w: 4 });

  let acc = 0;
  const update = (t, dt) => {
    ups.forEach(f => f(t, dt));
    acc += dt;
    if (acc > 0.25) { acc = 0; lives.forEach(([b, fn]) => b.mesh.visible && b.draw(fn())); }
  };
  update(0, 0); lives.forEach(([b, fn]) => b.draw(fn()));
  return { update, GEO_P, stA, stB, ixp, mast, boat, vd };
};
