/* Service worker del Portal DMD 2.0
   Estrategia: network-first para los archivos del sitio (siempre la versión
   más reciente; el caché solo es respaldo sin conexión). Las llamadas al API
   (script.google.com) NO se interceptan. */
const CACHE = "dmd-portal-v1";
const ASSETS = ["./", "index.html", "styles.css", "app.js", "api.js", "config.js", "manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Solo GET del mismo origen (los POST al API pasan directo)
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
