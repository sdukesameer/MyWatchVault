// js/dashboard.js
// Handles Stats computation, Continue Watching, and Upcoming logic

// Media types that some exports dump into the genre column.
const NON_GENRES = new Set([
    'anime', 'series', 'movie', 'movies', 'tv', 'tv show', 'tv series', 'web series',
    'film', 'show', 'ova', 'ona', 'special', 'unknown', 'n/a'
]);

let lastLibraryHash = '';
let cachedStats = null;

function computeLibraryHash(library) {
    return library.length + '-' + library.map(m => m.status + m.addedAt + m.hasNew + (m.seasons?.length||0) + m.rating + (m.globalRating||'') + (m.genre||'') + (m.runtime||'') + (m.seasons||[]).map(s=>s.watched).join(':')).join('');
}

export function getStats(library) {
    const hash = computeLibraryHash(library);
    if (hash === lastLibraryHash && cachedStats) {
        return cachedStats;
    }

    let hours = 0;
    let eps = 0;
    let sumRating = 0;
    let ratedCount = 0;
    let sumGlobal = 0;
    let globalCount = 0;
    const catCounts = { 'anime-series': 0, 'anime-movie': 0, 'series': 0, 'movie': 0 };
    const genreCounts = {};

    library.forEach(m => {
        if (catCounts[m.category] !== undefined) catCounts[m.category]++;
        if (m.rating > 0) {
            sumRating += m.rating;
            ratedCount++;
        }
        
        // Average of the public/critic scores, so you can see how well-regarded
        // the things you watch actually are.
        const global = parseFloat(m.globalRating);
        if (isFinite(global) && global > 0) { sumGlobal += global; globalCount++; }

        if (m.genre) {
            m.genre.split(',').forEach(raw => {
                const g = raw.trim();
                // Several sources put the media type in the genre column; those aren't genres.
                if (!g || NON_GENRES.has(g.toLowerCase())) return;
                genreCounts[g] = (genreCounts[g] || 0) + 1;
            });
        }

        // Prefer the real runtime when we have it; fall back to genre averages otherwise.
        const runtime = parseInt(m.runtime) || 0;
        if (m.category === 'movie' || m.category === 'anime-movie') {
            if (m.status === 'completed') hours += (runtime || 120) / 60;
        } else {
            const watchedEps = m.seasons?.reduce((acc, s) => acc + (parseInt(s.watched) || 0), 0) || 0;
            eps += watchedEps;
            const perEp = runtime || (m.category === 'anime-series' ? 24 : 45);
            hours += watchedEps * (perEp / 60);
        }
    });

    let topGenre = '-';
    let max = 0;
    for (const [g, count] of Object.entries(genreCounts)) {
        if (count > max) { max = count; topGenre = g; }
    }

    cachedStats = {
        total: library.length,
        hoursWatched: Math.round(hours),
        totalEpisodes: eps,
        avgRating: ratedCount ? (sumRating / ratedCount).toFixed(1) : '0.0',
        avgGlobalRating: globalCount ? (sumGlobal / globalCount).toFixed(1) : '0.0',
        ratedCount,
        topGenre,
        catCounts
    };
    lastLibraryHash = hash;
    
    return cachedStats;
}

const recency = m => new Date(m.updatedAt || m.addedAt || 0);

// ── Airing schedule ─────────────────────────────────────────────
// Anything with a known next-episode air time, soonest first. Titles you've dropped
// aren't upcoming, and an air time already past is stale data rather than a schedule.
export function getAiringSchedule(library, { days = 14, limit = 8 } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const horizon = now + days * 86400;

    return library
        .filter(m => m.status !== 'dropped')
        .map(m => ({ media: m, airingAt: parseInt(m.nextEpisode?.airingAt) || 0 }))
        .filter(e => e.airingAt > now && e.airingAt <= horizon)
        .sort((a, b) => a.airingAt - b.airingAt)
        .slice(0, limit)
        .map(e => ({ ...e.media, airingAt: e.airingAt, nextEpisode: e.media.nextEpisode }));
}

// "Today" / "Tomorrow" / "Sat 14 Sep", plus the local air time.
export function formatAirTime(airingAt) {
    const d = new Date(airingAt * 1000);
    const today = new Date();
    const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dayDiff = Math.round((startOf(d) - startOf(today)) / 86400000);

    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (dayDiff === 0) return `Today · ${time}`;
    if (dayDiff === 1) return `Tomorrow · ${time}`;
    if (dayDiff < 7) return `${d.toLocaleDateString([], { weekday: 'long' })} · ${time}`;
    return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${time}`;
}

// How many titles the Continue Watching hero will rotate through.
const CONTINUE_ROTATION_MAX = 10;

export function getDashboardItems(library) {
    const watching = library
        .filter(m => m.status === 'watching')
        .sort((a, b) => recency(b) - recency(a));

    // Everything currently being watched, most recently touched first — the hero
    // rotates through these.
    let continueItems = watching.slice(0, CONTINUE_ROTATION_MAX);
    let continueItem = continueItems[0] || null;

    if (!continueItem) {
        const planToWatch = library
            .filter(m => m.status === 'plan-to-watch')
            .sort((a, b) => recency(b) - recency(a));
        if (planToWatch.length > 0) {
            continueItems = planToWatch.slice(0, CONTINUE_ROTATION_MAX).map(m => ({ ...m, isFallback: true }));
            continueItem = continueItems[0];
        }
    }

    // hasNew first, then plan-to-watch; stable so the panel doesn't reshuffle on every render.
    const upcoming = library
        .filter(m => m.hasNew || m.status === 'plan-to-watch')
        .sort((a, b) => (b.hasNew ? 1 : 0) - (a.hasNew ? 1 : 0) || recency(b) - recency(a))
        .slice(0, 3);

    return { continueItem, continueItems, upcoming };
}
