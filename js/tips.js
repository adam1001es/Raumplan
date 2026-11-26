// Automatische Hinweise für die Direktion.

import { isoDate, addDays, weekday, DAY_SHORT, fmtDate, currentPeriod, slotState, isBusy, weekUtil, byId, schoolToday, bookable } from "./model.js";
import { fmtPeriods } from "./parser.js";

/** Liefert [{level:'ok'|'info'|'warn'|'alert', icon, title, text}] */
export function computeTips(data, now = new Date()) {
  const tips = [];
  const R = byId(data.rooms), G = byId(data.groups);
  const today = schoolToday(now);
  const isToday = isoDate(today) === isoDate(now);
  const monday = addDays(today, 1 - weekday(today));
  const periods = data.settings.periods.map((p) => p.nr);
  const util = weekUtil(data, monday);

  // 1) Jetzt / nächste Einheit frei
  const cp = isToday ? currentPeriod(data.settings.periods, now) : { status: "vor", nr: periods[0] };
  if (cp.nr) {
    const st = slotState(data, isoDate(today), cp.nr);
    const free = data.rooms.filter((r) => bookable(r) && !isBusy(st.get(r.id)));
    const normal = free.filter((r) => !r.notnutzung), emerg = free.filter((r) => r.notnutzung);
    const when = cp.status === "jetzt" ? `Jetzt (${cp.nr}. EH)` : `${isToday ? "Nächste" : DAY_SHORT[weekday(today)]} ${cp.nr}. EH`;
    tips.push({
      level: normal.length ? "ok" : "warn", icon: normal.length ? "🟢" : "🔴",
      title: `${when}: ${normal.length} ${normal.length === 1 ? "Raum" : "Räume"} frei`,
      text: (normal.length ? normal.map((r) => r.name).join(", ") : "Kein regulärer Raum frei.") + (emerg.length ? ` · zur Not: ${emerg.map((r) => r.name).join(", ")}` : ""),
    });
  }

  // 2) Frei gewordene Räume (Änderungen ab heute)
  const todayIso = isoDate(today);
  const freed = data.changes.filter((c) => c.art === "frei" && c.datum >= todayIso).sort((a, b) => a.datum.localeCompare(b.datum) || a.period - b.period);
  const grouped = {};
  for (const c of freed) {
    const k = `${c.datum}|${c.room_id}|${c.group_id || ""}`;
    (grouped[k] ||= { ...c, periods: [] }).periods.push(c.period);
  }
  Object.values(grouped).slice(0, 5).forEach((c) => {
    const d = new Date(c.datum + "T12:00");
    tips.push({
      level: "info", icon: "✨",
      title: `${R[c.room_id]?.name || "Raum"} frei: ${DAY_SHORT[weekday(d)]} ${fmtDate(d)}, ${fmtPeriods([...new Set(c.periods)].sort((a, b) => a - b))}`,
      text: c.group_id ? `${G[c.group_id]?.name || "Klasse"} ist nicht da${c.note ? ` (${c.note})` : ""} – Raum kann vergeben werden.` : (c.note || "Raum freigegeben."),
    });
  });

  // 3) Doppelbelegungen + zu kleine Räume (diese Woche ab heute)
  const conflicts = []; const tooSmall = [];
  for (let d = weekday(today); d <= 5; d++) {
    for (const p of periods) {
      const st = util.bySlot[d][p].state;
      for (const [rid, cell] of st) {
        const room = R[rid];
        if (cell.groups.length > 1 && room && !["Speisesaal", "Mehrzweck", "Turnsaal"].includes(room.typ))
          conflicts.push(`${DAY_SHORT[d]} ${p}. EH ${room.name}: ${cell.groups.map((g) => G[g]?.name).join(" + ")}`);
        const kids = cell.groups.reduce((s, g) => s + (G[g]?.schueler || 0), 0);
        if (room?.kapazitaet && kids > room.kapazitaet) tooSmall.push(`${DAY_SHORT[d]} ${p}. EH ${room.name} (${kids}/${room.kapazitaet})`);
      }
    }
  }
  if (conflicts.length) tips.push({ level: "alert", icon: "⛔", title: `${conflicts.length} Doppelbelegung${conflicts.length > 1 ? "en" : ""}`, text: conflicts.slice(0, 4).join(" · ") + (conflicts.length > 4 ? " …" : "") });
  if (tooSmall.length) tips.push({ level: "warn", icon: "👥", title: "Raum zu klein", text: [...new Set(tooSmall)].slice(0, 3).join(" · ") });

  // 4) Engpässe (≥ 85 % der regulären Räume belegt)
  const peaks = [];
  for (let d = 1; d <= 5; d++) for (const p of periods) {
    const s = util.bySlot[d][p];
    if (s.total && s.busy / s.total >= 0.85) peaks.push({ d, p, s });
  }
  if (peaks.length) {
    const worst = peaks.sort((a, b) => b.s.busy / b.s.total - a.s.busy / a.s.total)[0];
    const emerg = data.rooms.filter((r) => bookable(r) && r.notnutzung && !isBusy(worst.s.state.get(r.id)));
    tips.push({
      level: "warn", icon: "📈", title: `Engpass: ${peaks.length} Einheit${peaks.length > 1 ? "en" : ""} fast voll`,
      text: `Am knappsten ${DAY_SHORT[worst.d]} ${worst.p}. EH (${worst.s.busy}/${worst.s.total} Räume).` + (emerg.length ? ` Ausweich: ${emerg.map((r) => r.name).join(", ")}.` : ""),
    });
  }

  // 5) Hort-Räume am Vormittag / Klassenräume am Nachmittag
  const morning = data.settings.periods.filter((p) => p.start < "12:30").map((p) => p.nr);
  const afternoon = data.settings.periods.filter((p) => p.start >= "12:30").map((p) => p.nr);
  const hortRooms = data.rooms.filter((r) => r.typ === "Hort");
  const hortFreeMorning = hortRooms.filter((r) => {
    let free = 0, tot = 0;
    for (let d = 1; d <= 5; d++) for (const p of morning) { tot++; if (!isBusy(util.bySlot[d][p].state.get(r.id))) free++; }
    return tot && free / tot > 0.6;
  });
  if (hortFreeMorning.length) tips.push({ level: "info", icon: "💡", title: "Hort-Räume vormittags meist frei", text: `${hortFreeMorning.map((r) => r.name).join(", ")} – ideal für Teilungs-, Förder- oder Religionsgruppen.` });

  if (afternoon.length) {
    let bestD = 0, bestCount = -1, bestRooms = [];
    for (let d = 1; d <= 5; d++) {
      const freeAll = data.rooms.filter((r) => r.typ === "Klassenraum" && afternoon.slice(1).every((p) => !isBusy(util.bySlot[d][p].state.get(r.id))));
      if (freeAll.length > bestCount) { bestCount = freeAll.length; bestD = d; bestRooms = freeAll; }
    }
    if (bestCount > 0) tips.push({ level: "info", icon: "🏫", title: `${DAY_SHORT[bestD]} nachmittags ${bestCount} Klassenräume frei`, text: `Ab der ${afternoon[1] || afternoon[0]}. EH: ${bestRooms.slice(0, 6).map((r) => r.name).join(", ")}${bestRooms.length > 6 ? " …" : ""} – Platz für Hort oder Lernbetreuung.` });
  }

  // 6) Wenig genutzte Räume
  const low = data.rooms.filter((r) => bookable(r) && !r.notnutzung && r.typ !== "Hort" && util.byRoom[r.id] < 0.3).sort((a, b) => util.byRoom[a.id] - util.byRoom[b.id]);
  if (low.length) tips.push({ level: "info", icon: "📉", title: "Wenig genutzt (Reserve)", text: low.slice(0, 4).map((r) => `${r.name} ${Math.round(util.byRoom[r.id] * 100)} %`).join(" · ") });

  return tips;
}
