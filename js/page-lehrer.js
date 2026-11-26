// Übersicht für Lehrkräfte: animiertes 3D-Gebäude + kurze Listen. Nur ansehen.

import { bootPage, $, h, everyMinute } from "./ui.js";
import { isoDate, parseIso, weekday, fmtDate, DAY_SHORT, slotState, isBusy, byId, bereichClass, currentPeriod, bookable } from "./model.js";
import { planTableHtml, changeLogHtml } from "./views.js";
import { mountScene } from "./scene3d.js";

const { store, gate } = await bootPage({ need: null, page: "index.html" });
const app = $("#app");
let scene = null;

async function start() {
  if (!gate()) { scene = null; return; }
  if (!store.data.rooms.length) {
    app.innerHTML = `<div class="card pad center narrow"><div class="big-emoji">🏗️</div><h2>Noch keine Räume angelegt</h2><p class="muted">Die Direktion richtet den Raumplan gerade ein.</p></div>`;
    return;
  }
  app.innerHTML = `<div id="scene"></div><div class="grid2 below" id="below"></div>`;
  scene = await mountScene($("#scene"), store, { onSel: renderBelow });
  renderBelow(scene.sel);
}

function renderBelow(sel) {
  const box = $("#below"); if (!box) return;
  const d = store.data; const G = byId(d.groups), R = byId(d.rooms);
  const st = slotState(d, sel.iso, sel.period);
  const date = parseIso(sel.iso);
  const free = d.rooms.filter((r) => bookable(r) && !isBusy(st.get(r.id)));
  const where = {};
  for (const [rid, c] of st) for (const g of c.groups) (where[g] ||= []).push(R[rid]?.name);
  const away = new Set(); for (const [, c] of st) c.freedBy.forEach((g) => { if (!where[g]) away.add(g); });
  const order = ["NMS", "PTS", "VS", "Hort", "gemeinsam"];
  const gs = [...d.groups].filter((g) => where[g.id] || away.has(g.id))
    .sort((a, b) => order.indexOf(a.bereich) - order.indexOf(b.bereich) || a.name.localeCompare(b.name, "de", { numeric: true }));
  const now = new Date(); const cp = currentPeriod(d.settings.periods, now);
  const openTable = $("#tbl")?.open;
  box.innerHTML = `
    <div>
      <div class="card pad">
        <div class="row between"><h2>🟢 Frei · ${DAY_SHORT[weekday(date)]} ${sel.period}. EH</h2><span class="badge frei">${free.filter((r) => !r.notnutzung).length}</span></div>
        <div class="free-pills">${free.length ? free.map((r) => `<span class="pill ${r.notnutzung ? "emerg" : ""}">${h(r.name)}</span>`).join("") : `<span class="muted">Alle Räume belegt.</span>`}</div>
      </div>
      <div class="card pad" style="margin-top:1rem">
        <h2>📍 Wo ist welche Klasse?</h2>
        <div class="where-list">${gs.map((g) => where[g.id]
          ? `<div class="where ${bereichClass(g.bereich)}"><b>${h(g.name)}</b><span>${h(where[g.id].join(", "))}</span></div>`
          : `<div class="where away"><b>${h(g.name)}</b><span class="muted">unterwegs</span></div>`).join("") || `<span class="muted">Keine Klasse in dieser Einheit.</span>`}</div>
      </div>
    </div>
    <div>
      <div class="card pad"><h2>🔔 Änderungen ${DAY_SHORT[weekday(date)]} ${fmtDate(date)}</h2>${changeLogHtml(d, d.changes.filter((c) => c.datum === sel.iso && c.art !== "info"), { limit: 15 })}</div>
      <details class="card pad more" id="tbl" style="margin-top:1rem" ${openTable ? "open" : ""}><summary>Tagesplan als Tabelle</summary>
        <div style="margin-top:.6rem">${planTableHtml(d, { mode: "date", iso: sel.iso, nowPeriod: sel.iso === isoDate(now) && cp.status === "jetzt" ? cp.nr : null })}</div>
      </details>
    </div>`;
}

store.onChange(() => { if (!scene) start(); else scene.refresh(); });
everyMinute(() => scene?.tick());
start();
