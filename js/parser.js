// Versteht kurze deutsche Sätze wie
//   "Klasse 2a ist am Donnerstag in der 3. Einheit frei"
//   "2a Do 3-4 in R12"   ·   "Werkraum morgen 5. EH frei"
//   "Hort A jeden Mittwoch ab der 7. im Turnsaal"
//   "Was ist jetzt frei?"  ·  "Wo ist 3b Fr 2?"  ·  "rückgängig"

import {
  DAY_SHORT, isoDate, parseIso, addDays, weekday, fmtDate, schoolToday, nextWeekday,
  currentPeriod, slotState, isBusy, byId,
} from "./model.js";

export function norm(s) {
  return String(s || "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9.\-:?/ ]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function roomAliases(r) {
  const n = norm(r.name);
  const out = new Set([n, n.replace(/[\s-]/g, ""), n.replace(/-/g, " ")]);
  const m = n.match(/^(?:r|raum|zimmer|klasse)\s?0*(\d+)$/);
  if (m) ["raum", "r", "zimmer", "rm"].forEach((p) => { out.add(`${p} ${m[1]}`); out.add(`${p}${m[1]}`); out.add(`${p} 0${m[1]}`); out.add(`${p}0${m[1]}`); });
  if (/raum$/.test(n.replace(/[\s-]/g, ""))) { const base = n.replace(/[\s-]?raum$/, ""); if (base.length >= 3) out.add(base); }
  if (n === "turnsaal") { out.add("turnhalle"); out.add("turnen"); out.add("halle"); }
  return [...out].filter((a) => a.length >= 2);
}
function groupAliases(g) {
  const n = norm(g.name).replace(/[()]/g, "").trim();
  const out = new Set([n, n.replace(/[\s-]/g, "")]);
  const first = n.split(" ")[0];
  if (first.length >= 6) out.add(first); // "religion (gruppe)" -> "religion"
  return [...out].filter((a) => a.length >= 2);
}

function findEntities(text, data) {
  const cands = [];
  for (const r of data.rooms) for (const a of roomAliases(r)) cands.push({ kind: "room", id: r.id, a });
  for (const g of data.groups) for (const a of groupAliases(g)) cands.push({ kind: "group", id: g.id, a });
  cands.sort((x, y) => y.a.length - x.a.length);
  const found = [];
  let t = ` ${text} `;
  for (const c of cands) {
    const re = new RegExp(`(?<![a-z0-9])${esc(c.a)}(?![a-z0-9])`);
    const m = re.exec(t);
    if (m) {
      found.push({ ...c, pos: m.index });
      t = t.slice(0, m.index) + " ".repeat(c.a.length) + t.slice(m.index + c.a.length);
    }
  }
  found.sort((a, b) => a.pos - b.pos);
  return { found, rest: t };
}

const DAY_WORDS = [
  [/(?<![a-z])(montag|mo)(?![a-z])/, 1], [/(?<![a-z])(dienstag|di)(?![a-z])/, 2], [/(?<![a-z])(mittwoch|mi)(?![a-z])/, 3],
  [/(?<![a-z])(donnerstag|do)(?![a-z])/, 4], [/(?<![a-z])(freitag|fr)(?![a-z])/, 5],
];

function findDate(t, now) {
  let rest = t; let date = null; let wd = null; let explicit = false;
  const cut = (m) => { rest = rest.slice(0, m.index) + " ".repeat(m[0].length) + rest.slice(m.index + m[0].length); };
  let m;
  if ((m = /(?<![a-z])uebermorgen(?![a-z])/.exec(rest))) { date = addDays(now, 2); cut(m); explicit = true; }
  else if ((m = /(?<![a-z])morgen(?![a-z])/.exec(rest))) { date = addDays(now, 1); cut(m); explicit = true; }
  else if ((m = /(?<![a-z])heute(?![a-z])/.exec(rest))) { date = addDays(now, 0); cut(m); explicit = true; }
  if (!date && (m = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?!\s*-)(?!\s*(eh|einheit|stunde))/.exec(rest))) {
    const d = +m[1], mo = +m[2];
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      let y = m[3] ? +m[3] : now.getFullYear();
      if (y < 100) y += 2000;
      date = new Date(y, mo - 1, d);
      if (!m[3] && date < addDays(now, -120)) date = new Date(y + 1, mo - 1, d);
      cut(m); explicit = true;
    }
  }
  for (const [re, n] of DAY_WORDS) {
    if ((m = re.exec(rest))) { wd = n; cut(m); break; }
  }
  const nextWeek = /(?<![a-z])naechste[nmr]?(?![a-z])|kommende[nmr]?/.test(rest);
  if (!date && wd) { date = nextWeekday(wd, now); if (nextWeek && date - now < 7 * 864e5 && weekday(now) <= wd) date = addDays(date, 7); explicit = true; }
  if (date && !wd) wd = weekday(date);
  return { date, wd, explicit, rest };
}

function findPeriods(t, settings) {
  const all = settings.periods.map((p) => p.nr).sort((a, b) => a - b);
  const max = all[all.length - 1] || 10;
  let rest = t.replace(/\d{1,2}:\d{2}/g, " ");
  const set = new Set();
  const cut = (m) => { rest = rest.slice(0, m.index) + " ".repeat(m[0].length) + rest.slice(m.index + m[0].length); };
  let m;
  if (/ganz(en|er|e)? tag|ganztag|ganztaegig|alle einheiten/.test(rest)) all.forEach((p) => set.add(p));
  if (/(?<![a-z])vormittag/.test(rest)) settings.periods.filter((p) => p.start < "12:30").forEach((p) => set.add(p.nr));
  if (/(?<![a-z])nachmittag/.test(rest)) settings.periods.filter((p) => p.start >= "12:30").forEach((p) => set.add(p.nr));
  const reRange = /(?<![\d.])(\d{1,2})\.?\s*(?:-|bis|und|\/)\s*(?:zur |zum |der )?(\d{1,2})\.?(?!\d)/g;
  while ((m = reRange.exec(rest))) {
    const a = +m[1], b = +m[2];
    const isUnd = /und|\//.test(m[0]);
    if (a >= 1 && b <= max && a <= b) { if (isUnd) { set.add(a); set.add(b); } else for (let i = a; i <= b; i++) set.add(i); }
  }
  rest = rest.replace(reRange, " ");
  const reAb = /(?<![a-z])ab (?:der |dem )?(\d{1,2})\.?/;
  if ((m = reAb.exec(rest))) { for (let i = +m[1]; i <= max; i++) if (all.includes(i)) set.add(i); cut(m); }
  const reNum = /(?<![\d.:])(\d{1,2})\.?(?![\d:])/g;
  while ((m = reNum.exec(rest))) { const n = +m[1]; if (n >= 1 && n <= max) set.add(n); }
  return [...set].filter((p) => all.includes(p)).sort((a, b) => a - b);
}

export function fmtPeriods(ps) {
  if (!ps.length) return "";
  const parts = []; let s = ps[0], prev = ps[0];
  for (let i = 1; i <= ps.length; i++) {
    const p = ps[i];
    if (p === prev + 1) { prev = p; continue; }
    parts.push(s === prev ? `${s}.` : `${s}.–${prev}.`);
    s = prev = p;
  }
  return parts.join(", ") + " EH";
}

const FREE_RE = /(?<![a-z])(frei|faellt aus|faellt weg|entfaellt|nicht da|nicht im|nicht in|abwesend|unterwegs|ausflug|wandertag|exkursion|schikurs|skikurs|sportwoche|projekttag|lehrausgang|weg|krank|braucht keinen|brauchen keinen|kein raum|keinen raum|zieht aus)(?![a-z])/;
const NOTE_WORDS = ["ausflug", "wandertag", "exkursion", "schikurs", "skikurs", "sportwoche", "projekttag", "lehrausgang", "elternabend", "konferenz", "schularbeit", "test", "veranstaltung", "theater", "probe", "sprechtag", "fotograf", "impfung", "berufspraktische tage"];
const PERM_RE = /(?<![a-z])(jede[nrsm]?|immer|dauerhaft|ab sofort|regelmaessig|woechentlich|ab jetzt|grundsaetzlich|im stundenplan|stundenplan)(?![a-z])/;

function extractNote(raw) {
  const p = raw.match(/\(([^)]+)\)/); if (p) return p[1].trim();
  const w = raw.match(/\b(?:wegen|für|fuer|zum|zur)\s+([^,.;!?]+)/i);
  const n = norm(raw);
  for (const k of NOTE_WORDS) if (n.includes(k)) return k.replace(/\b\w/g, (c) => c.toUpperCase());
  if (w && w[1].length < 40 && !/einheit|stunde|\d/.test(w[1])) return w[1].trim();
  return "";
}

/** Freie Räume für Datum + Einheiten (frei in ALLEN angegebenen). */
export function freeRooms(data, dateIso, periods) {
  const states = periods.map((p) => slotState(data, dateIso, p));
  return data.rooms.filter((r) => states.every((st) => !isBusy(st.get(r.id))));
}

export const HELP_TEXT =
`So schreiben Sie Änderungen:
• „2a Do 3. EH frei" – Klasse ist weg, ihr Raum wird frei
• „2a Do 3-4 in R12" – Klasse zieht um
• „Werkraum morgen 5. EH frei" / „Aula Fr 6 belegt (Elternabend)"
• „Hort A jeden Mi ab der 7. im Turnsaal" – dauerhaft im Plan
• „Was ist jetzt frei?" · „Was ist Do 3 frei?" · „Wo ist 3b Fr 2?"
• „rückgängig" – letzte eigene Änderung zurücknehmen
Tage: heute, morgen, Mo–Fr, nächsten Di, 28.11. · Einheiten: 3, 3-4, 3. und 5., ab 6, vormittags, nachmittags, ganztags`;

/**
 * Hauptfunktion. Liefert:
 *  { type, reply, changes?, ops?, warn? }
 *  type: 'change' | 'permanent' | 'query' | 'undo' | 'help' | 'error'
 */
export function parseCommand(raw, data, now = new Date()) {
  const text = norm(raw);
  const R = byId(data.rooms), G = byId(data.groups);
  const settings = data.settings;
  if (!text) return { type: "error", reply: "Bitte einen Satz eingeben." };
  if (/^(hilfe|help|\?|befehle|was kann ich schreiben)/.test(text)) return { type: "help", reply: HELP_TEXT };
  if (/^(rueckgaengig|undo|zurueck|storno|letzte aenderung (loeschen|zuruecknehmen))/.test(text)) return { type: "undo", reply: "" };

  const { found, rest: r1 } = findEntities(text, data);
  const rooms = [...new Set(found.filter((f) => f.kind === "room").map((f) => f.id))];
  const groups = [...new Set(found.filter((f) => f.kind === "group").map((f) => f.id))];
  const { date: dParsed, wd, explicit, rest: r2 } = findDate(r1, now);
  let periods = findPeriods(r2, settings);
  const isJetzt = /(?<![a-z])(jetzt|gerade|momentan|aktuell|sofort)(?![a-z])/.test(text) && !/ab jetzt|ab sofort/.test(text);
  const permanent = PERM_RE.test(text);
  const isQuestion = raw.trim().endsWith("?") || /^(was|welche[rsn]?|wo|wer|gibt es|zeig|liste|frei)(?![a-z])/.test(text);
  const isFree = FREE_RE.test(text);
  const note = extractNote(raw);

  const today = schoolToday(now);
  let date = dParsed || today;
  let assumedDay = !explicit;
  if (isJetzt || (!periods.length && isQuestion && isoDate(date) === isoDate(now))) {
    const cp = currentPeriod(settings.periods, now);
    if (!periods.length && cp.nr && weekday(now) <= 5) periods = [cp.nr];
  }
  const dayStr = `${DAY_SHORT[weekday(date)]} ${fmtDate(date)}`;

  // ── Fragen ──
  if (isQuestion && !(groups.length && rooms.length)) {
    if (weekday(date) > 5) return { type: "error", reply: "Am Wochenende gibt es keinen Plan." };
    if (!periods.length) periods = settings.periods.map((p) => p.nr);
    const iso = isoDate(date);
    if (groups.length && /^(wo|wann)/.test(text)) {
      const lines = groups.map((gid) => {
        const parts = periods.map((p) => {
          const st = slotState(data, iso, p);
          const where = [...st].filter(([, c]) => c.groups.includes(gid)).map(([rid]) => R[rid]?.name);
          return `${p}. EH: ${where.length ? where.join(", ") : "—"}`;
        });
        return `📍 ${G[gid].name} am ${dayStr}\n${parts.join("\n")}`;
      });
      return { type: "query", reply: lines.join("\n\n") };
    }
    const list = rooms.length ? data.rooms.filter((r) => rooms.includes(r.id)) : data.rooms;
    const free = freeRooms({ ...data, rooms: list }, iso, periods);
    const normal = free.filter((r) => !r.notnutzung), emerg = free.filter((r) => r.notnutzung);
    let reply = `🟢 Frei am ${dayStr}, ${fmtPeriods(periods)}:\n`;
    reply += normal.length ? normal.map((r) => r.name).join(", ") : "kein regulärer Raum frei";
    if (emerg.length) reply += `\n🟡 Zur Not: ${emerg.map((r) => r.name).join(", ")}`;
    return { type: "query", reply, free: free.map((r) => r.id) };
  }

  // ── Änderungen ──
  if (!groups.length && !rooms.length)
    return { type: "error", reply: "Ich habe keine Klasse und keinen Raum erkannt. Beispiel: „2a Do 3. EH frei“ oder „Werkraum morgen 5 frei“. Schreiben Sie „hilfe“ für alle Möglichkeiten." };
  if (!periods.length)
    return { type: "error", reply: `Welche Einheit? z.B. „${raw.trim()} 3. EH“ oder „… 3-4“ oder „… ganztags“.` };

  if (permanent) {
    if (!wd && !dParsed) return { type: "error", reply: "Für dauerhafte Änderungen bitte den Wochentag nennen, z.B. „jeden Donnerstag“." };
    const day = wd || weekday(date);
    const ops = []; const desc = [];
    if (groups.length && rooms.length && !isFree) {
      for (const gid of groups) for (const p of periods) { ops.push({ op: "removeGroup", day, period: p, group_id: gid }); ops.push({ op: "add", day, period: p, room_id: rooms[0], group_id: gid }); }
      desc.push(`${groups.map((g) => G[g].name).join(", ")} ist ab jetzt jeden ${DAY_SHORT[day]} in der ${fmtPeriods(periods)} in ${R[rooms[0]].name}`);
    } else if (groups.length) {
      for (const gid of groups) for (const p of periods) ops.push({ op: "removeGroup", day, period: p, group_id: gid });
      desc.push(`${groups.map((g) => G[g].name).join(", ")} hat jeden ${DAY_SHORT[day]} in der ${fmtPeriods(periods)} keinen Raum mehr im Plan`);
    } else if (rooms.length && isFree) {
      for (const rid of rooms) for (const p of periods) ops.push({ op: "clearRoom", day, period: p, room_id: rid });
      desc.push(`${rooms.map((r) => R[r].name).join(", ")} ist jeden ${DAY_SHORT[day]} in der ${fmtPeriods(periods)} frei`);
    } else {
      return { type: "error", reply: "Dauerhaft belegen geht nur mit Klasse/Gruppe, z.B. „Hort A jeden Mi 7-8 im Turnsaal“." };
    }
    return { type: "permanent", ops, reply: `📌 Stundenplan geändert: ${desc.join("; ")}.`, summary: desc.join("; "), day, periods };
  }

  if (weekday(date) > 5) return { type: "error", reply: "Das ist ein Wochenende – bitte einen Schultag angeben." };
  const iso = isoDate(date);
  const changes = []; const warn = []; const done = [];

  if (groups.length && rooms.length && !isFree) {
    const target = rooms[0];
    for (const gid of groups) {
      for (const p of periods) {
        const st = slotState(data, iso, p);
        const occ = st.get(target);
        const others = occ.groups.filter((x) => x !== gid);
        if (others.length) warn.push(`${p}. EH: ${R[target].name} ist schon von ${others.map((x) => G[x]?.name).join(", ")} belegt`);
        else if (occ.reserved) warn.push(`${p}. EH: ${R[target].name} ist bereits reserviert`);
        changes.push({ datum: iso, period: p, room_id: target, group_id: gid, art: "belegt", note, text: raw.trim() });
      }
      done.push(`${G[gid].name} ist am ${dayStr} in der ${fmtPeriods(periods)} in ${R[target].name}`);
    }
  } else if (groups.length) {
    if (!isFree) return { type: "error", reply: `Wohin soll ${groups.map((g) => G[g].name).join(", ")}? z.B. „${G[groups[0]].name} ${DAY_SHORT[weekday(date)]} ${periods[0]} in R12“ – oder „… frei“, wenn die Klasse keinen Raum braucht.` };
    for (const gid of groups) {
      const freed = new Set(); const missing = []; const alreadyFree = [];
      for (const p of periods) {
        const st = slotState(data, iso, p);
        const where = [...st].filter(([rid, c]) => c.groups.includes(gid) && (!rooms.length || rooms.includes(rid))).map(([rid]) => rid);
        if (!where.length) {
          const already = [...st].some(([, c]) => c.freedBy.includes(gid));
          (already ? alreadyFree : missing).push(p); continue;
        }
        for (const rid of where) { changes.push({ datum: iso, period: p, room_id: rid, group_id: gid, art: "frei", note, text: raw.trim() }); freed.add(rid); }
      }
      if (freed.size) done.push(`${G[gid].name} ist am ${dayStr} in der ${fmtPeriods(periods.filter((p) => !missing.includes(p)))} weg → ${[...freed].map((r) => R[r].name).join(", ")} frei`);
      if (alreadyFree.length) warn.push(`${G[gid].name} ist ${fmtPeriods(alreadyFree)} bereits als frei eingetragen`);
      if (missing.length) warn.push(`${G[gid].name} hat ${fmtPeriods(missing)} laut Plan keinen Raum`);
    }
  } else {
    for (const rid of rooms) {
      for (const p of periods) {
        const st = slotState(data, iso, p);
        const cell = st.get(rid);
        if (isFree) {
          if (!isBusy(cell)) warn.push(`${R[rid].name} ist ${p}. EH ohnehin frei`);
          changes.push({ datum: iso, period: p, room_id: rid, group_id: null, art: "frei", note, text: raw.trim() });
        } else {
          if (isBusy(cell)) warn.push(`${p}. EH: ${R[rid].name} ist schon von ${cell.groups.map((x) => G[x]?.name).join(", ") || "Reservierung"} belegt`);
          changes.push({ datum: iso, period: p, room_id: rid, group_id: null, art: "belegt", note: note || "reserviert", text: raw.trim() });
        }
      }
      done.push(`${R[rid].name} ist am ${dayStr} in der ${fmtPeriods(periods)} ${isFree ? "frei" : `reserviert${note ? ` (${note})` : ""}`}`);
    }
  }

  if (!changes.length) return { type: "error", reply: `Nichts zu ändern: ${warn.join("; ")}.` };
  let reply = `✅ ${done.join("\n✅ ")}`;
  if (assumedDay) reply += `\n(Kein Tag genannt – ich habe ${dayStr} angenommen.)`;
  if (warn.length) reply += `\n⚠️ ${warn.join("\n⚠️ ")}`;
  if (warn.some((w) => w.includes("belegt"))) {
    const alt = freeRooms(data, iso, periods).filter((r) => !r.notnutzung).slice(0, 4);
    if (alt.length) reply += `\n💡 Frei wären: ${alt.map((r) => r.name).join(", ")}`;
  }
  return { type: "change", changes, reply, warn };
}

/** Führt ein Ergebnis von parseCommand im Speicher aus. Gibt die Antwort zurück. */
export async function applyCommand(res, store, raw) {
  if (res.type === "change") {
    const rows = await store.addChanges(res.changes);
    return { ...res, rows };
  }
  if (res.type === "permanent") {
    const d = store.data;
    for (const o of res.ops) {
      if (o.op === "removeGroup") await store.removeGroupFromSlot(o.day, o.period, o.group_id);
      else if (o.op === "clearRoom") await store.setScheduleCell(o.day, o.period, o.room_id, []);
      else if (o.op === "add") await store.addSchedule([{ day: o.day, period: o.period, room_id: o.room_id, group_id: o.group_id }]);
    }
    const mon = new Date(); const iso = isoDate(nextWeekday(res.day, mon));
    const anyRoom = res.ops.find((o) => o.room_id)?.room_id || d.rooms[0]?.id || null;
    await store.addChanges([{ datum: iso, period: res.periods[0], room_id: anyRoom, group_id: null, art: "info", note: "Dauerhaft", text: `📌 ${raw.trim()} → ${res.summary}` }]);
    return res;
  }
  if (res.type === "undo") {
    const mine = store.data.changes
      .filter((c) => c.created_by === store.user?.id && c.art !== "info")
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    if (!mine.length) return { type: "error", reply: "Keine eigene Änderung zum Zurücknehmen gefunden." };
    const last = mine[0];
    const batch = mine.filter((c) => c.text === last.text && Math.abs(new Date(c.created_at) - new Date(last.created_at)) < 5000);
    await store.deleteChanges(batch.map((c) => c.id));
    return { type: "undo", reply: `↩️ Zurückgenommen: „${last.text || "Änderung"}“ (${batch.length} Eintr${batch.length === 1 ? "ag" : "äge"}).` };
  }
  return res;
}

export { parseIso };
