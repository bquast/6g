// planet.js — mini planet: shape, placement helpers, terrain, sky, boards
// Classic script. Uses global THREE.

const R = 400;                       // planet radius (world m)
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

const dirLL = (lat, lon) => {
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  return V3(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)).normalize();
};

// tangent pointing "north" at unit direction up
const northAt = up => {
  const ref = Math.abs(up.y) < 0.98 ? V3(0, 1, 0) : V3(1, 0, 0);
  return ref.sub(up.clone().multiplyScalar(ref.dot(up))).normalize();
};
const eastAt = up => V3().crossVectors(northAt(up), up).normalize();

// quaternion: object +Y = up, object -Z = fwd
const basisQ = (up, fwd) => {
  const z = fwd.clone().negate();
  const x = V3().crossVectors(up, z).normalize();
  const z2 = V3().crossVectors(x, up);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z2));
};

// project v onto tangent plane of up
const tangent = (v, up) => v.clone().sub(up.clone().multiplyScalar(v.dot(up))).normalize();

// ---------- terrain height ----------
const TOWN = dirLL(52, 20);
const FLAT = [                      // flat zones: radius m0 flat, blend out to m1 (metres)
  { d: TOWN, m0: 70, m1: 110, h: 0.3 },
  { d: dirLL(32, 34), m0: 20, m1: 50, h: 0.4 },   // gateway
  { d: dirLL(-38, 150), m0: 20, m1: 45, h: 0.6 }, // camper
  { d: dirLL(40, 42), m0: 25, m1: 55, h: 0.4 },   // farm
  { d: dirLL(30, -8), m0: 20, m1: 45, h: 0.5 }    // hikers
].map(f => ({ ...f, a0: f.m0 / R, a1: f.m1 / R }));
const rawH = d =>
  12 * Math.sin(2.1 * d.x + 0.7) * Math.sin(2.7 * d.y + 1.1) * Math.sin(1.9 * d.z + 0.3) +
  4.0 * Math.sin(7.3 * d.x + 5.1 * d.z) + 2.0 * Math.sin(13.7 * d.y + 9.3 * d.x) +
  0.9 * Math.sin(29 * d.z + 23 * d.x) + 2.5;
const hAt = d => FLAT.reduce((h, f) => {
  const a = Math.acos(clamp(d.dot(f.d), -1, 1));
  return lerp(f.h, h, smooth(f.a0, f.a1, a));
}, rawH(d));
const WATER = R - 0.8;
const groundR = d => R + hAt(d);
const walkR = d => Math.max(groundR(d), WATER + 0.2);

// direction from local meters around a center direction
const localDir = (c, e, n) => c.clone().multiplyScalar(R).add(eastAt(c).multiplyScalar(e)).add(northAt(c).multiplyScalar(n)).normalize();

// place object on the surface; heading in degrees from north (clockwise)
const headingFwd = (d, deg) => {
  const a = deg * Math.PI / 180;
  return northAt(d).multiplyScalar(Math.cos(a)).add(eastAt(d).multiplyScalar(Math.sin(a))).normalize();
};
const placeOn = (obj, d, lift = 0, fwd = null) => {
  obj.position.copy(d).multiplyScalar(groundR(d) + lift);
  obj.quaternion.copy(basisQ(d, fwd ? tangent(fwd, d) : northAt(d)));
  return obj;
};
const placeLocal = (obj, e, n, lift = 0, deg = 0) => {
  const d = localDir(TOWN, e, n);
  return placeOn(obj, d, lift, headingFwd(d, deg));
};
const townPos = (e, n, lift = 0) => { const d = localDir(TOWN, e, n); return d.multiplyScalar(groundR(d) + lift); };

// ---------- materials ----------
const lam = (color, o = {}) => new THREE.MeshLambertMaterial(Object.assign({ color, flatShading: true }, o));
const glow = (color, opacity = 0.3) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
});
const box = (w, h, d, m) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); return new THREE.Mesh(g, m); };

// ---------- terrain mesh ----------
const makeTerrain = () => {
  const g = new THREE.IcosahedronGeometry(1, 64);
  const p = g.attributes.position, n = p.count;
  const col = new Float32Array(n * 3);
  const d = V3(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    d.fromBufferAttribute(p, i).normalize();
    p.setXYZ(i, ...d.clone().multiplyScalar(groundR(d)).toArray());
  }
  for (let i = 0; i < n; i += 3) {           // one color per face
    const m = V3();
    for (let k = 0; k < 3; k++) m.add(d.fromBufferAttribute(p, i + k));
    m.divideScalar(3);
    const h = m.length() - R, u = m.clone().normalize();
    const j = 0.5 + 0.5 * Math.sin(u.x * 41 + u.z * 37);
    if (h < -0.4) c.set('#e9d59c');
    else if (h < 5) c.set('#36c2a0').lerp(new THREE.Color('#7fdc8a'), j * 0.5);
    else if (h < 10) c.set('#2a8f86').lerp(new THREE.Color('#3aa39a'), j);
    else c.set('#c47a9e').lerp(new THREE.Color('#e3a3b8'), j);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const land = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  const water = new THREE.Mesh(new THREE.IcosahedronGeometry(WATER, 28),
    new THREE.MeshPhongMaterial({ color: '#1fa3c9', transparent: true, opacity: 0.82, shininess: 80, flatShading: true }));
  const grp = new THREE.Group(); grp.add(land, water);
  return grp;
};

// ---------- trees and rocks (instanced, outside flat zones) ----------
const nearFlat = d => FLAT.some(f => d.dot(f.d) > Math.cos(f.a1 + 0.02));
const scatter = (count, test, seed) => {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out = [];
  for (let i = 0; out.length < count && i < count * 20; i++) {
    const d = V3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    if (test(d)) out.push({ d, r: rnd() });
  }
  return out;
};
const makeFlora = () => {
  const grp = new THREE.Group();
  const pts = scatter(900, d => !nearFlat(d) && groundR(d) > WATER + 0.6 && hAt(d) < 10, 7);
  const stalk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.2, 1, 5).translate(0, 0.5, 0), lam('#5b3d6b'), pts.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), lam('#ffffff'), pts.length);
  const pal = ['#ff9f43', '#ff5fa2', '#ffd23f', '#b06cff', '#ff7a59'].map(x => new THREE.Color(x));
  const m = new THREE.Matrix4(), o = new THREE.Object3D();
  pts.forEach((p, i) => {
    const h = 2 + p.r * 4;
    placeOn(o, p.d, -0.2); o.scale.set(1, h, 1); o.updateMatrix(); stalk.setMatrixAt(i, o.matrix);
    placeOn(o, p.d, h - 0.2); o.scale.setScalar(1 + p.r * 1.4); o.updateMatrix(); crown.setMatrixAt(i, o.matrix);
    crown.setColorAt(i, pal[i % pal.length]);
  });
  const rp = scatter(400, d => !nearFlat(d) && groundR(d) > WATER, 99);
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), lam('#9a7f9f'), rp.length);
  rp.forEach((p, i) => { placeOn(o, p.d, 0); o.scale.set(0.6 + p.r * 2, 0.4 + p.r, 0.7 + p.r * 1.5); o.updateMatrix(); rocks.setMatrixAt(i, o.matrix); });
  grp.add(stalk, crown, rocks);
  return grp;
};

// ---------- sky (follows the camera) ----------
const makeSky = () => {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { up: { value: V3(0, 1, 0) }, sun: { value: V3(0, 1, 0) }, space: { value: 0 } },
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `uniform vec3 up; uniform vec3 sun; uniform float space; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float h = dot(d, up);
        vec3 zen = vec3(.22,.52,.86), hor = vec3(1.,.74,.6), gnd = vec3(.5,.42,.55);
        vec3 c = h > 0. ? mix(hor, zen, pow(h, .55)) : mix(hor, gnd, min(1., -h*4.));
        float s = max(0., dot(d, sun));
        c += vec3(1.,.9,.7)*pow(s, 300.)*3. + vec3(1.,.6,.4)*pow(s, 6.)*.25;
        c = mix(c, vec3(.005,.006,.02) + vec3(1.,.9,.7)*pow(s, 600.)*3., space);
        gl_FragColor = vec4(c, 1.); }`
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), mat);
  sky.renderOrder = -2; sky.frustumCulled = false;
  const sp = new Float32Array(3000);
  for (let i = 0; i < 3000; i += 3) { const v = V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().multiplyScalar(2400); sp.set([v.x, v.y, v.z], i); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#fff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  stars.renderOrder = -1; stars.frustumCulled = false;
  const grp = new THREE.Group(); grp.add(sky, stars);
  const update = (camPos, sunDir) => {
    const up = camPos.clone().normalize(), alt = camPos.length() - R;
    const space = smooth(80, 280, alt);
    grp.position.copy(camPos);
    mat.uniforms.up.value.copy(up); mat.uniforms.sun.value.copy(sunDir); mat.uniforms.space.value = space;
    stars.material.opacity = 0.15 + space * 0.85;
    return space;
  };
  return { grp, update };
};

// ---------- info boards (canvas text, face the viewer) ----------
const BOARDS = [];
const makeBoard = (title, lines, o = {}) => {
  const w = o.w || 3, color = o.color || '#38e1ff';
  const cv = document.createElement('canvas'); cv.width = 768; cv.height = 480;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.625), mat);
  mesh.renderOrder = 10;
  const draw = ls => {
    ctx.clearRect(0, 0, 768, 480);
    ctx.fillStyle = 'rgba(6,14,28,0.86)'; ctx.beginPath(); ctx.roundRect(4, 4, 760, 472, 22); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.stroke();
    ctx.fillStyle = color; ctx.font = 'bold 40px system-ui, sans-serif'; ctx.fillText(title, 28, 56);
    ctx.font = '27px ui-monospace, Menlo, monospace';
    ls.forEach((l, i) => {
      ctx.fillStyle = l.startsWith('>') ? '#ffd23f' : l.startsWith('#') ? '#8fa3b8' : '#e8f3ff';
      ctx.fillText(l.replace(/^[>#]\s?/, ''), 28, 104 + i * 33.5);
    });
    tex.needsUpdate = true;
  };
  draw(lines);
  const b = { mesh, draw, anchor: o.anchor, at: o.at, lift: o.lift ?? 3, range: o.range || 18 };
  BOARDS.push(b);
  return b;
};
// anchor: Object3D (follows it) or at: fixed Vector3. lift is along local up.
const updateBoards = (camPos, showAll) => {
  const p = V3();
  BOARDS.forEach(b => {
    if (b.anchor) b.anchor.getWorldPosition(p); else p.copy(b.at);
    const up = p.clone().normalize();
    b.mesh.position.copy(p).addScaledVector(up, b.lift);
    const dist = b.mesh.position.distanceTo(camPos);
    const a = showAll ? 1 - smooth(b.range, b.range * 1.4, dist) : 0;
    b.mesh.visible = a > 0.01;
    if (!b.mesh.visible) return;
    b.mesh.material.opacity = a;
    b.mesh.up.copy(up); b.mesh.lookAt(camPos);
  });
};
