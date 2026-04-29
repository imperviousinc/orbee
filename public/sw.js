// Minimal service worker for PWA installability.
// Network-first — doesn't cache app shell, just enables the install prompt.

self.addEventListener("fetch", () => {
  // Let all requests pass through to the network.
});
