const CACHE = "power-hoops-v20";
const SHELL = ["index.html", "browse.html", "conferences.html", "compare.html", "schedule.html", "trends.html", "bubble.html", "assets/style.css?v=20", "assets/app.js?v=20", "manifest.webmanifest"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const isData = new URL(event.request.url).pathname.includes("/data/");
  const isDocument = event.request.mode === "navigate" || event.request.destination === "document";
  const isAsset = event.request.destination === "script" || event.request.destination === "style";
  if (isData || isDocument || isAsset) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then(cached => cached || caches.match("index.html"))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match("index.html"))));
});

