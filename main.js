// main.js — renderer, player (walk), craft (fly), controls, hub, loop.

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(0.5);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#ffc0a0', 150, 700);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 6000);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
camera.position.set(0, 1.65, 0);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

scene.add(new THREE.AmbientLight('#b8c4ff', 1.1));
const sun = new THREE.DirectionalLight('#fff2dd', 2.2); scene.add(sun, sun.target);
scene.add(makeTerrain(), makeFlora());
const sky = makeSky(); scene.add(sky.grp);
const world = buildSixG(scene);

// ---------- settings (hub) ----------
const OPT = { assist: true, comfort: true, labels: true };

// ---------- player ----------
const S = { mode: 'walk', pos: townPos(0, -15), fwd: null, snap: 0, space: 0 };
S.fwd = northAt(S.pos.clone().normalize());

// ---------- craft ----------
const craft = new THREE.Group(); scene.add(craft);
const cock = new THREE.Group(); craft.add(cock);              // offset to the seat
const dark = lam('#3a3f52'), trim = lam('#d8dde8');
[-1, 1].forEach(s => {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1.8), dark); rail.position.set(s * 0.55, 0.3, -0.2); cock.add(rail);
});
const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.9, 6).rotateX(-Math.PI / 2), trim); nose.position.set(0, 0.0, -2.2); cock.add(nose);
const engines = [];
[[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sy]) => {    // X-foils behind the pilot, below eye line
  const w = new THREE.Group(); w.position.set(sx * 0.5, 0.35, 0.9); w.rotation.z = sx * sy * 0.22;
  w.add(new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.04, 0.9), trim).translateX(sx * 2.0));
  const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.4, 8).rotateX(Math.PI / 2), dark); eng.position.set(sx * 3.8, 0, 0.1); w.add(eng);
  const fl = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), new THREE.MeshBasicMaterial({ color: '#ff6a3d' })); fl.position.set(sx * 3.8, 0, 0.81); w.add(fl); engines.push(fl);
  cock.add(w);
});
// yoke and throttle (positions set by fitCockpit)
const yoke = new THREE.Group(); cock.add(yoke);
const yokeVis = new THREE.Group(); yoke.add(yokeVis);
yokeVis.add(new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 6, 20, Math.PI), lam('#ffd23f')).rotateZ(Math.PI));
yokeVis.add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6).rotateX(Math.PI / 2), dark).translateZ(0.15));
const thr = new THREE.Group(); cock.add(thr);
thr.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.32), dark));
const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), lam('#ff5fa2')); thr.add(knob);
const hudCv = document.createElement('canvas'); hudCv.width = 1024; hudCv.height = 200;
const hudTex = new THREE.CanvasTexture(hudCv); hudTex.colorSpace = THREE.SRGBColorSpace;
const hud = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.254), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthWrite: false, fog: false }));
hud.renderOrder = 20; cock.add(hud);
const fitCockpit = () => {
  const h = renderer.xr.isPresenting ? camera.position : V3(0, 1.25, 0);
  cock.position.set(h.x, 0, h.z);
  yoke.position.set(0.2, h.y - 0.5, -0.4);
  thr.position.set(-0.28, h.y - 0.55, -0.3);
  hud.position.set(0, h.y + 0.42, -1.1); hud.rotation.x = 0.35;
};
fitCockpit();
const CR = { pos: V3(), q: new THREE.Quaternion(), speed: 0, thr: 0 };
{
  const d = localDir(TOWN, 7, -18); CR.pos.copy(d).multiplyScalar(groundR(d) + 1.2); CR.q.copy(basisQ(d, northAt(d)));
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.15, 24), lam('#4a4f6a'));
  scene.add(placeLocal(pad, 7, -18, 0));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.06, 6, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
  scene.add(placeLocal(ring, 7, -18, 0.12));
  makeBoard('Your craft', ['Walk close, then press A (or E).', 'Right hand: grab the yellow yoke.', '  push/pull = pitch, twist = roll', 'Left hand: grab the pink throttle.', '  push forward = more speed', 'Or: right stick = pitch/roll,', '  left stick = throttle/yaw.', 'B = assist on/off. A = exit (low).'], { at: townPos(7, -18), lift: 3.2, range: 10 });
}

BOARDS.forEach(b => scene.add(b.mesh));

// ---------- XR controllers ----------
const hands = {};                                   // left/right -> { grip, src }
[0, 1].forEach(i => {
  const grip = renderer.xr.getControllerGrip(i); rig.add(grip);
  grip.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.12), lam('#e8e8f0')));
  grip.addEventListener('connected', e => { hands[e.data.handedness] = { grip, src: e.data }; grip.userData.hand = e.data.handedness; if (e.data.handedness === 'left') grip.add(hubG); });
  grip.addEventListener('disconnected', () => { const h = grip.userData.hand; if (h) delete hands[h]; });
});
const pad = h => (hands[h] && hands[h].src.gamepad) || null;
const axis = (h, i) => { const g = pad(h); return g && g.axes.length > i ? g.axes[i] : 0; };
const btn = (h, i) => { const g = pad(h); return !!(g && g.buttons[i] && g.buttons[i].pressed); };
const edges = {};
const pressed = (key, now) => { const was = edges[key]; edges[key] = now; return now && !was; };
const dz = x => Math.abs(x) < 0.15 ? 0 : x;

// ---------- hub on the left wrist (poke with the right hand) ----------
const hubG = new THREE.Group(); hubG.position.set(0, 0.05, 0.06); hubG.rotation.x = -0.9;
const hubCv = document.createElement('canvas'); hubCv.width = 512; hubCv.height = 128;
const hubTex = new THREE.CanvasTexture(hubCv); hubTex.colorSpace = THREE.SRGBColorSpace;
hubG.add(new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.06), new THREE.MeshBasicMaterial({ map: hubTex, transparent: true, fog: false })));
const HUB = [['Assist', 'assist'], ['Comfort', 'comfort'], ['Labels', 'labels'], ['Fit', null]];
const drawHub = () => {
  const c = hubCv.getContext('2d'); c.clearRect(0, 0, 512, 128);
  HUB.forEach(([n, k], i) => {
    const on = k ? OPT[k] : true;
    c.fillStyle = on ? '#1f6f8b' : '#3a2a3a'; c.beginPath(); c.roundRect(6 + i * 127, 8, 116, 112, 16); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 28px system-ui'; c.textAlign = 'center'; c.fillText(n, 64 + i * 127, 60);
    c.font = '22px system-ui'; c.fillText(k ? (on ? 'ON' : 'off') : 'hands', 64 + i * 127, 94);
  });
  hubTex.needsUpdate = true;
};
drawHub();
let hubCool = 0;
const hubAction = i => {
  const k = HUB[i][1];
  if (k) OPT[k] = !OPT[k]; else fitCockpit();
  drawHub();
};
const pokeHub = dt => {
  hubCool -= dt;
  if (!hands.left || !hands.right || hubCool > 0) return;
  const tip = hands.right.grip.localToWorld(V3(0, 0, -0.07));
  HUB.forEach((_, i) => {
    const b = hubG.localToWorld(V3(-0.09 + i * 0.06, 0, 0));
    if (tip.distanceTo(b) < 0.03) { hubAction(i); hubCool = 0.7; }
  });
};

// ---------- comfort vignette ----------
const vigTex = canvasTex(256, 256, (c, w) => {
  const g = c.createRadialGradient(w / 2, w / 2, w * 0.2, w / 2, w / 2, w / 2);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
  c.fillStyle = g; c.fillRect(0, 0, w, w);
});
const vig = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: vigTex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
vig.position.z = -0.25; vig.renderOrder = 999; camera.add(vig);
let vigA = 0;

// ---------- desktop input ----------
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });
const look = { yaw: 0, pitch: 0 };
renderer.domElement.addEventListener('click', () => !renderer.xr.isPresenting && renderer.domElement.requestPointerLock());
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  look.yaw -= e.movementX * 0.0025; look.pitch = clamp(look.pitch - e.movementY * 0.0025, -1.4, 1.4);
});
const k = c => keys[c] ? 1 : 0;

// ---------- board / exit ----------
const alt = p => p.length() - walkR(p.clone().normalize());
const board = () => { S.mode = 'fly'; fitCockpit(); look.yaw = 0; look.pitch = 0; };
const exit = () => {
  if (alt(CR.pos) > 6) return;
  S.mode = 'walk';
  const up = CR.pos.clone().normalize(), right = V3(1, 0, 0).applyQuaternion(CR.q);
  const p = CR.pos.clone().addScaledVector(tangent(right, up), 3.5);
  S.pos.copy(p.normalize().multiplyScalar(walkR(p))); S.fwd = tangent(V3(0, 0, -1).applyQuaternion(CR.q), S.pos.clone().normalize());
  CR.speed = 0; CR.thr = 0;
};

// ---------- walking ----------
const walk = dt => {
  const up = S.pos.clone().normalize();
  const head = V3(); camera.getWorldDirection(head);
  let f = tangent(head, up); if (!isFinite(f.x)) f = S.fwd.clone();
  const r = V3().crossVectors(f, up);
  const mx = dz(axis('left', 2)) + k('KeyD') - k('KeyA'), my = -dz(axis('left', 3)) + k('KeyW') - k('KeyS');
  const run = (btn('left', 0) || keys.ShiftLeft) ? 2.6 : 1;
  const sp = 3 * run;
  const mv = f.multiplyScalar(my).addScaledVector(r, mx);
  if (mv.lengthSq() > 1) mv.normalize();
  const np = S.pos.clone().addScaledVector(mv, sp * dt), nu = np.clone().normalize();
  S.pos.copy(nu).multiplyScalar(walkR(nu));
  S.fwd = tangent(S.fwd, nu);
  const rx = axis('right', 2);                              // snap turn 30 deg
  if (Math.abs(rx) > 0.7 && !S.snap) { S.snap = 1; S.fwd.applyAxisAngle(nu, rx > 0 ? -Math.PI / 6 : Math.PI / 6); }
  if (Math.abs(rx) < 0.3) S.snap = 0;
  if (!renderer.xr.isPresenting) { S.fwd.applyAxisAngle(nu, look.yaw); look.yaw = 0; camera.rotation.set(look.pitch, 0, 0); camera.position.set(0, 1.65, 0); }
  rig.position.copy(S.pos); rig.quaternion.copy(basisQ(nu, S.fwd));
  return mv.length() * run;                                // motion amount for vignette
};

// ---------- flying ----------
const grab = { yoke: null, thr: null };
const grabUpdate = () => {
  const r = hands.right, l = hands.left;
  const local = h => cock.worldToLocal(h.grip.getWorldPosition(V3()));
  if (r && btn('right', 1)) {
    if (!grab.yoke && local(r).distanceTo(yoke.position) < 0.2) grab.yoke = { p0: local(r), q0: r.grip.quaternion.clone() };
  } else grab.yoke = null;
  if (l && btn('left', 1)) {
    if (!grab.thr && local(l).distanceTo(thr.position.clone().add(knob.position)) < 0.2) grab.thr = { z0: local(l).z, t0: CR.thr };
  } else grab.thr = null;
  let pitch = 0, roll = 0;
  if (grab.yoke) {
    const p = local(r), dzz = p.z - grab.yoke.p0.z;          // pull back (+z) = nose up
    pitch = clamp(dzz / 0.12, -1, 1);
    const qr = grab.yoke.q0.clone().invert().multiply(r.grip.quaternion);
    const tw = new THREE.Euler().setFromQuaternion(qr, 'ZXY').z;
    roll = clamp(-tw / 1.0, -1, 1);
    yokeVis.position.z = clamp(dzz, -0.12, 0.12); yokeVis.rotation.z = -roll * 1.0;
  } else { yokeVis.position.z *= 0.8; yokeVis.rotation.z *= 0.8; }
  if (grab.thr) CR.thr = clamp(grab.thr.t0 + (grab.thr.z0 - local(l).z) / 0.25, 0, 1);
  return { pitch, roll };
};
const fly = dt => {
  const g = renderer.xr.isPresenting ? grabUpdate() : { pitch: 0, roll: 0 };
  const pitch = clamp(g.pitch + (grab.yoke ? 0 : -dz(axis('right', 3))) + k('ArrowDown') - k('ArrowUp'), -1, 1);
  const roll = clamp(g.roll + (grab.yoke ? 0 : dz(axis('right', 2))) + k('ArrowRight') - k('ArrowLeft'), -1, 1);
  const yaw = clamp(-dz(axis('left', 2)) + k('KeyA') - k('KeyD'), -1, 1);
  if (!grab.thr) CR.thr = clamp(CR.thr + (-dz(axis('left', 3)) + k('KeyW') - k('KeyS')) * dt * 0.5, 0, 1);
  knob.position.z = 0.14 - CR.thr * 0.28;
  const up = CR.pos.clone().normalize();
  const vmax = 40 + 80 * S.space;
  CR.speed += (CR.thr * vmax - CR.speed) * Math.min(1, dt * 0.9);
  const right = V3(1, 0, 0).applyQuaternion(CR.q), bank = right.dot(up);
  let px = pitch * 1.0, yy = yaw * 0.7, rz = -roll * 1.7;
  if (OPT.assist && Math.abs(roll) < 0.15) rz += -bank * 2.0;               // level the wings
  const turn = bank * (OPT.assist ? 1.3 : 0.6);                              // bank = turn
  CR.q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(px * dt, yy * dt, rz * dt)));
  CR.q.premultiply(new THREE.Quaternion().setFromAxisAngle(up, turn * dt));
  const fwd = V3(0, 0, -1).applyQuaternion(CR.q);
  const np = CR.pos.clone().addScaledVector(fwd, CR.speed * dt), nu = np.clone().normalize();
  CR.q.premultiply(new THREE.Quaternion().setFromUnitVectors(up, nu)).normalize();  // follow the curve
  const rmin = walkR(nu) + 1.2, rmax = R + 560;
  CR.pos.copy(nu).multiplyScalar(clamp(np.length(), rmin, rmax));
  craft.position.copy(CR.pos); craft.quaternion.copy(CR.q);
  rig.position.copy(CR.pos); rig.quaternion.copy(CR.q);
  if (!renderer.xr.isPresenting) { camera.position.set(0, 1.25, 0); camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ'); }
  engines.forEach(e => e.material.color.setHSL(0.03 + CR.thr * 0.08, 1, 0.4 + CR.thr * 0.3));
  return Math.abs(px) + Math.abs(turn) + Math.abs(rz) * 0.5;
};
const layer = a => a < 8 ? 'ground' : a < 45 ? 'drone layer' : a < 160 ? 'HAPS layer (~20 km)' : 'LEO layer (550 km)';
let hudT = 0;
const drawHud = () => {
  const c = hudCv.getContext('2d'), a = alt(CR.pos);
  c.clearRect(0, 0, 1024, 200);
  c.fillStyle = 'rgba(6,14,28,0.7)'; c.beginPath(); c.roundRect(4, 4, 1016, 192, 24); c.fill();
  c.fillStyle = '#4fe3ff'; c.font = 'bold 44px ui-monospace, Menlo, monospace';
  c.fillText(`ALT ${a.toFixed(0).padStart(4)} m   SPD ${CR.speed.toFixed(0).padStart(3)} m/s`, 30, 64);
  c.fillStyle = '#ffd23f'; c.font = '34px system-ui'; c.fillText(layer(a), 30, 116);
  c.fillStyle = OPT.assist ? '#7dff9a' : '#ff5fa2'; c.fillText(OPT.assist ? 'ASSIST' : 'MANUAL', 560, 116);
  c.fillStyle = '#e8f3ff'; c.fillText(a < 6 && CR.speed < 8 ? 'A = exit' : '', 780, 116);
  c.fillStyle = '#333a50'; c.fillRect(30, 140, 960, 30);
  c.fillStyle = '#ff5fa2'; c.fillRect(30, 140, 960 * CR.thr, 30);
  hudTex.needsUpdate = true;
};

// ---------- VR button and info ----------
const info = document.getElementById('info'), vrBtn = document.getElementById('vr');
if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then(ok => {
  if (!ok) { vrBtn.textContent = 'VR not available'; return; }
  vrBtn.disabled = false;
  vrBtn.onclick = async () => {
    const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    await renderer.xr.setSession(s); camera.position.set(0, 0, 0); info.style.display = 'none';
    s.addEventListener('end', () => { info.style.display = ''; });
  };
}); else vrBtn.textContent = 'VR not available';

// ---------- loop ----------
let last = 0, t = 0;
renderer.setAnimationLoop(time => {
  const dt = clamp((time - last) / 1000, 0, 0.05); last = time; t += dt;
  // buttons: A = board/exit, B = assist (desktop: E, Q, L)
  if (pressed('A', btn('right', 4) || keys.KeyE)) S.mode === 'walk' ? (S.pos.distanceTo(CR.pos) < 6 && board()) : exit();
  if (pressed('B', btn('right', 5) || keys.KeyQ)) { OPT.assist = !OPT.assist; drawHub(); }
  if (pressed('L', keys.KeyL)) { OPT.labels = !OPT.labels; drawHub(); }
  if (S.mode === 'walk') { craft.position.copy(CR.pos); craft.quaternion.copy(CR.q); }
  const motion = S.mode === 'walk' ? walk(dt) : fly(dt);
  pokeHub(dt);
  vigA = lerp(vigA, OPT.comfort && renderer.xr.isPresenting ? clamp(motion * (S.mode === 'walk' ? 0.7 : 0.6), 0, 0.85) : 0, Math.min(1, dt * 6));
  vig.material.opacity = vigA; vig.visible = vigA > 0.01;
  hudT += dt; if (S.mode === 'fly' && hudT > 0.2) { hudT = 0; drawHud(); }
  hud.visible = S.mode === 'fly';
  world.update(t, dt);
  const cp = camera.getWorldPosition(V3()), up = cp.clone().normalize();
  const sd = up.clone().multiplyScalar(0.75).add(northAt(up).multiplyScalar(-0.45)).add(eastAt(up).multiplyScalar(0.5)).normalize();
  sun.position.copy(cp).addScaledVector(sd, 200); sun.target.position.copy(cp);
  S.space = sky.update(cp, sd);
  scene.fog.color.setRGB(lerp(1, 0.01, S.space), lerp(0.75, 0.01, S.space), lerp(0.63, 0.03, S.space));
  scene.fog.far = 700 + S.space * 5000; scene.fog.near = 150 + S.space * 3000;
  updateBoards(cp, OPT.labels);
  renderer.render(scene, camera);
});
