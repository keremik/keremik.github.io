/* Best Home – Service Worker: liefert _blob/<id> (Auftragszettel, Belegfotos) aus dem privaten
   Supabase-Speicher „dateien“ – mit der Anmeldung der geöffneten App. */
importScripts("konfig.js");
const KONF = self.BESTHOME_KONFIG || {};
// Die App darf in einem Unterordner liegen (z. B. /besthome/): dann /besthome/_blob/<id>
const BLOB = new URL("_blob/", self.registration.scope).pathname;
let token = null;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (ev) => ev.waitUntil(self.clients.claim()));
self.addEventListener("message", (ev) => { if (ev.data && ev.data.typ === "token") token = ev.data.token || null; });

async function frageToken() {
  for (const c of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
    const t = await new Promise((ok) => {
      const k = new MessageChannel();
      k.port1.onmessage = (ev) => ok(ev.data || null);
      c.postMessage({ typ: "token?" }, [k.port2]);
      setTimeout(() => ok(null), 2000);
    });
    if (t) return t;
  }
  return null;
}

async function datei(id) {
  for (let versuch = 0; versuch < 2; versuch++) {
    if (!token || versuch) token = await frageToken();
    if (!token) break;
    const r = await fetch(`${KONF.url}/storage/v1/object/authenticated/dateien/${id}`, { headers: { Authorization: `Bearer ${token}`, apikey: KONF.anonKey } });
    if ([400, 401, 403].includes(r.status) && !versuch) continue; // Anmeldung abgelaufen: frische holen
    return new Response(r.body, { status: r.status, headers: { "Content-Type": r.headers.get("Content-Type") || "application/octet-stream", "Cache-Control": "private, max-age=3600" } });
  }
  return new Response("Bitte die App öffnen und anmelden, dann den Link erneut antippen.", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

self.addEventListener("fetch", (ev) => {
  const u = new URL(ev.request.url);
  if (u.origin !== self.location.origin || !u.pathname.startsWith(BLOB)) return;
  const id = u.pathname.slice(BLOB.length).replace(/[^0-9a-f]/gi, "");
  ev.respondWith(datei(id));
});
