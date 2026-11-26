// Live-Übersicht: Etagen-Grundrisse untereinander, schlanke Kopfzeile, Einheiten-Leiste unten.

import { h, $, $$ } from "./ui.js";
import { FLOOR_NAMES, roomPlace, setFloorNames } from "./building3d.js";
import { createPlan } from "./plan3d.js";
import { isoDate, parseIso, addDays, mondayOf, weekday, fmtDate, DAY_SHORT, DAY_NAMES, schoolToday, currentPeriod, slotState, byId } from "./model.js";

// Bewusst wenige Farben: grün = frei, grau = besetzt.
export const KIND_COLORS = {
  busy: "#8b97ab", free: "#22c55e", emerg: "#a7e8bd", conflict: "#ef4444", reserved: "#8b97ab", admin: "#dfe3ea",
};

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
    else if (c.groups.length) { kind = "busy"; color = KIND_COLORS.busy; label = G[c.groups[0]]?.name || "?"; }
    else if (c.reserved) { kind = "reserved"; color = KIND_COLORS.reserved; label = "reserviert"; }
    else if (r.notnutzung) { kind = "emerg"; color = KIND_COLORS.emerg; label = "zur Not"; }
    else { kind = "free"; color = KIND_COLORS.free; label = "frei"; }
    out.set(r.id, { kind, color, label, name: r.name, changed: c.changed, cell: c });
  }
  return out;
}

/** host: Element. opts: { canEdit(), onEdit(roomId, iso, period), onSel(sel) } */
export async function mountScene(host, store, opts = {}) {
  const sel = { iso: null, period: null, follow: true, playing: null, room: null };
  setFloorNames(store.data.settings.stockNamen);
  syncNow();
  host.innerHTML = `
    <div class="s3d plan">
      <div class="s3d-hud"><div class="when"></div><div class="free"></div></div>
      <div class="s3d-key"><span><i style="background:#22c55e"></i>frei</span><span><i style="background:linear-gradient(90deg,#5b8def,#9b7bf0,#e5679f,#f0954a)"></i>besetzt (Farbe = Stockwerk)</span></div>
      <div class="s3d-canvas"></div>
      <div class="s3d-bottom glass">
        <div class="days"></div>
        <div class="tl"><button class="play" title="Tag abspielen">▶</button><div class="pers"></div></div>
      </div>
    </div>
    <div class="s3d-info glass" hidden></div>`;
  let b;
  try {
    b = await createPlan($(".s3d-canvas", host), store.data.rooms, { gebaeude: store.data.settings.gebaeude || [], onSelect: (id) => { sel.room = id; b.select(id); renderInfo(); } });
  } catch (e) {
    $(".s3d-canvas", host).innerHTML = `<div class="s3d-fallback">3D wird von diesem Gerät nicht unterstützt (${h(e.message)}).</div>`;
    return { sel, refresh() {}, tick() {}, setSel() {} };
  }
  const sig = () => store.data.rooms.map((r) => [r.id, r.name, r.stock, r.trakt, r.groesse, r.typ, r.sort, r.seite].join("|")).join(";") + JSON.stringify(store.data.settings.gebaeude || []) + JSON.stringify(store.data.settings.stockNamen || {}) + store.data.settings.periods.map((p) => p.nr).join(",");
  let roomSig = sig();
  function syncNow() {
    const now = new Date(); const today = schoolToday(now); const isToday = isoDate(today) === isoDate(now);
    const cp = currentPeriod(store.data.settings.periods, now);
    if (isToday && cp.status !== "nach") { sel.iso = isoDate(today); sel.period = cp.nr; }
    else { sel.iso = isoDate(isToday ? schoolToday(addDays(now, 1)) : today); sel.period = store.data.settings.periods[0]?.nr || 1; }
  }
  const stopPlay = () => { if (sel.playing) { clearInterval(sel.playing); sel.playing = null; $(".play", host).textContent = "▶"; } };

  /** Zusammenhängender Block um die gewählte Einheit: gleicher Zustand/gleiche Klasse */
  function blockAround(d, roomId, period) {
    const ps = [...d.settings.periods].sort((x, y) => x.nr - y.nr);
    const st = ps.map((p) => ({ p, s: roomStates(d, sel.iso, p.nr).get(roomId) }));
    const key = (s) => (s.kind === "busy" || s.kind === "conflict" || s.kind === "reserved" ? "B:" + s.label : "F");
    const i = st.findIndex((x) => x.p.nr === period);
    if (i < 0) return null;
    const k = key(st[i].s);
    let a = i, b = i;
    while (a > 0 && key(st[a - 1].s) === k) a--;
    while (b < st.length - 1 && key(st[b + 1].s) === k) b++;
    const next = st[b + 1];
    let after = null;
    if (next) {
      let c = b + 1; const k2 = key(next.s);
      while (c < st.length - 1 && key(st[c + 1].s) === k2) c++;
      after = { s: next.s, from: next.p, to: st[c].p };
    }
    return { s: st[i].s, from: st[a].p, to: st[b].p, after, all: st };
  }

  function renderInfo() {
    const box = $(".s3d-info", host);
    const d = store.data; const r = d.rooms.find((x) => x.id === sel.room);
    if (!r) { box.hidden = true; return; }
    const G = byId(d.groups);
    const place = roomPlace(r);
    const bl = blockAround(d, r.id, sel.period);
    if (!bl) { box.hidden = true; return; }
    const s = bl.s;
    const isBusyK = ["busy", "conflict", "reserved"].includes(s.kind);
    const isAdmin = s.kind === "admin";
    const range = (f, t) => `${f.start} – ${t.end}`;
    const eh = (f, t) => f.nr === t.nr ? `${f.nr}. EH` : `${f.nr}.–${t.nr}. EH`;
    const why = [s.cell.freedBy.length && !s.cell.groups.length ? `${s.cell.freedBy.map((g) => G[g]?.name).join(", ")} ist nicht da` : "", ...s.cell.notes].filter(Boolean).join(" · ");
    let headline, detail = "", afterTxt = "";
    if (isAdmin) { headline = `<span class="st adm">${h(r.typ)}</span>`; detail = "Wird nicht für Unterricht vergeben."; }
    else if (isBusyK) {
      headline = `<span class="st busy">Besetzt</span><b class="who">${h(s.label)}</b>`;
      detail = `<b>${range(bl.from, bl.to)}</b> <small>${eh(bl.from, bl.to)}</small>`;
    } else {
      headline = `<span class="st free">${s.kind === "emerg" ? "Frei (zur Not)" : "Frei"}</span>`;
      detail = `<b>${range(bl.from, bl.to)}</b> <small>${eh(bl.from, bl.to)}</small>`;
    }
    if (!isAdmin && bl.after) {
      const ab = ["busy", "conflict", "reserved"].includes(bl.after.s.kind);
      afterTxt = ab ? `Danach <b>${h(bl.after.s.label)}</b> ab ${bl.after.from.start} bis ${bl.after.to.end}` : `Danach frei bis ${bl.after.to.end}`;
    } else if (!isAdmin) afterTxt = "Danach Schulschluss";
    const strip = bl.all.map(({ p, s: ss }) => `<button class="mini ${p.nr === sel.period ? "on" : ""} k-${ss.kind}" data-p="${p.nr}" title="${p.nr}. EH ${p.start}: ${h(ss.label)}"><span>${p.nr}</span></button>`).join("");
    box.innerHTML = `
      <div class="row between"><div><b class="nm">${h(r.name)}</b> <small>${FLOOR_NAMES(place.stock)}${r.kapazitaet ? ` · ${r.kapazitaet} Plätze` : ""}</small></div><button class="icon x" aria-label="Schließen">✕</button></div>
      <div class="hl">${headline}</div>
      ${detail ? `<div class="tm">${detail}</div>` : ""}
      ${why ? `<div class="why">${h(why)}</div>` : ""}
      ${afterTxt ? `<div class="after">${afterTxt}</div>` : ""}
      ${isAdmin ? "" : `<div class="strip">${strip}</div>`}
      ${opts.canEdit?.() && !isAdmin ? `<button class="edit">✏️ Ändern</button>` : ""}`;
    box.hidden = false;
    $(".x", box).onclick = () => { sel.room = null; b.select(null); box.hidden = true; };
    $$(".mini", box).forEach((m) => m.onclick = () => { stopPlay(); sel.period = +m.dataset.p; sel.follow = false; refresh(); });
    $(".edit", box)?.addEventListener("click", () => opts.onEdit?.(r.id, sel.iso, sel.period));
  }

  function refresh() {
    const d = store.data;
    if (!d.rooms.length) return;
    const s2 = sig();
    if (s2 !== roomSig) { roomSig = s2; setFloorNames(d.settings.stockNamen); b.rebuild(d.rooms, d.settings.gebaeude || []); renderControls(); }
    const states = roomStates(d, sel.iso, sel.period);
    b.update(states);
    const now = new Date(); const date = parseIso(sel.iso);
    const cp = currentPeriod(d.settings.periods, now);
    const isNow = sel.iso === isoDate(now) && cp.status === "jetzt" && cp.nr === sel.period;
    const per = d.settings.periods.find((p) => p.nr === sel.period);
    const regular = d.rooms.filter((r) => !r.notnutzung && !["Verwaltung", "Nebenraum"].includes(r.typ));
    const free = regular.filter((r) => states.get(r.id).kind === "free").length;
    $(".when", host).innerHTML = `${isNow ? `<span class="live-dot"></span>` : ""}<b>${DAY_SHORT[weekday(date)]} ${fmtDate(date)} · ${sel.period}. EH</b> <span class="muted">${per ? `${per.start}–${per.end}` : ""}</span>${!sel.follow && !sel.playing ? ` <button class="now-btn">Jetzt</button>` : ""}`;
    $(".now-btn", host)?.addEventListener("click", () => { stopPlay(); sel.follow = true; syncNow(); refresh(); });
    $(".free", host).innerHTML = `<b>${free}</b> frei`;
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
    const mon = mondayOf(schoolToday());
    $(".days", host).innerHTML = [1, 2, 3, 4, 5].map((wd) => { const dd = addDays(mon, wd - 1); return `<button data-iso="${isoDate(dd)}">${DAY_SHORT[wd]} <small>${fmtDate(dd)}</small></button>`; }).join("");
    $$(".days button", host).forEach((x) => x.onclick = () => { stopPlay(); sel.iso = x.dataset.iso; sel.follow = false; refresh(); });
    $(".pers", host).innerHTML = d.settings.periods.map((p) => `<button data-p="${p.nr}"><span>${p.nr}</span></button>`).join("");
    $$(".pers button", host).forEach((x) => x.onclick = () => { stopPlay(); sel.period = +x.dataset.p; sel.follow = false; refresh(); });
  }

  $(".play", host).onclick = () => {
    if (sel.playing) { stopPlay(); refresh(); return; }
    const ps = store.data.settings.periods.map((p) => p.nr);
    sel.follow = false;
    let i = ps.indexOf(sel.period); if (i < 0 || i >= ps.length - 1) i = -1;
    const step = () => { i++; if (i >= ps.length) { stopPlay(); refresh(); return; } sel.period = ps[i]; refresh(); };
    $(".play", host).textContent = "⏸"; sel.playing = setInterval(step, 1500); step();
  };

  renderControls();
  refresh();
  return {
    sel,
    refresh() { refresh(); },
    tick() { if (sel.follow && !sel.playing) syncNow(); refresh(); },
    setSel(iso, period) { stopPlay(); sel.iso = iso; sel.period = period; sel.follow = false; refresh(); },
  };
}
