// Wiederverwendbare Darstellungen (Raumkarten, Wochenraster, Änderungsliste, Legende).

import { h } from "./ui.js";
import { slotState, isBusy, byId, bereichClass, DAY_SHORT, weekday, parseIso, fmtDate, bookable } from "./model.js";
import { fmtPeriods } from "./parser.js";

export function legendHtml() {
  return `<div class="legend">
    <span class="b-nms"><i></i>NMS</span><span class="b-pts"><i></i>PTS</span><span class="b-vs"><i></i>Volksschule</span>
    <span class="b-hort"><i></i>Hort</span><span class="b-gem"><i></i>Gemeinsam</span>
    <span><i class="free"></i>frei</span><span><i class="emerg"></i>zur Not nutzbar</span><span><i class="chg"></i>geändert</span></div>`;
}

/** Raumkarten für Datum + Einheit. opts: {filter, search, clickable} */
export function roomCardsHtml(data, iso, period, opts = {}) {
  const G = byId(data.groups);
  const st = slotState(data, iso, period);
  const q = (opts.search || "").toLowerCase().trim();
  let rooms = data.rooms.filter(bookable);
  if (opts.filter && opts.filter !== "alle") {
    if (opts.filter === "frei") rooms = rooms.filter((r) => !isBusy(st.get(r.id)));
    else rooms = rooms.filter((r) => r.bereich === opts.filter || st.get(r.id).groups.some((g) => G[g]?.bereich === opts.filter));
  }
  if (q) rooms = rooms.filter((r) => r.name.toLowerCase().includes(q) || r.typ.toLowerCase().includes(q) || st.get(r.id).groups.some((g) => G[g]?.name.toLowerCase().includes(q)));
  if (!rooms.length) return `<p class="muted">Keine Räume für diese Auswahl.</p>`;
  return `<div class="rooms">${rooms.map((r) => {
    const c = st.get(r.id);
    const busy = isBusy(c);
    const g0 = G[c.groups[0]];
    const cls = busy ? `busy ${bereichClass(g0?.bereich || r.bereich)}` : "free";
    const label = c.groups.length ? c.groups.map((g) => h(G[g]?.name || "?")).join(" + ") : c.reserved ? "reserviert" : r.notnutzung ? "zur Not frei" : "frei";
    const freedNote = !busy && c.freedBy.length ? `${c.freedBy.map((g) => G[g]?.name).filter(Boolean).join(", ")} nicht da` : "";
    const note = [freedNote, ...c.notes].filter(Boolean).join(" · ");
    return `<div class="room ${cls} ${r.notnutzung ? "emerg" : ""} ${c.groups.length > 1 ? "conflict" : ""} ${opts.clickable ? "click" : ""}" data-room="${h(r.id)}">
      <div class="n"><span>${h(r.name)}</span>${c.changed ? `<span class="dot" title="geändert"></span>` : ""}</div>
      <div class="ty">${h(r.typ)}${r.kapazitaet ? ` · ${r.kapazitaet} Pl.` : ""}</div>
      <div class="g">${label}</div>
      ${note ? `<div class="note" title="${h(note)}">${h(note)}</div>` : ""}
    </div>`;
  }).join("")}</div>`;
}

/**
 * Raster Räume × Einheiten.
 * mode 'date': tatsächliche Belegung an iso; mode 'plan': regulärer Wochenplan am Wochentag day.
 */
export function planTableHtml(data, { mode, iso, day, nowPeriod, clickable, bereich }) {
  const G = byId(data.groups);
  const periods = [...data.settings.periods].sort((a, b) => a.nr - b.nr);
  const states = {};
  for (const p of periods) {
    if (mode === "date") states[p.nr] = slotState(data, iso, p.nr);
    else {
      const m = new Map(data.rooms.map((r) => [r.id, { groups: [], changed: false, notes: [], freedBy: [], reserved: false }]));
      for (const s of data.schedule) if (s.day === day && s.period === p.nr && m.has(s.room_id)) m.get(s.room_id).groups.push(s.group_id);
      states[p.nr] = m;
    }
  }
  let rooms = data.rooms.filter(bookable);
  if (bereich && bereich !== "alle") rooms = rooms.filter((r) => r.bereich === bereich);
  const head = `<tr><th class="rn">Raum</th>${periods.map((p) => `<th>${p.nr}.<small>${h(p.start)}</small></th>`).join("")}</tr>`;
  const body = rooms.map((r) => `<tr><th class="rn">${h(r.name)}<small>${h(r.typ)}</small></th>${periods.map((p) => {
    const c = states[p.nr].get(r.id);
    const g0 = G[c.groups[0]];
    let cls = "free";
    if (c.groups.length > 1) cls = "conflict";
    else if (c.groups.length) cls = `busy ${bereichClass(g0?.bereich || r.bereich)}`;
    else if (c.reserved) cls = "reserved";
    else if (c.freedBy.length) cls = "freed";
    if (r.notnutzung && cls === "free") cls += " emerg";
    if (c.changed) cls += " chg";
    if (nowPeriod === p.nr) cls += " now";
    const txt = c.groups.length ? c.groups.map((g) => h(G[g]?.name || "?")).join("+") : c.reserved ? "res." : "";
    const title = [r.name, `${p.nr}. EH`, c.groups.map((g) => G[g]?.name).join(" + ") || (c.reserved ? "reserviert" : "frei"), ...c.notes].join(" · ");
    return `<td class="${clickable ? "click" : ""}"><div class="cell ${cls}" data-room="${h(r.id)}" data-period="${p.nr}" title="${h(title)}">${txt}</div></td>`;
  }).join("")}</tr>`).join("");
  return `<div class="grid-wrap"><table class="plan"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/** Änderungsliste. opts: {canDelete(c), limit, profiles} */
export function changeLogHtml(data, changes, opts = {}) {
  const R = byId(data.rooms), G = byId(data.groups), P = byId(data.profiles || []);
  // gleichzeitige Einträge desselben Satzes zusammenfassen
  const groups = [];
  for (const c of [...changes].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))) {
    const last = groups[groups.length - 1];
    if (last && last.text === c.text && last.datum === c.datum && last.art === c.art && Math.abs(new Date(last.created_at) - new Date(c.created_at)) < 5000) { last.items.push(c); continue; }
    groups.push({ ...c, items: [c] });
  }
  const list = groups.slice(0, opts.limit || 30);
  if (!list.length) return `<p class="muted">Noch keine Änderungen.</p>`;
  return `<div class="log">${list.map((g) => {
    const d = parseIso(g.datum);
    const periods = [...new Set(g.items.map((i) => i.period))].sort((a, b) => a - b);
    const roomsTxt = [...new Set(g.items.map((i) => R[i.room_id]?.name).filter(Boolean))].join(", ");
    const what = g.art === "info" ? h(g.text) :
      `<b>${h(g.group_id ? G[g.group_id]?.name : roomsTxt)}</b> ${g.art === "frei" ? (g.group_id ? `nicht da → ${h(roomsTxt)} frei` : "frei") : (g.group_id ? `→ ${h(roomsTxt)}` : "reserviert")}${g.note ? ` <span class="muted">(${h(g.note)})</span>` : ""}`;
    const who = P[g.created_by]?.name || P[g.created_by]?.email || "";
    const at = g.created_at ? new Date(g.created_at) : null;
    const ids = g.items.map((i) => i.id).join(",");
    return `<div class="it">
      <span class="badge ${h(g.art)}">${g.art === "info" ? "Plan" : g.art}</span>
      <div class="tx">${what}<div class="meta">${g.art === "info" ? "dauerhaft" : `${DAY_SHORT[weekday(d)]} ${fmtDate(d)} · ${fmtPeriods(periods)}`}${who ? ` · ${h(who)}` : ""}${at ? ` · ${at.toLocaleString("de-AT", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}</div></div>
      ${opts.canDelete && opts.canDelete(g) ? `<button class="icon" data-del="${h(ids)}" title="Löschen">✕</button>` : ""}
    </div>`;
  }).join("")}</div>`;
}
