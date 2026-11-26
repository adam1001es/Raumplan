// Gemeinsame Oberflächen-Bausteine: Kopfzeile, Login, Toasts, Hilfen.

import { getStore, ROLE_LABEL } from "./store.js";

export const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(msg, kind = "") {
  let box = $("#toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
  const el = document.createElement("div");
  el.className = `toast ${kind}`; el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.classList.add("out"), 2800);
  setTimeout(() => el.remove(), 3300);
}

const NAV = [
  { href: "index.html", label: "Übersicht", icon: "👀", need: null },
  { href: "aendern.html", label: "Ändern", icon: "✏️", need: "edit" },
  { href: "direktion.html", label: "Direktion", icon: "🎛️", need: "master" },
];

/**
 * Startet eine Seite: Store laden, Kopfzeile zeichnen, ggf. Login verlangen.
 * need: null (öffentlich, falls erlaubt) | 'viewer' | 'edit' | 'master'
 */
export async function bootPage({ need = null, page }) {
  const app = $("#app");
  let store;
  try { store = await getStore(); }
  catch (e) {
    app.innerHTML = `<div class="card pad center"><h2>Verbindung fehlgeschlagen</h2><p class="muted">${h(e.message)}</p><p>Bitte Internet prüfen und neu laden.</p></div>`;
    throw e;
  }
  const allowed = () => {
    const role = store.role;
    if (store.mode === "supabase" && store.loadError && !role) return false;
    if (need === null) return store.mode === "demo" || store.data.settings.publicView || ["master", "editor", "viewer"].includes(role);
    if (need === "viewer") return ["master", "editor", "viewer"].includes(role);
    if (need === "edit") return store.canEdit;
    if (need === "master") return store.isMaster;
    return true;
  };
  renderHeader(store, page);
  store.onChange(() => renderHeader(store, page));
  return { store, allowed, gate: () => gate(store, allowed, need) };
}

function renderHeader(store, page) {
  const el = $("#top");
  if (!el) return;
  const role = store.role;
  const links = NAV.filter((n) => !n.need || (n.need === "edit" ? store.canEdit : store.isMaster) || store.mode === "demo")
    .map((n) => `<a href="${n.href}" class="${n.href === page ? "on" : ""}"><span>${n.icon}</span>${n.label}</a>`).join("");
  let userBox = "";
  if (store.mode === "demo") {
    userBox = `<label class="demo-user" title="Im Demo-Modus Rolle wechseln">
      <select id="demoUser">${store.data.profiles.map((p) => `<option value="${h(p.id)}" ${p.id === store.user?.id ? "selected" : ""}>${h(p.name)}</option>`).join("")}</select></label>`;
  } else if (store.user) {
    userBox = `<button class="ghost small" id="logout" title="${h(store.user.email)} · ${h(ROLE_LABEL[role] || role)}">Abmelden</button>`;
  } else {
    userBox = `<button class="ghost small" id="loginBtn">Anmelden</button>`;
  }
  el.innerHTML = `
    <div class="brand"><span class="logo">▦</span><div><b>${h(store.data.settings.schoolName || "Raumplan")}</b><small><span class="live-dot"></span>${store.mode === "demo" ? "Demo" : "Live"}</small></div></div>
    <nav>${links}</nav>
    <div class="who">${userBox}</div>`;
  $("#demoUser")?.addEventListener("change", (e) => store.switchUser(e.target.value));
  $("#logout")?.addEventListener("click", async () => { await store.signOut(); location.reload(); });
  $("#loginBtn")?.addEventListener("click", () => showLogin(store));
  const banner = $("#demoBanner");
  if (banner) banner.hidden = store.mode !== "demo";
}

function gate(store, allowed, need) {
  if (allowed()) return true;
  const app = $("#app");
  if (store.mode === "supabase" && store.user && store.role === "pending") {
    app.innerHTML = `<div class="card pad center narrow"><div class="big-emoji">⏳</div><h2>Fast geschafft</h2><p>Ihr Zugang <b>${h(store.user.email)}</b> wartet auf Freigabe durch die Direktion.</p><p class="muted">Diese Seite aktualisiert sich automatisch.</p></div>`;
    return false;
  }
  if (store.mode === "supabase" && store.user) {
    app.innerHTML = `<div class="card pad center narrow"><div class="big-emoji">🔒</div><h2>Keine Berechtigung</h2><p>Ihre Rolle: <b>${h(ROLE_LABEL[store.role] || store.role)}</b>. Diese Seite ist für ${need === "master" ? "die Direktion" : "Bearbeiter"}.</p><p><a class="btn" href="index.html">Zur Übersicht</a></p></div>`;
    return false;
  }
  showLogin(store, app);
  return false;
}

export function showLogin(store, into) {
  const host = into || (() => { const d = document.createElement("div"); d.className = "modal-bg"; document.body.appendChild(d); return d; })();
  const isModal = !into;
  host.innerHTML = `
    <form class="card pad narrow login" id="loginForm">
      <div class="big-emoji">🏫</div>
      <h2>Anmelden</h2>
      <p class="muted">Mit Ihrer Schul-E-Mail. Neu hier? Einfach registrieren – die Direktion schaltet Sie frei.</p>
      <label>E-Mail<input type="email" name="email" required autocomplete="username"></label>
      <label>Passwort<input type="password" name="pw" required minlength="6" autocomplete="current-password"></label>
      <label class="reg-only" hidden>Name (für die Direktion)<input name="name" placeholder="z.B. Maria Huber, Hortleitung"></label>
      <div class="row gap">
        <button class="btn grow" type="submit" id="doLogin">Anmelden</button>
        ${isModal ? `<button class="ghost" type="button" id="closeLogin">Abbrechen</button>` : ""}
      </div>
      <button type="button" class="link" id="toggleReg">Noch kein Zugang? Registrieren</button>
      <p class="err" id="loginErr"></p>
    </form>`;
  let reg = false;
  const f = $("#loginForm", host);
  $("#toggleReg", host).onclick = () => {
    reg = !reg;
    $(".reg-only", host).hidden = !reg;
    $("#doLogin", host).textContent = reg ? "Registrieren" : "Anmelden";
    $("#toggleReg", host).textContent = reg ? "Ich habe schon einen Zugang" : "Noch kein Zugang? Registrieren";
  };
  $("#closeLogin", host)?.addEventListener("click", () => host.remove());
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f); const err = $("#loginErr", host); err.textContent = "";
    const btn = $("#doLogin", host); btn.disabled = true;
    try {
      const r = reg ? await store.signUp(fd.get("email"), fd.get("pw"), fd.get("name")) : await store.signIn(fd.get("email"), fd.get("pw"));
      if (r.error) throw r.error;
      if (reg && !r.data?.session) { err.className = "ok"; err.textContent = "Bitte bestätigen Sie die E-Mail (Posteingang prüfen), dann anmelden."; btn.disabled = false; return; }
      location.reload();
    } catch (ex) {
      const m = String(ex.message || ex);
      err.textContent = /invalid login/i.test(m) ? "E-Mail oder Passwort falsch." : /not confirmed/i.test(m) ? "E-Mail noch nicht bestätigt – bitte Posteingang prüfen." : m;
      btn.disabled = false;
    }
  };
}

/** Minütlich neu zeichnen (für "jetzt"-Anzeigen). */
export function everyMinute(fn) {
  const tick = () => { fn(); setTimeout(tick, 60000 - (Date.now() % 60000) + 200); };
  setTimeout(tick, 60000 - (Date.now() % 60000) + 200);
}
