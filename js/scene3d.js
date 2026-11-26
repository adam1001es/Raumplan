// Live-3D-Übersicht mit schlanken Bedienelementen (Stockwerk, Tag, Einheit, Abspielen, Raum-Info).

import { h, $, $$ } from "./ui.js";
import { createBuilding, FLOOR_NAMES, roomPlace, setFloorNames } from "./building3d.js";
import { isoDate, parseIso, addDays, mondayOf, weekday, fmtDate, DAY_SHORT, DAY_NAMES, schoolToday, currentPeriod, slotState, byId } from "./model.js";

export const KIND_COLORS = {
  NMS: "#3b6cf6", PTS: "#8b5cf6", VS: "#0bb4d4", Hort: "#f59e0b", gemeinsam: "#64748b",
  free: "#22c55e", emerg: "#facc15", conflict: "#ef4444", reserved: "#94a3b8", admin: "#c3cad6",
};
const LABEL_MODES = [["free", "Nur freie Räume beschriftet"], ["all", "Alle Räume beschriftet"], ["none", "Keine Beschriftung"]];

/** Zustand pro Raum für die 3D-Ansicht */
export function roomStates(data, iso, period) {
  const G = byId(data.groups);
  const st = slotState(data, iso, period);
  const out = new Map();
  for (const r of data.rooms) {
    const c = st.get(r.id);
    let kind, color, label;
    if (["Verwaltung", "Nebenraum"].includes(r.typ)) { kind = "admin"; color = KIND_COLORS.admin; label = r.typ; }
    else if (c.groups.length > 1) { kind = "conflict"; color = KIND_COLORS.conflict; label = c.groups.map((g) => G[g]?.name).join("+"); }
    else if (c.groups.length) { kind = "busy"; const b = G[c.groups[0]]?.bereich || r.bereich; color = KIND_COLORS[b] || KIND_COLORS.gemeinsam; label = G[c.groups[0]]?.name || "?"; }
    else if (c.reserved) { kind = "reserved"; color = KIND_COLORS.reserved; label = "reserviert"; }
    else if (r.notnutzung) { kind = "emerg"; color = KIND_COLORS.emerg; label = "zur Not"; }
    else { kind = "free"; color = KIND_COLORS.free; label = "frei"; }
    out.set(r.id, { kind, color, label, name: r.name, changed: c.changed, cell: c });
  }
  return out;
}

/** host: Element. opts: { canEdit(), onEdit(roomId, iso, period), onSel(sel) } */
export async function mountScene(host, store, opts = {}) {
  const sel = { iso: null, period: null, follow: true, floor: null, exploded: false, playing: null, room: null, labels: "free" };
  try { sel.labels = localStorage.getItem("raumplan-labels") || "free"; } catch {}
  setFloorNames(store.data.settings.stockNamen);
  syncNow();
  host.innerHTML = `
    <div class="s3d">
      <div class="s3d-canvas"></div>
      <div class="s3d-hud glass">
        <div class="when"></div>
        <div class="free"></div>
      </div>
      <div class="s3d-rail">
        <div class="glass floors"></div>
        <div class="glass tools">
          <button data-t="labels" title="Beschriftung">🏷️</button>
          <button data-t="explode" title="Stockwerke auseinanderziehen">⇕</button>
          <button data-t="reset" title="Ansicht zurücksetzen">⌂</button>
        </div>
      </div>
      <div class="s3d-info glass" hidden></div>
      <div class="s3d-bottom glass">
        <div class="days"></div>
        <div class="tl"><button class="play" title="Tag abspielen">▶</button><div class="pers"></div></div>
      </div>
    </div>
    <div class="legend s3d-legend">
      <span><i style="background:${KIND_COLORS.free}"></i>frei</span><span><i style="background:${KIND_COLORS.emerg}"></i>zur Not</span>
      <span><i style="background:${KIND_COLORS.NMS}"></i>NMS</span><span><i style="background:${KIND_COLORS.PTS}"></i>PTS</span>
      <span><i style="background:${KIND_COLORS.VS}"></i>VS</span><span><i style="background:${KIND_COLORS.Hort}"></i>Hort</span>
      <span><i style="background:${KIND_COLORS.gemeinsam}"></i>gemeinsam</span><span><i style="background:${KIND_COLORS.conflict}"></i>doppelt</span>
      <span><i style="background:#e11d74;transform:rotate(45deg) scale(.75)"></i>geändert</span>
    </div>`;
  const s3d = $(".s3d", host);
  let b;
  try {
    b = await createBuilding($(".s3d-canvas", host), store.data.rooms, { gebaeude: store.data.settings.gebaeude || [], labels: sel.labels, onSelect: (id) => { sel.room = id; b.select(id); renderInfo(); } });
  } catch (e) {
    $(".s3d-canvas", host).innerHTML = `<div class="s3d-fallback">3D wird von diesem Gerät nicht unterstützt (${h(e.message)}).</div>`;
    return { sel, refresh() {}, tick() {}, setSel() {} };
  }
  let roomSig = sig(store.data.rooms) + "#" + store.data.settings.periods.map((p) => p.nr).join(",");
  function sig(rooms) { return rooms.map((r) => [r.id, r.name, r.stock, r.trakt, r.groesse, r.typ, r.bereich, r.sort, r.seite].join("|")).join(";") + JSON.stringify(store.data.settings.gebaeude || []) + JSON.stringify(store.data.settings.stockNamen || {}); }
  function syncNow() {
    const now = new Date(); const today = schoolToday(now); const isToday = isoDate(today) === isoDate(now);
    const cp = currentPeriod(store.data.settings.periods, now);
    if (isToday && cp.status !== "nach") { sel.iso = isoDate(today); sel.period = cp.nr; }
    else { sel.iso = isoDate(isToday ? schoolToday(addDays(now, 1)) : today); sel.period = store.data.settings.periods[0]?.nr || 1; }
  }
  const stopPlay = () => { if (sel.playing) { clearInterval(sel.playing); sel.playing = null; $(".play", host).textContent = "▶"; } };

  function renderInfo() {
    const box = $(".s3d-info", host);
    const d = store.data; const r = d.rooms.find((x) => x.id === sel.room);
    if (!r) { box.hidden = true; return; }
    const G = byId(d.groups);
    const s = roomStates(d, sel.iso, sel.period).get(r.id);
    const place = roomPlace(r);
    const strip = d.settings.periods.map((p) => {
      const ss = roomStates(d, sel.iso, p.nr).get(r.id);
      return `<button class="mini ${p.nr === sel.period ? "on" : ""}" data-p="${p.nr}" style="background:${ss.color}" title="${p.nr}. EH: ${h(ss.label)}">${p.nr}</button>`;
    }).join("");
    const why = [s.cell.freedBy.length && !s.cell.groups.length ? `${s.cell.freedBy.map((g) => G[g]?.name).join(", ")} nicht da` : "", ...s.cell.notes].filter(Boolean).join(" · ");
    box.innerHTML = `
      <div class="row between"><div><b class="nm">${h(r.name)}</b> <small>${FLOOR_NAMES(place.stock)}${r.kapazitaet ? ` · ${r.kapazitaet} Pl.` : ""}</small></div><button class="icon x">✕</button></div>
      <div class="now"><i style="background:${s.color}"></i><b>${h(s.label)}</b>${why ? `<small>${h(why)}</small>` : ""}</div>
      <div class="strip">${strip}</div>
      ${opts.canEdit?.() ? `<button class="edit">✏️ Ändern</button>` : ""}`;
    box.hidden = false;
    $(".x", box).onclick = () => { sel.room = null; b.select(null); box.hidden = true; };
    $$(".mini", box).forEach((m) => m.onclick = () => { stopPlay(); sel.period = +m.dataset.p; sel.follow = false; refresh(); });
    $(".edit", box)?.addEventListener("click", () => opts.onEdit?.(r.id, sel.iso, sel.period));
  }

  function refresh() {
    const d = store.data;
    if (!d.rooms.length) return;
    const s2 = sig(d.rooms) + "#" + d.settings.periods.map((p) => p.nr).join(",");
    if (s2 !== roomSig) { roomSig = s2; setFloorNames(d.settings.stockNamen); b.rebuild(d.rooms, d.settings.gebaeude || []); b.setFloor(sel.floor); b.setExploded(sel.exploded); renderControls(); }
    const states = roomStates(d, sel.iso, sel.period);
    b.update(states);
    const now = new Date(); const date = parseIso(sel.iso);
    const cp = currentPeriod(d.settings.periods, now);
    const isNow = sel.iso === isoDate(now) && cp.status === "jetzt" && cp.nr === sel.period;
    const per = d.settings.periods.find((p) => p.nr === sel.period);
    const regular = d.rooms.filter((r) => !r.notnutzung && !["Verwaltung", "Nebenraum"].includes(r.typ));
    const free = regular.filter((r) => states.get(r.id).kind === "free").length;
    const emerg = d.rooms.filter((r) => states.get(r.id).kind === "emerg").length;
    $(".when", host).innerHTML = `
      <div class="lv">${isNow ? `<span class="live-dot"></span>Live` : sel.playing ? "▶ Tagesablauf" : sel.iso === isoDate(now) ? "Heute" : DAY_NAMES[weekday(date)]}${!sel.follow && !sel.playing ? `<button class="now-btn">Jetzt</button>` : ""}</div>
      <div class="dt">${DAY_SHORT[weekday(date)]} ${fmtDate(date)} · <b>${sel.period}. EH</b></div>
      <div class="tm">${per ? `${per.start}–${per.end}` : ""}</div>`;
    $(".now-btn", host)?.addEventListener("click", () => { stopPlay(); sel.follow = true; syncNow(); refresh(); });
    $(".free", host).innerHTML = `<div class="big">${free}</div><div class="sm">frei${emerg ? `<br>+${emerg} zur Not` : ""}</div>`;
    $$(".pers button", host).forEach((x) => {
      const p = +x.dataset.p; x.classList.toggle("on", p === sel.period);
      const ss = roomStates(d, sel.iso, p);
      const f = regular.filter((r) => ss.get(r.id).kind === "free").length;
      x.style.setProperty("--fill", `${regular.length ? Math.round(((regular.length - f) / regular.length) * 100) : 0}%`);
      x.title = `${p}. EH: ${f} frei`;
    });
    $$(".days button", host).forEach((x) => x.classList.toggle("on", x.dataset.iso === sel.iso));
    if (sel.room) renderInfo();
    opts.onSel?.(sel);
  }

  function renderControls() {
    const d = store.data;
    $(".floors", host).innerHTML = [`<button data-f="" class="${sel.floor === null ? "on" : ""}">Alle</button>`, ...[...b.floors()].reverse().map((f) => `<button data-f="${f}" class="${sel.floor === f ? "on" : ""}">${FLOOR_NAMES(f)}</button>`)].join("");
    $$(".floors button", host).forEach((x) => x.onclick = () => { sel.floor = x.dataset.f === "" ? null : +x.dataset.f; b.setFloor(sel.floor); renderControls(); refresh(); });
    const mon = mondayOf(schoolToday());
    $(".days", host).innerHTML = [1, 2, 3, 4, 5].map((wd) => { const dd = addDays(mon, wd - 1); return `<button data-iso="${isoDate(dd)}" class="${isoDate(dd) === sel.iso ? "on" : ""}">${DAY_SHORT[wd]} <small>${fmtDate(dd)}</small></button>`; }).join("");
    $$(".days button", host).forEach((x) => x.onclick = () => { stopPlay(); sel.iso = x.dataset.iso; sel.follow = false; refresh(); });
    $(".pers", host).innerHTML = d.settings.periods.map((p) => `<button data-p="${p.nr}"><span>${p.nr}</span></button>`).join("");
    $$(".pers button", host).forEach((x) => x.onclick = () => { stopPlay(); sel.period = +x.dataset.p; sel.follow = false; refresh(); });
    const lb = $("[data-t=labels]", host); lb.title = LABEL_MODES.find(([k]) => k === sel.labels)[1]; lb.dataset.mode = sel.labels;
    $("[data-t=explode]", host).classList.toggle("on", sel.exploded);
  }

  $(".play", host).onclick = () => {
    if (sel.playing) { stopPlay(); refresh(); return; }
    const ps = store.data.settings.periods.map((p) => p.nr);
    sel.follow = false;
    let i = ps.indexOf(sel.period); if (i < 0 || i >= ps.length - 1) i = -1;
    const step = () => { i++; if (i >= ps.length) { stopPlay(); refresh(); return; } sel.period = ps[i]; refresh(); };
    $(".play", host).textContent = "⏸"; sel.playing = setInterval(step, 1500); step();
  };
  $$(".tools button", host).forEach((x) => x.onclick = () => {
    const t = x.dataset.t;
    if (t === "explode") { sel.exploded = !sel.exploded; b.setExploded(sel.exploded); }
    if (t === "labels") {
      const i = LABEL_MODES.findIndex(([k]) => k === sel.labels);
      sel.labels = LABEL_MODES[(i + 1) % LABEL_MODES.length][0];
      try { localStorage.setItem("raumplan-labels", sel.labels); } catch {}
      b.setLabels(sel.labels);
      const toast = document.createElement("div"); toast.className = "s3d-toast"; toast.textContent = LABEL_MODES.find(([k]) => k === sel.labels)[1];
      s3d.appendChild(toast); setTimeout(() => toast.remove(), 1600);
    }
    if (t === "reset") { sel.floor = null; b.setFloor(null); b.resetView(); }
    renderControls(); refresh();
  });

  renderControls();
  refresh();
  return {
    sel,
    refresh() { refresh(); },
    tick() { if (sel.follow && !sel.playing) syncNow(); refresh(); },
    setSel(iso, period) { stopPlay(); sel.iso = iso; sel.period = period; sel.follow = false; refresh(); },
  };
}
