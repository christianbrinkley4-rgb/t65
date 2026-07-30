// Field service worker. Goal: once the app has been opened on wifi, it opens
// again in a driveway with no signal.
//
// Strategy is stale-while-revalidate for same-origin app files (HTML, JS, CSS,
// fonts): serve the cached copy instantly, refresh it in the background so the
// next launch is current. Supabase and Google Maps are cross-origin and must
// never be cached — stale lead data pretending to be live is worse than an
// honest failure, and the app has its own lead cache for that.

// Bump this on every deploy. The activate handler deletes every cache whose
// name doesn't match, which is what forces a phone that already has the app
// installed to pick up the new build instead of serving the old shell.
const CACHE = "t65-app-v9";

self.addEventListener("install", (event) => {
  // Take over as soon as possible; a half-updated shell is a field bug.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

function isAppAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.endsWith("/sw.js")) return false;
  return true;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (!isAppAsset(url)) return; // Supabase, Census, Maps: always live

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: false });

      const network = fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === "basic") {
            cache.put(req, resp.clone()).catch(() => {});
          }
          return resp;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(network);
        return cached;
      }

      const fresh = await network;
      if (fresh) return fresh;

      // Offline and never cached: for a page request fall back to any cached
      // page so the app shell still boots instead of showing the browser error.
      if (req.mode === "navigate") {
        const anyPage =
          (await cache.match(new URL("./", url).toString())) ||
          (await cache.match(new URL("../list/", url).toString()));
        if (anyPage) return anyPage;
      }
      return new Response("Offline and this page has not been cached yet.", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      });
    })()
  );
});
