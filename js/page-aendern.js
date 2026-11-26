// Ändern-Seite: Chat-Eingabe wie WhatsApp + Schnell-Formular + letzte Änderungen.

import { bootPage, $, $$, h, toast } from "./ui.js";
import { isoDate, addDays, mondayOf, schoolToday, DAY_SHORT, fmtDate } from "./model.js";
import { parseCommand, applyCommand, HELP_TEXT } from "./parser.js";
import { changeLogHtml } from "./views.js";

const { store, gate } = await bootPage({ need: "edit", page: "aendern.html" });
const app = $("#app");
const HIST_KEY = "raumplan-chat";
let msgs = [];
try { msgs = JSON.parse(sessionStorage.getItem(HIST_KEY) || "[]"); } catch { msgs = []; }
if (!msgs.length) msgs.push({ who: "bot", text: `Hallo! 👋 Schreiben Sie einfach, was sich ändert – wie in WhatsApp.\n\nz.B. „Klasse 2a ist am Donnerstag in der 3. Einheit frei“\noder „Hort A morgen 7-8 im Turnsaal“.\n\nTippen Sie auf „Hilfe“ für alle Möglichkeiten.`, at: Date.now() });
let pending = null; // wartende dauerhafte Änderung
let built = false;

const save = () => { try { sessionStorage.setItem(HIST_KEY, JSON.stringify(msgs.slice(-60))); } catch {} };

function msgHtml(m, i) {
  const t = new Date(m.at).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
  let acts = "";
  if (m.undoIds?.length && !m.undone) acts = `<div class="acts"><button class="ghost small" data-undo="${i}">↩️ Rückgängig</button></div>`;
  if (m.confirm && !m.resolved) acts = `<div class="acts"><button class="small" data-yes="${i}">Ja, dauerhaft ändern</button><button class="ghost small" data-no="${i}">Abbrechen</button></div>`;
  return `<div class="msg ${m.who} ${m.err ? "err" : ""}">${h(m.text)}${acts}<time>${t}</time></div>`;
}

function renderChat() {
  const box = $("#chat"); if (!box) return;
  box.innerHTML = msgs.map(msgHtml).join("");
  box.scrollTop = box.scrollHeight;
  $$("[data-undo]", box).forEach((b) => b.onclick = async () => {
    const m = msgs[+b.dataset.undo];
    try { await store.deleteChanges(m.undoIds); m.undone = true; push("bot", "↩️ Zurückgenommen."); } catch (e) { push("bot", `Fehler: ${e.message}`, { err: true }); }
  });
  $$("[data-yes]", box).forEach((b) => b.onclick = async () => {
    const m = msgs[+b.dataset.yes]; m.resolved = true;
    if (!pending) return renderChat();
    try { await applyCommand(pending.res, store, pending.raw); push("bot", pending.res.reply); } catch (e) { push("bot", `Fehler: ${e.message}`, { err: true }); }
    pending = null;
  });
  $$("[data-no]", box).forEach((b) => b.onclick = () => { msgs[+b.dataset.no].resolved = true; pending = null; push("bot", "Abgebrochen – nichts geändert."); });
}

function push(who, text, extra = {}) { msgs.push({ who, text, at: Date.now(), ...extra }); save(); renderChat(); }

async function send(raw) {
  raw = raw.trim(); if (!raw) return;
  push("me", raw);
  const res = parseCommand(raw, store.data);
  try {
    if (res.type === "permanent") {
      pending = { res, raw };
      push("bot", `${res.reply.replace("📌 Stundenplan geändert:", "📌 Das ändert den regulären Stundenplan:")}\nSoll ich das dauerhaft eintragen?`, { confirm: true });
      return;
    }
    if (res.type === "help") return push("bot", HELP_TEXT);
    const out = await applyCommand(res, store, raw);
    if (out.type === "change") push("bot", out.reply, { undoIds: (out.rows || []).map((r) => r.id) });
    else push("bot", out.reply, { err: out.type === "error" });
  } catch (e) { push("bot", `Fehler beim Speichern: ${e.message}`, { err: true }); }
}

function quickFormHtml(d) {
  const mon = mondayOf(schoolToday());
  const days = [];
  for (let w = 0; w < 2; w++) for (let i = 0; i < 5; i++) { const dd = addDays(mon, w * 7 + i); if (dd >= addDays(schoolToday(), 0)) days.push(dd); }
  const opt = (v, t) => `<option value="${h(v)}">${h(t)}</option>`;
  return `
    <details class="card pad" style="margin-top:1rem" id="qf">
      <summary style="cursor:pointer;font-weight:700">⚡ Ohne Tippen eintragen</summary>
      <div class="row gap wrap" style="margin-top:.6rem">
        <label class="grow">Was?<select id="qWhat">
          <optgroup label="Klasse / Gruppe">${d.groups.map((g) => opt(g.name, g.name)).join("")}</optgroup>
          <optgroup label="Raum">${d.rooms.map((r) => opt(r.name, `Raum: ${r.name}`)).join("")}</optgroup>
        </select></label>
        <label class="grow">Tag<select id="qDay">${days.map((dd) => opt(fmtDate(dd), `${DAY_SHORT[dd.getDay()]} ${fmtDate(dd)}`)).join("")}</select></label>
      </div>
      <div class="row gap wrap">
        <label class="grow">Von EH<select id="qFrom">${d.settings.periods.map((p) => opt(p.nr, `${p.nr}. (${p.start})`)).join("")}</select></label>
        <label class="grow">Bis EH<select id="qTo">${d.settings.periods.map((p) => opt(p.nr, `${p.nr}. (${p.end})`)).join("")}</select></label>
      </div>
      <div class="row gap wrap">
        <label class="grow">Aktion<select id="qAct">${opt("frei", "ist frei / nicht da")}${opt("in", "geht in Raum …")}${opt("belegt", "Raum reservieren")}</select></label>
        <label class="grow" id="qToRoomL" hidden>Zielraum<select id="qToRoom">${d.rooms.map((r) => opt(r.name, r.name)).join("")}</select></label>
      </div>
      <label>Notiz (optional)<input id="qNote" placeholder="z.B. Ausflug, Elternabend"></label>
      <button class="btn" id="qGo" style="width:100%">Eintragen</button>
    </details>`;
}

function render() {
  if (!gate()) { built = false; return; }
  const d = store.data;
  const canDel = (g) => store.isMaster || g.created_by === store.user?.id;
  const recent = d.changes.filter((c) => c.datum >= isoDate(addDays(new Date(), -1)));
  if (!built) {
    const ex = { g: d.groups[0]?.name || "2a", r: d.rooms.find((r) => r.typ !== "Klassenraum")?.name || d.rooms[0]?.name || "R12" };
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    app.innerHTML = `
      <div class="card" style="overflow:hidden">
        <div class="quick chips" id="quick">
          <button class="chip" data-q="Was ist jetzt frei?">🟢 Was ist jetzt frei?</button>
          <button class="chip" data-t="${h(ex.g)} heute 3. EH frei">✍️ Klasse frei …</button>
          <button class="chip" data-t="${h(ex.g)} heute 3-4 in ${h(ex.r)}">🔁 Umziehen …</button>
          <button class="chip" data-q="rückgängig">↩️ Rückgängig</button>
          <button class="chip" data-q="hilfe">❓ Hilfe</button>
        </div>
        <div class="chat" id="chat"></div>
        <form class="composer" id="comp">
          ${SR ? `<button type="button" class="ghost mic" id="mic" title="Sprechen">🎤</button>` : ""}
          <textarea id="inp" rows="1" placeholder="z.B. 2a Do 3. EH frei" enterkeyhint="send" autocomplete="off"></textarea>
          <button type="submit" title="Senden">➤</button>
        </form>
      </div>
      <div id="qfBox"></div>
      <div class="card pad" style="margin-top:1rem"><h2>🕑 Letzte Änderungen</h2><div id="log"></div></div>`;
    built = true;
    const inp = $("#inp");
    const grow = () => { inp.style.height = "auto"; inp.style.height = Math.min(inp.scrollHeight, 120) + "px"; };
    inp.oninput = grow;
    inp.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#comp").requestSubmit(); } };
    $("#comp").onsubmit = (e) => { e.preventDefault(); const v = inp.value; inp.value = ""; grow(); send(v); };
    $$("#quick .chip").forEach((b) => b.onclick = () => {
      if (b.dataset.q) return send(b.dataset.q);
      inp.value = b.dataset.t; inp.focus(); inp.select(); grow();
    });
    if (SR) {
      const rec = new SR(); rec.lang = "de-AT"; rec.interimResults = true; rec.continuous = false;
      let on = false;
      rec.onresult = (e) => { inp.value = [...e.results].map((r) => r[0].transcript).join(" "); grow(); };
      rec.onend = () => { on = false; $("#mic")?.classList.remove("rec"); if (inp.value.trim()) toast("Text prüfen und senden ➤"); };
      rec.onerror = () => { on = false; $("#mic")?.classList.remove("rec"); };
      $("#mic").onclick = () => { if (on) { rec.stop(); return; } inp.value = ""; try { rec.start(); on = true; $("#mic").classList.add("rec"); } catch {} };
    }
  }
  // Schnellformular nur neu bauen, wenn geschlossen (sonst Eingaben behalten)
  if (!$("#qf")?.open) {
    $("#qfBox").innerHTML = quickFormHtml(d);
    const act = $("#qAct");
    act.onchange = () => { $("#qToRoomL").hidden = act.value !== "in"; };
    $("#qGo").onclick = () => {
      const what = $("#qWhat").value, day = $("#qDay").value, a = +$("#qFrom").value, b = Math.max(+$("#qTo").value, a);
      const note = $("#qNote").value.trim();
      const per = a === b ? `${a}. EH` : `${a}-${b}. EH`;
      let s = `${what} ${day} ${per} `;
      s += act.value === "frei" ? "frei" : act.value === "in" ? `in ${$("#qToRoom").value}` : "belegt";
      if (note) s += ` (${note})`;
      $("#qf").open = false;
      send(s);
    };
  }
  renderChat();
  $("#log").innerHTML = changeLogHtml(d, recent, { canDelete: canDel, limit: 25 });
  $$("#log [data-del]").forEach((b) => b.onclick = async () => {
    if (!confirm("Diese Änderung löschen?")) return;
    try { await store.deleteChanges(b.dataset.del.split(",")); toast("Gelöscht"); } catch (e) { toast(e.message, "err"); }
  });
}

store.onChange(render);
render();
