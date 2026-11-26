// Übersicht als Treppe: jedes Stockwerk ein kompaktes Rechteck (vorne Straßenseite, hinten Hofseite),
// eine Stufe höher und leicht versetzt auf dem darunter. Jedes Stockwerk hat eine eigene Farbe;
// freie Räume leuchten grün. Keine Beschriftung in den Räumen. Ansicht bewegt sich nicht,
// die Seite scrollt normal; jeder Raum ist direkt antippbar.
// API: const p = await createPlan(container, rooms, { gebaeude, onSelect })
//      p.update(states)  p.select(id|null)  p.rebuild(rooms, gebaeude)  p.floors()  p.floorColor(stock)

import * as THREE from "./vendor/three.module.min.js";
import { CSS2DRenderer, CSS2DObject } from "./vendor/CSS2DRenderer.js";
import { furniture, FLOOR_NAMES, roomPlace } from "./building3d.js";

const UNIT = 3.2, DEPTH = 3.0, CORR = 0.9, WALL_H = 1.1, SLAB = 0.14;
const ELEV = (40 * Math.PI) / 180;      // Blickwinkel von oben
const STEP_X = 1.0, STEP_Y = 1.1;       // Treppe: je Stockwerk nach rechts und nach oben
const LEFT = 4.2;                       // Platz links für das Stockwerk-Schild

// Eine Farbe je Stockwerk (bewusst kein Grün – Grün heißt „frei")
const FLOOR_COLORS = ["#5b8def", "#9b7bf0", "#e5679f", "#f0954a", "#d9b43a", "#3eb3d1", "#8a94a6", "#c07ad6"];
export const floorColor = (idx) => FLOOR_COLORS[((idx % FLOOR_COLORS.length) + FLOOR_COLORS.length) % FLOOR_COLORS.length];

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
  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x1b2236 : 0xd4dbe7, dark ? 1.3 : 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, dark ? 0.8 : 1.0); sun.position.set(-3, 10, 7); scene.add(sun);

  const root = new THREE.Group(); scene.add(root);
  let meshes = new Map(), floors = [], ext = { x0: 0, x1: 1 }, selected = null;
  const clock = new THREE.Clock(); let t0 = 0;
  const colorOf = new Map();
  const D = 2 * DEPTH + CORR;

  function build(list, gebaeude) {
    root.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    root.clear(); meshes = new Map(); floors = []; colorOf.clear();
    const order = (gebaeude || []).map((g) => g.name);
    const tIdx = (t) => { const i = order.indexOf(t); return i < 0 ? 99 : i; };
    const placed = list.map((r) => ({ room: r, ...roomPlace(r) }));
    const stocks = [...new Set(placed.map((p) => p.stock))].sort((a, b) => a - b);
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    let maxW = 0;
    const plans = stocks.map((stock) => {
      const inF = placed.filter((p) => p.stock === stock)
        .sort((a, b) => tIdx(a.trakt) - tIdx(b.trakt) || (a.room.sort ?? 0) - (b.room.sort ?? 0));
      const rows = [[], []], len = [0, 0];
      for (const p of inF) {
        const hofTrakt = /hof/i.test(p.trakt) && p.trakt !== order[0];
        const side = hofTrakt ? 1 : (p.seite || (p.room.typ === "Klassenraum" ? "strasse" : "hof")) === "strasse" ? 0 : 1;
        rows[side].push(p); len[side] += p.groesse * UNIT;
      }
      const w = Math.max(len[0], len[1], UNIT);
      maxW = Math.max(maxW, w);
      return { stock, rows, w };
    });
    plans.forEach((pl, lvl) => {
      const col = new THREE.Color(floorColor(lvl)); colorOf.set(pl.stock, col);
      const g = new THREE.Group(); root.add(g);
      floors.push({ stock: pl.stock, lvl, g });
      const slabCol = col.clone().lerp(new THREE.Color(dark ? 0x1a2238 : 0xffffff), dark ? 0.75 : 0.86);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(pl.w + 0.4, SLAB, D + 0.4), new THREE.MeshStandardMaterial({ color: slabCol, roughness: 0.9 }));
      slab.position.set(pl.w / 2, -SLAB / 2, 0); g.add(slab);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(pl.w + 0.4, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: col }));
      edge.position.set(pl.w / 2, 0, D / 2 + 0.2); g.add(edge);
      const furn = { 0: [], 1: [] };
      pl.rows.forEach((row, ri) => {
        let x = 0;
        const z = (ri === 0 ? 1 : -1) * (CORR / 2 + DEPTH / 2); // vorne = Straße
        for (const p of row) {
          const pw = p.groesse * UNIT, w = pw - 0.16, d = DEPTH - 0.16;
          const cx = x + pw / 2; x += pw;
          const room = new THREE.Group(); room.position.set(cx, 0, z);
          const tile = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, 0.08, d - 0.06), new THREE.MeshStandardMaterial({ color: slabCol, roughness: 0.7, transparent: true }));
          tile.position.y = 0.04;
          const glass = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
          glass.position.y = WALL_H / 2; glass.userData.roomId = p.room.id;
          const frame = new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.45 }));
          frame.position.y = WALL_H / 2;
          room.add(tile, glass, frame);
          room.userData = { roomId: p.room.id, tile, glass, frame, kind: "free", target: col.clone(), floorCol: col, slabCol, delay: lvl * 0.07 + Math.random() * 0.25 };
          g.add(room); meshes.set(p.room.id, room);
          for (const [bx, by, bz, sx, sy, sz, dk] of furniture(p.room, pw - 0.3, DEPTH - 0.3)) furn[dk ? 1 : 0].push({ x: cx + bx, y: Math.min(by, WALL_H - 0.1) * 0.8, z: z + bz, sx, sy: sy * 0.8, sz });
        }
      });
      for (const dk of [0, 1]) {
        const items = furn[dk]; if (!items.length) continue;
        const im = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: dk ? (dark ? 0x93a0bd : 0x6b7588) : (dark ? 0xd3dbec : 0xffffff), roughness: 0.7, transparent: true, opacity: dk ? 0.6 : 0.9 }), items.length);
        items.forEach((it, i) => { m4.compose(new THREE.Vector3(it.x, it.y + 0.09, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz)); im.setMatrixAt(i, m4); });
        g.add(im);
      }
      const tag = document.createElement("div"); tag.className = "p3d-tag"; tag.textContent = FLOOR_NAMES(pl.stock); tag.style.background = floorColor(lvl);
      const to = new CSS2DObject(tag); to.position.set(-0.5, 0.3, D / 2); to.center.set(1, 0.5); g.add(to);
    });
    ext = { x0: -LEFT, x1: maxW + (plans.length - 1) * STEP_X + 0.6 };
    fit(); t0 = clock.getElapsedTime();
  }

  // Bildschirm-Höhe eines Punktes bei Blick mit ELEV von vorne oben
  const screenV = (y, z) => y * Math.cos(ELEV) - z * Math.sin(ELEV);
  function fit() {
    const W = container.clientWidth || 360;
    const bandH = D * Math.sin(ELEV) + WALL_H * Math.cos(ELEV) + 0.4;
    const zStep = Math.max(0, (bandH - STEP_Y * Math.cos(ELEV)) / Math.sin(ELEV));
    floors.forEach((f) => f.g.position.set(f.lvl * STEP_X, f.lvl * STEP_Y, -f.lvl * zStep));
    const n = floors.length;
    const vMin = screenV(0, D / 2 + 0.3) - 0.5;
    const vMax = screenV((n - 1) * STEP_Y + WALL_H, -(n - 1) * zStep - D / 2) + 0.6;
    const worldW = ext.x1 - ext.x0, frustH = vMax - vMin;
    const H = Math.round(frustH * (W / worldW));
    container.style.height = H + "px";
    renderer.setSize(W, H); labelR.setSize(W, H);
    camera.left = -worldW / 2; camera.right = worldW / 2; camera.top = frustH / 2; camera.bottom = -frustH / 2;
    camera.updateProjectionMatrix();
    const vMid = (vMin + vMax) / 2;
    const T = new THREE.Vector3((ext.x0 + ext.x1) / 2, vMid / Math.cos(ELEV), 0);
    camera.position.copy(T).add(new THREE.Vector3(0, Math.sin(ELEV), Math.cos(ELEV)).multiplyScalar(300));
    camera.lookAt(T);
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
  let raf; const blue = new THREE.Color(0x1d4ed8);
  function loop() {
    raf = requestAnimationFrame(loop);
    const t = clock.getElapsedTime(), it = t - t0;
    for (const [id, m] of meshes) {
      const u = m.userData, sel = selected === id;
      const k = Math.min(1, Math.max(0, (it - u.delay) * 2.5));
      m.scale.y = Math.max(0.01, k < 1 ? 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2) : 1);
      u.tile.material.color.lerp(u.target, 0.12);
      u.tile.material.emissive.copy(u.target);
      u.tile.material.emissiveIntensity = u.kind === "free" ? 0.2 + 0.08 * Math.sin(t * 2 + u.delay * 9) : 0;
      u.tile.material.opacity = u.kind === "admin" ? 0.5 : 1;
      u.glass.material.opacity += ((sel ? 0.32 : u.kind === "admin" ? 0.03 : 0.07) - u.glass.material.opacity) * 0.15;
      u.frame.material.color.lerp(sel ? blue : u.floorCol, 0.15);
      u.frame.material.opacity += ((sel ? 1 : u.kind === "admin" ? 0.15 : 0.45) - u.frame.material.opacity) * 0.15;
    }
    renderer.render(scene, camera); labelR.render(scene, camera);
  }
  build(rooms, opts.gebaeude); loop();

  return {
    update(states) {
      for (const [id, m] of meshes) {
        const s = states.get(id); if (!s) continue;
        const u = m.userData; u.kind = s.kind;
        if (s.kind === "busy" || s.kind === "reserved") u.target.copy(u.floorCol);
        else if (s.kind === "admin") u.target.copy(u.slabCol);
        else u.target.set(s.color);
      }
    },
    select(id) { selected = id; },
    rebuild(list, gebaeude) { build(list, gebaeude); },
    floors: () => floors.map((f) => f.stock),
    floorColor: (stock) => { const c = colorOf.get(stock); return c ? "#" + c.getHexString() : null; },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); container.innerHTML = ""; },
  };
}
