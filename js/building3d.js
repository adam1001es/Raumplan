// Animiertes 3D-Schulgebäude (three.js). Stockwerke aufgefächert, jeder Raum ein Block.
// API: const b = await createBuilding(container, rooms, { onSelect })
//      b.update(states)  states: Map roomId -> {kind:'busy'|'free'|'emerg'|'conflict'|'reserved', color, label, changed}
//      b.setFloor(stock|null)  b.setExploded(bool)  b.select(roomId|null)  b.rebuild(rooms)  b.dispose()

import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "./vendor/CSS2DRenderer.js";
import { RoundedBoxGeometry } from "./vendor/RoundedBoxGeometry.js";

const UNIT = 3.2, DEPTH = 3.2, CORRIDOR = 1.5, ROOM_H = 1.25, GAP_EXPLODED = 4.2, GAP_COMPACT = 1.6;

export const FLOOR_NAMES = (s) => (s === 0 ? "EG" : s < 0 ? `${-s}. UG` : `${s}. OG`);

/** Trakt + Stock für einen Raum (mit sinnvollen Standardwerten). */
export function roomPlace(r, idxInBereich = 0) {
  const trakt = (r.trakt || "").trim() || (r.bereich === "VS" || r.bereich === "Hort" ? "VS & Hort" : "Haupthaus");
  let stock = Number.isFinite(+r.stock) && r.stock !== null && r.stock !== "" ? +r.stock : null;
  if (stock === null) stock = ["Turnsaal", "Speisesaal", "Mehrzweck", "Werkraum", "Hort"].includes(r.typ) ? 0 : 1 + Math.floor(idxInBereich / 6);
  const groesse = +r.groesse || (r.typ === "Turnsaal" ? 3 : ["Mehrzweck", "Speisesaal"].includes(r.typ) ? 2 : 1);
  return { trakt, stock, groesse };
}

export function computeLayout(rooms, stackZ = false) {
  const counters = {};
  const placed = rooms.map((r) => {
    const key = r.bereich + (r.typ === "Klassenraum" ? "K" : "F");
    const i = (counters[key] = (counters[key] ?? -1) + 1);
    return { room: r, ...roomPlace(r, i) };
  });
  const trakts = [...new Set(placed.map((p) => p.trakt))];
  const out = []; const floors = new Set(); const slabs = []; let maxW = 0;
  let xCursor = 0, zCursor = 0; const TD = 2 * DEPTH + CORRIDOR + 0.8;
  trakts.forEach((t, ti) => {
    if (stackZ) xCursor = 0;
    const zOff = stackZ ? zCursor : 0;
    const inT = placed.filter((p) => p.trakt === t);
    const stocks = [...new Set(inT.map((p) => p.stock))].sort((a, b) => a - b);
    let traktW = 0; const perStock = {};
    for (const s of stocks) {
      const rows = [[], []]; const len = [0, 0];
      for (const p of inT.filter((q) => q.stock === s).sort((a, b) => (a.room.sort ?? 0) - (b.room.sort ?? 0))) {
        const ri = len[0] <= len[1] ? 0 : 1;
        rows[ri].push(p); len[ri] += p.groesse * UNIT;
      }
      perStock[s] = { rows, len };
      traktW = Math.max(traktW, len[0], len[1]);
      floors.add(s);
    }
    for (const s of stocks) {
      const { rows, len } = perStock[s];
      rows.forEach((row, ri) => {
        let x = xCursor + (traktW - len[ri]) / 2;
        for (const p of row) {
          const w = p.groesse * UNIT;
          out.push({ ...p, x: x + w / 2 - (stackZ ? traktW / 2 : 0), z: zOff + (ri === 0 ? -(CORRIDOR / 2 + DEPTH / 2) : CORRIDOR / 2 + DEPTH / 2), w, d: DEPTH });
          x += w;
        }
      });
      slabs.push({ trakt: t, stock: s, x: stackZ ? 0 : xCursor + traktW / 2, z: zOff, w: traktW + 0.8, d: TD });
    }
    if (stackZ) { maxW = Math.max(maxW, traktW); zCursor += TD + 4; }
    else xCursor += traktW + 4.5;
  });
  const width = stackZ ? maxW : xCursor - 4.5;
  const depth = stackZ ? zCursor - 4 : TD;
  const zMid = stackZ ? (zCursor - 4 - TD) / 2 : 0;
  out.forEach((o) => { if (!stackZ) o.x -= width / 2; o.z -= zMid; });
  slabs.forEach((s) => { if (!stackZ) s.x -= width / 2; s.z -= zMid; });
  return { rooms: out, slabs, floors: [...floors].sort((a, b) => a - b), width, depth };
}

function webglOk() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export async function createBuilding(container, rooms, opts = {}) {
  if (!webglOk()) throw new Error("WebGL nicht verfügbar");
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const labelR = new CSS2DRenderer();
  labelR.domElement.className = "b3d-labels";
  container.appendChild(labelR.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 600);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47; controls.minPolarAngle = 0.15;
  controls.enablePan = true; controls.screenSpacePanning = true;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.45;
  let idleT = null;
  controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(idleT); });
  controls.addEventListener("end", () => { clearTimeout(idleT); idleT = setTimeout(() => (controls.autoRotate = autoRotateWanted), 25000); });
  let autoRotateWanted = true;

  scene.add(new THREE.HemisphereLight(dark ? 0x8899cc : 0xffffff, dark ? 0x1a2030 : 0xb9c4d6, dark ? 1.1 : 1.35));
  const sun = new THREE.DirectionalLight(0xffffff, dark ? 1.3 : 1.9);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  scene.add(sun);

  const world = new THREE.Group(); scene.add(world);
  let stacked = false; let lastRooms = rooms; let meshes = new Map(); let floorGroups = new Map(); let layout; let exploded = true; let floorSel = null; let selected = null;
  const clock = new THREE.Clock(); let introT0 = 0;
  const deco = new THREE.Group(); scene.add(deco);

  function build(roomList) {
    lastRooms = roomList;
    world.clear(); deco.clear(); meshes = new Map(); floorGroups = new Map();
    stacked = (container.clientWidth || 600) / (container.clientHeight || 400) < 0.95;
    layout = computeLayout(roomList, stacked);
    const size = Math.max(layout.width, layout.depth, 14);
    // Boden
    const ground = new THREE.Mesh(new THREE.CircleGeometry(size * 0.95, 64), new THREE.MeshStandardMaterial({ color: dark ? 0x18213a : 0xe3ebdf, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.62; ground.receiveShadow = true; deco.add(ground);
    const ring = new THREE.Mesh(new THREE.RingGeometry(size * 0.95, size * 0.98, 64), new THREE.MeshBasicMaterial({ color: dark ? 0x2a3557 : 0xcfdcc9 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -0.61; deco.add(ring);
    // Bäume
    const treeMat = new THREE.MeshStandardMaterial({ color: dark ? 0x2f7d5b : 0x7cc495, roughness: 0.8, flatShading: true });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x9a7b5f, roughness: 1 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.3; const rr = size * (0.62 + (i % 3) * 0.09);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr * 0.75;
      if (Math.abs(z) < layout.depth / 2 + 2 && Math.abs(x) < layout.width / 2 + 2) continue;
      const t = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.9, 6), trunkMat); trunk.position.y = -0.15;
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85 + (i % 2) * 0.3, 0), treeMat); crown.position.y = 0.9;
      crown.castShadow = trunk.castShadow = true; t.add(trunk, crown); t.position.set(x, -0.5, z); deco.add(t);
    }
    // Stockwerke
    for (const s of layout.slabs) {
      const key = s.stock;
      if (!floorGroups.has(key)) { const g = new THREE.Group(); g.userData = { stock: key }; world.add(g); floorGroups.set(key, g); }
      const g = floorGroups.get(key);
      const slab = new THREE.Mesh(new RoundedBoxGeometry(s.w, 0.28, s.d, 2, 0.12), new THREE.MeshStandardMaterial({ color: dark ? 0x2a3350 : 0xf4f6fa, roughness: 0.9, transparent: true }));
      slab.position.set(s.x, -0.3, s.z); slab.receiveShadow = true; slab.castShadow = true; slab.userData.slab = true; g.add(slab);
      const corr = new THREE.Mesh(new THREE.PlaneGeometry(s.w - 0.8, CORRIDOR * 0.7), new THREE.MeshBasicMaterial({ color: dark ? 0x3a4568 : 0xdde3ee, transparent: true }));
      corr.rotation.x = -Math.PI / 2; corr.position.set(s.x, -0.15, s.z); corr.userData.slab = true; g.add(corr);
      {
        const tl = document.createElement("div"); tl.className = "b3d-floor"; tl.textContent = s.stock === Math.min(...layout.slabs.filter((x) => x.trakt === s.trakt).map((x) => x.stock)) ? `${s.trakt} · ${FLOOR_NAMES(s.stock)}` : FLOOR_NAMES(s.stock);
        const o = new CSS2DObject(tl); o.position.set(s.x - s.w / 2 + 0.2, 0, s.z + s.d / 2 + 0.2); o.center.set(0, 0); o.userData.floorLabel = true; g.add(o);
      }
    }
    // Räume
    for (const p of layout.rooms) {
      const g = floorGroups.get(p.stock);
      const geo = new RoundedBoxGeometry(p.w - 0.32, ROOM_H, p.d - 0.32, 3, 0.18);
      const mat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.55, metalness: 0.05, transparent: true, opacity: 1 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, ROOM_H / 2 - 0.15, p.z); m.castShadow = true; m.receiveShadow = true;
      m.userData = { roomId: p.room.id, target: new THREE.Color(0xcbd5e1), kind: "free", baseY: m.position.y, delay: Math.random() * 0.5 };
      // Kanten
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(p.w - 0.3, ROOM_H, p.d - 0.3)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
      m.add(edges); m.userData.edges = edges;
      // Marker "geändert"
      const mk = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshStandardMaterial({ color: 0xe11d74, emissive: 0xe11d74, emissiveIntensity: 0.6 }));
      mk.position.set(0, ROOM_H / 2 + 0.75, 0); mk.visible = false; m.add(mk); m.userData.marker = mk;
      // Label
      const el = document.createElement("div"); el.className = "b3d-lbl";
      el.innerHTML = `<b></b><span></span>`;
      el.addEventListener("click", () => opts.onSelect?.(p.room.id));
      const lbl = new CSS2DObject(el); lbl.position.set(0, ROOM_H / 2 + 0.05, 0); lbl.center.set(0.5, 1); m.add(lbl);
      m.userData.label = el; m.userData.labelObj = lbl;
      g.add(m); meshes.set(p.room.id, m);
    }
    applyFloors(true);
    fit();
    introT0 = clock.getElapsedTime();
  }

  function floorY(stock) { const i = layout.floors.indexOf(stock); return i * (exploded ? GAP_EXPLODED : GAP_COMPACT) + 0.0; }
  function applyFloors(instant = false) {
    for (const [s, g] of floorGroups) {
      g.userData.targetY = floorY(s);
      if (instant) g.position.y = g.userData.targetY + 14 + layout.floors.indexOf(s) * 5;
      const dim = floorSel !== null && s !== floorSel;
      g.traverse((o) => {
        if (o.isMesh) { o.material.opacity = dim ? (o.userData.slab ? 0.08 : 0.1) : 1; o.material.depthWrite = !dim; }
        if (o.isCSS2DObject) o.visible = !dim;
      });
    }
  }

  function fit() {
    const w = container.clientWidth || 600, h = container.clientHeight || 400;
    renderer.setSize(w, h); labelR.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if ((w / h < 0.95) !== stacked && layout) { build(lastRooms); return; }
    const height = (layout.floors.length - 1) * GAP_EXPLODED + ROOM_H;
    const center = new THREE.Vector3(0, height * 0.42, 0);
    const radius = 0.5 * Math.hypot(layout.width + 1, layout.depth + 1, height + 1);
    const vF = (camera.fov * Math.PI) / 180;
    const hF = 2 * Math.atan(Math.tan(vF / 2) * camera.aspect);
    const dist = (radius / Math.sin(Math.min(vF, hF) / 2)) * (stacked ? 0.86 : 0.8);
    const dir = stacked ? new THREE.Vector3(0.75, 0.85, 0.55).normalize() : new THREE.Vector3(0.35, 0.8, 1).normalize();
    camera.position.copy(center).addScaledVector(dir, dist);
    controls.target.copy(center); controls.maxDistance = dist * 2.2; controls.minDistance = 5;
    controls.update();
    const span = radius * 2.2;
    sun.position.set(span * 0.4, span * 0.9, span * 0.5);
    const sc = sun.shadow.camera; sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.far = span * 4; sc.updateProjectionMatrix();
  }

  // Tippen auf Raum
  const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2(); let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const vis = [...meshes.values()].filter((m) => m.material.opacity > 0.5);
    const hit = ray.intersectObjects(vis, false)[0];
    opts.onSelect?.(hit ? hit.object.userData.roomId : null);
  });

  const ro = new ResizeObserver(() => fit()); ro.observe(container);
  let raf;
  const tmp = new THREE.Color();
  function loop() {
    raf = requestAnimationFrame(loop);
    const t = clock.getElapsedTime(); const it = t - introT0;
    for (const [, g] of floorGroups) {
      const ty = g.userData.targetY ?? 0;
      g.position.y += (ty - g.position.y) * Math.min(1, 0.075 + (it < 2 ? 0.02 : 0.05));
    }
    for (const [id, m] of meshes) {
      const u = m.userData;
      const k = Math.min(1, Math.max(0, (it - 0.6 - u.delay) * 2.2));
      const ease = k < 1 ? 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2) : 1;
      m.scale.y = Math.max(0.02, ease);
      m.material.color.lerp(u.target, 0.08);
      let em = 0; let emColor = u.target;
      if (u.kind === "free") em = 0.18 + 0.16 * Math.sin(t * 2.6 + u.delay * 9);
      else if (u.kind === "emerg") em = 0.08 + 0.08 * Math.sin(t * 2 + u.delay * 9);
      else if (u.kind === "conflict") { em = 0.3 + 0.3 * Math.max(0, Math.sin(t * 6)); emColor = tmp.set(0xff2a2a); }
      m.material.emissive.copy(emColor); m.material.emissiveIntensity = em;
      const sel = selected === id;
      m.position.y = u.baseY + (sel ? 0.35 + Math.sin(t * 3) * 0.06 : 0);
      u.edges.material.opacity += ((sel ? 1 : 0) - u.edges.material.opacity) * 0.2;
      if (u.marker.visible) { u.marker.rotation.y = t * 2; u.marker.position.y = ROOM_H / 2 + 0.75 + Math.sin(t * 3) * 0.12; }
    }
    controls.update();
    renderer.render(scene, camera);
    labelR.render(scene, camera);
  }
  build(rooms);
  loop();

  return {
    floors: () => layout.floors,
    update(states) {
      for (const [id, m] of meshes) {
        const s = states.get(id); if (!s) continue;
        m.userData.target.set(s.color); m.userData.kind = s.kind;
        m.userData.marker.visible = !!s.changed;
        const el = m.userData.label;
        el.className = `b3d-lbl k-${s.kind}${selected === id ? " sel" : ""}`;
        el.querySelector("b").textContent = s.name;
        el.querySelector("span").textContent = s.label;
      }
    },
    setFloor(stock) { floorSel = stock; applyFloors(); },
    setExploded(v) { exploded = v; applyFloors(); },
    setAutoRotate(v) { autoRotateWanted = v; controls.autoRotate = v; },
    select(id) { selected = id; for (const [rid, m] of meshes) m.userData.label.classList.toggle("sel", rid === id); },
    rebuild(list) { build(list); },
    resetView() { fit(); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); container.innerHTML = ""; },
  };
}
