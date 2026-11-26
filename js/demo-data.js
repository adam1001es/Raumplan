// Beispieldaten nach dem Schulhausplan von St. Marien (Liniengasse 21, 1060 Wien),
// laut www.liniengasse.at → Schulalltag → Schulhausplan & Rundgang.
// Volksschule im 1. OG (nicht für MS/PTS nutzbar). Klassen zur Straßenseite.
// Stundenplan und Schülerzahlen sind erfunden und dienen nur zur Vorführung.

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

// Lage der Trakte: L-Form an der Ecke Liniengasse/Millergasse + Hofgebäude (Festsaal).
// x/z in Raster-Einheiten, Drehung in Grad, laenge = Mindestlänge in Raumbreiten.
export const DEMO_GEBAEUDE = [
  { name: "Liniengasse", x: 0, z: 0, rot: 90, laenge: 6 },
  { name: "Millergasse", x: 3.9, z: -3.9, rot: 0, flip: true, laenge: 3 },
  { name: "Hof", x: 5.4, z: -13.4, rot: 0, laenge: 3 },
];
export const DEMO_STOCKNAMEN = { 6: "Dach" };

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

export function buildDemoData() {
  const rand = rng(7);
  const rooms = [];
  // id, Name, Art, Bereich, Plätze, Notfall, Trakt, Stock, Seite, Größe
  const R = (id, name, typ, bereich, kapazitaet, notnutzung, trakt, stock, seite, groesse = 1) =>
    rooms.push({ id, name, typ, bereich, kapazitaet, notnutzung, trakt, stock, seite, groesse, sort: stock * 100 + rooms.length });

  // EG
  R("aula", "Aula", "Mehrzweck", "gemeinsam", 80, true, "Liniengasse", 0, "strasse", 2);
  R("foyer", "Pforte & Foyer", "Verwaltung", "gemeinsam", 0, false, "Liniengasse", 0, "strasse");
  R("halle", "Halle", "Mehrzweck", "gemeinsam", 60, true, "Liniengasse", 0, "strasse", 2);
  R("sp", "Speisesaal", "Speisesaal", "gemeinsam", 60, true, "Liniengasse", 0, "hof", 2);
  R("kueche", "Küche", "Nebenraum", "gemeinsam", 0, false, "Liniengasse", 0, "hof");
  R("buffet", "Buffet", "Nebenraum", "gemeinsam", 0, false, "Liniengasse", 0, "hof");
  R("gard", "Garderoben", "Nebenraum", "gemeinsam", 0, false, "Millergasse", 0, "strasse");
  R("fs", "Festsaal/Turnsaal", "Turnsaal", "gemeinsam", 60, false, "Hof", 0, "strasse", 3);
  // 1. OG – Volksschule
  R("r101", "R101", "Klassenraum", "VS", 25, false, "Liniengasse", 1, "strasse");
  R("r102", "R102", "Klassenraum", "VS", 25, false, "Liniengasse", 1, "strasse");
  R("r103", "R103", "Klassenraum", "VS", 25, false, "Liniengasse", 1, "strasse");
  R("r104", "R104", "Klassenraum", "VS", 25, false, "Liniengasse", 1, "strasse");
  R("wrt", "Werkraum techn.", "Werkraum", "gemeinsam", 26, false, "Liniengasse", 1, "hof");
  R("wrx", "Werkraum text.", "Werkraum", "gemeinsam", 26, false, "Liniengasse", 1, "hof");
  R("kap", "Kapelle", "Mehrzweck", "gemeinsam", 40, true, "Millergasse", 1, "strasse", 2);
  // 2. OG – Verwaltung
  R("dir", "Direktion", "Verwaltung", "gemeinsam", 0, false, "Liniengasse", 2, "strasse");
  R("sek", "Sekretariat", "Verwaltung", "gemeinsam", 0, false, "Liniengasse", 2, "strasse");
  R("buch", "Buchhaltung", "Verwaltung", "gemeinsam", 0, false, "Liniengasse", 2, "strasse");
  R("lz", "Lehrerzimmer", "Verwaltung", "gemeinsam", 0, false, "Liniengasse", 2, "strasse", 2);
  R("os", "Leitung Offene Schule", "Verwaltung", "gemeinsam", 0, false, "Liniengasse", 2, "hof");
  R("edv1", "EDV-Raum 1", "EDV", "gemeinsam", 26, false, "Millergasse", 2, "strasse");
  // 3. OG
  R("r301", "R301", "Klassenraum", "NMS", 26, false, "Liniengasse", 3, "strasse");
  R("r302", "R302", "Klassenraum", "NMS", 26, false, "Liniengasse", 3, "strasse");
  R("r303", "R303", "Klassenraum", "NMS", 26, false, "Liniengasse", 3, "strasse");
  R("r304", "R304", "Klassenraum", "NMS", 26, false, "Liniengasse", 3, "strasse");
  R("bib", "Bibliothek", "Bibliothek", "gemeinsam", 24, true, "Liniengasse", 3, "hof", 2);
  R("spf", "Sprachförderklasse", "Klassenraum", "NMS", 14, false, "Liniengasse", 3, "hof");
  R("phc", "Physik/Chemie", "Sonstiges", "gemeinsam", 26, false, "Millergasse", 3, "strasse");
  // 4. OG
  R("r401", "R401", "Klassenraum", "NMS", 26, false, "Liniengasse", 4, "strasse");
  R("r402", "R402", "Klassenraum", "NMS", 26, false, "Liniengasse", 4, "strasse");
  R("r403", "R403", "Klassenraum", "NMS", 26, false, "Liniengasse", 4, "strasse");
  R("r404", "R404", "Klassenraum", "NMS", 26, false, "Liniengasse", 4, "strasse");
  R("edv2", "EDV-Raum 2", "EDV", "gemeinsam", 26, false, "Liniengasse", 4, "hof");
  R("arzt", "Arztzimmer", "Verwaltung", "gemeinsam", 0, false, "Liniengasse", 4, "hof");
  R("skue", "Schulküche", "Sonstiges", "gemeinsam", 26, false, "Liniengasse", 4, "hof");
  R("hort", "Hort & Tagesbetreuung", "Hort", "Hort", 30, false, "Millergasse", 4, "strasse", 2);
  // 5. OG
  R("r501", "R501", "Klassenraum", "NMS", 26, false, "Liniengasse", 5, "strasse");
  R("r502", "R502", "Klassenraum", "NMS", 26, false, "Liniengasse", 5, "strasse");
  R("r503", "R503", "Klassenraum", "NMS", 26, false, "Liniengasse", 5, "strasse");
  R("r504", "R504", "Klassenraum", "PTS", 24, false, "Liniengasse", 5, "strasse");
  R("zs", "Zeichensaal", "Sonstiges", "gemeinsam", 26, false, "Liniengasse", 5, "hof");
  R("bes", "Besprechung", "Mehrzweck", "gemeinsam", 12, true, "Liniengasse", 5, "hof");
  R("ts2", "Turnsaal", "Turnsaal", "gemeinsam", 30, false, "Millergasse", 5, "strasse", 2);
  // Dach
  R("sport", "Sportplatz Dach", "Turnsaal", "gemeinsam", 30, false, "Liniengasse", 6, "strasse", 3);
  R("garten", "Dachgarten", "Sonstiges", "gemeinsam", 30, true, "Liniengasse", 6, "hof", 2);
  rooms.sort((a, b) => a.sort - b.sort);

  const groups = [];
  const g = (id, name, bereich, stammraum, schueler) => groups.push({ id, name, bereich, stammraum, schueler });
  [["1a", "r301"], ["1b", "r302"], ["4a", "r303"], ["4c", "r304"], ["3a", "r401"], ["3b", "r402"], ["3c", "r403"], ["4b", "r404"], ["2a", "r501"], ["2b", "r502"], ["2c", "r503"]]
    .forEach(([k, r]) => g(`g${k}`, k, "NMS", r, 20 + Math.floor(rand() * 6)));
  g("gpts", "PTS", "PTS", "r504", 22);
  g("gspf", "Sprachförderung", "NMS", "spf", 10);
  g("gvs1", "VS 1", "VS", "r101", 22); g("gvs2", "VS 2", "VS", "r102", 23);
  g("gvs3", "VS 3", "VS", "r103", 24); g("gvs4", "VS 4", "VS", "r104", 22);
  g("ghort", "Hort", "Hort", "hort", 28);
  g("gos", "Offene Schule", "Hort", null, 24);
  g("grel", "Religion (Gruppe)", "gemeinsam", null, 12);

  const occ = {};
  for (let d = 1; d <= 5; d++) { occ[d] = {}; for (let p = 1; p <= 10; p++) occ[d][p] = new Map(); }
  const busy = (gid, d, p) => [...occ[d][p].values()].includes(gid);
  const place = (d, p, room, gid) => occ[d][p].set(room, gid);
  const hours = (grp) => {
    const res = [];
    for (let d = 1; d <= 5; d++) {
      let last = 6;
      if (grp.bereich === "VS") last = d === 5 ? 4 : 5;
      if (["3a", "3b", "3c", "4a", "4b", "4c", "PTS"].includes(grp.name) && (d === 2 || d === 4)) last = 8;
      if (["1a", "1b", "2a", "2b", "2c"].includes(grp.name) && d === 3) last = 7;
      if (grp.name === "Sprachförderung") last = 4;
      for (let p = 1; p <= last; p++) res.push([d, p]);
    }
    return res;
  };
  const MS = (x) => x.bereich === "NMS" && x.name !== "Sprachförderung";
  const special = [
    { rooms: ["fs", "ts2"], who: (x) => MS(x) || x.bereich === "PTS" || x.bereich === "VS", n: 2, double: true },
    { rooms: ["sport"], who: (x) => ["2a", "2b", "2c", "3a", "3b"].includes(x.name), n: 1 },
    { rooms: ["wrt", "wrx"], who: (x) => ["1a", "1b", "2a", "2b", "2c", "PTS"].includes(x.name), n: 2, double: true },
    { rooms: ["edv1", "edv2"], who: (x) => ["3a", "3b", "3c", "4a", "4b", "4c", "PTS"].includes(x.name), n: 2 },
    { rooms: ["phc"], who: (x) => ["3a", "3b", "3c", "4a", "4b", "4c"].includes(x.name), n: 2 },
    { rooms: ["zs"], who: MS, n: 2, double: true },
    { rooms: ["skue"], who: (x) => ["4a", "4b", "4c", "PTS"].includes(x.name), n: 2, double: true },
  ];
  const classes = groups.filter((x) => (x.bereich === "NMS" || x.bereich === "PTS" || x.bereich === "VS") && x.stammraum);
  for (const sp of special) {
    for (const cls of classes.filter(sp.who)) {
      const own = hours(cls);
      const slots = [...own].sort(() => rand() - 0.5);
      let placed = 0;
      for (const [d, p] of slots) {
        if (placed >= sp.n) break;
        const need = sp.double ? [p, p + 1] : [p];
        const room = sp.rooms.find((r) => need.every((pp) => !occ[d][pp].has(r)));
        const ok = room && need.every((pp) => own.some(([dd, q]) => dd === d && q === pp) && !busy(cls.id, d, pp));
        if (!ok) continue;
        need.forEach((pp) => place(d, pp, room, cls.id));
        placed += need.length;
      }
    }
  }
  for (const cls of classes) for (const [d, p] of hours(cls)) if (!busy(cls.id, d, p)) place(d, p, cls.stammraum, cls.id);
  // Hort & Offene Schule am Nachmittag
  for (let d = 1; d <= 5; d++) {
    const end = d === 5 ? 8 : 10;
    place(d, 6, "sp", "ghort");
    for (let p = 7; p <= end; p++) place(d, p, "hort", "ghort");
    place(d, 7, "sp", "gos");
    const osRoom = d === 2 || d === 4 ? "halle" : "r301";
    for (let p = 8; p <= end; p++) if (!occ[d][p].has(osRoom)) place(d, p, osRoom, "gos");
  }
  // Religionsgruppe in freie Räume
  [[1, 3], [2, 2], [3, 4], [4, 3], [5, 2]].forEach(([d, p]) => {
    const free = rooms.find((r) => r.typ === "Klassenraum" && r.bereich !== "VS" && !occ[d][p].has(r.id));
    if (free) place(d, p, free.id, "grel");
  });

  const schedule = [];
  let sid = 1;
  for (let d = 1; d <= 5; d++) for (let p = 1; p <= 10; p++)
    for (const [room_id, group_id] of occ[d][p]) schedule.push({ id: `s${sid++}`, day: d, period: p, room_id, group_id, note: "" });

  const today = new Date();
  let mon = mondayOf(today);
  if (today.getDay() === 0 || today.getDay() === 6) mon = addDays(mon, 7);
  const dayDate = (d) => isoDate(addDays(mon, d - 1));
  const now = Date.now();
  const at = (h) => new Date(now - h * 3600e3).toISOString();
  const changes = [
    { id: "c1", datum: dayDate(4), period: 3, room_id: "r501", group_id: "g2a", art: "frei", note: "Ausflug", text: "2a Do 3-4 frei (Ausflug)", created_by: "demo-master", created_at: at(1) },
    { id: "c2", datum: dayDate(4), period: 4, room_id: "r501", group_id: "g2a", art: "frei", note: "Ausflug", text: "2a Do 3-4 frei (Ausflug)", created_by: "demo-master", created_at: at(1) },
    { id: "c3", datum: dayDate(2), period: 7, room_id: "wrx", group_id: "ghort", art: "belegt", note: "Bastelnachmittag", text: "Hort Di 7. EH im Werkraum text.", created_by: "demo-editor", created_at: at(2) },
    { id: "c4", datum: dayDate(5), period: 5, room_id: "r504", group_id: "gpts", art: "frei", note: "Berufspraktische Tage", text: "PTS Fr 5. EH frei", created_by: "demo-editor", created_at: at(3) },
  ];

  return {
    settings: { schoolName: "St. Marien – MS & PTS", periods: DEFAULT_PERIODS, publicView: true, days: 5, gebaeude: DEMO_GEBAEUDE, stockNamen: DEMO_STOCKNAMEN },
    rooms, groups, schedule, changes,
    profiles: [
      { id: "demo-master", email: "direktion@schule.at", name: "Direktion", role: "master" },
      { id: "demo-editor", email: "hort@schule.at", name: "Hortleitung", role: "editor" },
      { id: "demo-viewer", email: "lehrer@schule.at", name: "Lehrkraft", role: "viewer" },
    ],
  };
}
