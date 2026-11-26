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

export const FLOOR_NAMES = (s) => (s === 0 ? "EG" : s < 0 ? `${-s}. UG` : `${s}. OG`);

/** Gebäude, Stock und Größe eines Raums (mit Standardwerten). */
export function roomPlace(r, idxInBereich = 0) {
  const trakt = (r.trakt || "").trim() || "Schulhaus";
  let stock = r.stock !== null && r.stock !== undefined && r.stock !== "" && Number.isFinite(+r.stock) ? +r.stock : null;
  if (stock === null) stock = ["Turnsaal", "Speisesaal", "Mehrzweck", "Werkraum", "Hort"].includes(r.typ) ? 0 : 1 + Math.floor(idxInBereich / 6);
  const groesse = +r.groesse || (r.typ === "Turnsaal" ? 2 : 1);
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
  const out = [], slabs = [], floors = new Set();
  const TD = 2 * DEPTH + CORRIDOR;
  let xCursor = 0, zCursor = 0, maxW = 0;
  for (const t of trakts) {
    const inT = placed.filter((p) => p.trakt === t);
    const stocks = [...new Set(inT.map((p) => p.stock))].sort((a, b) => a - b);
    const per = {}; let traktW = 0;
    for (const s of stocks) {
      const rows = [[], []], len = [0, 0];
      for (const p of inT.filter((q) => q.stock === s).sort((a, b) => (a.room.sort ?? 0) - (b.room.sort ?? 0))) {
        const ri = len[0] <= len[1] ? 0 : 1; rows[ri].push(p); len[ri] += p.groesse * UNIT;
      }
      per[s] = { rows, len, w: Math.max(len[0], len[1]) };
      traktW = Math.max(traktW, per[s].w); floors.add(s);
    }
    const x0 = stackZ ? -traktW / 2 : xCursor, z0 = stackZ ? zCursor : 0;
    for (const s of stocks) {
      const { rows, len, w } = per[s];
      rows.forEach((row, ri) => {
        let x = x0 + (traktW - w) / 2 + (w - len[ri]) / 2;
        for (const p of row) {
          const pw = p.groesse * UNIT;
          out.push({ ...p, x: x + pw / 2, z: z0 + (ri === 0 ? -1 : 1) * (CORRIDOR / 2 + DEPTH / 2), w: pw, d: DEPTH });
          x += pw;
        }
      });
      slabs.push({ trakt: t, stock: s, x: x0 + traktW / 2, z: z0, w: w + 0.5, d: TD + 0.5 });
    }
    maxW = Math.max(maxW, traktW);
    if (stackZ) zCursor += TD + 5; else xCursor += traktW + 5;
  }
  const width = stackZ ? maxW : xCursor - 5;
  const depth = stackZ ? zCursor - 5 : TD;
  const dx = stackZ ? 0 : width / 2, dz = stackZ ? (depth - TD) / 2 : 0;
  out.forEach((o) => { o.x -= dx; o.z -= dz; });
  slabs.forEach((o) => { o.x -= dx; o.z -= dz; });
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
  controls.autoRotate = true; controls.autoRotateSpeed = 0.35;
  let idleT = null, autoWanted = true;
  controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(idleT); });
  controls.addEventListener("end", () => { clearTimeout(idleT); idleT = setTimeout(() => (controls.autoRotate = autoWanted), 30000); });

  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x1b2236 : 0xc9d3e3, dark ? 1.2 : 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, dark ? 1.1 : 1.6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.radius = 4;
  scene.add(sun);

  const world = new THREE.Group(); scene.add(world);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: dark ? 0.35 : 0.12 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -SLAB; ground.receiveShadow = true; scene.add(ground);

  let layout, stacked = false, lastRooms = rooms;
  let meshes = new Map(), floorGroups = new Map();
  let exploded = false, floorSel = null, selected = null, labelMode = opts.labels || "free";
  const clock = new THREE.Clock(); let introT0 = 0;
  const C = (hex) => new THREE.Color(hex);
  const slabColor = dark ? 0x2b3552 : 0xffffff, corrColor = dark ? 0x323d5e : 0xe9edf4;

  function build(list) {
    lastRooms = list;
    for (const g of floorGroups.values()) g.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    world.clear(); meshes = new Map(); floorGroups = new Map();
    stacked = (container.clientWidth || 600) / (container.clientHeight || 400) < 0.95;
    layout = computeLayout(list, stacked);
    const topStock = Math.max(...layout.floors);

    for (const s of layout.slabs) {
      if (!floorGroups.has(s.stock)) { const g = new THREE.Group(); g.userData = { stock: s.stock }; world.add(g); floorGroups.set(s.stock, g); }
      const g = floorGroups.get(s.stock);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(s.w, SLAB, s.d), new THREE.MeshStandardMaterial({ color: slabColor, roughness: 0.85, transparent: true }));
      slab.position.set(s.x, -SLAB / 2, s.z); slab.castShadow = true; slab.receiveShadow = true; slab.userData.base = 1; g.add(slab);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), new THREE.LineBasicMaterial({ color: dark ? 0x4a5677 : 0xcfd6e3, transparent: true }));
      edge.position.copy(slab.position); edge.userData.base = 1; g.add(edge);
      const corr = new THREE.Mesh(new THREE.PlaneGeometry(s.w - 0.5, CORRIDOR - 0.2), new THREE.MeshStandardMaterial({ color: corrColor, roughness: 1, transparent: true }));
      corr.rotation.x = -Math.PI / 2; corr.position.set(s.x, 0.005, s.z); corr.userData.base = 1; g.add(corr);
      const fl = document.createElement("div"); fl.className = "b3d-floor"; fl.textContent = FLOOR_NAMES(s.stock);
      const fo = new CSS2DObject(fl); fo.position.set(s.x - s.w / 2 - 0.3, 0.2, s.z + s.d / 2); fo.center.set(1, 0.5); fo.userData.floorLabel = true; g.add(fo);
      if (s.stock === topStock) { // Dach
        const roof = new THREE.Mesh(new THREE.BoxGeometry(s.w, SLAB, s.d), new THREE.MeshStandardMaterial({ color: slabColor, roughness: 0.85, transparent: true, opacity: 0.35, depthWrite: false }));
        roof.position.set(s.x, WALL_H + SLAB / 2 + 0.05, s.z); roof.userData.base = 0.35; roof.userData.roof = true; g.add(roof);
      }
    }

    for (const p of layout.rooms) {
      const g = floorGroups.get(p.stock);
      const w = p.w - 0.18, d = p.d - 0.18;
      const room = new THREE.Group(); room.position.set(p.x, 0, p.z);
      const tile = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.12, d - 0.1), new THREE.MeshStandardMaterial({ color: 0xd5dbe5, roughness: 0.6, transparent: true }));
      tile.position.y = 0.06; tile.receiveShadow = true; tile.castShadow = true; tile.userData.base = 1;
      const glass = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
      glass.position.y = WALL_H / 2; glass.userData.glass = true;
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: dark ? 0x8fa0c8 : 0x9aa8bf, transparent: true, opacity: 0.55 }));
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
    applyFloors(true); fit(); introT0 = clock.getElapsedTime();
  }

  const gap = () => (exploded ? GAP_EXPLODED : GAP_REAL);
  const floorY = (s) => layout.floors.indexOf(s) * gap();
  const dimmed = (s) => floorSel !== null && s !== floorSel;
  function applyFloors(instant = false) {
    for (const [s, g] of floorGroups) {
      g.userData.targetY = floorY(s);
      if (instant) g.position.y = g.userData.targetY + 10 + layout.floors.indexOf(s) * 2.5;
      const f = dimmed(s) ? 0.12 : 1;
      g.traverse((o) => {
        if (o.material && o.userData.base !== undefined) {
          o.material.opacity = o.userData.base * f;
          if (!o.userData.roof) o.material.depthWrite = f === 1;
        }
        if (o.isCSS2DObject && o.userData.floorLabel) o.element.classList.toggle("dim", dimmed(s));
        if (o.userData.roof) o.visible = floorSel === null && !exploded;
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

  function fit() {
    const w = container.clientWidth || 600, h = container.clientHeight || 400;
    renderer.setSize(w, h); labelR.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (layout && (w / h < 0.95) !== stacked && new Set(layout.slabs.map((s) => s.trakt)).size > 1) { build(lastRooms); return; }
    const height = (layout.floors.length - 1) * gap() + WALL_H;
    const center = new THREE.Vector3(0, height * 0.5, 0);
    const radius = 0.5 * Math.hypot(layout.width + 1.5, layout.depth + 1.5, height + 0.5);
    const vF = (camera.fov * Math.PI) / 180, hF = 2 * Math.atan(Math.tan(vF / 2) * camera.aspect);
    const dist = (radius / Math.sin(Math.min(vF, hF) / 2)) * (camera.aspect > 1 ? 1.0 : 0.84);
    const dir = new THREE.Vector3(0.75, 0.5, 1).normalize();
    camera.position.copy(center).addScaledVector(dir, dist);
    controls.target.copy(center); controls.minDistance = 4; controls.maxDistance = dist * 2.5; controls.update();
    const span = radius * 2;
    sun.position.set(span * 0.6, span * 1.2, span * 0.4);
    const sc = sun.shadow.camera; sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.far = span * 5; sc.updateProjectionMatrix();
  }

  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const targets = []; for (const m of meshes.values()) if (!dimmed(m.userData.stock)) targets.push(m.userData.glass);
    const hit = ray.intersectObjects(targets, false)[0];
    opts.onSelect?.(hit ? hit.object.userData.roomId : null);
  });

  const ro = new ResizeObserver(() => fit()); ro.observe(container);
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
      if (u.kind === "free") em = 0.25 + 0.2 * Math.sin(t * 2.4 + u.delay * 7);
      else if (u.kind === "conflict") em = 0.2 + 0.5 * Math.max(0, Math.sin(t * 6));
      u.tile.material.emissive.copy(u.target); u.tile.material.emissiveIntensity = em;
      const gBase = sel ? 0.42 : u.kind === "busy" ? 0.2 : u.kind === "free" ? 0.12 : 0.16;
      u.glass.material.opacity += (gBase * (dim ? 0.12 : 1) - u.glass.material.opacity) * 0.15;
      u.frame.material.color.lerp(sel ? white : u.target, 0.12);
      u.frame.material.opacity += ((dim ? 0.06 : sel ? 1 : 0.5) - u.frame.material.opacity) * 0.15;
      u.tile.material.opacity = dim ? 0.12 : 1;
      m.position.y = sel ? 0.25 + Math.sin(t * 3) * 0.05 : m.position.y * 0.85;
      if (u.mk.visible) { u.mk.rotation.y = t * 2; u.mk.position.y = WALL_H + 0.45 + Math.sin(t * 3) * 0.1; }
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
        const u = m.userData; u.target.set(s.color); u.kind = s.kind; u.mk.visible = !!s.changed;
        u.el.className = `b3d-lbl k-${s.kind}${selected === id ? " sel" : ""}`;
        u.el.querySelector("b").textContent = s.name;
        u.el.querySelector("span").textContent = s.label;
      }
      applyLabels();
    },
    setFloor(s) { floorSel = s; applyFloors(); },
    setExploded(v) { exploded = v; applyFloors(); fit(); },
    setLabels(mode) { labelMode = mode; applyLabels(); },
    setAutoRotate(v) { autoWanted = v; controls.autoRotate = v; },
    select(id) { selected = id; for (const [rid, m] of meshes) m.userData.el.classList.toggle("sel", rid === id); applyLabels(); },
    rebuild(list) { build(list); },
    resetView() { fit(); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); container.innerHTML = ""; },
  };
}
