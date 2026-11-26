// 3D-Schulgebäude (three.js): Glasräume mit farbigem Boden, Stockwerke übereinander.
// API: const b = await createBuilding(container, rooms, { onSelect })
//      b.update(states)  states: Map roomId -> {kind, color, label, name, changed}
//      b.setFloor(stock|null)  b.setExploded(bool)  b.setLabels('free'|'all'|'none')
//      b.select(roomId|null)  b.rebuild(rooms)  b.resetView()  b.floors()

import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "./vendor/CSS2DRenderer.js";

const UNIT = 3.2, DEPTH = 3.2, CORRIDOR = 1.4, WALL_H = 1.7, SLAB = 0.14;
const GAP_REAL = 2.15, GAP_EXPLODED = 3.6;

let floorNameOverrides = {};
export function setFloorNames(m) { floorNameOverrides = m || {}; }
export const FLOOR_NAMES = (s) => floorNameOverrides[s] || (s === 0 ? "EG" : s < 0 ? `${-s}. UG` : `${s}. OG`);

/** Gebäude, Stock, Größe und Seite eines Raums (mit Standardwerten). */
export function roomPlace(r, idxInBereich = 0) {
  const trakt = (r.trakt || "").trim() || "Schulhaus";
  let stock = r.stock !== null && r.stock !== undefined && r.stock !== "" && Number.isFinite(+r.stock) ? +r.stock : null;
  if (stock === null) stock = ["Turnsaal", "Speisesaal", "Mehrzweck", "Werkraum", "Hort"].includes(r.typ) ? 0 : 1 + Math.floor(idxInBereich / 6);
  const groesse = +r.groesse || (r.typ === "Turnsaal" ? 2 : 1);
  const seite = r.seite === "hof" || r.seite === "strasse" ? r.seite : null;
  return { trakt, stock, groesse, seite };
}

/**
 * Räume auf Trakte/Stockwerke verteilen.
 * gebaeude (optional): [{ name, x, z, rot (Grad), flip }] – Lage und Drehung der Trakte.
 * Ohne Angabe stehen die Trakte nebeneinander.
 */
export function computeLayout(rooms, stackZ = false, gebaeude = []) {
  const counters = {};
  const placed = rooms.map((r) => {
    const key = r.bereich + (r.typ === "Klassenraum" ? "K" : "F");
    const i = (counters[key] = (counters[key] ?? -1) + 1);
    return { room: r, ...roomPlace(r, i) };
  });
  const cfgs = Object.fromEntries((gebaeude || []).map((g) => [g.name, g]));
  const trakts = [...new Set([...(gebaeude || []).map((g) => g.name).filter((n) => placed.some((p) => p.trakt === n)), ...placed.map((p) => p.trakt)])];
  const TD = 2 * DEPTH + CORRIDOR;
  const out = [], slabs = [], fill = [], floors = new Set();
  let xCursor = 0, zCursor = 0;
  trakts.forEach((t, ti) => {
    const cfg = cfgs[t];
    const inT = placed.filter((p) => p.trakt === t);
    const stocks = [...new Set(inT.map((p) => p.stock))].sort((a, b) => a - b);
    const bySide = !!cfg || inT.some((p) => p.seite);
    const local = []; const lslabs = []; const fillers = []; let traktW = 0;
    for (const s of stocks) {
      const rows = [[], []], len = [0, 0];
      for (const p of inT.filter((q) => q.stock === s).sort((a, b) => (a.room.sort ?? 0) - (b.room.sort ?? 0))) {
        let ri = len[0] <= len[1] ? 0 : 1;
        if (bySide) ri = (p.seite || (p.room.typ === "Klassenraum" ? "strasse" : "hof")) === "strasse" ? 0 : 1;
        rows[ri].push(p); len[ri] += p.groesse * UNIT;
      }
      const w = Math.max(len[0], len[1], UNIT, (+cfg?.laenge || 0) * UNIT);
      rows.forEach((row, ri) => {
        let x = bySide ? 0 : (w - len[ri]) / 2;
        const side = (ri === 0 ? -1 : 1) * (cfg?.flip ? -1 : 1);
        for (const p of row) { const pw = p.groesse * UNIT; local.push({ ...p, lx: x + pw / 2, lz: side * (CORRIDOR / 2 + DEPTH / 2), w: pw, d: DEPTH }); x += pw; }
        // freie Fläche (Stiegenhaus, WC, Gang …) als neutraler Block
        if (bySide && w - x > 0.5) fillers.push({ trakt: t, stock: s, lx: x + (w - x) / 2, lz: side * (CORRIDOR / 2 + DEPTH / 2), w: w - x, d: DEPTH });
      });
      lslabs.push({ trakt: t, stock: s, lx: w / 2, w: w + 0.5, d: TD + 0.5, main: ti === 0 });
      traktW = Math.max(traktW, w); floors.add(s);
    }
    let ox, oz, rot = 0;
    if (cfg) { ox = +cfg.x || 0; oz = +cfg.z || 0; rot = ((+cfg.rot || 0) * Math.PI) / 180; }
    else if (stackZ) { ox = -traktW / 2; oz = zCursor; zCursor += TD + 5; }
    else { ox = xCursor; oz = 0; xCursor += traktW + 5; }
    if (cfg && !stackZ) xCursor = Math.max(xCursor, ox + traktW + 5);
    const c = Math.cos(rot), sn = Math.sin(rot);
    const tf = (lx, lz) => [ox + lx * c + lz * sn, oz - lx * sn + lz * c];
    for (const o of local) { const [x, z] = tf(o.lx, o.lz); out.push({ ...o, x, z, rot }); }
    for (const o of lslabs) { const [x, z] = tf(o.lx, 0); slabs.push({ ...o, x, z, rot }); }
    for (const o of fillers) { const [x, z] = tf(o.lx, o.lz); fill.push({ ...o, x, z, rot }); }
  });
  // Mittelpunkt + Ausdehnung aus allen Stockwerksplatten
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of slabs) for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = (a * s.w) / 2, lz = (b * s.d) / 2;
    const x = s.x + lx * Math.cos(s.rot) + lz * Math.sin(s.rot), z = s.z - lx * Math.sin(s.rot) + lz * Math.cos(s.rot);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  out.forEach((o) => { o.x -= cx; o.z -= cz; });
  slabs.forEach((o) => { o.x -= cx; o.z -= cz; });
  fill.forEach((o) => { o.x -= cx; o.z -= cz; });
  return { rooms: out, slabs, fill, configured: (gebaeude || []).length > 0, floors: [...floors].sort((a, b) => a - b), width: maxX - minX, depth: maxZ - minZ };
}

/**
 * Ganz leichte Einrichtung je Raumart. Liefert Boxen [x, y, z, breite, höhe, tiefe, dunkel?]
 * im Raum-Koordinatensystem (Mitte des Raums, Boden = 0). w = Breite (x), d = Tiefe (z).
 */
export function furniture(r, w, d) {
  const out = []; const B = (x, y, z, sx, sy, sz, dk = 0) => out.push([x, y, z, sx, sy, sz, dk]);
  const n = (r.name || "").toLowerCase();
  const desks = (cols, rows, dw = 0.5, dd = 0.3) => {
    const mx = w * 0.16, mzF = d * 0.3, mzB = d * 0.14;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = -w / 2 + mx + ((w - 2 * mx) * (i + 0.5)) / cols;
      const z = -d / 2 + mzF + ((d - mzF - mzB) * (j + 0.5)) / rows;
      B(x, 0.3, z, dw, 0.06, dd); B(x, 0.15, z, dw * 0.9, 0.3, 0.04);
    }
  };
  const board = () => B(0, 1.05, -d / 2 + 0.06, Math.min(w * 0.55, 2.2), 0.5, 0.04, 1);
  if (r.typ === "Klassenraum") { desks(3, 3); board(); B(-w * 0.28, 0.3, -d / 2 + 0.55, 0.6, 0.06, 0.32); }
  else if (r.typ === "EDV") { desks(3, 3, 0.55, 0.3); board(); for (let i = 0; i < 9; i++) { const x = -w / 2 + w * 0.16 + ((w - w * 0.32) * ((i % 3) + 0.5)) / 3, z = -d / 2 + d * 0.3 + ((d * 0.56) * (Math.floor(i / 3) + 0.5)) / 3; B(x, 0.46, z - 0.06, 0.28, 0.2, 0.03, 1); } }
  else if (r.typ === "Turnsaal") {
    const lw = w * 0.82, ld = d * 0.72;
    B(0, 0.13, -ld / 2, lw, 0.01, 0.05); B(0, 0.13, ld / 2, lw, 0.01, 0.05); B(-lw / 2, 0.13, 0, 0.05, 0.01, ld); B(lw / 2, 0.13, 0, 0.05, 0.01, ld); B(0, 0.13, 0, 0.05, 0.01, ld);
    B(-lw / 2 + 0.1, 1.1, 0, 0.05, 0.5, 0.6, 1); B(lw / 2 - 0.1, 1.1, 0, 0.05, 0.5, 0.6, 1);
  }
  else if (r.typ === "Speisesaal") { for (let i = 0; i < 3; i++) { const z = -d / 2 + d * (0.25 + i * 0.25); B(0, 0.3, z, w * 0.75, 0.06, 0.4); } }
  else if (r.typ === "Bibliothek") { B(-w / 2 + 0.15, 0.6, 0, 0.22, 1.1, d * 0.8); B(0, 0.6, -d / 2 + 0.15, w * 0.7, 1.1, 0.22); B(w * 0.12, 0.3, d * 0.12, 0.9, 0.06, 0.6); }
  else if (r.typ === "Werkraum") { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) B(-w * 0.2 + i * w * 0.4, 0.38, -d * 0.12 + j * d * 0.36, w * 0.3, 0.1, 0.55); board(); }
  else if (r.typ === "Hort") { B(-w * 0.2, 0.3, 0, 0.9, 0.06, 0.9); B(w * 0.2, 0.3, -d * 0.15, 0.9, 0.06, 0.6); B(w * 0.25, 0.22, d * 0.3, 1.2, 0.3, 0.4); }
  else if (r.typ === "Verwaltung") { if (w > 1.2) { B(-w * 0.18, 0.3, 0, Math.min(0.7, w * 0.35), 0.06, 0.4); B(w * 0.18, 0.3, d * 0.15, Math.min(0.7, w * 0.35), 0.06, 0.4); } else B(0, 0.3, 0, w * 0.6, 0.06, 0.35); }
  else if (r.typ === "Nebenraum") { if (n.includes("stiege")) for (let i = 0; i < 7; i++) B(-w * 0.2, 0.08 + i * 0.16, -d * 0.35 + i * 0.22, w * 0.35, 0.08, 0.22); }
  else if (r.typ === "Mehrzweck") {
    if (n.includes("kapelle")) { for (let i = 0; i < 4; i++) { B(-w * 0.2, 0.25, -d * 0.2 + i * d * 0.17, w * 0.3, 0.12, 0.2); B(w * 0.2, 0.25, -d * 0.2 + i * d * 0.17, w * 0.3, 0.12, 0.2); } B(0, 0.4, -d / 2 + 0.35, 0.6, 0.4, 0.3, 1); }
    else if (n.includes("besprech")) B(0, 0.32, 0, w * 0.55, 0.06, d * 0.35);
    else { B(-w * 0.3, 0.22, d * 0.25, w * 0.25, 0.1, 0.3); B(w * 0.3, 0.22, d * 0.25, w * 0.25, 0.1, 0.3); }
  }
  else if (r.typ === "Sonstiges") {
    if (n.includes("garten")) { for (let i = 0; i < 4; i++) B(-w * 0.3 + (i % 2) * w * 0.6, 0.2, -d * 0.2 + Math.floor(i / 2) * d * 0.4, 0.6, 0.35, 0.6); }
    else { for (let j = 0; j < 3; j++) B(0, 0.38, -d * 0.18 + j * d * 0.24, w * 0.7, 0.08, 0.4); board(); }
  }
  return out;
}

function webglOk() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export async function createBuilding(container, rooms, opts = {}) {
  if (!webglOk()) throw new Error("WebGL nicht verfügbar");
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const labelR = new CSS2DRenderer(); labelR.domElement.className = "b3d-labels"; container.appendChild(labelR.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 800);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49; controls.minPolarAngle = 0.12;
  controls.screenSpacePanning = true;
  controls.autoRotate = false; controls.enabled = false; renderer.domElement.style.touchAction = "pan-y"; // Ansicht fest: nichts verschiebt sich beim Tippen
  let idleT = null, autoWanted = false, camGoal = null;
  controls.addEventListener("start", () => { controls.autoRotate = false; camGoal = null; clearTimeout(idleT); });
  controls.addEventListener("end", () => { clearTimeout(idleT); if (autoWanted) idleT = setTimeout(() => (controls.autoRotate = true), 30000); });

  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x1b2236 : 0xc9d3e3, dark ? 1.2 : 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, dark ? 1.1 : 1.6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.radius = 4;
  scene.add(sun);

  const world = new THREE.Group(); scene.add(world);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: dark ? 0.15 : 0.035 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -SLAB; ground.receiveShadow = true; scene.add(ground);

  let layout, stacked = false, lastRooms = rooms;
  let meshes = new Map(), floorGroups = new Map();
  let exploded = true, floorSel = null, selected = null, labelMode = "none";
  const clock = new THREE.Clock(); let introT0 = 0;
  const C = (hex) => new THREE.Color(hex);
  const slabColor = dark ? 0x2b3552 : 0xffffff, corrColor = dark ? 0x323d5e : 0xe9edf4;

  function build(list) {
    lastRooms = list;
    for (const g of floorGroups.values()) g.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    world.clear(); meshes = new Map(); floorGroups = new Map();
    stacked = (container.clientWidth || 600) / (container.clientHeight || 400) < 0.95;
    layout = computeLayout(list, stacked && !(opts.gebaeude?.length), opts.gebaeude);

    for (const s of layout.slabs) {
      if (!floorGroups.has(s.stock)) { const g = new THREE.Group(); g.userData = { stock: s.stock }; world.add(g); floorGroups.set(s.stock, g); }
      const g = floorGroups.get(s.stock);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(s.w, SLAB, s.d), new THREE.MeshStandardMaterial({ color: slabColor, roughness: 0.85, transparent: true }));
      slab.position.set(s.x, -SLAB / 2, s.z); slab.rotation.y = s.rot; slab.castShadow = true; slab.receiveShadow = true; slab.userData.base = 1; g.add(slab);


      if (s.main) {
        const fl = document.createElement("div"); fl.className = "b3d-floor"; fl.textContent = FLOOR_NAMES(s.stock);
        const a = s.w / 2 + 0.5, lz = layout.configured ? -s.d / 2 : s.d / 2;
        const fo = new CSS2DObject(fl); fo.position.set(s.x + a * Math.cos(s.rot) + lz * Math.sin(s.rot), 0.3, s.z - a * Math.sin(s.rot) + lz * Math.cos(s.rot)); fo.center.set(0, 0.5); fo.userData.floorLabel = true; g.add(fo);
      }
      const topOfTrakt = Math.max(...layout.slabs.filter((x) => x.trakt === s.trakt).map((x) => x.stock));
      if (s.stock === topOfTrakt) { // Dach
        const roof = new THREE.Mesh(new THREE.BoxGeometry(s.w, SLAB, s.d), new THREE.MeshStandardMaterial({ color: slabColor, roughness: 0.85, transparent: true, opacity: 0.35, depthWrite: false }));
        roof.position.set(s.x, WALL_H + SLAB / 2 + 0.05, s.z); roof.rotation.y = s.rot; roof.userData.base = 0.35; roof.userData.roof = true; g.add(roof);
      }
    }

    for (const p of layout.rooms) {
      const g = floorGroups.get(p.stock);
      const w = p.w - 0.18, d = p.d - 0.18;
      const room = new THREE.Group(); room.position.set(p.x, 0, p.z); room.rotation.y = p.rot || 0;
      const tile = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.12, d - 0.1), new THREE.MeshStandardMaterial({ color: 0xd5dbe5, roughness: 0.6, transparent: true }));
      tile.position.y = 0.06; tile.receiveShadow = true; tile.castShadow = true; tile.userData.base = 1;
      const glass = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
      glass.position.y = WALL_H / 2; glass.userData.glass = true;
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: dark ? 0x8fa0c8 : 0x9aa8bf, transparent: true, opacity: 0.12 }));
      frame.position.y = WALL_H / 2;
      const mk = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: 0xe11d74, emissive: 0xe11d74, emissiveIntensity: 0.7 }));
      mk.position.y = WALL_H + 0.45; mk.visible = false;
      const el = document.createElement("div"); el.className = "b3d-lbl"; el.innerHTML = "<b></b><span></span>";
      el.addEventListener("click", (e) => { e.stopPropagation(); opts.onSelect?.(p.room.id); });
      const lbl = new CSS2DObject(el); lbl.position.y = WALL_H * 0.55; lbl.center.set(0.5, 0.5);
      room.add(tile, glass, frame, mk, lbl);
      room.userData = { roomId: p.room.id, tile, glass, frame, mk, lbl, el, kind: "free", target: C(0xd5dbe5), delay: p.stock * 0.18 + Math.random() * 0.25, stock: p.stock };
      glass.userData.roomId = p.room.id;
      g.add(room); meshes.set(p.room.id, room);
    }
    for (const f of layout.fill) {
      const g = floorGroups.get(f.stock); if (!g) continue;
      const box = new THREE.Mesh(new THREE.BoxGeometry(f.w - 0.18, 0.06, f.d - 0.18), new THREE.MeshStandardMaterial({ color: dark ? 0x3a4466 : 0xeef1f6, roughness: 1, transparent: true, opacity: 0.6 }));
      box.position.set(f.x, 0.03, f.z); box.rotation.y = f.rot; box.userData.base = 0.6; g.add(box);
    }
    // Einrichtung: pro Stockwerk zwei InstancedMeshes (hell / dunkel)
    const perFloor = new Map();
    for (const p of layout.rooms) {
      const list = perFloor.get(p.stock) || []; perFloor.set(p.stock, list);
      const c = Math.cos(p.rot || 0), sn = Math.sin(p.rot || 0);
      for (const [bx, by, bz, sx, sy, sz, dk] of furniture(p.room, p.w - 0.3, p.d - 0.3)) list.push({ x: p.x + bx * c + bz * sn, y: by, z: p.z - bx * sn + bz * c, sx, sy, sz, rot: p.rot || 0, dk });
    }
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const [stock, list] of perFloor) {
      const g = floorGroups.get(stock); if (!g) continue;
      for (const dk of [0, 1]) {
        const items = list.filter((f) => f.dk === dk); if (!items.length) continue;
        const mat = new THREE.MeshStandardMaterial({ color: dk ? (dark ? 0x93a0bd : 0x5b6678) : (dark ? 0xc9d2e6 : 0xffffff), roughness: 0.7, transparent: true, opacity: dk ? 0.75 : 0.92 });
        const im = new THREE.InstancedMesh(unit, mat, items.length);
        items.forEach((f, i) => { q.setFromAxisAngle(up, f.rot); m4.compose(new THREE.Vector3(f.x, f.y + 0.12, f.z), q, new THREE.Vector3(f.sx, f.sy, f.sz)); im.setMatrixAt(i, m4); });
        im.userData.base = mat.opacity; im.castShadow = false; g.add(im);
      }
    }
    applyFloors(true); fit(true); introT0 = clock.getElapsedTime();
  }

  const gap = () => (exploded ? GAP_EXPLODED : GAP_REAL);
  const floorY = (s) => layout.floors.indexOf(s) * gap();
  const dimmed = (s) => floorSel !== null && s !== floorSel;
  function applyFloors(instant = false) {
    ground.visible = floorSel === null;
    for (const [s, g] of floorGroups) {
      g.userData.targetY = floorY(s);
      if (instant) g.position.y = g.userData.targetY + 10 + layout.floors.indexOf(s) * 2.5;
      g.visible = floorSel === null || s === floorSel;
      const f = dimmed(s) ? 0.12 : 1;
      g.traverse((o) => {
        if (o.material && o.userData.base !== undefined) {
          o.material.opacity = o.userData.base * f;
          if (!o.userData.roof) o.material.depthWrite = f === 1;
        }
        if (o.isCSS2DObject && o.userData.floorLabel) o.visible = g.visible;
        if (o.userData.roof) o.visible = false;
      });
    }
    applyLabels();
  }
  function applyLabels() {
    for (const [id, m] of meshes) {
      const u = m.userData;
      const byMode = labelMode === "all" || (labelMode === "free" && ["free", "emerg", "conflict"].includes(u.kind));
      u.lbl.visible = selected === id || (byMode && !dimmed(u.stock));
    }
  }

  function fit(instant = false) {
    const w = container.clientWidth || 600, h = container.clientHeight || 400;
    renderer.setSize(w, h); labelR.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (layout && (w / h < 0.95) !== stacked && new Set(layout.slabs.map((s) => s.trakt)).size > 1 && !(opts.gebaeude?.length)) { build(lastRooms); return; }
    const vF = (camera.fov * Math.PI) / 180, hF = 2 * Math.atan(Math.tan(vF / 2) * camera.aspect);
    let center, dist, dir;
    if (floorSel === null) {
      const height = (layout.floors.length - 1) * gap() + WALL_H;
      center = new THREE.Vector3(0, height * 0.5, 0);
      const radius = 0.5 * Math.hypot(layout.width + 1.5, layout.depth + 1.5, height + 0.5);
      dist = (radius / Math.sin(Math.min(vF, hF) / 2)) * (camera.aspect > 1 ? 1.0 : 0.86);
      dir = (layout.configured ? new THREE.Vector3(-0.85, 0.62, 0.8) : new THREE.Vector3(0.75, 0.5, 1)).normalize();
    } else {
      const rs = layout.rooms.filter((r) => r.stock === floorSel);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const r of rs) { const e = Math.max(r.w, r.d) / 2; x0 = Math.min(x0, r.x - e); x1 = Math.max(x1, r.x + e); z0 = Math.min(z0, r.z - e); z1 = Math.max(z1, r.z + e); }
      if (!rs.length) { x0 = z0 = -5; x1 = z1 = 5; }
      center = new THREE.Vector3((x0 + x1) / 2, floorY(floorSel) + 0.4, (z0 + z1) / 2);
      // lange Seite des Stockwerks entlang der langen Bildschirmseite ausrichten
      const alongZ = (z1 - z0) > (x1 - x0);
      const portrait = camera.aspect < 1;
      dir = (alongZ === portrait ? new THREE.Vector3(-0.12, 2.2, 1) : new THREE.Vector3(-1, 2.2, 0.12)).normalize();
      const halfV = Math.tan(vF / 2), halfH = Math.tan(hF / 2);
      const sw = alongZ === portrait ? (x1 - x0) : (z1 - z0), sh = alongZ === portrait ? (z1 - z0) : (x1 - x0);
      dist = Math.max((sw / 2 + 0.6) / halfH, (sh / 2 + 0.6) * 0.95 / halfV) + 2;
    }
    const pos = center.clone().addScaledVector(dir, dist);
    controls.minDistance = 3; controls.maxDistance = dist * 3;
    if (instant) { camera.position.copy(pos); controls.target.copy(center); camGoal = null; controls.update(); }
    else camGoal = { pos, target: center };
    const span = Math.max(layout.width, layout.depth, 10) * 1.2;
    sun.position.set(span * 0.6, span * 1.2 + floorY(floorSel ?? 0), span * 0.4);
    const sc = sun.shadow.camera; sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.far = span * 6; sc.updateProjectionMatrix();
  }

  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    if (floorSel === null) {
      // Übersicht: das Stockwerk wählen, dessen Höhe am Bildschirm am nächsten am Finger liegt
      const ty = e.clientY - r.top; let best = null, bd = Infinity;
      for (const [stock, g] of floorGroups) {
        const sl = layout.slabs.filter((x) => x.stock === stock);
        const cx = sl.reduce((a2, x) => a2 + x.x, 0) / sl.length, cz = sl.reduce((a2, x) => a2 + x.z, 0) / sl.length;
        const v = new THREE.Vector3(cx, g.position.y + WALL_H * 0.4, cz).project(camera);
        const sy = (-v.y * 0.5 + 0.5) * r.height;
        const dd = Math.abs(sy - ty);
        if (dd < bd) { bd = dd; best = stock; }
      }
      if (best !== null) opts.onFloorPick?.(best, null);
      return;
    }
    const targets = []; for (const m of meshes.values()) if (m.userData.stock === floorSel) targets.push(m.userData.glass);
    const hit = ray.intersectObjects(targets, false)[0];
    opts.onSelect?.(hit ? hit.object.userData.roomId : null);
  });

  const ro = new ResizeObserver(() => fit(true)); ro.observe(container);
  let raf; const white = C(0xffffff);
  function loop() {
    raf = requestAnimationFrame(loop);
    const t = clock.getElapsedTime(), it = t - introT0;
    for (const g of floorGroups.values()) g.position.y += ((g.userData.targetY ?? 0) - g.position.y) * 0.09;
    for (const [id, m] of meshes) {
      const u = m.userData, sel = selected === id, dim = dimmed(u.stock);
      const k = Math.min(1, Math.max(0, (it - 0.5 - u.delay) * 2.4));
      const e = k < 1 ? 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2) : 1;
      m.scale.set(1, Math.max(0.01, e), 1);
      u.tile.material.color.lerp(u.target, 0.1);
      u.glass.material.color.lerp(u.target, 0.1);
      let em = 0;
      if (u.kind === "free") em = 0.18 + 0.1 * Math.sin(t * 2 + u.delay * 7);
      else if (u.kind === "conflict") em = 0.2 + 0.5 * Math.max(0, Math.sin(t * 6));
      u.tile.material.emissive.copy(u.target); u.tile.material.emissiveIntensity = em;
      const gBase = sel ? 0.35 : u.kind === "admin" ? 0.03 : u.kind === "free" ? 0.1 : 0.07;
      u.glass.material.opacity += (gBase * (dim ? 0.12 : 1) - u.glass.material.opacity) * 0.15;
      u.frame.material.color.lerp(sel ? white : u.target, 0.12);
      u.frame.material.opacity += ((dim ? 0.03 : sel ? 1 : u.kind === "admin" ? 0.06 : 0.14) - u.frame.material.opacity) * 0.15;
      u.tile.material.opacity = dim ? 0.1 : u.kind === "admin" ? 0.35 : 1;
      m.position.y = sel ? 0.25 + Math.sin(t * 3) * 0.05 : m.position.y * 0.85;
      if (u.mk.visible) { u.mk.rotation.y = t * 2; u.mk.position.y = WALL_H + 0.45 + Math.sin(t * 3) * 0.1; }
    }
    if (camGoal) {
      camera.position.lerp(camGoal.pos, 0.1); controls.target.lerp(camGoal.target, 0.1);
      if (camera.position.distanceTo(camGoal.pos) < 0.05) camGoal = null;
    }
    controls.update();
    renderer.render(scene, camera); labelR.render(scene, camera);
  }
  build(rooms); loop();

  return {
    floors: () => layout.floors,
    update(states) {
      for (const [id, m] of meshes) {
        const s = states.get(id); if (!s) continue;
        const u = m.userData; u.target.set(s.color); u.kind = s.kind; u.mk.visible = false;
        u.el.className = `b3d-lbl k-${s.kind}${selected === id ? " sel" : ""}`;
        u.el.querySelector("b").textContent = s.name;
        u.el.querySelector("span").textContent = s.label;
      }
      applyLabels();
    },
    setFloor(s) { floorSel = s; applyFloors(); fit(); },
    setExploded(v) { exploded = v; applyFloors(); fit(); },
    floor: () => floorSel,
    setLabels(mode) { labelMode = mode; applyLabels(); },
    setAutoRotate(v) { autoWanted = v; controls.autoRotate = v; },
    select(id) { selected = id; for (const [rid, m] of meshes) m.userData.el.classList.toggle("sel", rid === id); applyLabels(); },
    rebuild(list, gebaeude) { if (gebaeude !== undefined) opts.gebaeude = gebaeude; build(list); },
    resetView() { fit(); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); container.innerHTML = ""; },
  };
}
