// Übersicht für Lehrkräfte: nur ansehen, einfach und klar.

import { bootPage, $, $$, h, everyMinute } from "./ui.js";
import { isoDate, parseIso, addDays, mondayOf, weekday, fmtDate, DAY_SHORT, DAY_NAMES, schoolToday, currentPeriod, slotState, isBusy, byId, bereichClass } from "./model.js";
import { roomCardsHtml, planTableHtml, legendHtml, changeLogHtml } from "./views.js";

const { store, gate } = await bootPage({ need: null, page: "index.html" });
const app = $("#app");

let sel = initialSel();
let filter = "alle", search = "", followNow = true;

function initialSel() {
  const now = new Date();
  const today = schoolToday(now);
  const isToday = isoDate(today) === isoDate(now);
  const cp = currentPeriod(store.data.settings.periods, now);
  if (isToday && cp.status !== "nach") return { iso: isoDate(today), period: cp.nr };
  const d = isToday ? schoolToday(addDays(now, 1)) : today;
  return { iso: isoDate(d), period: store.data.settings.periods[0]?.nr || 1 };
}

function render() {
  if (!gate()) return;
  const d = store.data;
  if (!d.rooms.length) {
    app.innerHTML = `<div class="card pad center narrow"><div class="big-emoji">🏗️</div><h2>Noch keine Räume angelegt</h2><p class="muted">Die Direktion richtet den Raumplan gerade ein.</p></div>`;
    return;
  }
  const now = new Date();
  const date = parseIso(sel.iso);
  const isToday = sel.iso === isoDate(now);
  const cp = currentPeriod(d.settings.periods, now);
  const per = d.settings.periods.find((p) => p.nr === sel.period) || d.settings.periods[0];
  const isNow = isToday && cp.status === "jetzt" && cp.nr === sel.period;
  const mon = mondayOf(schoolToday(now));
  const G = byId(d.groups), R = byId(d.rooms);
  const st = slotState(d, sel.iso, sel.period);
  const free = d.rooms.filter((r) => !isBusy(st.get(r.id)));

  // Wo ist welche Klasse?
  const where = {};
  for (const [rid, c] of st) for (const g of c.groups) (where[g] ||= []).push(R[rid]?.name);
  const away = new Set(); for (const [, c] of st) c.freedBy.forEach((g) => { if (!where[g]) away.add(g); });
  const groupsSorted = [...d.groups].sort((a, b) => ["NMS", "PTS", "VS", "Hort", "gemeinsam"].indexOf(a.bereich) - ["NMS", "PTS", "VS", "Hort", "gemeinsam"].indexOf(b.bereich) || a.name.localeCompare(b.name, "de", { numeric: true }));
  const whereHtml = groupsSorted.filter((g) => where[g.id] || away.has(g.id)).map((g) => where[g.id]
    ? `<div class="where ${bereichClass(g.bereich)}"><b>${h(g.name)}</b><span>${h(where[g.id].join(", "))}</span></div>`
    : `<div class="where away ${bereichClass(g.bereich)}"><b>${h(g.name)}</b><span class="muted">unterwegs</span></div>`).join("");

  const todays = d.changes.filter((c) => c.datum === sel.iso && c.art !== "info");

  app.innerHTML = `
    <div class="now-head">
      <div>
        <div class="t">${isNow ? "● Jetzt" : isToday ? "Heute" : DAY_NAMES[weekday(date)]} · ${DAY_SHORT[weekday(date)]} ${fmtDate(date)}</div>
        <div class="p">${per ? `${per.nr}. Einheit · ${per.start}–${per.end}` : ""}</div>
      </div>
      <div class="row gap">${!followNow || !isToday ? `<button class="small" id="toNow">Jetzt</button>` : ""}<div class="clock">${now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })}</div></div>
    </div>

    <div class="chips" id="days">${[1, 2, 3, 4, 5].map((wd) => { const dd = addDays(mon, wd - 1); const iso = isoDate(dd); return `<button class="chip ${iso === sel.iso ? "on" : ""}" data-iso="${iso}">${DAY_SHORT[wd]}<small>${fmtDate(dd)}</small></button>`; }).join("")}</div>
    <div class="chips" id="pers" style="margin:.5rem 0 1rem">${d.settings.periods.map((p) => `<button class="chip ${p.nr === sel.period ? "on" : ""}" data-p="${p.nr}">${p.nr}.<small>${h(p.start)}</small></button>`).join("")}</div>

    <div class="grid2">
      <div>
        <div class="card pad">
          <div class="section-title" style="margin-top:0"><h2>🟢 Freie Räume</h2><span class="badge frei">${free.filter((r) => !r.notnutzung).length} frei</span></div>
          <div class="free-pills">${free.length ? free.map((r) => `<span class="pill ${r.notnutzung ? "emerg" : ""}">${h(r.name)}</span>`).join("") : `<span class="muted">Alle Räume belegt.</span>`}</div>
        </div>

        <div class="section-title"><h2>Alle Räume</h2></div>
        <div class="filter-row">
          <div class="chips" id="filters">${["alle", "frei", "NMS", "PTS", "VS", "Hort"].map((f) => `<button class="chip ${f === filter ? "on" : ""}" data-f="${f}">${f === "alle" ? "Alle" : f === "frei" ? "Nur frei" : f}</button>`).join("")}</div>
          <input id="search" placeholder="Raum oder Klasse suchen …" value="${h(search)}">
        </div>
        <div id="cards">${roomCardsHtml(d, sel.iso, sel.period, { filter, search })}</div>
        <div style="margin-top:.8rem">${legendHtml()}</div>

        <div class="section-title"><h2>Tagesplan ${DAY_SHORT[weekday(date)]} ${fmtDate(date)}</h2></div>
        ${planTableHtml(d, { mode: "date", iso: sel.iso, nowPeriod: isToday && cp.status === "jetzt" ? cp.nr : null })}
      </div>
      <div>
        <div class="card pad">
          <h2>📍 Wo ist welche Klasse?</h2>
          <div class="where-list">${whereHtml || `<span class="muted">Keine Klasse in dieser Einheit.</span>`}</div>
        </div>
        <div class="card pad" style="margin-top:1rem">
          <h2>🔔 Änderungen ${isToday ? "heute" : `am ${DAY_SHORT[weekday(date)]}`}</h2>
          ${changeLogHtml(d, todays, { limit: 20 })}
        </div>
      </div>
    </div>`;

  $$("#days .chip").forEach((b) => b.onclick = () => { sel.iso = b.dataset.iso; followNow = false; render(); });
  $$("#pers .chip").forEach((b) => b.onclick = () => { sel.period = +b.dataset.p; followNow = false; render(); });
  $$("#filters .chip").forEach((b) => b.onclick = () => { filter = b.dataset.f; render(); });
  $("#toNow")?.addEventListener("click", () => { sel = initialSel(); followNow = true; render(); });
  const s = $("#search");
  s.oninput = () => { search = s.value; $("#cards").innerHTML = roomCardsHtml(store.data, sel.iso, sel.period, { filter, search }); };
}

store.onChange(() => { const f = document.activeElement?.id === "search"; render(); if (f) { const s = $("#search"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); } });
everyMinute(() => { if (followNow) sel = initialSel(); if (document.activeElement?.id !== "search") render(); });
render();
