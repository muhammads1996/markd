const CACHE_NAME = "markd-participant-static-v1";
const SAFE_ASSETS = [
  "/manifest.webmanifest",
  "/markd-192.png",
  "/markd-512.png",
  "/markd-maskable-512.png",
  "/apple-touch-icon.png",
  "/participant/offline",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SAFE_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isSensitive =
    url.origin !== self.location.origin ||
    url.hostname.includes("supabase") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    request.headers.get("RSC") === "1";

  if (isSensitive) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate" && url.pathname.startsWith("/participant")) {
    event.respondWith(
      fetch(request).catch(() => caches.match("/participant/offline")),
    );
    return;
  }

  if (SAFE_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request)),
    );
  }
});
