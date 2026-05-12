// Service worker — diari de viatge Xina 2026
// Estratègia:
//   - Pre-cache EAGER de l'shell + recursos externs crítics durant install
//   - Network-first per a HTML (perquè els canvis es vegin de seguida)
//   - Stale-while-revalidate per a assets propis i Firebase SDK / Google Fonts / Leaflet
//   - Les dades del viatge (Firestore) ja es desen a IndexedDB pel propi SDK

const CACHE = "xina-viatge-v4";

// Shell propi
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg"
];

// Recursos externs que volem garantir disponibles offline (best-effort)
const EXTERNAL_PRECACHE = [
  // Firebase modular SDK
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js",
  // Leaflet
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  // Google Fonts CSS (les fonts en si es cacheen quan es requereixen)
  "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700;900&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,700;1,9..144,400&family=JetBrains+Mono:wght@400;500&display=swap"
];

// Prefixos d'origens externs que es poden cachear sota demanda (per sw-while-revalidate)
const EXTERNAL_CACHEABLE = [
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://www.gstatic.com/firebasejs",
  "https://unpkg.com/leaflet",
  "https://upload.wikimedia.org",          // Imatges de Wikipedia/Wikimedia
  "https://en.wikipedia.org/api/rest_v1",  // Wikipedia API per a thumbnails
  "https://zh.wikipedia.org/api/rest_v1",
  "https://es.wikipedia.org/api/rest_v1"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Shell propi: si falla, fallem (és crític)
    await c.addAll(SHELL);
    // Externs: best-effort, ignorem fallades individuals
    await Promise.allSettled(EXTERNAL_PRECACHE.map(async (url) => {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (res && (res.ok || res.type === 'opaque')) {
          await c.put(url, res);
        }
      } catch (e) { /* silenci */ }
    }));
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isHTML(req) {
  if (req.mode === "navigate") return true;
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

function isExternalCacheable(url) {
  return EXTERNAL_CACHEABLE.some((prefix) => url.startsWith(prefix));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const externalCacheable = isExternalCacheable(req.url);

  // No interceptem Firestore / Google APIs (les peticions de dades les gestiona el SDK)
  if (!sameOrigin && !externalCacheable) return;

  // HTML: network-first amb fallback a cache
  if (isHTML(req)) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((c) => c || caches.match("./index.html")))
    );
    return;
  }

  // Assets: stale-while-revalidate
  e.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Comunicació amb la pàgina (per ex. consultar estat del cache)
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "CACHE_STATUS") {
    caches.open(CACHE).then(c => c.keys()).then(keys => {
      e.source.postMessage({ type: "CACHE_STATUS_REPLY", count: keys.length, urls: keys.map(r => r.url) });
    });
  }
});
