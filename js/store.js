// Datenspeicher: DEMO (localStorage, nur dieses Gerät) oder SUPABASE (live, alle Geräte).
// Beide bieten dieselben Funktionen, die Seiten merken keinen Unterschied.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { buildDemoData, DEFAULT_PERIODS } from "./demo-data.js";

const DEMO_KEY = "raumplan-demo-v1";
const DEMO_USER_KEY = "raumplan-demo-user";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id${Date.now()}${Math.random().toString(16).slice(2)}`);

export const ROLE_LABEL = { master: "Direktion (Master)", editor: "Bearbeiten", viewer: "Nur ansehen", pending: "Wartet auf Freigabe" };

function emptyData() {
  return {
    settings: { schoolName: "Unsere Schule", periods: DEFAULT_PERIODS, publicView: true, days: 5 },
    rooms: [], groups: [], schedule: [], changes: [], profiles: [],
  };
}

class BaseStore {
  constructor() { this.listeners = new Set(); this.data = emptyData(); this.user = null; }
  onChange(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  emit() { for (const cb of this.listeners) { try { cb(this.data); } catch (e) { console.error(e); } } }
  get role() { return this.user?.role || null; }
  get canEdit() { return this.role === "master" || this.role === "editor"; }
  get isMaster() { return this.role === "master"; }
}

// ── DEMO ───────────────────────────────────────────────────────
class DemoStore extends BaseStore {
  constructor() {
    super();
    this.mode = "demo";
    this.chan = "BroadcastChannel" in window ? new BroadcastChannel("raumplan") : null;
    if (this.chan) this.chan.onmessage = () => { this.load(); this.emit(); };
    window.addEventListener("storage", (e) => { if (e.key === DEMO_KEY) { this.load(); this.emit(); } });
  }
  async init() {
    this.load();
    const uidSel = localStorage.getItem(DEMO_USER_KEY) || "demo-master";
    this.user = this.data.profiles.find((p) => p.id === uidSel) || this.data.profiles[0];
    return this;
  }
  load() {
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      this.data = raw ? JSON.parse(raw) : buildDemoData();
      if (!raw) this.persist(false);
    } catch { this.data = buildDemoData(); }
  }
  persist(broadcast = true) {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(this.data)); } catch (e) { console.warn(e); }
    if (broadcast && this.chan) this.chan.postMessage("changed");
    this.emit();
  }
  switchUser(id) { localStorage.setItem(DEMO_USER_KEY, id); this.user = this.data.profiles.find((p) => p.id === id); this.emit(); }
  resetDemo() { this.data = buildDemoData(); this.persist(); }
  async signIn() { return { error: null }; }
  async signUp() { return { error: null }; }
  async signOut() {}
  // Mutationen
  async addChanges(list) {
    const rows = list.map((c) => ({ id: uid(), created_by: this.user?.id, created_at: new Date().toISOString(), note: "", text: "", ...c }));
    this.data.changes.push(...rows); this.persist(); return rows;
  }
  async deleteChange(id) { this.data.changes = this.data.changes.filter((c) => c.id !== id); this.persist(); }
  async deleteChanges(ids) { const s = new Set(ids); this.data.changes = this.data.changes.filter((c) => !s.has(c.id)); this.persist(); }
  async upsert(table, row) {
    const list = this.data[table];
    if (!row.id) row = { ...row, id: uid() };
    const i = list.findIndex((x) => x.id === row.id);
    if (i >= 0) list[i] = { ...list[i], ...row }; else list.push(row);
    this.persist(); return row;
  }
  async remove(table, id) {
    this.data[table] = this.data[table].filter((x) => x.id !== id);
    if (table === "rooms") this.data.schedule = this.data.schedule.filter((s) => s.room_id !== id);
    if (table === "groups") this.data.schedule = this.data.schedule.filter((s) => s.group_id !== id);
    this.persist();
  }
  async setScheduleCell(day, period, room_id, group_ids) {
    this.data.schedule = this.data.schedule.filter((s) => !(s.day === day && s.period === period && s.room_id === room_id));
    for (const g of group_ids) this.data.schedule.push({ id: uid(), day, period, room_id, group_id: g, note: "" });
    this.persist();
  }
  async removeGroupFromSlot(day, period, group_id) {
    this.data.schedule = this.data.schedule.filter((s) => !(s.day === day && s.period === period && s.group_id === group_id));
    this.persist();
  }
  async addSchedule(rows) { this.data.schedule.push(...rows.map((r) => ({ id: uid(), note: "", ...r }))); this.persist(); }
  async saveSettings(settings) { this.data.settings = { ...this.data.settings, ...settings }; this.persist(); }
  async setRole(id, role) { const p = this.data.profiles.find((x) => x.id === id); if (p) p.role = role; this.persist(); }
  async replaceAll(d) { const profiles = this.data.profiles; this.data = { ...emptyData(), ...d, profiles }; this.persist(); }
}

// ── SUPABASE ───────────────────────────────────────────────────
class SupaStore extends BaseStore {
  constructor() { super(); this.mode = "supabase"; this.session = null; this._t = null; }
  async init() {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true } });
    const { data } = await this.sb.auth.getSession();
    this.session = data.session;
    this.sb.auth.onAuthStateChange(async (_e, session) => {
      const was = this.session?.user?.id; this.session = session;
      if (was !== session?.user?.id) { await this.loadUser(); await this.load(); this.emit(); }
    });
    await this.loadUser();
    await this.load();
    this.sb.channel("raumplan-live")
      .on("postgres_changes", { event: "*", schema: "public" }, () => this.scheduleReload())
      .subscribe();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.scheduleReload(); });
    return this;
  }
  scheduleReload() { clearTimeout(this._t); this._t = setTimeout(async () => { await this.load(); this.emit(); }, 250); }
  async loadUser() {
    const u = this.session?.user;
    if (!u) { this.user = null; return; }
    const { data } = await this.sb.from("profiles").select("*").eq("id", u.id).maybeSingle();
    this.user = { id: u.id, email: u.email, name: data?.name || u.email, role: data?.role || "pending" };
  }
  async load() {
    const q = (t, order) => this.sb.from(t).select("*").order(order || "id");
    const [s, r, g, sc, ch, pr] = await Promise.all([
      this.sb.from("settings").select("*").eq("id", 1).maybeSingle(),
      q("rooms", "sort"), q("groups", "name"), q("schedule"),
      this.sb.from("changes").select("*").gte("datum", new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)).order("created_at"),
      this.user?.role === "master" ? q("profiles", "email") : Promise.resolve({ data: [] }),
    ]);
    this.loadError = [s, r, g, sc, ch].find((x) => x.error)?.error || null;
    this.data = {
      settings: { ...emptyData().settings, ...(s.data?.data || {}) },
      rooms: r.data || [], groups: g.data || [], schedule: sc.data || [], changes: ch.data || [], profiles: pr.data || [],
    };
  }
  async refresh() { await this.load(); this.emit(); }
  async signIn(email, password) { const r = await this.sb.auth.signInWithPassword({ email, password }); return r; }
  async signUp(email, password, name) {
    return this.sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.href } });
  }
  async signOut() { await this.sb.auth.signOut(); }
  async _do(p) { const { error, data } = await p; if (error) throw new Error(error.message); await this.refresh(); return data; }
  async addChanges(list) {
    const rows = list.map((c) => ({ note: "", text: "", ...c, created_by: this.user?.id }));
    return this._do(this.sb.from("changes").insert(rows).select());
  }
  async deleteChange(id) { return this._do(this.sb.from("changes").delete().eq("id", id)); }
  async deleteChanges(ids) { return this._do(this.sb.from("changes").delete().in("id", ids)); }
  async upsert(table, row) {
    if (!row.id) row = { ...row, id: uid() };
    return this._do(this.sb.from(table).upsert(row).select());
  }
  async remove(table, id) { return this._do(this.sb.from(table).delete().eq("id", id)); }
  async setScheduleCell(day, period, room_id, group_ids) {
    const { error } = await this.sb.from("schedule").delete().match({ day, period, room_id });
    if (error) throw new Error(error.message);
    if (group_ids.length) return this._do(this.sb.from("schedule").insert(group_ids.map((g) => ({ id: uid(), day, period, room_id, group_id: g }))));
    await this.refresh();
  }
  async removeGroupFromSlot(day, period, group_id) { return this._do(this.sb.from("schedule").delete().match({ day, period, group_id })); }
  async addSchedule(rows) { return this._do(this.sb.from("schedule").insert(rows.map((r) => ({ id: uid(), note: "", ...r })))); }
  async saveSettings(settings) {
    const data = { ...this.data.settings, ...settings };
    return this._do(this.sb.from("settings").upsert({ id: 1, data }));
  }
  async setRole(id, role) { return this._do(this.sb.from("profiles").update({ role }).eq("id", id)); }
  /** Datenbank mit neuen Räumen/Klassen/Plan füllen (IDs werden neu vergeben). */
  async replaceAll(d) {
    const map = {}; const nid = (old) => old ? (map[old] ||= uid()) : null;
    const rooms = d.rooms.map((r) => ({ ...r, id: nid(r.id) }));
    const groups = d.groups.map((g) => ({ ...g, id: nid(g.id), stammraum: g.stammraum ? nid(g.stammraum) : null }));
    const schedule = d.schedule.map((s) => ({ id: uid(), day: s.day, period: s.period, room_id: nid(s.room_id), group_id: nid(s.group_id), note: s.note || "" }));
    const del = async (t) => { const { error } = await this.sb.from(t).delete().not("id", "is", null); if (error) throw new Error(error.message); };
    await del("changes"); await del("schedule"); await del("groups"); await del("rooms");
    const ins = async (t, rows) => { for (let i = 0; i < rows.length; i += 500) { const { error } = await this.sb.from(t).insert(rows.slice(i, i + 500)); if (error) throw new Error(error.message); } };
    await ins("rooms", rooms); await ins("groups", groups); await ins("schedule", schedule);
    if (d.settings) await this.sb.from("settings").upsert({ id: 1, data: { ...this.data.settings, ...d.settings } });
    await this.refresh();
  }
}

let _store;
export async function getStore() {
  if (_store) return _store;
  _store = SUPABASE_URL && SUPABASE_ANON_KEY ? new SupaStore() : new DemoStore();
  await _store.init();
  return _store;
}
export { buildDemoData };
