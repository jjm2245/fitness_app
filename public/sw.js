// Bump this on every change so an already-installed PWA discards the old cache
// (and the old fetch handler) on activate. v1 shipped a bug: it returned
// *redirected* responses to navigation requests, which the browser rejects with
// "a response served by a service worker has redirections" — bricking the
// installed app the moment the auth cookie expired (the proxy 307s pages to
// /login, fetch follows it, and the SW handed that redirected response back to a
// navigation). See the navigate branch below.
const CACHE_NAME = "fitness-app-shell-v2";
const APP_SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API: network-first, never cached. Offline → 503 so the client's outbox
  // treats it as "not synced yet" and re-drains later.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request).catch(() => new Response(null, { status: 503 })));
    return;
  }

  // Navigations (top-level page loads): network-first.
  //
  // A service worker MUST NOT return a redirected response to a navigation — the
  // browser throws "a response served by a service worker has redirections" and
  // the page fails to load. Our proxy 307s unauthenticated page requests to
  // /login; the default `fetch` follows that, producing a response with
  // `redirected === true` (final URL /login, status 200). We reconstruct a
  // clean, non-redirected Response from that body so the browser can render the
  // login page and the user can actually re-authenticate. Offline → serve the
  // cached app shell so the installed PWA still launches.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.redirected) return response;
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        })
        .catch(() => caches.match("/", { ignoreSearch: true }).then((cached) => cached || Response.error()))
    );
    return;
  }

  // Everything else (static assets, chunks): cache-first, fall back to network.
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
