// Live-3D-Übersicht mit Bedienelementen (Stockwerk, Tag, Einheit, Abspielen, Raum-Info).

import { h, $, $$ } from "./ui.js";
import { createBuilding, FLOOR_NAMES, roomPlace } from "./building3d.js";
import { isoDate, parseIso, addDays, mondayOf, weekday, fmtDate, DAY_SHORT, DAY_NAMES, schoolToday, currentPeriod, slotState, isBusy, byId } from "./model.js";

export const KIND_COLORS = {
  NMS: "#3b6cf6", PTS: "#8b5cf6", VS: "#0bb4d4", Hort: "#f59e0b", gemeinsam: "#64748b",
  free: "#22c55e", emerg: "#facc15", conflict: "#ef4444", reserved: "#94a3b8",
};

/** Zustand pro Raum für die 3D-Ansicht */
export function roomStates(data, iso, period) {
  const G = byId(data.groups);
  const st = slotState(data, iso, period);
  const out = new Map();
  for (const r of data.rooms) {
    const c = st.get(r.id);
    let kind, color, label;
    if (c.groups.length > 1) { kind = "conflict"; color = KIND_COLORS.conflict; label = c.groups.map((g) => G[g]?.name).join("+"); }
    else if (c.groups.length) { kind = "busy"; const b = G[c.groups[0]]?.bereich || r.bereich; color = KIND_COLORS[b] || KIND_COLORS.gemeinsam; label = G[c.groups[0]]?.name || "?"; }
    else if (c.reserved) { kind = "reserved"; color = KIND_COLORS.reserved; label = "reserviert"; }
    else if (r.notnutzung) { kind = "emerg"; color = KIND_COLORS.emerg; label = "zur Not"; }
    else { kind = "free"; color = KIND_COLORS.free; label = "frei"; }
    out.set(r.id, { kind, color, label, name: r.name, changed: c.changed, cell: c });
  }
  return out;
}

/**
 * host: Element. opts: { canEdit, onEdit(roomId, iso, period), onSel(sel) }
 * Gibt { sel, refresh, setSel } zurück.
 */
export async function mountScene(host, store, opts = {}) {
  const sel = { iso: null, period: null, follow: true, floor: null, exploded: true, playing: null, room: null, labels: true };
  syncNow();
  host.innerHTML = `
    <div class="s3d">
      <div class="s3d-canvas"></div>
      <div class="s3d-top">
        <div class="glass when"></div>
        <div class="glass stat"></div>
      </div>
      <div class="s3d-side">
        <div class="glass floors"></div>
        <div class="glass tools">
          <button title="Stockwerke auffächern / zusammen" data-t="explode">⇕</button>
          <button title="Drehen an/aus" data-t="rotate" class="on">⟳</button>
          <button title="Beschriftung" data-t="labels" class="on">🏷️</button>
          <button title="Ansicht zurücksetzen" data-t="reset">⌂</button>
        </div>
      </div>
      <div class="s3d-info glass" hidden></div>
      <div class="s3d-bottom glass">
        <div class="days chips"></div>
        <div class="tl"><button class="play" title="Tag abspielen">▶</button><div class="pers"></div></div>
      </div>
    </div>
    <div class="legend s3d-legend">
      <span><i style="background:${KIND_COLORS.free}"></i>frei</span><span><i style="background:${KIND_COLORS.emerg}"></i>zur Not</span>
      <span><i style="background:${KIND_COLORS.NMS}"></i>NMS</span><span><i style="background:${KIND_COLORS.PTS}"></i>PTS</span>
      <span><i style="background:${KIND_COLORS.VS}"></i>VS</span><span><i style="background:${KIND_COLORS.Hort}"></i>Hort</span>
      <span><i style="background:${KIND_COLORS.gemeinsam}"></i>gemeinsam</span><span><i style="background:${KIND_COLORS.conflict}"></i>doppelt</span>
      <span><i style="background:#e11d74;border-radius:2px;transform:rotate(45deg);width:9px;height:9px"></i>geändert</span>
    </div>`;
  const canvasBox = $(".s3d-canvas", host);
  let b;
  try {
    b = await createBuilding(canvasBox, store.data.rooms, { onSelect: (id) => { sel.room = id; b.select(id); renderInfo(); } });
  } catch (e) {
    canvasBox.innerHTML = `<div class="s3d-fallback">3D wird von diesem Gerät nicht unterstützt (${h(e.message)}).</div>`;
    return { sel, refresh() {}, setSel() {} };
  }
  let roomSig = sig(store.data.rooms);

  function sig(rooms) { return rooms.map((r) => [r.id, r.name, r.stock, r.trakt, r.groesse, r.typ, r.bereich].join("|")).join(";"); }
  function syncNow() {
    const now = new Date(); const today = schoolToday(now); const isToday = isoDate(today) === isoDate(now);
    const cp = currentPeriod(store.data.settings.periods, now);
    if (isToday && cp.status !== "nach") { sel.iso = isoDate(today); sel.period = cp.nr; }
    else { sel.iso = isoDate(isToday ? schoolToday(addDays(now, 1)) : today); sel.period = store.data.settings.periods[0]?.nr || 1; }
  }

  function renderInfo() {
    const box = $(".s3d-info", host);
    const d = store.data; const r = d.rooms.find((x) => x.id === sel.room);
    if (!r) { box.hidden = true; return; }
    const G = byId(d.groups);
    const states = roomStates(d, sel.iso, sel.period); const s = states.get(r.id);
    const place = roomPlace(r);
    const strip = d.settings.periods.map((p) => {
      const ss = roomStates(d, sel.iso, p.nr).get(r.id);
      return `<button class="mini ${p.nr === sel.period ? "on" : ""}" data-p="${p.nr}" style="background:${ss.color}" title="${p.nr}. EH: ${h(ss.label)}">${p.nr}</button>`;
    }).join("");
    const why = [s.cell.freedBy.length && !s.cell.groups.length ? `${s.cell.freedBy.map((g) => G[g]?.name).join(", ")} nicht da` : "", ...s.cell.notes].filter(Boolean).join(" · ");
    box.innerHTML = `
      <div class="row between"><div><b class="nm">${h(r.name)}</b> <small>${h(r.typ)} · ${h(place.trakt)} ${FLOOR_NAMES(place.stock)}${r.kapazitaet ? ` · ${r.kapazitaet} Pl.` : ""}</small></div><button class="icon x">✕</button></div>
      <div class="now"><i style="background:${s.color}"></i><b>${h(s.label)}</b>${s.changed ? ` <span class="badge info">geändert</span>` : ""}${why ? `<small> · ${h(why)}</small>` : ""}</div>
      <div class="strip">${strip}</div>
      ${opts.canEdit?.() ? `<button class="edit">✏️ Diese Einheit ändern</button>` : ""}`;
    box.hidden = false;
    $(".x", box).onclick = () => { sel.room = null; b.select(null); box.hidden = true; };
    $$(".mini", box).forEach((m) => m.onclick = () => { sel.period = +m.dataset.p; sel.follow = false; stopPlay(); refresh(); });
    $(".edit", box)?.addEventListener("click", () => opts.onEdit?.(r.id, sel.iso, sel.period));
  }

  function stopPlay() { if (sel.playing) { clearInterval(sel.playing); sel.playing = null; } }

  function refresh() {
    const d = store.data;
    if (!d.rooms.length) return;
    const s2 = sig(d.rooms);
    if (s2 !== roomSig) { roomSig = s2; b.rebuild(d.rooms); b.setFloor(sel.floor); b.setExploded(sel.exploded); }
    const states = roomStates(d, sel.iso, sel.period);
    b.update(states);
    const now = new Date(); const date = parseIso(sel.iso);
    const cp = currentPeriod(d.settings.periods, now);
    const isNow = sel.iso === isoDate(now) && cp.status === "jetzt" && cp.nr === sel.period;
    const per = d.settings.periods.find((p) => p.nr === sel.period);
    const regular = d.rooms.filter((r) => !r.notnutzung);
    const free = regular.filter((r) => states.get(r.id).kind === "free").length;
    const emerg = d.rooms.filter((r) => states.get(r.id).kind === "emerg").length;
    const pct = regular.length ? (regular.length - free) / regular.length : 0;
    $(".when", host).innerHTML = `
      <div class="lv">${isNow ? `<span class="live-dot"></span> LIVE` : sel.playing ? "▶ Wiedergabe" : sel.iso === isoDate(now) ? "Heute" : DAY_NAMES[weekday(date)]}</div>
      <div class="dt">${DAY_SHORT[weekday(date)]} ${fmtDate(date)} · <b>${sel.period}. EH</b></div>
      <div class="tm">${per ? `${per.start}–${per.end}` : ""}${!sel.follow ? ` <button class="small now-btn">Jetzt</button>` : ""}</div>`;
    $(".now-btn", host)?.addEventListener("click", () => { stopPlay(); sel.follow = true; syncNow(); renderControls(); refresh(); });
    const C = 2 * Math.PI * 16;
    $(".stat", host).innerHTML = `
      <svg viewBox="0 0 40 40" class="ring"><circle cx="20" cy="20" r="16" class="bg"/><circle cx="20" cy="20" r="16" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - pct)}"/></svg>
      <div><div class="big">${free}</div><div class="sm">frei${emerg ? ` · +${emerg} zur Not` : ""}</div><div class="sm">${Math.round(pct * 100)} % belegt</div></div>`;
    $$(".pers button", host).forEach((x) => x.classList.toggle("on", +x.dataset.p === sel.period));
    $$(".days button", host).forEach((x) => x.classList.toggle("on", x.dataset.iso === sel.iso));
    // farbige Mini-Auslastung je Einheit in der Zeitleiste
    $$(".pers button", host).forEach((x) => {
      const ss = roomStates(d, sel.iso, +x.dataset.p);
      const f = regular.filter((r) => ss.get(r.id).kind === "free").length;
      x.style.setProperty("--fill", `${regular.length ? Math.round(((regular.length - f) / regular.length) * 100) : 0}%`);
      x.title = `${x.dataset.p}. EH: ${f} frei`;
    });
    if (sel.room) renderInfo();
    opts.onSel?.(sel);
  }

  function renderControls() {
    const d = store.data;
    const floors = b.floors();
    $(".floors", host).innerHTML = [`<button data-f="" class="${sel.floor === null ? "on" : ""}">Alle</button>`, ...[...floors].reverse().map((f) => `<button data-f="${f}" class="${sel.floor === f ? "on" : ""}">${FLOOR_NAMES(f)}</button>`)].join("");
    $$(".floors button", host).forEach((x) => x.onclick = () => { sel.floor = x.dataset.f === "" ? null : +x.dataset.f; b.setFloor(sel.floor); renderControls(); });
    const mon = mondayOf(schoolToday());
    $(".days", host).innerHTML = [1, 2, 3, 4, 5].map((wd) => { const dd = addDays(mon, wd - 1); return `<button class="chip" data-iso="${isoDate(dd)}">${DAY_SHORT[wd]}<small>${fmtDate(dd)}</small></button>`; }).join("");
    $$(".days button", host).forEach((x) => x.onclick = () => { stopPlay(); sel.iso = x.dataset.iso; sel.follow = false; refresh(); });
    $(".pers", host).innerHTML = d.settings.periods.map((p) => `<button data-p="${p.nr}"><span>${p.nr}</span></button>`).join("");
    $$(".pers button", host).forEach((x) => x.onclick = () => { stopPlay(); sel.period = +x.dataset.p; sel.follow = false; refresh(); });
    $(".play", host).textContent = sel.playing ? "⏸" : "▶";
  }

  $(".play", host).onclick = () => {
    if (sel.playing) { stopPlay(); $(".play", host).textContent = "▶"; refresh(); return; }
    const ps = store.data.settings.periods.map((p) => p.nr);
    sel.follow = false;
    let i = ps.indexOf(sel.period); if (i < 0 || i >= ps.length - 1) i = -1;
    const step = () => { i++; if (i >= ps.length) { stopPlay(); $(".play", host).textContent = "▶"; refresh(); return; } sel.period = ps[i]; refresh(); };
    step(); sel.playing = setInterval(step, 1500); $(".play", host).textContent = "⏸";
  };
  $$(".tools button", host).forEach((x) => x.onclick = () => {
    const t = x.dataset.t;
    if (t === "explode") { sel.exploded = !sel.exploded; b.setExploded(sel.exploded); x.classList.toggle("on", !sel.exploded); }
    if (t === "rotate") { const on = !x.classList.contains("on"); x.classList.toggle("on", on); b.setAutoRotate(on); }
    if (t === "labels") { sel.labels = !sel.labels; x.classList.toggle("on", sel.labels); host.querySelector(".s3d").classList.toggle("no-labels", !sel.labels); }
    if (t === "reset") b.resetView();
  });

  renderControls();
  refresh();
  return {
    sel,
    refresh() { renderControls(); refresh(); },
    tick() { if (sel.follow && !sel.playing) { syncNow(); refresh(); } else refresh(); },
    setSel(iso, period) { stopPlay(); sel.iso = iso; sel.period = period; sel.follow = false; refresh(); },
  };
}
