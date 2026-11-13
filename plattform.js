/* Best Home Rechnungen – eigenständige Version.
 *
 * Stellt dieselbe Schnittstelle bereit wie claude.ai (window.claude.use: db, user, assets,
 * downloads, sample), aber auf Supabase: Anmeldung mit Benutzername und Passwort, Daten in
 * der Tabelle „dokumente“ (Live-Abgleich über Realtime), Dateien im privaten Speicher „dateien“
 * (ausgeliefert unter _blob/<id> über den Service Worker), Belege auslesen über die Funktion
 * „beleg-lesen“. Die App (seite.html + kern.js) bleibt unverändert dieselbe.
 */
(function () {
  "use strict";
  const KONF = window.BESTHOME_KONFIG || {};
  const DOMAIN = "benutzer.best-home.local";
  // Die App darf in einem Unterordner liegen (z. B. /besthome/): Dateien dann unter /besthome/_blob/<id>
  const BLOB = new URL("_blob/", document.baseURI).pathname;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let freigabe;
  const angemeldet = new Promise((ok) => { freigabe = ok; });
  window.claude = Object.freeze({ use: async (name) => { await angemeldet; return faehigkeit(name); } });

  // ---------- Anmeldung ----------
  const schicht = document.createElement("div");
  schicht.className = "bh-schicht";
  const css = document.createElement("style");
  css.textContent = `
.bh-schicht { position: fixed; inset: 0; z-index: 50; background: var(--grund, #f5f5f7); display: grid; place-items: center; padding: 22px; overflow-y: auto; }
.bh-schicht .karte { width: min(100%, 400px); }
.bh-schicht h1 { font-size: 1.9rem; letter-spacing: -.03em; line-height: 1.1; }
.bh-schicht form { display: grid; gap: 14px; }
.bh-schicht .fehler { color: var(--rot, #d70015); font-weight: 600; min-height: 1.2em; }
.bh-konto { flex: none; width: 34px; height: 34px; border-radius: 50%; border: 0; background: var(--zweit, #e8e8ed); color: var(--tinte, #1d1d1f);
  font: 600 .8rem/1 var(--schrift, system-ui); cursor: pointer; display: grid; place-items: center; }
.bh-menue { position: fixed; z-index: 40; right: max(12px, env(safe-area-inset-right)); top: calc(env(safe-area-inset-top, 0px) + 58px); width: min(300px, calc(100vw - 24px));
  background: var(--flaeche, #fff); border-radius: 18px; box-shadow: var(--schatten-hoch, 0 10px 30px rgb(0 0 0 / .12)); padding: 16px; display: grid; gap: 10px; }
.bh-menue[hidden] { display: none; }
`;
  document.head.appendChild(css);

  function zeige(html) {
    schicht.innerHTML = html;
    if (!schicht.isConnected) document.body.appendChild(schicht);
  }
  const marke = `<svg width="34" height="40" viewBox="0 0 26 30" aria-hidden="true"><path d="M13 1.5 24 5.4v8.4c0 7.3-4.6 12.2-11 14.7C6.6 26 2 21.1 2 13.8V5.4Z" fill="var(--akzent, #0071e3)"/><path d="M13 9.2 19 14v6.6H7V14Z" fill="#fff"/><rect x="11.2" y="15.6" width="3.6" height="5" rx="1" fill="var(--akzent, #0071e3)"/></svg>`;

  if (!KONF.url || !KONF.anonKey || !window.supabase) {
    zeige(`<section class="karte">${marke}<h1>Noch nicht eingerichtet</h1>
      <p class="leise">Es fehlen die Zugangsdaten zum Server (Adresse und öffentlicher Schlüssel des Supabase-Projekts).
      Sie stehen in <code>konfig.json</code> oder werden beim Bauen als SUPABASE_URL und SUPABASE_ANON_KEY übergeben – siehe Anleitung.</p></section>`);
    return;
  }
  const sb = window.supabase.createClient(KONF.url, KONF.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "besthome-sitzung" },
  });
  let sitzung = null;
  let profilName = "";

  function anmeldeMaske(fehler = "") {
    zeige(`<section class="karte">${marke}
      <h1>Best Home<br><span class="grau">Anmelden.</span></h1>
      <form id="bh-anmelden" autocomplete="on">
        <label>Benutzername<input name="benutzer" id="bh-benutzer" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
        <label>Passwort<input name="passwort" id="bh-passwort" type="password" required autocomplete="current-password"></label>
        <p class="fehler" role="alert">${esc(fehler)}</p>
        <button class="knopf" id="bh-los">Anmelden</button>
      </form>
      <p class="leise klein">Benutzername und Passwort bekommst du von Kerem oder Bünyamin.</p></section>`);
    const form = schicht.querySelector("#bh-anmelden");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const name = String(f.get("benutzer") || "").trim().toLowerCase();
      const knopf = form.querySelector("#bh-los");
      knopf.disabled = true; knopf.textContent = "Einen Moment …";
      const email = name.includes("@") ? name : `${name}@${DOMAIN}`;
      const { data, error } = await sb.auth.signInWithPassword({ email, password: String(f.get("passwort") || "") });
      if (error) {
        // nur die Meldung zeigen – der Benutzername bleibt stehen
        form.querySelector(".fehler").textContent = /invalid|credentials/i.test(error.message) ? "Benutzername oder Passwort stimmt nicht." : `Anmeldung nicht möglich: ${error.message}`;
        knopf.disabled = false; knopf.textContent = "Anmelden";
        const pw = form.querySelector("#bh-passwort"); pw.value = ""; pw.focus();
        return;
      }
      await weiter(data.session);
    });
    setTimeout(() => { const el = schicht.querySelector("#bh-benutzer"); if (el) el.focus(); }, 50);
  }

  // Allererster Aufruf der App: Es gibt noch kein Konto – das erste wird hier angelegt und ist der Inhaber
  function erstMaske(fehler = "", werte = {}) {
    zeige(`<section class="karte">${marke}
      <h1>Willkommen.<br><span class="grau">Erste Einrichtung.</span></h1>
      <p class="leise">Die App ist neu. Lege jetzt <b>dein Konto</b> an – du wirst damit <b>Inhaber</b>: du siehst alles, ernennst Admins und legst die Zugänge für alle anderen an.</p>
      <form id="bh-erst" autocomplete="on">
        <label>Dein Name<input name="name" id="bh-e-name" required autocomplete="name" value="${esc(werte.name || "")}" placeholder="Vorname Nachname"></label>
        <label>Benutzername (zum Anmelden)<input name="benutzer" id="bh-e-benutzer" required autocomplete="username" autocapitalize="none" spellcheck="false"
          value="${esc(werte.benutzer || "")}" placeholder="z. B. kerem" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{1,30}" title="2–31 Zeichen: Buchstaben, Ziffern, Punkt, Bindestrich"></label>
        <label>Passwort (mindestens 8 Zeichen)<input name="passwort" id="bh-e-pw" type="password" required minlength="8" autocomplete="new-password"></label>
        <label>Passwort wiederholen<input name="passwort2" id="bh-e-pw2" type="password" required minlength="8" autocomplete="new-password"></label>
        <p class="fehler" role="alert">${esc(fehler)}</p>
        <button class="knopf" id="bh-e-los">Konto anlegen</button>
      </form>
      <p class="leise klein">Merke dir Benutzername und Passwort gut – damit meldest du dich auf jedem Gerät an.</p></section>`);
    const form = schicht.querySelector("#bh-erst");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const name = String(f.get("name") || "").trim(), benutzer = String(f.get("benutzer") || "").trim().toLowerCase();
      const passwort = String(f.get("passwort") || "");
      const zeigeFehler = (text) => { form.querySelector(".fehler").textContent = text; knopf.disabled = false; knopf.textContent = "Konto anlegen"; };
      const knopf = form.querySelector("#bh-e-los");
      if (passwort !== String(f.get("passwort2") || "")) { zeigeFehler("Die beiden Passwörter sind nicht gleich."); return; }
      knopf.disabled = true; knopf.textContent = "Einen Moment …";
      try {
        await zugang({ aktion: "erstkonto", name, benutzer, passwort });
      } catch (e) { zeigeFehler(e.message || String(e)); return; }
      const { data, error } = await sb.auth.signInWithPassword({ email: `${benutzer}@${DOMAIN}`, password: passwort });
      if (error) { anmeldeMaske("Konto angelegt. Bitte jetzt anmelden."); return; }
      await weiter(data.session);
    });
    setTimeout(() => { const el = schicht.querySelector("#bh-e-name"); if (el) el.focus(); }, 50);
  }
  /** Ohne Sitzung: Anmeldemaske – oder die Ersteinrichtung, solange es noch keinen Inhaber gibt */
  async function ohneSitzung() {
    let start = null;
    try { start = await zugang({ aktion: "start" }); } catch (e) { console.warn("Start", e); }
    if (start && start.inhaber === false) erstMaske(); else anmeldeMaske();
  }

  async function funktion(name, body) {
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      let antwort = null;
      try { antwort = await error.context.json(); } catch { /* keine JSON-Antwort */ }
      if (antwort) return { ...antwort, status: error.context.status };
      throw new Error(error.message || "Server nicht erreichbar");
    }
    return data;
  }
  async function zugang(body) {
    const d = await funktion("zugang", body);
    if (d && d.fehler) throw new Error(d.fehler);
    return d;
  }

  async function weiter(s) {
    sitzung = s;
    // Erste Anmeldung überhaupt: Inhaber einrichten
    let status = null;
    try { status = await zugang({ aktion: "status" }); } catch (e) { console.warn("Status", e); }
    if (status && !status.inhaber) { einrichtungsMaske(); return; }
    try {
      const { data } = await sb.from("dokumente").select("daten").eq("pfad", `profil/${s.user.id}`).maybeSingle();
      profilName = (data && data.daten && data.daten.name) || "";
    } catch { /* Name aus den Metadaten */ }
    tokenAnServiceWorker();
    schicht.remove();
    kontoKnopf();
    freigabe();
  }

  function einrichtungsMaske(fehler = "") {
    zeige(`<section class="karte">${marke}
      <h1>Willkommen.<br><span class="grau">Erste Einrichtung.</span></h1>
      <p class="leise">Du meldest dich als Erste(r) an und wirst damit <b>Inhaber</b>: du siehst alles, ernennst Admins und legst die Zugänge für alle anderen an.</p>
      <form id="bh-einrichten">
        <label>Dein Name<input name="name" required value="${esc(benutzerName())}" autocomplete="name"></label>
        <p class="fehler" role="alert">${esc(fehler)}</p>
        <button class="knopf">Als Inhaber einrichten</button>
      </form></section>`);
    const form = schicht.querySelector("#bh-einrichten");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      form.querySelector("button").disabled = true;
      try {
        await zugang({ aktion: "einrichten", name: String(new FormData(form).get("name") || "").trim() });
        const { data, error } = await sb.auth.refreshSession();
        if (error) throw error;
        await weiter(data.session);
      } catch (e) { einrichtungsMaske(e.message || String(e)); }
    });
  }

  const benutzerName = () => {
    const u = sitzung && sitzung.user;
    if (!u) return "";
    return profilName || (u.user_metadata && u.user_metadata.name) || String(u.email || "").replace(`@${DOMAIN}`, "");
  };

  // Konto-Knopf oben rechts: Name, Passwort ändern, Abmelden
  function kontoKnopf() {
    const innen = document.querySelector(".leiste-innen");
    if (!innen || innen.querySelector(".bh-konto")) return;
    const name = benutzerName();
    const kuerzel = name.split(/\s+/).filter(Boolean).map((t) => t[0]).join("").slice(0, 2).toUpperCase() || "?";
    const knopf = document.createElement("button");
    knopf.className = "bh-konto"; knopf.type = "button"; knopf.textContent = kuerzel;
    knopf.setAttribute("aria-label", `Konto: ${name}`); knopf.setAttribute("aria-expanded", "false");
    innen.appendChild(knopf);
    const menue = document.createElement("div");
    menue.className = "bh-menue"; menue.hidden = true;
    const benutzer = String((sitzung.user.user_metadata && sitzung.user.user_metadata.benutzer) || sitzung.user.email || "").replace(`@${DOMAIN}`, "");
    menue.innerHTML = `<div><b>${esc(name)}</b><div class="leise klein">Benutzername ${esc(benutzer)}</div></div>
      <form id="bh-pw" class="felder" style="grid-template-columns:1fr">
        <label>Neues Passwort<input type="password" name="pw" minlength="8" required autocomplete="new-password" id="bh-pw-neu"></label>
        <button class="knopf zweit">Passwort ändern</button></form>
      <button class="knopf still" type="button" id="bh-abmelden">Abmelden</button>`;
    document.body.appendChild(menue);
    knopf.addEventListener("click", () => { menue.hidden = !menue.hidden; knopf.setAttribute("aria-expanded", String(!menue.hidden)); });
    document.addEventListener("click", (ev) => { if (!menue.hidden && !menue.contains(ev.target) && ev.target !== knopf) { menue.hidden = true; knopf.setAttribute("aria-expanded", "false"); } });
    menue.querySelector("#bh-abmelden").addEventListener("click", abmelden);
    menue.querySelector("#bh-pw").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const pw = String(new FormData(ev.target).get("pw") || "");
      const { error } = await sb.auth.updateUser({ password: pw });
      meldung(error ? `Passwort nicht geändert: ${error.message}` : "Passwort geändert.", Boolean(error));
      if (!error) { ev.target.reset(); menue.hidden = true; }
    });
  }
  function meldung(text, fehler) {
    const el = document.getElementById("meldung");
    if (!el) { alert(text); return; }
    el.textContent = text; el.className = fehler ? "fehler" : ""; el.hidden = false;
    setTimeout(() => { el.hidden = true; }, fehler ? 7000 : 3500);
  }
  async function abmelden() {
    await sb.auth.signOut().catch(() => {});
    try { localStorage.removeItem("besthome-sitzung"); } catch { /* egal */ }
    location.reload();
  }

  // ---------- Service Worker: _blob/<id> mit Anmeldung aus dem privaten Speicher ----------
  function tokenAnServiceWorker() {
    if (!("serviceWorker" in navigator) || !sitzung) return;
    const nachricht = { typ: "token", token: sitzung.access_token };
    if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage(nachricht);
    navigator.serviceWorker.ready.then((reg) => reg.active && reg.active.postMessage(nachricht)).catch(() => {});
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service Worker", e));
    navigator.serviceWorker.addEventListener("message", (ev) => {
      if (ev.data && ev.data.typ === "token?" && ev.ports[0]) ev.ports[0].postMessage(sitzung ? sitzung.access_token : null);
    });
  }
  sb.auth.onAuthStateChange((ereignis, s) => {
    if (s) { sitzung = s; tokenAnServiceWorker(); }
    if (ereignis === "SIGNED_OUT" && freigegeben()) location.reload();
  });
  let istFrei = false;
  angemeldet.then(() => { istFrei = true; });
  const freigegeben = () => istFrei;

  // ---------- db: Dokumentenspeicher wie in claude.ai ----------
  const sammlungVon = (pfad) => pfad.slice(0, pfad.lastIndexOf("/"));
  const cache = new Map();
  const geladen = new Set();       // vollständig geladene Sammlungen
  const einzeln = new Set();       // einzeln beobachtete Dokumente
  const docHoerer = new Map(), colHoerer = new Map();
  const zuMelden = new Set();
  let meldeZeit = 0;
  const kopie = (d) => (d === undefined ? undefined : structuredClone(d));
  const snapDoc = (pfad) => {
    const d = cache.get(pfad);
    return { id: pfad.split("/").pop(), exists: d !== undefined, data: () => kopie(d), metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const snapCol = (col) => {
    const docs = [...cache.keys()].filter((p) => sammlungVon(p) === col).sort().map(snapDoc);
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  };
  function melde(pfad) {
    zuMelden.add(pfad);
    if (!meldeZeit) meldeZeit = setTimeout(ausliefern, 15);
  }
  function ausliefern() {
    meldeZeit = 0;
    const pfade = [...zuMelden]; zuMelden.clear();
    for (const p of pfade) for (const f of docHoerer.get(p) || []) f(snapDoc(p));
    for (const c of new Set(pfade.map(sammlungVon))) if (geladen.has(c)) for (const f of colHoerer.get(c) || []) f(snapCol(c));
  }
  function fehlerVon(e) {
    const code = e && e.code === "42501" ? "permission_denied" : e && e.code === "P0002" ? "not_found" : (e && e.code) || "unavailable";
    const text = code === "permission_denied" ? "Keine Berechtigung für diese Änderung." : code === "not_found" ? "Eintrag nicht gefunden." : (e && e.message) || "Speicher nicht erreichbar.";
    const f = new Error(text); f.code = code; return f;
  }
  async function ladeSammlung(col) {
    const neu = new Map();
    for (let von = 0; ; von += 1000) {
      const { data, error } = await sb.from("dokumente").select("pfad,daten").eq("sammlung", col).order("pfad").range(von, von + 999);
      if (error) throw fehlerVon(error);
      for (const r of data) neu.set(r.pfad, r.daten);
      if (data.length < 1000) break;
    }
    for (const p of [...cache.keys()]) if (sammlungVon(p) === col && !neu.has(p)) { cache.delete(p); melde(p); }
    for (const [p, d] of neu) cache.set(p, d);
    geladen.add(col);
    for (const f of colHoerer.get(col) || []) f(snapCol(col));
  }
  async function ladeDokument(pfad) {
    const { data, error } = await sb.from("dokumente").select("daten").eq("pfad", pfad).maybeSingle();
    if (error) throw fehlerVon(error);
    const alt = cache.get(pfad);
    if (data) cache.set(pfad, data.daten); else cache.delete(pfad);
    if (JSON.stringify(alt) !== JSON.stringify(data ? data.daten : undefined)) melde(pfad);
    return data ? data.daten : undefined;
  }
  // Live-Abgleich: alle Änderungen kommen über einen Kanal (Zugriffsregeln gelten auch hier)
  let kanal = null, getrennt = false, zuletztSync = Date.now();
  function kanalStarten() {
    if (kanal) return;
    kanal = sb.channel("dokumente")
      .on("postgres_changes", { event: "*", schema: "public", table: "dokumente" }, (p) => {
        if (p.eventType === "DELETE") {
          const pfad = p.old && p.old.pfad;
          if (pfad && cache.has(pfad)) { cache.delete(pfad); melde(pfad); }
          return;
        }
        const r = p.new;
        if (!r || !r.pfad) return;
        if (!geladen.has(sammlungVon(r.pfad)) && !einzeln.has(r.pfad)) return;
        cache.set(r.pfad, r.daten); melde(r.pfad);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { if (getrennt) { getrennt = false; abgleichen(); } }
        else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) getrennt = true;
      });
  }
  async function abgleichen() {
    zuletztSync = Date.now();
    try {
      await Promise.all([...geladen].map(ladeSammlung));
      await Promise.all([...einzeln].map(ladeDokument));
      ausliefern();
    } catch (e) { console.warn("Abgleich", e); }
  }
  // Handy aus der Tasche: nach längerer Pause neu abgleichen (Websocket kann geschlafen haben)
  let versteckt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) versteckt = Date.now();
    else if (versteckt && Date.now() - versteckt > 30000) abgleichen();
  });
  setInterval(() => { if (!document.hidden && Date.now() - zuletztSync > 10 * 60000) abgleichen(); }, 60000);

  const zufallsId = (n = 20) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 62]).join("");
  function docRef(pfad) {
    return {
      id: pfad.split("/").pop(), path: pfad,
      async get() { await ladeDokument(pfad); return snapDoc(pfad); },
      async set(daten) {
        const json = JSON.parse(JSON.stringify(daten));
        const { error } = await sb.from("dokumente").upsert({ pfad, daten: json }, { onConflict: "pfad" });
        if (error) throw fehlerVon(error);
        cache.set(pfad, json); melde(pfad);
      },
      async update(aenderung) {
        const { data, error } = await sb.rpc("dok_aendern", { p_pfad: pfad, p_aenderung: JSON.parse(JSON.stringify(aenderung)) });
        if (error) throw fehlerVon(error);
        cache.set(pfad, data); melde(pfad);
      },
      async delete() {
        const { error } = await sb.from("dokumente").delete().eq("pfad", pfad);
        if (error) throw fehlerVon(error);
        cache.delete(pfad); melde(pfad);
      },
      onSnapshot(f, fehler) {
        (docHoerer.get(pfad) || docHoerer.set(pfad, []).get(pfad)).push(f);
        einzeln.add(pfad); kanalStarten();
        ladeDokument(pfad).then(() => f(snapDoc(pfad))).catch((e) => fehler && fehler(e));
        return () => { docHoerer.set(pfad, (docHoerer.get(pfad) || []).filter((x) => x !== f)); };
      },
    };
  }
  function colRef(col) {
    return {
      path: col,
      doc: (id) => docRef(`${col}/${id || zufallsId()}`),
      async add(daten) { const r = docRef(`${col}/${zufallsId()}`); await r.set(daten); return r; },
      onSnapshot(f, fehler) {
        (colHoerer.get(col) || colHoerer.set(col, []).get(col)).push(f);
        kanalStarten();
        if (geladen.has(col)) setTimeout(() => f(snapCol(col)), 0);
        else ladeSammlung(col).catch((e) => fehler && fehler(e));
        return () => { colHoerer.set(col, (colHoerer.get(col) || []).filter((x) => x !== f)); };
      },
    };
  }
  const db = Object.freeze({ doc: docRef, collection: colRef });

  // ---------- user ----------
  const user = Object.freeze({
    id: async () => sitzung.user.id,
    isOwner: async () => Boolean(sitzung.user.app_metadata && sitzung.user.app_metadata.inhaber),
    canEdit: async () => Boolean(sitzung.user.app_metadata && sitzung.user.app_metadata.inhaber),
    can: async (n) => (n === "data.write" ? true : null),
    me: async () => {
      const inhaber = Boolean(sitzung.user.app_metadata && sitzung.user.app_metadata.inhaber);
      return { id: sitzung.user.id, name: benutzerName(), isOwner: inhaber, canEdit: inhaber, email: null, avatarUrl: "", color: "" };
    },
    profiles: async (ids) => {
      const liste = [].concat(ids);
      const { data } = await sb.from("dokumente").select("pfad,daten").in("pfad", liste.map((id) => `profil/${id}`));
      const nach = new Map((data || []).map((r) => [r.pfad.slice(7), r.daten]));
      return Object.fromEntries(liste.map((id) => [id, { id, name: (nach.get(id) || {}).name || "", benutzer: (nach.get(id) || {}).benutzer || "", guest: false, isMe: id === sitzung.user.id }]));
    },
  });

  // ---------- assets: privater Speicher „dateien“ ----------
  const assets = Object.freeze({
    async upload(blob, opt = {}) {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      const typ = blob.type || opt.type || "application/octet-stream";
      const { error } = await sb.storage.from("dateien").upload(id, blob, { contentType: typ, upsert: false });
      if (error) { const f = new Error(`Hochladen fehlgeschlagen: ${error.message}`); f.code = "upload_failed"; throw f; }
      return { id, url: `${BLOB}${id}`, sizeBytes: blob.size, contentType: typ };
    },
    async delete(id) {
      const { error } = await sb.storage.from("dateien").remove([id]);
      return { deleted: !error };
    },
  });

  // ---------- downloads ----------
  const downloads = Object.freeze({
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: /\.csv$/i.test(filename) ? "text/csv;charset=utf-8" : "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { status: "saved" };
    },
  });

  // ---------- sample: Belege mit Claude auslesen (nur wenn auf dem Server eingerichtet) ----------
  let sampleZustand = null;
  async function sampleAktiv() {
    if (sampleZustand === null) {
      try { sampleZustand = Boolean((await funktion("beleg-lesen", { status: true }) || {}).aktiv); } catch { sampleZustand = false; }
    }
    return sampleZustand;
  }
  const alsBase64 = (blob) => new Promise((ok, fehl) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = fehl; r.readAsDataURL(blob);
  });
  const sample = Object.freeze({
    limits: async () => ({ inputBytes: 262144, images: { maxCount: 5, maxBytes: 20000000, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] } }),
    async json(input, opt = {}) {
      const bilder = await Promise.all([].concat(opt.images || []).map(async (b) => ({ typ: b.type || "image/jpeg", daten: await alsBase64(b) })));
      let d;
      try { d = await funktion("beleg-lesen", { prompt: String(input), bilder }); }
      catch (e) { throw Object.assign(new Error(e.message || "Server nicht erreichbar"), { code: "network_error" }); }
      if (!d || d.fehler) throw Object.assign(new Error((d && (d.meldung || d.fehler)) || "Fehler"), { code: (d && d.fehler) || "unavailable" });
      return d.antwort;
    },
  });

  async function faehigkeit(name) {
    if (name === "db") return db;
    if (name === "user") return user;
    if (name === "assets") return assets;
    if (name === "downloads") return downloads;
    if (name === "sample") return (await sampleAktiv()) ? sample : null;
    return null;
  }

  // ---------- Haken für die App: Zugänge mit Benutzername und Passwort ----------
  const SILBEN = ["ba", "be", "bo", "da", "de", "do", "fa", "fe", "fi", "ga", "ge", "ka", "ke", "ki", "ko", "la", "le", "lo", "ma", "me", "mi", "mo",
    "na", "ne", "no", "pa", "pe", "ra", "re", "ri", "ro", "sa", "se", "so", "ta", "te", "to", "wa", "we", "zu"];
  function passwortVorschlag() {
    const z = crypto.getRandomValues(new Uint32Array(8));
    const wort = (i) => { const w = SILBEN[z[i] % SILBEN.length] + SILBEN[z[i + 1] % SILBEN.length]; return w[0].toUpperCase() + w.slice(1); };
    return `${wort(0)}-${wort(2)}-${wort(4)}-${String(z[6] % 90 + 10)}`;
  }
  window.PLATTFORM = Object.freeze({
    name: "extern",
    blobPfad: BLOB,
    zugaenge: true,
    speicherText: "Die Daten liegen auf dem Server der App (Supabase, Frankfurt) und sind auf allen Geräten gleich. Rechnungen und Einstellungen sind zusätzlich verschlüsselt.",
    passwortVorschlag,
    zugangsListe: async () => (await zugang({ aktion: "liste" })).liste || [],
    zugangAnlegen: (x) => zugang({ aktion: "anlegen", ...x }),
    passwortSetzen: (id, passwort) => zugang({ aktion: "passwort", id, passwort }),
    zugangLoeschen: (id) => zugang({ aktion: "loeschen", id }),
    abmelden,
  });

  // Start: vorhandene Sitzung nutzen, sonst Anmeldemaske
  zeige(`<section class="karte">${marke}<h1>Best Home</h1><p class="leise">Einen Moment …</p></section>`);
  sb.auth.getSession().then(({ data }) => (data.session ? weiter(data.session) : ohneSitzung())).catch(() => anmeldeMaske());
})();
