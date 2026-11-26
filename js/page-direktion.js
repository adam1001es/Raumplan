// Direktion (Master): Live-Monitoring, Woche, Auslastung, Tipps, Einstellungen.

import { bootPage, $, $$, h, toast, everyMinute } from "./ui.js";
import { ROLE_LABEL, buildDemoData } from "./store.js";
import {
  isoDate, parseIso, addDays, mondayOf, weekday, fmtDate, DAY_SHORT, DAY_NAMES, BEREICHE, ROOM_TYPES,
  schoolToday, currentPeriod, slotState, isBusy, weekUtil, byId, bereichClass,
} from "./model.js";
import { roomCardsHtml, planTableHtml, legendHtml, changeLogHtml } from "./views.js";
import { computeTips } from "./tips.js";
import { fmtPeriods } from "./parser.js";

const { store, gate } = await bootPage({ need: "master", page: "direktion.html" });
const app = $("#app");

const st = {
  tab: sessionStorage.getItem("dir-tab") || "live",
  follow: true, iso: null, period: null,
  weekOffset: 0, planMode: "date", day: null, bereich: "alle",
  filter: "alle", search: "",
};
function syncNow() {
  const now = new Date();
  const today = schoolToday(now);
  const isToday = isoDate(today) === isoDate(now);
  const cp = currentPeriod(store.data.settings.periods, now);
  if (isToday && cp.status !== "nach") { st.iso = isoDate(today); st.period = cp.nr; }
  else { st.iso = isoDate(isToday ? schoolToday(addDays(now, 1)) : today); st.period = store.data.settings.periods[0]?.nr || 1; }
  if (!st.day) st.day = weekday(parseIso(st.iso));
}
syncNow();

function setTab(t) { st.tab = t; sessionStorage.setItem("dir-tab", t); render(); }

function render() {
  if (!gate()) return;
  const d = store.data;
  const tabs = [["live", "📡 Live"], ["woche", "🗓️ Woche"], ["auslastung", "📊 Auslastung"], ["einstellungen", "⚙️ Einstellungen"]];
  const needsSetup = !d.rooms.length;
  if (needsSetup && st.tab !== "einstellungen") st.tab = "einstellungen";
  app.innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<button class="${st.tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</div><div id="tab"></div>`;
  $$("[data-tab]").forEach((b) => b.onclick = () => setTab(b.dataset.tab));
  const box = $("#tab");
  if (st.tab === "live") renderLive(box);
  else if (st.tab === "woche") renderWeek(box);
  else if (st.tab === "auslastung") renderUtil(box);
  else renderSettings(box, needsSetup);
}

// ── LIVE ───────────────────────────────────────────────────────
function renderLive(box) {
  const d = store.data;
  const now = new Date();
  const date = parseIso(st.iso);
  const isToday = st.iso === isoDate(now);
  const cp = currentPeriod(d.settings.periods, now);
  const isNow = isToday && cp.status === "jetzt" && cp.nr === st.period;
  const per = d.settings.periods.find((p) => p.nr === st.period);
  const slot = slotState(d, st.iso, st.period);
  const regular = d.rooms.filter((r) => !r.notnutzung);
  const busy = regular.filter((r) => isBusy(slot.get(r.id))).length;
  const pct = regular.length ? Math.round((busy / regular.length) * 100) : 0;
  const mon = mondayOf(schoolToday(now));
  const weekChanges = d.changes.filter((c) => c.datum >= isoDate(mon) && c.datum <= isoDate(addDays(mon, 4)) && c.art !== "info");
  const tips = computeTips(d, now);
  const weekDays = [1, 2, 3, 4, 5].map((wd) => addDays(mon, wd - 1));

  box.innerHTML = `
    <div class="now-head">
      <div>
        <div class="t">${isNow ? "● Live – jetzt" : isToday ? "Heute" : DAY_NAMES[weekday(date)]}</div>
        <div class="p">${DAY_SHORT[weekday(date)]} ${fmtDate(date)} · ${per ? `${per.nr}. EH ${per.start}–${per.end}` : ""}</div>
      </div>
      <div class="row gap wrap">
        <select id="lDay" style="width:auto">${weekDays.map((dd) => `<option value="${isoDate(dd)}" ${isoDate(dd) === st.iso ? "selected" : ""}>${DAY_SHORT[weekday(dd)]} ${fmtDate(dd)}</option>`).join("")}</select>
        <select id="lPer" style="width:auto">${d.settings.periods.map((p) => `<option value="${p.nr}" ${p.nr === st.period ? "selected" : ""}>${p.nr}. EH ${p.start}</option>`).join("")}</select>
        ${!st.follow ? `<button class="small" id="lNow">Jetzt</button>` : ""}
        <div class="clock">${now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })}</div>
      </div>
    </div>
    <div class="kpis">
      <div class="card kpi"><div class="l">Auslastung</div><div class="v">${pct} %</div><div class="bar"><i style="width:${pct}%"></i></div></div>
      <div class="card kpi"><div class="l">Belegt</div><div class="v">${busy}<small> / ${regular.length}</small></div></div>
      <div class="card kpi"><div class="l">Frei</div><div class="v" style="color:var(--free)">${regular.length - busy}</div><div class="l">+ ${d.rooms.filter((r) => r.notnutzung && !isBusy(slot.get(r.id))).length} zur Not</div></div>
      <div class="card kpi"><div class="l">Änderungen diese Woche</div><div class="v">${new Set(weekChanges.map((c) => c.text + c.datum)).size}</div></div>
    </div>
    <div class="grid2">
      <div>
        <div class="filter-row">
          <div class="chips" id="lFilter">${["alle", "frei", "NMS", "PTS", "VS", "Hort"].map((f) => `<button class="chip ${f === st.filter ? "on" : ""}" data-f="${f}">${f === "alle" ? "Alle" : f === "frei" ? "Nur frei" : f}</button>`).join("")}</div>
          <input id="lSearch" placeholder="Raum / Klasse suchen" value="${h(st.search)}">
        </div>
        <div id="lCards">${roomCardsHtml(d, st.iso, st.period, { filter: st.filter, search: st.search, clickable: true })}</div>
        <div style="margin-top:.8rem">${legendHtml()}</div>
        <p class="muted" style="font-size:.8rem">Tipp: Raum antippen, um ihn für diese Einheit zu ändern.</p>
      </div>
      <div>
        <div class="card pad"><h2>💡 Tipps</h2><div class="tips">${tips.map((t) => `<div class="tip ${t.level}"><div class="i">${t.icon}</div><div><b>${h(t.title)}</b><span>${h(t.text)}</span></div></div>`).join("") || `<p class="muted">Alles im grünen Bereich.</p>`}</div></div>
        <div class="card pad" style="margin-top:1rem"><div class="row between"><h2>🕑 Letzte Änderungen</h2><a href="aendern.html" class="btn small">✏️ Ändern</a></div><div id="lLog">${changeLogHtml(d, d.changes, { limit: 8, canDelete: () => true })}</div></div>
      </div>
    </div>`;
  $("#lDay").onchange = (e) => { st.iso = e.target.value; st.follow = false; render(); };
  $("#lPer").onchange = (e) => { st.period = +e.target.value; st.follow = false; render(); };
  $("#lNow")?.addEventListener("click", () => { st.follow = true; syncNow(); render(); });
  $$("#lFilter .chip").forEach((b) => b.onclick = () => { st.filter = b.dataset.f; render(); });
  const s = $("#lSearch");
  s.oninput = () => { st.search = s.value; $("#lCards").innerHTML = roomCardsHtml(store.data, st.iso, st.period, { filter: st.filter, search: st.search, clickable: true }); bindCards(); };
  const bindCards = () => $$("#lCards .room").forEach((el) => el.onclick = () => openSlotSheet(el.dataset.room, st.iso, st.period));
  bindCards();
  bindDeletes(box);
}

function bindDeletes(root) {
  $$("[data-del]", root).forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm("Diese Änderung löschen?")) return;
    try { await store.deleteChanges(b.dataset.del.split(",")); toast("Gelöscht"); } catch (ex) { toast(ex.message, "err"); }
  });
}

// ── Sheet: einzelne Einheit eines Raums ändern ─────────────────
function modal(html) {
  const bg = document.createElement("div"); bg.className = "modal-bg";
  bg.innerHTML = `<div class="card pad">${html}</div>`;
  bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
  document.body.appendChild(bg);
  return bg;
}

function openSlotSheet(roomId, iso, period) {
  const d = store.data; const G = byId(d.groups), R = byId(d.rooms);
  const room = R[roomId]; const date = parseIso(iso);
  const cell = slotState(d, iso, period).get(roomId);
  const existing = d.changes.filter((c) => c.datum === iso && c.period === period && c.room_id === roomId);
  const maxP = Math.max(...d.settings.periods.map((p) => p.nr));
  const m = modal(`
    <div class="row between"><h2>${h(room.name)}</h2><button class="icon" data-x>✕</button></div>
    <p class="muted">${DAY_NAMES[weekday(date)]} ${fmtDate(date)} · ${period}. EH · ${h(room.typ)}${room.kapazitaet ? ` · ${room.kapazitaet} Plätze` : ""}</p>
    <p>Jetzt: <b>${cell.groups.length ? cell.groups.map((g) => h(G[g]?.name)).join(" + ") : cell.reserved ? "reserviert" : "frei"}</b>${cell.changed ? ` <span class="badge info">geändert</span>` : ""}</p>
    <label>Gilt bis Einheit<select id="sTo">${d.settings.periods.filter((p) => p.nr >= period).map((p) => `<option value="${p.nr}">${p.nr}. EH (bis ${p.end})</option>`).join("")}</select></label>
    <label>Notiz<input id="sNote" placeholder="z.B. Ausflug, Elternabend"></label>
    <div class="row gap wrap" style="margin:.6rem 0">
      ${cell.groups.map((g) => `<button class="ghost" data-away="${h(g)}">🚶 ${h(G[g]?.name)} ist nicht da</button>`).join("")}
      ${isBusy(cell) ? `<button class="ghost" data-clear>🟢 Raum frei machen</button>` : ""}
      <button class="ghost" data-res>🔒 Reservieren</button>
    </div>
    <label>Klasse / Gruppe hierher holen<div class="row gap"><select id="sGroup">${d.groups.map((g) => `<option value="${h(g.id)}">${h(g.name)} (${h(g.bereich)})</option>`).join("")}</select><button data-move style="flex:none">Holen</button></div></label>
    ${existing.length ? `<h3 style="margin-top:1rem">Änderungen in dieser Einheit</h3>${changeLogHtml(d, existing, { canDelete: () => true })}` : ""}
  `);
  const close = () => m.remove();
  $("[data-x]", m).onclick = close;
  const periods = () => { const to = +$("#sTo", m).value; const out = []; for (let p = period; p <= Math.min(to, maxP); p++) if (d.settings.periods.some((x) => x.nr === p)) out.push(p); return out; };
  const note = () => $("#sNote", m).value.trim();
  const save = async (mk, text) => {
    try { await store.addChanges(periods().map((p) => ({ datum: iso, period: p, room_id: roomId, note: note(), text, ...mk(p) }))); toast("Gespeichert ✓"); close(); }
    catch (e) { toast(e.message, "err"); }
  };
  const lbl = () => `${DAY_SHORT[weekday(date)]} ${fmtPeriods(periods())}`;
  $$("[data-away]", m).forEach((b) => b.onclick = () => save(() => ({ group_id: b.dataset.away, art: "frei" }), `${G[b.dataset.away]?.name} ${lbl()} frei`));
  $("[data-clear]", m)?.addEventListener("click", () => save(() => ({ group_id: null, art: "frei" }), `${room.name} ${lbl()} frei`));
  $("[data-res]", m).onclick = () => save(() => ({ group_id: null, art: "belegt", note: note() || "reserviert" }), `${room.name} ${lbl()} reserviert`);
  $("[data-move]", m).onclick = () => { const g = $("#sGroup", m).value; save(() => ({ group_id: g, art: "belegt" }), `${G[g]?.name} ${lbl()} in ${room.name}`); };
  bindDeletes(m);
}

function openPlanSheet(roomId, day, period) {
  const d = store.data; const R = byId(d.rooms);
  const cur = new Set(d.schedule.filter((s) => s.day === day && s.period === period && s.room_id === roomId).map((s) => s.group_id));
  const m = modal(`
    <div class="row between"><h2>${h(R[roomId].name)} · Stundenplan</h2><button class="icon" data-x>✕</button></div>
    <p class="muted">Jeden ${DAY_NAMES[day]} · ${period}. EH (regulärer Plan)</p>
    <input id="pSearch" placeholder="Klasse suchen …">
    <div id="pList" style="max-height:45vh;overflow:auto;margin:.6rem 0">${d.groups.map((g) => `<label class="row gap" style="font-weight:500;margin:.3rem 0" data-name="${h(g.name.toLowerCase())}"><input type="checkbox" value="${h(g.id)}" ${cur.has(g.id) ? "checked" : ""} style="width:auto"> <span class="badge ${bereichClass(g.bereich)}" style="background:var(--cb);color:var(--c)">${h(g.bereich)}</span> ${h(g.name)}</label>`).join("")}</div>
    <label>Gilt bis Einheit<select id="pTo">${d.settings.periods.filter((p) => p.nr >= period).map((p) => `<option value="${p.nr}">${p.nr}. EH</option>`).join("")}</select></label>
    <div class="row gap"><button class="grow" data-save>Speichern</button><button class="ghost" data-empty>Leeren</button></div>`);
  $("[data-x]", m).onclick = () => m.remove();
  $("#pSearch", m).oninput = (e) => { const q = e.target.value.toLowerCase(); $$("#pList label", m).forEach((l) => l.hidden = !l.dataset.name.includes(q)); };
  const doSave = async (ids) => {
    const to = +$("#pTo", m).value;
    try { for (const p of d.settings.periods.filter((x) => x.nr >= period && x.nr <= to)) await store.setScheduleCell(day, p.nr, roomId, ids); toast("Stundenplan gespeichert ✓"); m.remove(); }
    catch (e) { toast(e.message, "err"); }
  };
  $("[data-save]", m).onclick = () => doSave($$("#pList input:checked", m).map((i) => i.value));
  $("[data-empty]", m).onclick = () => doSave([]);
}

// ── WOCHE ──────────────────────────────────────────────────────
function renderWeek(box) {
  const d = store.data;
  const now = new Date();
  const mon = addDays(mondayOf(schoolToday(now)), st.weekOffset * 7);
  const kw = isoWeek(mon);
  const iso = isoDate(addDays(mon, st.day - 1));
  const cp = currentPeriod(d.settings.periods, now);
  const nowP = iso === isoDate(now) && cp.status === "jetzt" ? cp.nr : null;
  box.innerHTML = `
    <div class="plan-tools">
      <div class="seg"><button class="${st.planMode === "date" ? "on" : ""}" data-m="date">Tatsächlich (mit Änderungen)</button><button class="${st.planMode === "plan" ? "on" : ""}" data-m="plan">Regulärer Stundenplan</button></div>
      ${st.planMode === "date" ? `<div class="row gap"><button class="ghost small" data-w="-1">‹</button><b>KW ${kw}</b><button class="ghost small" data-w="1">›</button>${st.weekOffset ? `<button class="ghost small" data-w="0">Heute</button>` : ""}</div>` : ""}
      <select id="wB" style="width:auto">${["alle", ...BEREICHE].map((b) => `<option value="${b}" ${b === st.bereich ? "selected" : ""}>${b === "alle" ? "Alle Bereiche" : b}</option>`).join("")}</select>
    </div>
    <div class="chips" style="margin-bottom:.7rem">${[1, 2, 3, 4, 5].map((wd) => { const dd = addDays(mon, wd - 1); return `<button class="chip ${wd === st.day ? "on" : ""}" data-d="${wd}">${DAY_SHORT[wd]}${st.planMode === "date" ? `<small>${fmtDate(dd)}</small>` : ""}</button>`; }).join("")}</div>
    ${st.planMode === "plan" ? `<div class="edit-hint">✏️ Sie bearbeiten den <b>regulären Wochenplan</b> (gilt jede Woche). Zelle antippen zum Ändern. Einmalige Änderungen bitte unter „Tatsächlich“ oder auf der Ändern-Seite.</div>` : `<p class="muted" style="font-size:.8rem;margin-top:0">Zelle antippen für eine einmalige Änderung an diesem Tag.</p>`}
    ${planTableHtml(d, { mode: st.planMode, iso, day: st.day, nowPeriod: st.planMode === "date" ? nowP : null, clickable: true, bereich: st.bereich })}
    <div style="margin-top:.8rem">${legendHtml()}</div>`;
  $$("[data-m]", box).forEach((b) => b.onclick = () => { st.planMode = b.dataset.m; render(); });
  $$("[data-w]", box).forEach((b) => b.onclick = () => { const v = +b.dataset.w; st.weekOffset = v === 0 ? 0 : st.weekOffset + v; render(); });
  $$("[data-d]", box).forEach((b) => b.onclick = () => { st.day = +b.dataset.d; render(); });
  $("#wB").onchange = (e) => { st.bereich = e.target.value; render(); };
  $$(".cell", box).forEach((c) => c.onclick = () => st.planMode === "plan" ? openPlanSheet(c.dataset.room, st.day, +c.dataset.period) : openSlotSheet(c.dataset.room, iso, +c.dataset.period));
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 864e5 + 1) / 7);
}

// ── AUSLASTUNG ─────────────────────────────────────────────────
function heatColor(p) {
  // grün -> gelb -> rot
  const hue = 140 - Math.min(1, p) * 140;
  return `hsl(${hue} 75% ${p > 0.85 ? 62 : 72}%)`;
}
function renderUtil(box) {
  const d = store.data;
  const mon = addDays(mondayOf(schoolToday()), st.weekOffset * 7);
  const u = weekUtil(d, mon);
  const periods = d.settings.periods;
  const R = byId(d.rooms);
  const rows = periods.map((p) => `<tr><th>${p.nr}.<br><small style="font-weight:500">${h(p.start)}</small></th>${[1, 2, 3, 4, 5].map((wd) => {
    const s = u.bySlot[wd][p.nr]; const v = s.total ? s.busy / s.total : 0;
    return `<td style="background:${heatColor(v)}" data-d="${wd}" data-p="${p.nr}" title="${s.busy} von ${s.total} Räumen belegt">${Math.round(v * 100)}%<small>${s.total - s.busy} frei</small></td>`;
  }).join("")}</tr>`).join("");
  const byRoom = Object.entries(u.byRoom).filter(([id]) => R[id]).sort((a, b) => b[1] - a[1]);
  box.innerHTML = `
    <div class="plan-tools"><div class="row gap"><button class="ghost small" data-w="-1">‹</button><b>KW ${isoWeek(mon)} · ab ${fmtDate(mon)}</b><button class="ghost small" data-w="1">›</button></div></div>
    <div class="grid2">
      <div class="card pad"><h2>🔥 Wann wird's eng?</h2><p class="muted" style="font-size:.82rem">Anteil belegter Räume (ohne Notnutzungs-Räume). Feld antippen → Live-Ansicht dieser Einheit.</p>
        <div style="overflow-x:auto"><table class="heat"><thead><tr><th></th>${[1, 2, 3, 4, 5].map((wd) => `<th>${DAY_SHORT[wd]}<br><small style="font-weight:500">${fmtDate(addDays(mon, wd - 1))}</small></th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
      </div>
      <div class="card pad"><h2>🏷️ Auslastung je Raum</h2><p class="muted" style="font-size:.82rem">Diese Woche, alle Einheiten.</p>
        ${byRoom.map(([id, v]) => `<div class="util-row ${bereichClass(R[id].bereich)}"><span>${h(R[id].name)}${R[id].notnutzung ? " ·" : ""}</span><div class="b"><i style="width:${Math.round(v * 100)}%"></i></div><b>${Math.round(v * 100)}%</b></div>`).join("")}
      </div>
    </div>`;
  $$("[data-w]", box).forEach((b) => b.onclick = () => { st.weekOffset += +b.dataset.w; render(); });
  $$("td[data-d]", box).forEach((td) => td.onclick = () => { st.iso = isoDate(addDays(mon, +td.dataset.d - 1)); st.period = +td.dataset.p; st.follow = false; setTab("live"); });
}

// ── EINSTELLUNGEN ──────────────────────────────────────────────
function renderSettings(box, needsSetup) {
  const d = store.data;
  const base = location.href.replace(/[^/]*$/, "");
  const opt = (v, t, s) => `<option value="${h(v)}" ${s ? "selected" : ""}>${h(t)}</option>`;
  box.innerHTML = `
    <div class="settings">
      ${needsSetup ? `<div class="card pad" style="border:2px solid var(--accent)"><h2>👋 Willkommen! Los geht's</h2><p>Die Datenbank ist noch leer. Am schnellsten: Beispieldaten laden und dann anpassen – oder unten Räume und Klassen selbst anlegen.</p><button id="seed">Beispieldaten laden</button></div>` : ""}

      <div class="card pad">
        <h2>🏫 Schule</h2>
        <label>Name<input id="sName" value="${h(d.settings.schoolName || "")}"></label>
        <label class="switch">Lehrer-Übersicht ohne Anmeldung ansehen<input type="checkbox" id="sPublic" ${d.settings.publicView ? "checked" : ""}></label>
        <p class="muted" style="font-size:.8rem">Ein: Lehrkräfte öffnen einfach den Link. Aus: Nur angemeldete, freigeschaltete Personen sehen den Plan.</p>
        <h3 style="margin-top:1rem">🔗 Links zum Teilen</h3>
        <div class="log">
          <div class="it"><div class="tx"><b>Lehrkräfte (nur ansehen)</b><div class="meta">${h(base)}index.html</div></div><button class="ghost small" data-copy="${h(base)}index.html">Kopieren</button></div>
          <div class="it"><div class="tx"><b>Ändern (Hort, VS, Bearbeiter)</b><div class="meta">${h(base)}aendern.html</div></div><button class="ghost small" data-copy="${h(base)}aendern.html">Kopieren</button></div>
        </div>
      </div>

      <div class="card pad">
        <h2>👥 Zugänge & Rollen</h2>
        <p class="muted" style="font-size:.82rem">Neue Personen registrieren sich selbst über den Link und erscheinen hier als „Wartet auf Freigabe“. Sie entscheiden die Rolle.</p>
        <div class="table-scroll"><table class="edit"><thead><tr><th>Name / E-Mail</th><th>Rolle</th></tr></thead><tbody>
          ${d.profiles.map((p) => `<tr><td><b>${h(p.name || "")}</b><br><small>${h(p.email || "")}</small></td><td><select data-role="${h(p.id)}" ${p.id === store.user?.id ? "disabled" : ""}>${Object.entries(ROLE_LABEL).map(([k, v]) => opt(k, v, p.role === k)).join("")}</select></td></tr>`).join("") || `<tr><td colspan="2" class="muted">Noch niemand registriert.</td></tr>`}
        </tbody></table></div>
      </div>

      <div class="card pad">
        <div class="row between"><h2>⏰ Einheiten</h2><button class="ghost small" id="addPer">+ Einheit</button></div>
        <div class="table-scroll"><table class="edit"><thead><tr><th>Nr.</th><th>Beginn</th><th>Ende</th><th></th></tr></thead><tbody id="perBody">
          ${d.settings.periods.map((p, i) => `<tr><td><b>${p.nr}.</b></td><td><input type="time" data-pi="${i}" data-k="start" value="${h(p.start)}"></td><td><input type="time" data-pi="${i}" data-k="end" value="${h(p.end)}"></td><td><button class="icon" data-delper="${i}">✕</button></td></tr>`).join("")}
        </tbody></table></div>
        <button id="savePer" style="margin-top:.6rem">Einheiten speichern</button>
      </div>

      <div class="card pad">
        <div class="row between"><h2>🚪 Räume <small>(${d.rooms.length})</small></h2><button class="ghost small" id="addRoom">+ Raum</button></div>
        <div class="table-scroll"><table class="edit"><thead><tr><th>Name</th><th>Art</th><th>Bereich</th><th>Plätze</th><th title="Nur im Notfall nutzbar">Notfall</th><th></th></tr></thead><tbody>
          ${d.rooms.map((r) => `<tr data-rid="${h(r.id)}">
            <td><input data-f="name" value="${h(r.name)}"></td>
            <td><select data-f="typ">${ROOM_TYPES.map((t) => opt(t, t, r.typ === t)).join("")}</select></td>
            <td><select data-f="bereich">${BEREICHE.map((b) => opt(b, b, r.bereich === b)).join("")}</select></td>
            <td><input type="number" min="0" data-f="kapazitaet" value="${h(r.kapazitaet ?? "")}"></td>
            <td><input type="checkbox" data-f="notnutzung" ${r.notnutzung ? "checked" : ""}></td>
            <td><button class="icon" data-delroom="${h(r.id)}">✕</button></td></tr>`).join("")}
        </tbody></table></div>
        <p class="muted" style="font-size:.78rem">Änderungen werden beim Verlassen des Feldes gespeichert. „Notfall“ = Raum wird als „zur Not nutzbar“ vorgeschlagen (z.B. Aula, Bibliothek).</p>
      </div>

      <div class="card pad">
        <div class="row between"><h2>🎒 Klassen & Gruppen <small>(${d.groups.length})</small></h2><button class="ghost small" id="addGroup">+ Klasse</button></div>
        <div class="table-scroll"><table class="edit"><thead><tr><th>Name</th><th>Bereich</th><th>Stammraum</th><th>Kinder</th><th></th></tr></thead><tbody>
          ${d.groups.map((g) => `<tr data-gid="${h(g.id)}">
            <td><input data-f="name" value="${h(g.name)}"></td>
            <td><select data-f="bereich">${BEREICHE.map((b) => opt(b, b, g.bereich === b)).join("")}</select></td>
            <td><select data-f="stammraum">${opt("", "–", !g.stammraum)}${d.rooms.map((r) => opt(r.id, r.name, g.stammraum === r.id)).join("")}</select></td>
            <td><input type="number" min="0" data-f="schueler" value="${h(g.schueler ?? "")}"></td>
            <td><button class="icon" data-delgroup="${h(g.id)}">✕</button></td></tr>`).join("")}
        </tbody></table></div>
      </div>

      <div class="card pad">
        <h2>🪄 Stundenplan schnell füllen</h2>
        <p class="muted" style="font-size:.82rem">Setzt jede Klasse eines Bereichs Mo–Fr in ihren Stammraum. Danach Feinheiten (Turnsaal, Werkraum …) unter „Woche → Regulärer Stundenplan“ antippen.</p>
        <div class="row gap wrap">
          <label class="grow">Bereich<select id="fB">${BEREICHE.map((b) => opt(b, b)).join("")}</select></label>
          <label class="grow">von EH<select id="fFrom">${d.settings.periods.map((p) => opt(p.nr, p.nr + ".")).join("")}</select></label>
          <label class="grow">bis EH<select id="fTo">${d.settings.periods.map((p, i) => opt(p.nr, p.nr + ".", i === 5)).join("")}</select></label>
        </div>
        <button id="fill">Eintragen</button>
      </div>

      <div class="card pad">
        <h2>💾 Daten</h2>
        <div class="row gap wrap">
          <button class="ghost" id="export">⬇️ Sicherung herunterladen</button>
          <label class="btn ghost" style="margin:0;background:var(--soft);color:var(--ink)">⬆️ Sicherung einspielen<input type="file" id="import" accept=".json" hidden></label>
          <button class="ghost" id="cleanup">🧹 Änderungen älter als 30 Tage löschen</button>
          ${!needsSetup ? `<button class="danger" id="seed2">Alles durch Beispieldaten ersetzen</button>` : ""}
        </div>
      </div>
    </div>`;

  const run = async (fn, okMsg = "Gespeichert ✓") => { try { await fn(); toast(okMsg); } catch (e) { toast(e.message, "err"); } };
  const seed = async () => {
    if (d.rooms.length && !confirm("Alle Räume, Klassen, Stundenplan und Änderungen werden durch Beispieldaten ersetzt. Fortfahren?")) return;
    const demo = buildDemoData();
    await run(() => store.replaceAll({ rooms: demo.rooms, groups: demo.groups, schedule: demo.schedule, changes: [], settings: { periods: demo.settings.periods } }), "Beispieldaten geladen ✓");
  };
  $("#seed")?.addEventListener("click", seed);
  $("#seed2")?.addEventListener("click", seed);
  $("#sName").onchange = (e) => run(() => store.saveSettings({ schoolName: e.target.value.trim() }));
  $("#sPublic").onchange = (e) => run(() => store.saveSettings({ publicView: e.target.checked }));
  $$("[data-copy]").forEach((b) => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast("Link kopiert ✓"); } catch { prompt("Link kopieren:", b.dataset.copy); } });
  $$("[data-role]").forEach((s) => s.onchange = () => run(() => store.setRole(s.dataset.role, s.value)));

  // Einheiten
  let periods = d.settings.periods.map((p) => ({ ...p }));
  $$("#perBody input").forEach((i) => i.onchange = () => { periods[+i.dataset.pi][i.dataset.k] = i.value; });
  $$("[data-delper]").forEach((b) => b.onclick = () => { periods.splice(+b.dataset.delper, 1); periods = periods.map((p, i) => ({ ...p, nr: i + 1 })); run(() => store.saveSettings({ periods })); });
  $("#addPer").onclick = () => { const last = periods[periods.length - 1]; periods.push({ nr: periods.length + 1, start: last?.end || "08:00", end: last?.end || "08:50" }); run(() => store.saveSettings({ periods })); };
  $("#savePer").onclick = () => run(() => store.saveSettings({ periods }));

  // Räume & Klassen
  $$("tr[data-rid] [data-f]").forEach((el) => el.onchange = () => {
    const tr = el.closest("tr"); const r = store.data.rooms.find((x) => x.id === tr.dataset.rid);
    const v = el.type === "checkbox" ? el.checked : el.type === "number" ? +el.value : el.value;
    run(() => store.upsert("rooms", { ...r, [el.dataset.f]: v }));
  });
  $$("tr[data-gid] [data-f]").forEach((el) => el.onchange = () => {
    const tr = el.closest("tr"); const g = store.data.groups.find((x) => x.id === tr.dataset.gid);
    const v = el.type === "number" ? +el.value : el.dataset.f === "stammraum" ? (el.value || null) : el.value;
    run(() => store.upsert("groups", { ...g, [el.dataset.f]: v }));
  });
  $("#addRoom").onclick = () => run(() => store.upsert("rooms", { name: `Neuer Raum ${d.rooms.length + 1}`, typ: "Klassenraum", bereich: "NMS", kapazitaet: 25, notnutzung: false, sort: d.rooms.length }), "Raum angelegt ✓");
  $("#addGroup").onclick = () => run(() => store.upsert("groups", { name: `Neu ${d.groups.length + 1}`, bereich: "NMS", stammraum: null, schueler: 20 }), "Klasse angelegt ✓");
  $$("[data-delroom]").forEach((b) => b.onclick = () => { if (confirm("Raum samt Stundenplan-Einträgen löschen?")) run(() => store.remove("rooms", b.dataset.delroom), "Gelöscht"); });
  $$("[data-delgroup]").forEach((b) => b.onclick = () => { if (confirm("Klasse samt Stundenplan-Einträgen löschen?")) run(() => store.remove("groups", b.dataset.delgroup), "Gelöscht"); });

  // Stundenplan füllen
  $("#fill").onclick = () => {
    const b = $("#fB").value, a = +$("#fFrom").value, z = +$("#fTo").value;
    const gs = d.groups.filter((g) => g.bereich === b && g.stammraum);
    if (!gs.length) return toast("Keine Klassen mit Stammraum in diesem Bereich", "err");
    const exists = new Set(d.schedule.map((s) => `${s.day}|${s.period}|${s.group_id}`));
    const rows = [];
    for (const g of gs) for (let day = 1; day <= 5; day++) for (const p of d.settings.periods) if (p.nr >= a && p.nr <= z && !exists.has(`${day}|${p.nr}|${g.id}`)) rows.push({ day, period: p.nr, room_id: g.stammraum, group_id: g.id });
    run(() => store.addSchedule(rows), `${rows.length} Einträge ergänzt ✓`);
  };

  // Daten
  $("#export").onclick = () => {
    const { profiles, ...rest } = store.data;
    const blob = new Blob([JSON.stringify(rest, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `raumplan-sicherung-${isoDate(new Date())}.json`; a.click();
  };
  $("#import").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!Array.isArray(j.rooms) || !Array.isArray(j.groups)) throw new Error("Ungültige Datei");
      if (!confirm("Aktuelle Daten durch die Sicherung ersetzen?")) return;
      await run(() => store.replaceAll({ rooms: j.rooms, groups: j.groups, schedule: j.schedule || [], changes: [], settings: j.settings }), "Sicherung eingespielt ✓");
    } catch (ex) { toast(ex.message, "err"); }
  };
  $("#cleanup").onclick = () => {
    const old = d.changes.filter((c) => c.datum < isoDate(addDays(new Date(), -30))).map((c) => c.id);
    if (!old.length) return toast("Nichts zu löschen");
    run(() => store.deleteChanges(old), `${old.length} alte Einträge gelöscht`);
  };
}

store.onChange(() => {
  const a = document.activeElement;
  if (st.tab === "einstellungen" && a && ["INPUT", "SELECT"].includes(a.tagName) && a.id !== "import") return; // nicht beim Tippen neu zeichnen
  const focusSearch = a?.id === "lSearch";
  render();
  if (focusSearch) { const s = $("#lSearch"); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); }
});
everyMinute(() => { if (st.follow) syncNow(); if (st.tab === "live" && document.activeElement?.id !== "lSearch" && !$(".modal-bg")) render(); });
render();
