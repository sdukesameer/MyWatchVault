// js/api.js
// AI provider abstraction with fallback chain for WatchVault

const AI_PROVIDERS = [
    { name: 'Gemini 2.5 Flash', model: 'gemini-2.5-flash', type: 'gemini' },
    { name: 'Gemini 2.5 Flash Lite', model: 'gemini-2.5-flash-lite', type: 'gemini' },
    { name: 'Llama 3.3 70B Versatile (Groq)', model: 'llama-3.3-70b-versatile', type: 'groq' },
    { name: 'Llama 3.1 8B Instant (Groq)', model: 'llama-3.1-8b-instant', type: 'groq' },
    { name: 'OpenRouter Gemma 4 31B Free', model: 'google/gemma-4-31b-it:free', type: 'openrouter' },
    { name: 'Cohere Command R', model: 'command-r-08-2024', type: 'cohere' }
];

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_BASE = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const COHERE_BASE = 'https://api.cohere.com/v2/chat';

const PROXY_AI = '/.netlify/functions/ai-proxy';
const PROXY_TMDB = '/.netlify/functions/tmdb-proxy';
const PROXY_TIMEOUT_MS = 35000;
const REQUEST_TIMEOUT_MS = 25000;

function isProxied() {
    const hn = window.location.hostname;
    if (hn === 'localhost' || hn === '127.0.0.1' || hn.startsWith('192.168.') || hn.startsWith('10.')) {
        return false;
    }
    return true;
}

let lastProviderUsed = '';
export function getLastProvider() { return lastProviderUsed; }

const JIKAN_BASE = 'https://api.jikan.moe/v4';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Generic JSON GET with backoff on rate limits and upstream errors. Returns null once
// the retries are exhausted so callers can degrade instead of throwing.
const FETCH_TIMEOUT_MS = 15000;

// ── Circuit breaker ──────────────────────────────────────────────
// When a host is having an outage (MyAnimeList goes down regularly, taking Jikan with
// it) there is no point retrying it for every one of ten recommendations. After a few
// consecutive failures we stop calling that host for a while and let callers fall
// straight through to their alternatives.
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 90 * 1000;
const breakers = new Map();

function hostOf(url) {
    try { return new URL(url, window.location.origin).host; } catch { return url; }
}

function breakerOpen(host) {
    const b = breakers.get(host);
    if (!b || b.failures < BREAKER_THRESHOLD) return false;
    if (Date.now() - b.openedAt > BREAKER_COOLDOWN_MS) { breakers.delete(host); return false; }
    return true;
}

function recordFailure(host) {
    const b = breakers.get(host) || { failures: 0, openedAt: 0 };
    b.failures++;
    if (b.failures >= BREAKER_THRESHOLD && !b.openedAt) {
        b.openedAt = Date.now();
        console.warn(`[fetch] pausing requests to ${host} for ${BREAKER_COOLDOWN_MS / 1000}s after ${b.failures} failures`);
    }
    breakers.set(host, b);
}

function recordSuccess(host) { breakers.delete(host); }

export function resetCircuitBreakers() { breakers.clear(); }

export async function fetchJSONRetry(url, { retries = 2, signal, baseDelay = 600, headers, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
    const host = hostOf(url);
    // Host is known-bad right now: fail instantly instead of burning another timeout.
    if (breakerOpen(host)) return null;

    let delay = baseDelay;
    for (let attempt = 0; ; attempt++) {
        // Every request needs its own deadline. Without one a stalled connection hangs
        // forever, which is what left a full sync frozen partway through.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const onOuterAbort = () => controller.abort();
        if (signal) {
            if (signal.aborted) { clearTimeout(timer); throw new DOMException('Aborted', 'AbortError'); }
            signal.addEventListener('abort', onOuterAbort, { once: true });
        }
        try {
            const res = await fetch(url, { signal: controller.signal, headers });
            if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
            if (!res.ok) return null; // 404 and friends: retrying won't help
            const data = await res.json();
            // Jikan answers with a 200-shaped body carrying an error status in some cases.
            if (data && typeof data.status === 'number' && data.status >= 400) {
                throw new Error(`upstream ${data.status}`);
            }
            recordSuccess(host);
            return data;
        } catch (err) {
            // Our own deadline fired: treat it as a retryable failure, not a real abort.
            const timedOut = err.name === 'AbortError' && !signal?.aborted;
            if (err.name === 'AbortError' && signal?.aborted) throw err;
            if (attempt >= retries) {
                recordFailure(host);
                console.warn(`[fetch] gave up on ${url}: ${timedOut ? `timed out after ${timeoutMs}ms` : err.message}`);
                return null;
            }
            await sleep(delay);
            delay *= 2;
        } finally {
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', onOuterAbort);
        }
    }
}

// Runs async tasks with a cap on how many are in flight. A full sync used to fire one
// request per title at once, which guaranteed rate-limit errors from Jikan (3 req/sec).
export async function mapWithLimit(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (next < items.length) {
            const i = next++;
            try { results[i] = await worker(items[i], i); }
            catch (err) { results[i] = undefined; }
        }
    });
    await Promise.all(runners);
    return results;
}

// Jikan fronts MyAnimeList and intermittently returns 504 "MyAnimeList may be down".
export function jikanFetch(path, opts = {}) {
    return fetchJSONRetry(`${JIKAN_BASE}${path}`, opts);
}

// MAL reports episodes:null for currently-airing shows (One Piece, etc). The paginated
// episodes endpoint still knows how many have aired, so count them instead of showing "?".
const JIKAN_EPISODES_PER_PAGE = 100;
export async function resolveAnimeEpisodeCount(malId, opts = {}) {
    const first = await jikanFetch(`/anime/${malId}/episodes?page=1`, opts);
    if (!first?.pagination) return 0;

    const lastPage = first.pagination.last_visible_page || 1;
    if (lastPage <= 1) return (first.data || []).length;

    const last = await jikanFetch(`/anime/${malId}/episodes?page=${lastPage}`, opts);
    if (!last?.data) return (lastPage - 1) * JIKAN_EPISODES_PER_PAGE;
    return (lastPage - 1) * JIKAN_EPISODES_PER_PAGE + last.data.length;
}

async function callViaProxy(prompt) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
    try {
        const res = await fetch(PROXY_AI, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
            signal: controller.signal,
        });
        if (!res.ok) {
            const msg = await res.text().catch(() => `HTTP ${res.status}`);
            throw new Error(msg);
        }
        return await res.json();
    } catch (err) {
        if (err.name === 'AbortError') throw new Error('Proxy timed out');
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

export async function callTMDB(proxyEndpoint, params, config, signal) {
    if (config && config.tmdbKey && !isProxied()) {
        let url = '';
        const tmdbKey = config.tmdbKey;
        if (proxyEndpoint === 'search-movie') url = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${encodeURIComponent(params.query)}`;
        else if (proxyEndpoint === 'search-tv') url = `https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&query=${encodeURIComponent(params.query)}`;
        else if (proxyEndpoint === 'tv-details') url = `https://api.themoviedb.org/3/tv/${params.tvId}?api_key=${tmdbKey}`;
        else if (proxyEndpoint === 'movie-details') url = `https://api.themoviedb.org/3/movie/${params.tvId}?api_key=${tmdbKey}`;
        else if (proxyEndpoint === 'tv-similar') url = `https://api.themoviedb.org/3/tv/${params.tvId}/recommendations?api_key=${tmdbKey}`;
        else if (proxyEndpoint === 'movie-similar') url = `https://api.themoviedb.org/3/movie/${params.tvId}/recommendations?api_key=${tmdbKey}`;

        const data = await fetchJSONRetry(url, { signal, retries: 1 });
        if (!data) throw new Error('TMDB request failed');
        return data;
    } else {
        const queryParams = new URLSearchParams({ endpoint: proxyEndpoint, ...params });
        const data = await fetchJSONRetry(`${PROXY_TMDB}?${queryParams.toString()}`, { signal, retries: 1 });
        if (!data) throw new Error('TMDB proxy request failed');
        return data;
    }
}

// ── Keyless metadata fallbacks ───────────────────────────────────
// These need no API key, so they keep posters and episode counts working when MAL is
// down or no TMDB key is configured.

// Kitsu: anime database, no key required.
export async function kitsuAnime(title, opts = {}) {
    const url = `https://kitsu.io/api/edge/anime?filter%5Btext%5D=${encodeURIComponent(title)}&page%5Blimit%5D=1`;
    const data = await fetchJSONRetry(url, {
        ...opts,
        headers: { Accept: 'application/vnd.api+json' }
    });
    const a = data?.data?.[0]?.attributes;
    if (!a) return null;
    const rating = parseFloat(a.averageRating);
    return {
        title: a.canonicalTitle || title,
        poster: a.posterImage?.original || a.posterImage?.large || a.posterImage?.medium || null,
        episodes: parseInt(a.episodeCount) || 0,
        year: a.startDate ? parseInt(a.startDate.slice(0, 4)) : null,
        // Kitsu rates out of 100; show it on the same 10-point scale as everything else.
        globalRating: isNaN(rating) ? null : `${(rating / 10).toFixed(1)} ★`,
        description: (a.synopsis || '').slice(0, 300),
        isMovie: a.subtype === 'movie'
    };
}

// iTunes Search: no key. Reliable for TV artwork (movie results are often empty).
export async function itunesArtwork(title, opts = {}) {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&media=tvShow&entity=tvSeason&limit=1`;
    const data = await fetchJSONRetry(url, { retries: 1, ...opts });
    const art = data?.results?.[0]?.artworkUrl100;
    return art ? art.replace('100x100bb', '600x600bb') : null;
}

// Wikipedia REST summary: no key, CORS-enabled, and usually carries the poster image.
export async function wikipediaSummary(title, opts = {}) {
    const slug = encodeURIComponent(String(title).trim().replace(/\s+/g, '_'));
    const data = await fetchJSONRetry(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`, {
        retries: 1, ...opts
    });
    if (!data || data.type === 'disambiguation') return null;
    return {
        poster: data.thumbnail?.source || null,
        description: (data.extract || '').slice(0, 300)
    };
}

// ── Poster URL cache ─────────────────────────────────────────────
// Artwork lookups are the most repeated network calls in the app (and posters are not
// stored in the cloud DB), so remember the resolved URL per title.
const POSTER_CACHE_KEY = 'watchvault_poster_cache';
const POSTER_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
let posterCache = null;

function posterCacheKey(title, category) {
    return `${category || ''}|${String(title || '').trim().toLowerCase()}`;
}

function loadPosterCache() {
    if (posterCache) return posterCache;
    posterCache = new Map();
    try {
        const raw = JSON.parse(localStorage.getItem(POSTER_CACHE_KEY) || '[]');
        const now = Date.now();
        if (Array.isArray(raw)) {
            raw.forEach(([k, entry]) => {
                if (entry && now - entry.t < POSTER_CACHE_TTL) posterCache.set(k, entry);
            });
        }
    } catch { /* ignore a corrupt cache */ }
    return posterCache;
}

function savePosterCache() {
    try {
        localStorage.setItem(POSTER_CACHE_KEY, JSON.stringify([...loadPosterCache()]));
    } catch {
        try { localStorage.removeItem(POSTER_CACHE_KEY); } catch {}
    }
}

export function getCachedPoster(title, category) {
    const entry = loadPosterCache().get(posterCacheKey(title, category));
    return entry ? entry.url : undefined; // undefined = never looked up, null = looked up, none found
}

export function setCachedPoster(title, category, url) {
    const cache = loadPosterCache();
    cache.set(posterCacheKey(title, category), { url: url || null, t: Date.now() });
    while (cache.size > 400) cache.delete(cache.keys().next().value);
    savePosterCache();
}

// Best-effort poster lookup across the keyless sources, cheapest/most accurate first.
export async function findPosterFallback({ title, category }, opts = {}) {
    const cached = getCachedPoster(title, category);
    if (cached !== undefined) return cached;

    const url = await resolvePosterFallback({ title, category }, opts);
    setCachedPoster(title, category, url);
    return url;
}

async function resolvePosterFallback({ title, category }, opts = {}) {
    try {
        if (String(category || '').startsWith('anime')) {
            const k = await kitsuAnime(title, opts);
            if (k?.poster) return k.poster;
        } else if (category === 'series') {
            const art = await itunesArtwork(title, opts);
            if (art) return art;
        }
        const wiki = await wikipediaSummary(title, opts);
        return wiki?.poster || null;
    } catch (err) {
        if (err?.name === 'AbortError') throw err;
        return null;
    }
}

// ── Similar titles ───────────────────────────────────────────────
// Cached per title so reopening an item is instant and never re-spends an AI call.
const similarCache = new Map();

// Last-resort suggestions from the AI when no catalogue API could answer.
async function aiSimilarTitles(media, config, limit) {
    const prompt = `List ${limit} titles similar to "${media.title}"${media.year ? ` (${media.year})` : ''}`
        + `${media.genre ? `, genre: ${media.genre}` : ''}. Exclude "${media.title}" itself.
Return ONLY a JSON array: [{"title":"...","year":2020,"category":"anime-series|anime-movie|series|movie"}]`;
    const text = await callAI(prompt, config);
    const parsed = extractJSON(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
        .filter(r => r?.title)
        .slice(0, limit)
        .map(r => ({
            title: r.title,
            year: r.year || null,
            category: ['anime-series', 'anime-movie', 'series', 'movie'].includes(r.category)
                ? r.category : (media.category || 'movie'),
            poster: null
        }));
}

// Layered so it still returns something when MAL is down or no TMDB key is set.
export async function fetchSimilarTitles(media, config, limit = 8) {
    const cacheKey = `${media.category}|${String(media.title).toLowerCase()}`;
    if (similarCache.has(cacheKey)) return similarCache.get(cacheKey);

    const out = [];
    const push = t => { if (t.title && out.length < limit) out.push(t); };

    try {
        if (String(media.category || '').startsWith('anime')) {
            if (media.jikanId) {
                const rec = await jikanFetch(`/anime/${media.jikanId}/recommendations`, { retries: 1 });
                (rec?.data || []).slice(0, limit).forEach(r => {
                    const e = r.entry || {};
                    push({
                        title: e.title,
                        category: 'anime-series',
                        poster: e.images?.jpg?.large_image_url || e.images?.jpg?.image_url || null,
                        jikanId: e.mal_id
                    });
                });
            }
            if (!out.length) {
                // MAL unavailable — Kitsu can suggest by genre without a key.
                const genre = String(media.genre || '').split(',')[0].trim().toLowerCase().replace(/\s+/g, '-');
                if (genre) {
                    const url = `https://kitsu.io/api/edge/anime?filter%5Bcategories%5D=${encodeURIComponent(genre)}`
                        + `&page%5Blimit%5D=${limit + 4}&sort=-userCount`;
                    const data = await fetchJSONRetry(url, { retries: 1, headers: { Accept: 'application/vnd.api+json' } });
                    (data?.data || []).forEach(it => {
                        const a = it.attributes || {};
                        push({
                            title: a.canonicalTitle,
                            category: a.subtype === 'movie' ? 'anime-movie' : 'anime-series',
                            poster: a.posterImage?.medium || a.posterImage?.small || null,
                            year: a.startDate ? parseInt(a.startDate.slice(0, 4)) : null
                        });
                    });
                }
            }
        } else {
            const isMovie = media.category === 'movie';
            let tmdbId = media.tmdbId;
            if (!tmdbId) {
                const search = await callTMDB(isMovie ? 'search-movie' : 'search-tv',
                    { query: media.title }, config).catch(() => null);
                tmdbId = search?.results?.[0]?.id;
            }
            if (tmdbId) {
                const sim = await callTMDB(isMovie ? 'movie-similar' : 'tv-similar',
                    { tvId: tmdbId }, config).catch(() => null);
                (sim?.results || []).slice(0, limit).forEach(r => push({
                    title: r.title || r.name,
                    category: isMovie ? 'movie' : 'series',
                    poster: r.poster_path ? `https://image.tmdb.org/t/p/w300${r.poster_path}` : null,
                    year: (r.release_date || r.first_air_date || '').slice(0, 4) || null,
                    tmdbId: r.id
                }));
            }
        }
    } catch (err) {
        console.warn('Similar titles lookup failed:', err.message);
    }

    // Nothing from the catalogues (no TMDB key, or upstream down) — ask the AI.
    if (!out.length) {
        try {
            const suggested = await aiSimilarTitles(media, config, Math.min(limit, 6));
            suggested.forEach(push);
            // Artwork via the keyless sources so the cards aren't bare.
            await Promise.all(out.map(async t => {
                t.poster = await findPosterFallback(t).catch(() => null);
            }));
        } catch (err) {
            console.warn('AI similar fallback failed:', err.message);
        }
    }

    // Drop self-matches and duplicates.
    const seen = new Set([String(media.title || '').toLowerCase()]);
    const deduped = out.filter(t => {
        const key = String(t.title).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    similarCache.set(cacheKey, deduped);
    return deduped;
}

// Turns the proxy's provider-by-provider error dump into something actionable.
function explainProxyFailure(raw) {
    const text = String(raw || '');
    const hints = [];
    if (/\b403\b/.test(text)) hints.push('Gemini rejected the key (403) — check the key is valid and the Generative Language API is enabled for it');
    if (/\b429\b/.test(text)) hints.push('Groq is rate-limited (429) — wait a minute or use a different key');
    if (/\b413\b/.test(text)) hints.push('the request was too large (413) for that model');
    if (/\b404\b/.test(text)) hints.push('a provider model/endpoint no longer exists (404)');
    if (/not configured|missing/i.test(text)) hints.push('no AI keys are configured on the server');

    return hints.length
        ? `AI unavailable: ${hints.join('; ')}.`
        : 'AI unavailable — every provider failed. Check the Netlify function logs and your API keys.';
}

export async function callAI(prompt, config) {
    const errors = [];

    // In production every AI call goes through the serverless proxy. We deliberately do
    // NOT fall back to direct calls here: that would require shipping API keys to the
    // browser, where anyone could read them out of the page source.
    if (isProxied()) {
        try {
            const data = await callViaProxy(prompt);
            lastProviderUsed = data.providerUsed || 'Unknown';
            return data.text || '';
        } catch (err) {
            throw new Error(explainProxyFailure(err.message));
        }
    }

    for (const provider of AI_PROVIDERS) {
        if (provider.type === 'groq' && !config.groqKey) continue;
        if (provider.type === 'gemini' && !config.geminiKey) continue;
        if (provider.type === 'openrouter' && !config.openrouterKey) continue;
        if (provider.type === 'cohere' && !config.cohereKey) continue;

        try {
            let text;
            if (provider.type === 'gemini') {
                text = await callGemini(config.geminiKey, provider.model, prompt);
            } else if (provider.type === 'groq') {
                text = await callGroq(config.groqKey, provider.model, prompt);
            } else if (provider.type === 'openrouter') {
                text = await callOpenRouter(config.openrouterKey, provider.model, prompt);
            } else if (provider.type === 'cohere') {
                text = await callCohere(config.cohereKey, provider.model, prompt);
            }
            lastProviderUsed = provider.name;
            return text;
        } catch (err) {
            console.warn(`[${provider.name}] failed:`, err.message);
            errors.push(`${provider.name}: ${err.message}`);
        }
    }
    throw new Error('All AI providers failed:\n' + errors.join('\n'));
}

async function callGemini(apiKey, model, prompt) {
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;
    const body = { contents: [{ parts: [{ text: prompt }] }] };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } finally { clearTimeout(timeout); }
}

async function callGroq(apiKey, model, prompt) {
    const body = {
        model,
        messages: [
            { role: 'system', content: 'You are an entertainment assistant. Always respond with valid JSON only, no markdown.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.7, max_tokens: 8192,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(GROQ_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    } finally { clearTimeout(timeout); }
}

async function callOpenRouter(apiKey, model, prompt) {
    const body = {
        model,
        messages: [
            { role: 'system', content: 'You are an entertainment assistant. Always respond with valid JSON only, no markdown.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.7, max_tokens: 8192,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(OPENROUTER_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    } finally { clearTimeout(timeout); }
}

async function callCohere(apiKey, model, prompt) {
    const body = {
        model,
        messages: [
            { role: 'system', content: 'You are an entertainment assistant. Always respond with valid JSON only, no markdown.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.7,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(COHERE_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // v2 returns { message: { content: [{ type:'text', text }] } }
        const parts = data?.message?.content;
        if (Array.isArray(parts)) return parts.map(c => c.text || '').join('');
        return data.text || '';
    } finally { clearTimeout(timeout); }
}

export function extractJSON(text) {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    let raw = fenceMatch ? fenceMatch[1] : text;

    const start = raw.search(/[\[{]/);
    const lastBrace = raw.lastIndexOf('}');
    const lastBracket = raw.lastIndexOf(']');
    const end = Math.max(lastBrace, lastBracket);
    if (start === -1 || end === -1) throw new Error('No JSON found in response');
    raw = raw.slice(start, end + 1);

    try { return JSON.parse(raw); } catch { /* fall through */ }

    let repaired = raw
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/(["\w])\s*\n\s*(["\[{])/g, '$1,$2')
        .replace(/\t/g, ' ');

    try { return JSON.parse(repaired); } catch (e) {
        const lastComplete = Math.max(repaired.lastIndexOf('},'), repaired.lastIndexOf('}\n'));
        if (lastComplete > start) {
            try {
                const truncated = repaired.slice(0, lastComplete + 1) + (repaired[start] === '[' ? ']' : '}');
                return JSON.parse(truncated);
            } catch { /* ignore */ }
        }
        throw new Error('JSON parse failed after repairs: ' + e.message);
    }
}
