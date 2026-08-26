// sw.js — offline shell for WatchVault.
//
// Strategy, deliberately conservative so a deploy can never leave someone stuck on an
// old build:
//   • HTML  → network-first, cache as fallback (so new deploys are picked up)
//   • CSS/JS/icons → stale-while-revalidate (fast, refreshes in the background)
//   • Everything else (APIs, posters) → straight to the network, never cached here
//
// Bump CACHE_VERSION whenever the shell changes.

const CACHE_VERSION = 'watchvault-v1';
const SHELL = [
    './',
    './index.html',
    './css/style.css',
    './css/components.css',
    './js/app.js',
    './js/api.js',
    './js/ui.js',
    './js/library.js',
    './js/dashboard.js',
    './js/sync.js',
    './js/search.js',
    './js/recommendations.js',
    './js/constants.js',
    './js/utils.js',
    './js/csv.js',
    './js/cloud.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_VERSION);
        // Individual failures must not abort the whole install.
        await Promise.allSettled(SHELL.map(url => cache.add(new Request(url, { cache: 'reload' }))));
        self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

const isShellAsset = (url) =>
    url.origin === self.location.origin &&
    /\.(?:css|js|png|svg|webmanifest|json)$/.test(url.pathname) &&
    !url.pathname.includes('/.netlify/');

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Never cache the serverless functions — they carry live data and auth.
    if (url.pathname.includes('/.netlify/')) return;

    // Navigations: network first so deploys land, cache only when offline.
    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const fresh = await fetch(request);
                const cache = await caches.open(CACHE_VERSION);
                cache.put('./index.html', fresh.clone());
                return fresh;
            } catch {
                const cached = await caches.match('./index.html');
                return cached || Response.error();
            }
        })());
        return;
    }

    if (isShellAsset(url)) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_VERSION);
            const cached = await cache.match(request);
            const network = fetch(request)
                .then(res => { if (res && res.ok) cache.put(request, res.clone()); return res; })
                .catch(() => null);
            // Serve the cached copy immediately, refresh it for next time.
            return cached || (await network) || Response.error();
        })());
    }
    // Anything else (APIs, poster CDNs) falls through to the network untouched.
});
