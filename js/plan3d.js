// Etagen-Grundrisse in leichter 3D-Schrägansicht, untereinander (oberstes Stockwerk oben).
// Keine Überdeckung: jeder Raum ist direkt antippbar. Die Ansicht bewegt sich nicht,
// die Seite wird ganz normal gescrollt.
// API: const p = await createPlan(container, rooms, { gebaeude, onSelect })
//      p.update(states)  p.select(id|null)  p.rebuild(rooms, gebaeude)  p.scrollToFloor(stock)

import * as THREE from "./vendor/three.module.min.js";
import { CSS2DRenderer, CSS2DObject } from "./vendor/CSS2DRenderer.js";
import { computeLayout, furniture, FLOOR_NAMES } from "./building3d.js";

const WALL_H = 1.25, SLAB = 0.12, GAP = 1.6, ELEV = (46 * Math.PI) / 180, LABEL_MARGIN = 3.0, STEP = 1.1; // STEP = Treppen-Versatz je Stockwerk

function webglOk() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export async function createPlan(container, rooms, opts = {}) {
  if (!webglOk()) throw new Error("WebGL nicht verfügbar");
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.touchAction = "pan-y";
  container.appendChild(renderer.domElement);
  const labelR = new CSS2DRenderer(); labelR.domElement.className = "b3d-labels"; container.appendChild(labelR.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x1b2236 : 0xd4dbe7, dark ? 1.3 : 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, dark ? 0.9 : 1.2); sun.position.set(-4, 10, 6); scene.add(sun);

  const root = new THREE.Group(); scene.add(root);
  let meshes = new Map(), floorInfo = [], extent = { x0: 0, x1: 1, z0: 0, z1: 1 }, selected = null;
  const clock = new THREE.Clock(); let t0 = 0;

  function build(list, gebaeude) {
    root.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    root.clear(); meshes = new Map(); floorInfo = [];
    const L = computeLayout(list, false, gebaeude || []);
    // Lange Gebäudeseite waagrecht legen
    const rot = L.depth > L.width ? -Math.PI / 2 : 0;
    const c = Math.cos(rot), s = Math.sin(rot);
    const R = (x, z) => [x * c + z * s, -x * s + z * c];
    const corners = (cx, cz, w, d, r) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
      const lx = (a * w) / 2, lz = (b * d) / 2;
      return R(cx + lx * Math.cos(r) + lz * Math.sin(r), cz - lx * Math.sin(r) + lz * Math.cos(r));
    });
    let gx0 = Infinity, gx1 = -Infinity;
    const per = new Map();
    for (const sl of L.slabs) {
      const pts = corners(sl.x, sl.z, sl.w, sl.d, sl.rot);
      const f = per.get(sl.stock) || { z0: Infinity, z1: -Infinity }; per.set(sl.stock, f);
      for (const [x, z] of pts) { gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x); f.z0 = Math.min(f.z0, z); f.z1 = Math.max(f.z1, z); }
    }
    const stocks = [...L.floors].sort((a, b) => b - a); // oberstes zuerst
    let zCursor = 0;
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    stocks.forEach((stock, si) => {
      const f = per.get(stock);
      const lvl = stocks.length - 1 - si; // 0 = unterstes Stockwerk
      const g = new THREE.Group(); g.rotation.y = rot;
      // Gruppe so verschieben, dass dieses Stockwerk bei zCursor beginnt
      const off = new THREE.Vector3(lvl * STEP, 0, zCursor - f.z0);
      g.position.copy(off); root.add(g);
      floorInfo.push({ stock, z0: zCursor, z1: zCursor + (f.z1 - f.z0) });
      // Stockwerksplatten
      for (const sl of L.slabs.filter((x) => x.stock === stock)) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sl.w, SLAB, sl.d), new THREE.MeshStandardMaterial({ color: dark ? 0x26304c : 0xffffff, roughness: 0.9 }));
        m.position.set(sl.x, -SLAB / 2, sl.z); m.rotation.y = sl.rot; g.add(m);
      }
      // Räume
      const furn = { 0: [], 1: [] };
      for (const p of L.rooms.filter((r) => r.stock === stock)) {
        const w = p.w - 0.16, d = p.d - 0.16;
        const room = new THREE.Group(); room.position.set(p.x, 0, p.z); room.rotation.y = p.rot || 0;
        const tile = new THREE.Mesh(new THREE.BoxGeometry(w - 0.08, 0.08, d - 0.08), new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.7 }));
        tile.position.y = 0.04;
        const glass = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }));
        glass.position.y = WALL_H / 2; glass.userData.roomId = p.room.id;
        const frame = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: dark ? 0x7d8bb0 : 0xaab4c6, transparent: true, opacity: 0.35 }));
        frame.position.y = WALL_H / 2;
        room.add(tile, glass, frame);
        const bookable = !["Verwaltung", "Nebenraum"].includes(p.room.typ);
        let el = null;
        if (bookable && p.w >= 2.5) {
          el = document.createElement("div"); el.className = "p3d-lbl"; el.innerHTML = "<b></b><span></span>";
          const lbl = new CSS2DObject(el); lbl.position.set(0, WALL_H + 0.05, 0); room.add(lbl);
        }
        room.userData = { roomId: p.room.id, tile, glass, frame, el, kind: "free", target: new THREE.Color(0xdfe3ea), delay: Math.random() * 0.4 + floorInfo.length * 0.08 };
        g.add(room); meshes.set(p.room.id, room);
        const cr = Math.cos(p.rot || 0), sr = Math.sin(p.rot || 0);
        for (const [bx, by, bz, sx, sy, sz, dk] of furniture(p.room, p.w - 0.3, p.d - 0.3)) {
          furn[dk ? 1 : 0].push({ x: p.x + bx * cr + bz * sr, y: Math.min(by, WALL_H - 0.1) * 0.85, z: p.z - bx * sr + bz * cr, sx, sy: sy * 0.85, sz, rot: p.rot || 0 });
        }
      }
      for (const dk of [0, 1]) {
        const items = furn[dk]; if (!items.length) continue;
        const im = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: dk ? (dark ? 0x93a0bd : 0x5b6678) : (dark ? 0xc9d2e6 : 0xffffff), roughness: 0.7, transparent: true, opacity: dk ? 0.7 : 0.95 }), items.length);
        items.forEach((it, i) => { q.setFromAxisAngle(up, it.rot); m4.compose(new THREE.Vector3(it.x, it.y + 0.1, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz)); im.setMatrixAt(i, m4); });
        g.add(im);
      }
      // Stockwerksname links
      const fl = document.createElement("div"); fl.className = "p3d-floor"; fl.textContent = FLOOR_NAMES(stock);
      const fo = new CSS2DObject(fl); fo.position.set(gx0 - 0.7 + lvl * STEP, 0, zCursor + (f.z1 - f.z0) / 2); fo.center.set(1, 0.5); root.add(fo);
      zCursor += (f.z1 - f.z0) + GAP;
    });
    extent = { x0: gx0 - LABEL_MARGIN, x1: gx1 + 0.4 + (stocks.length - 1) * STEP, z0: -0.5, z1: zCursor - GAP + 0.5 };
    fit(); t0 = clock.getElapsedTime();
  }

  function fit() {
    const W = container.clientWidth || 360;
    const worldW = extent.x1 - extent.x0;
    const depth = extent.z1 - extent.z0;
    const frustH = depth * Math.sin(ELEV) + WALL_H * Math.cos(ELEV) + 1.2;
    const scale = W / worldW;
    const H = Math.round(frustH * scale);
    container.style.height = H + "px";
    renderer.setSize(W, H); labelR.setSize(W, H);
    camera.left = -worldW / 2; camera.right = worldW / 2; camera.top = frustH / 2; camera.bottom = -frustH / 2;
    const T = new THREE.Vector3((extent.x0 + extent.x1) / 2, WALL_H * 0.3, (extent.z0 + extent.z1) / 2);
    camera.position.copy(T).add(new THREE.Vector3(0, Math.sin(ELEV), Math.cos(ELEV)).multiplyScalar(200));
    camera.lookAt(T); camera.updateProjectionMatrix();
  }

  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects([...meshes.values()].map((m) => m.userData.glass), false)[0];
    opts.onSelect?.(hit ? hit.object.userData.roomId : null);
  });

  let lastW = 0;
  const ro = new ResizeObserver(() => { const w = container.clientWidth; if (w !== lastW) { lastW = w; fit(); } }); ro.observe(container);
  let raf; const white = new THREE.Color(0xffffff);
  function loop() {
    raf = requestAnimationFrame(loop);
    const t = clock.getElapsedTime(), it = t - t0;
    for (const [id, m] of meshes) {
      const u = m.userData, sel = selected === id;
      const k = Math.min(1, Math.max(0, (it - u.delay) * 2.5));
      m.scale.y = Math.max(0.01, k < 1 ? 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2) : 1);
      u.tile.material.color.lerp(u.target, 0.12);
      u.tile.material.emissive.copy(u.target);
      u.tile.material.emissiveIntensity = u.kind === "free" ? 0.15 + 0.08 * Math.sin(t * 2 + u.delay * 9) : 0;
      u.glass.material.color.lerp(sel ? white : u.target, 0.12);
      u.glass.material.opacity += ((sel ? 0.3 : u.kind === "admin" ? 0.02 : 0.08) - u.glass.material.opacity) * 0.15;
      u.frame.material.color.lerp(sel ? new THREE.Color(0x2f5bea) : white.clone().lerp(u.target, 0.6), 0.15);
      u.frame.material.opacity += ((sel ? 1 : u.kind === "admin" ? 0.12 : 0.35) - u.frame.material.opacity) * 0.15;
      u.tile.material.transparent = true; u.tile.material.opacity = u.kind === "admin" ? 0.45 : 1;
    }
    renderer.render(scene, camera); labelR.render(scene, camera);
  }
  build(rooms, opts.gebaeude); loop();

  return {
    update(states) {
      for (const [id, m] of meshes) {
        const s = states.get(id); if (!s) continue;
        const u = m.userData; u.target.set(s.color); u.kind = s.kind;
        if (u.el) {
          u.el.className = `p3d-lbl k-${s.kind}${selected === id ? " sel" : ""}`;
          // kurz halten: besetzt → nur die Klasse, frei → Raumname
          const short = (t) => (t.length > 9 ? t.slice(0, 8) + "…" : t);
          const busyK = s.kind === "busy" || s.kind === "conflict" || s.kind === "reserved";
          u.el.querySelector("b").textContent = busyK ? short(s.label) : short(s.name);
          u.el.querySelector("span").textContent = busyK ? short(s.name) : s.kind === "emerg" ? "zur Not" : "frei";
        }
      }
    },
    select(id) { selected = id; for (const [rid, m] of meshes) m.userData.el?.classList.toggle("sel", rid === id); },
    rebuild(list, gebaeude) { build(list, gebaeude); },
    floors: () => floorInfo.map((f) => f.stock),
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); container.innerHTML = ""; },
  };
}
