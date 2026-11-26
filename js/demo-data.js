// Beispieldaten für den Demo-Modus (NMS + PTS + Volksschule + Hort).
// Werden auch als Startwerte angeboten, wenn die echte Datenbank leer ist.

import { mondayOf, isoDate, addDays } from "./model.js";

export const DEFAULT_PERIODS = [
  { nr: 1, start: "07:50", end: "08:40" },
  { nr: 2, start: "08:45", end: "09:35" },
  { nr: 3, start: "09:50", end: "10:40" },
  { nr: 4, start: "10:45", end: "11:35" },
  { nr: 5, start: "11:40", end: "12:30" },
  { nr: 6, start: "12:35", end: "13:25" },
  { nr: 7, start: "13:30", end: "14:20" },
  { nr: 8, start: "14:25", end: "15:15" },
  { nr: 9, start: "15:20", end: "16:10" },
  { nr: 10, start: "16:10", end: "17:00" },
];

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function buildDemoData() {
  const rand = rng(42);
  const rooms = [];
  const add = (id, name, typ, bereich, kapazitaet, notnutzung = false) =>
    rooms.push({ id, name, typ, bereich, kapazitaet, notnutzung, sort: rooms.length });

  ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b"].forEach((k, i) =>
    add(`r${i + 1}`, `R${String(i + 1).padStart(2, "0")}`, "Klassenraum", "NMS", 26));
  add("r9", "R09", "Klassenraum", "PTS", 24);
  add("r10", "R10", "Klassenraum", "PTS", 24);
  add("r11", "R11", "Klassenraum", "VS", 25);
  add("r12", "R12", "Klassenraum", "VS", 25);
  add("r13", "R13", "Klassenraum", "VS", 25);
  add("r14", "R14", "Klassenraum", "VS", 25);
  add("h1", "Hort 1", "Hort", "Hort", 25);
  add("h2", "Hort 2", "Hort", "Hort", 25);
  add("ts", "Turnsaal", "Turnsaal", "gemeinsam", 30);
  add("wr", "Werkraum", "Werkraum", "gemeinsam", 26);
  add("edv", "EDV-Raum", "EDV", "gemeinsam", 24);
  add("mu", "Musiksaal", "Musik", "gemeinsam", 28);
  add("bib", "Bibliothek", "Bibliothek", "gemeinsam", 20, true);
  add("aula", "Aula", "Mehrzweck", "gemeinsam", 80, true);
  add("sp", "Speisesaal", "Speisesaal", "gemeinsam", 60, true);

  const groups = [];
  const g = (id, name, bereich, stammraum, schueler) =>
    groups.push({ id, name, bereich, stammraum, schueler });
  ["1a", "1b", "2a", "2b", "3a", "3b", "4a", "4b"].forEach((k, i) =>
    g(`g${k}`, k, "NMS", `r${i + 1}`, 20 + Math.floor(rand() * 6)));
  g("gp1", "P1", "PTS", "r9", 21);
  g("gp2", "P2", "PTS", "r10", 19);
  g("gvs1", "VS 1", "VS", "r11", 22);
  g("gvs2", "VS 2", "VS", "r12", 23);
  g("gvs3", "VS 3", "VS", "r13", 24);
  g("gvs4", "VS 4", "VS", "r14", 22);
  g("ghA", "Hort A", "Hort", "h1", 24);
  g("ghB", "Hort B", "Hort", "h2", 22);
  g("gdf", "Deutschförderung", "NMS", null, 9);
  g("grel", "Religion (Gruppe)", "gemeinsam", null, 12);

  // Belegung: occ[day][period] = Map(roomId -> groupId)
  const occ = {};
  for (let d = 1; d <= 5; d++) { occ[d] = {}; for (let p = 1; p <= 10; p++) occ[d][p] = new Map(); }
  const groupBusy = (gid, d, p) => [...occ[d][p].values()].includes(gid);
  const place = (d, p, room, gid) => occ[d][p].set(room, gid);

  // Stunden je Klasse
  const hours = (grp) => {
    const res = [];
    for (let d = 1; d <= 5; d++) {
      let last = 6;
      if (grp.bereich === "VS") last = d === 5 ? 4 : 5;
      if (["3a", "3b", "4a", "4b", "P1", "P2"].includes(grp.name) && (d === 2 || d === 4)) last = 8;
      if (["1a", "1b", "2a", "2b"].includes(grp.name) && d === 3) last = 7;
      for (let p = 1; p <= last; p++) res.push([d, p]);
    }
    return res;
  };

  // Fachräume zuerst vergeben (in Doppelstunden), Rest im Stammraum
  const special = [
    { room: "ts", who: (x) => ["NMS", "PTS", "VS"].includes(x.bereich), n: 2, double: true },
    { room: "wr", who: (x) => ["1a", "1b", "2a", "2b", "P1", "P2"].includes(x.name), n: 2, double: true },
    { room: "edv", who: (x) => ["3a", "3b", "4a", "4b", "P1", "P2"].includes(x.name), n: 1, double: false },
    { room: "mu", who: (x) => x.bereich === "NMS" || x.bereich === "VS", n: 1, double: false },
  ];
  const classes = groups.filter((x) => ["NMS", "PTS", "VS"].includes(x.bereich) && x.stammraum);
  for (const sp of special) {
    for (const cls of classes.filter(sp.who)) {
      const slots = hours(cls).sort(() => rand() - 0.5);
      let placed = 0;
      for (const [d, p] of slots) {
        if (placed >= sp.n) break;
        const need = sp.double ? [p, p + 1] : [p];
        const ok = need.every((pp) =>
          hours(cls).some(([dd, q]) => dd === d && q === pp) &&
          !occ[d][pp].has(sp.room) && !groupBusy(cls.id, d, pp));
        if (!ok) continue;
        need.forEach((pp) => place(d, pp, sp.room, cls.id));
        placed += need.length;
      }
    }
  }
  for (const cls of classes) {
    for (const [d, p] of hours(cls)) if (!groupBusy(cls.id, d, p)) place(d, p, cls.stammraum, cls.id);
  }
  // Hort
  for (let d = 1; d <= 5; d++) {
    const endA = d === 5 ? 8 : 10;
    place(d, 6, "sp", "ghA");
    for (let p = 7; p <= endA; p++) place(d, p, "h1", "ghA");
    place(d, 7, "sp", "ghB");
    for (let p = 8; p <= endA; p++) place(d, p, d === 3 ? "r11" : "h2", "ghB");
    place(d, 6, "h2", "ghB");
  }
  // Kleingruppen in freie Räume (oft Hort-Räume am Vormittag)
  const smallSlots = [[1, 2], [1, 3], [2, 4], [3, 2], [4, 3], [5, 2]];
  smallSlots.forEach(([d, p], i) => {
    const gid = i % 2 ? "grel" : "gdf";
    const free = rooms.find((r) => !r.notnutzung && r.typ !== "Turnsaal" && !occ[d][p].has(r.id) && r.bereich !== "VS");
    if (free) place(d, p, free.id, gid);
  });

  const schedule = [];
  let sid = 1;
  for (let d = 1; d <= 5; d++) for (let p = 1; p <= 10; p++)
    for (const [room_id, group_id] of occ[d][p]) schedule.push({ id: `s${sid++}`, day: d, period: p, room_id, group_id, note: "" });

  // ein paar Änderungen in dieser Woche
  const today = new Date();
  let mon = mondayOf(today);
  if (today.getDay() === 0 || today.getDay() === 6) mon = addDays(mon, 7);
  const dayDate = (d) => isoDate(addDays(mon, d - 1));
  const now = Date.now();
  const changes = [
    { id: "c1", datum: dayDate(4), period: 3, room_id: "r3", group_id: "g2a", art: "frei", note: "Ausflug", text: "2a Do 3. EH frei (Ausflug)", created_by: "demo-master", created_at: new Date(now - 3600e3).toISOString() },
    { id: "c2", datum: dayDate(4), period: 4, room_id: "r3", group_id: "g2a", art: "frei", note: "Ausflug", text: "2a Do 4. EH frei (Ausflug)", created_by: "demo-master", created_at: new Date(now - 3600e3).toISOString() },
    { id: "c3", datum: dayDate(2), period: 7, room_id: "wr", group_id: "ghA", art: "belegt", note: "Bastelnachmittag", text: "Hort A Di 7. EH im Werkraum", created_by: "demo-editor", created_at: new Date(now - 7200e3).toISOString() },
    { id: "c4", datum: dayDate(5), period: 5, room_id: "r9", group_id: "gp1", art: "frei", note: "Berufspraktische Tage", text: "P1 Fr 5. EH frei", created_by: "demo-editor", created_at: new Date(now - 9000e3).toISOString() },
  ];

  return {
    settings: { schoolName: "Mittelschule & PTS", periods: DEFAULT_PERIODS, publicView: true, days: 5 },
    rooms, groups, schedule, changes,
    profiles: [
      { id: "demo-master", email: "direktion@schule.at", name: "Direktion", role: "master" },
      { id: "demo-editor", email: "hort@schule.at", name: "Hortleitung", role: "editor" },
      { id: "demo-viewer", email: "lehrer@schule.at", name: "Lehrkraft", role: "viewer" },
    ],
  };
}
