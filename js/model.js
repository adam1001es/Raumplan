// Reine Berechnungen: Datum, Einheiten, tatsächliche Raumbelegung.

export const DAY_NAMES = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
export const DAY_SHORT = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const BEREICHE = ["NMS", "PTS", "VS", "Hort", "gemeinsam"];
export const ROOM_TYPES = ["Klassenraum", "Turnsaal", "Werkraum", "EDV", "Musik", "Hort", "Bibliothek", "Mehrzweck", "Speisesaal", "Sonstiges"];

// ── Datum ──────────────────────────────────────────────────────
export function isoDate(d) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function parseIso(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
export function mondayOf(d) {
  const wd = d.getDay() || 7;
  return addDays(d, 1 - wd);
}
/** Wochentag 1=Mo … 7=So */
export function weekday(d) { return d.getDay() || 7; }
export function fmtDate(d) {
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}
/** Nächster Schultag (heute, falls Mo–Fr) */
export function schoolToday(now = new Date()) {
  const wd = weekday(now);
  if (wd <= 5) return addDays(now, 0);
  return addDays(now, 8 - wd);
}
/** Datum des nächsten Wochentags wd (1–5), heute eingeschlossen */
export function nextWeekday(wd, now = new Date()) {
  const cur = weekday(now);
  let diff = wd - cur;
  if (diff < 0) diff += 7;
  return addDays(now, diff);
}

// ── Einheiten ──────────────────────────────────────────────────
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
/** Aktuelle bzw. nächste Einheit. {nr, status:'jetzt'|'pause'|'vor'|'nach', period} */
export function currentPeriod(periods, now = new Date()) {
  const m = now.getHours() * 60 + now.getMinutes();
  const ps = [...periods].sort((a, b) => a.nr - b.nr);
  if (!ps.length) return { status: "nach" };
  if (m < toMin(ps[0].start)) return { status: "vor", period: ps[0], nr: ps[0].nr };
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (m >= toMin(p.start) && m < toMin(p.end)) return { status: "jetzt", period: p, nr: p.nr };
    const n = ps[i + 1];
    if (n && m >= toMin(p.end) && m < toMin(n.start)) return { status: "pause", period: n, nr: n.nr };
  }
  return { status: "nach" };
}

// ── Belegung ───────────────────────────────────────────────────
/**
 * Tatsächliche Belegung aller Räume für ein Datum + Einheit.
 * Ergebnis: Map roomId -> { groups:[groupId], changed:bool, notes:[], freedBy:[groupId] }
 */
export function slotState(data, dateIso, period) {
  const wd = weekday(parseIso(dateIso));
  const map = new Map();
  for (const r of data.rooms) map.set(r.id, { groups: [], changed: false, notes: [], freedBy: [], reserved: false });
  for (const s of data.schedule) {
    if (s.day === wd && s.period === period && map.has(s.room_id)) map.get(s.room_id).groups.push(s.group_id);
  }
  const ch = data.changes
    .filter((c) => c.datum === dateIso && c.period === period && (c.art === "frei" || c.art === "belegt"))
    .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  for (const c of ch) {
    const cell = map.get(c.room_id);
    if (!cell) continue;
    if (c.art === "frei") {
      if (c.group_id) {
        cell.groups = cell.groups.filter((g) => g !== c.group_id);
        cell.freedBy.push(c.group_id);
      } else {
        cell.freedBy.push(...cell.groups);
        cell.groups = [];
        cell.reserved = false;
      }
    } else {
      if (c.group_id) {
        // Gruppe zieht um: aus allen anderen Räumen entfernen
        for (const [rid, other] of map) {
          if (rid !== c.room_id && other.groups.includes(c.group_id)) {
            other.groups = other.groups.filter((g) => g !== c.group_id);
            other.changed = true;
            other.freedBy.push(c.group_id);
          }
        }
        if (!cell.groups.includes(c.group_id)) cell.groups.push(c.group_id);
      } else {
        cell.reserved = true;
      }
    }
    cell.changed = true;
    if (c.note) cell.notes.push(c.note);
  }
  return map;
}

export function isBusy(cell) { return cell.groups.length > 0 || cell.reserved; }

/** Wo ist Gruppe gid zu Datum/Einheit? -> roomId[] */
export function whereIs(data, gid, dateIso, period) {
  const st = slotState(data, dateIso, period);
  return [...st].filter(([, c]) => c.groups.includes(gid)).map(([rid]) => rid);
}

/** Auslastung für eine Woche: {byRoom: {rid: pct}, bySlot: {d: {p: {busy,total}}}} */
export function weekUtil(data, monday) {
  const periods = data.settings.periods.map((p) => p.nr);
  const regular = data.rooms.filter((r) => !r.notnutzung);
  const byRoomCount = Object.fromEntries(data.rooms.map((r) => [r.id, 0]));
  const bySlot = {};
  for (let d = 1; d <= 5; d++) {
    bySlot[d] = {};
    const iso = isoDate(addDays(monday, d - 1));
    for (const p of periods) {
      const st = slotState(data, iso, p);
      let busy = 0;
      for (const r of regular) if (isBusy(st.get(r.id))) busy++;
      for (const r of data.rooms) if (isBusy(st.get(r.id))) byRoomCount[r.id]++;
      bySlot[d][p] = { busy, total: regular.length, state: st };
    }
  }
  const slots = 5 * periods.length || 1;
  const byRoom = Object.fromEntries(Object.entries(byRoomCount).map(([k, v]) => [k, v / slots]));
  return { byRoom, bySlot };
}

// ── Hilfen ─────────────────────────────────────────────────────
export function byId(list) { return Object.fromEntries(list.map((x) => [x.id, x])); }
export function periodLabel(settings, nr) {
  const p = settings.periods.find((x) => x.nr === nr);
  return p ? `${nr}. EH · ${p.start}–${p.end}` : `${nr}. EH`;
}
export function bereichClass(b) {
  return { NMS: "b-nms", PTS: "b-pts", VS: "b-vs", Hort: "b-hort" }[b] || "b-gem";
}
