// sw.js — offline shell for WatchVault.
//
// Strategy, deliberately conservative so a deploy can never leave someone stuck on an
// old build:
//   • HTML  → network-first, cache as fallback (so new deploys are picked up)
//   • CSS/JS → network-first with a short timeout, cache as fallback. These carry the
//     app's behaviour, and stale-while-revalidate meant a deploy did not land until the
//     *second* visit — which reads as "the fix isn't there" on a phone.
//   • Icons/manifest → stale-while-revalidate (they never change behaviour)
//   • Everything else (APIs, posters) → straight to the network, never cached here
//
// Bump CACHE_VERSION whenever the shell changes.

const CACHE_VERSION = 'watchvault-v2';
const CODE_TIMEOUT_MS = 3000;
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

const isOwn = (url) =>
    url.origin === self.location.origin && !url.pathname.includes('/.netlify/');
const isCode = (url) => isOwn(url) && /\.(?:css|js)$/.test(url.pathname);
const isStaticAsset = (url) => isOwn(url) && /\.(?:png|svg|webmanifest|json)$/.test(url.pathname);

// Prefer the deployed copy, but never let a slow or dead network block the app: the
// cached copy takes over after CODE_TIMEOUT_MS while the fetch keeps going in the
// background, so the next load is fresh either way.
async function networkFirstWithFallback(request) {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request);
    const network = fetch(request)
        .then(res => {
            if (res && res.ok) { cache.put(request, res.clone()); return res; }
            return null;
        })
        .catch(() => null);

    if (!cached) return (await network) || Response.error();
    const fresh = await Promise.race([
        network,
        new Promise(resolve => setTimeout(() => resolve(null), CODE_TIMEOUT_MS))
    ]);
    return fresh || cached;
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request);
    const network = fetch(request)
        .then(res => { if (res && res.ok) cache.put(request, res.clone()); return res; })
        .catch(() => null);
    return cached || (await network) || Response.error();
}

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

    if (isCode(url)) {
        event.respondWith(networkFirstWithFallback(request));
        return;
    }

    if (isStaticAsset(url)) {
        event.respondWith(staleWhileRevalidate(request));
    }
    // Anything else (APIs, poster CDNs) falls through to the network untouched.
});
