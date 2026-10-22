/*
 * Lets the game, installed on a phone's home screen, open without a connection.
 * Network first: every file comes fresh from the server when it can (so updates
 * show up at once) and is kept in a cache for the times it can't. The font from
 * Google is kept too; accounts and saves (Supabase) always go to the network.
 */

const CACHE = "doberega-v1";
const FONTS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const ours = url.origin === self.location.origin;
  if (!ours && !FONTS.some((origin) => url.href.startsWith(origin))) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok || response.type === "opaque") cache.put(request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(request, { ignoreSearch: ours && url.pathname.endsWith("/") });
      if (cached) return cached;
      throw error;
    }
  })());
});
