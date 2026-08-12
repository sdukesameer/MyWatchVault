// js/app.js
// Main Application Orchestrator

import * as lib from './library.js';
import * as ui from './ui.js';
import { runSync, renderSyncScreen } from './sync.js';
import { fetchRecommendations, renderRecommendations, enhanceRecommendation, updateRecommendationCard } from './recommendations.js';
import { callAI, extractJSON, getLastProvider, callTMDB, jikanFetch, fetchJSONRetry, resolveAnimeEpisodeCount, fetchSimilarTitles, findPosterFallback } from './api.js';
import { escapeHTML, showToast, handleError, showLoading, hideLoading, setupModalAccessibility, debounce } from './utils.js';
import { setupSearch } from './search.js';
import { getStats, getDashboardItems } from './dashboard.js';
import { CAT_LABELS, CAT_EMOJI, STATUS_LABELS, normalizeTags, isSeriesCategory } from './constants.js';

const state = {
    library: [],
    syncResults: {},
    config: {},
    currentCat: 'all',
    sortBy: 'recently-added',
    filterStatus: 'all',
    filterGenre: 'all',
    filterRating: 'all',
    libraryQuery: '',
    searchCache: new Map(),
    previewItem: null
};

const detailCache = new Map();
function cacheSet(key, val) {
    if (detailCache.size >= 20) {
        detailCache.delete(detailCache.keys().next().value); // FIFO
    }
    detailCache.set(key, val);
}

// TMDB exposes a real per-season breakdown, which is what we want when MAL/TVmaze are
// unavailable or (for long-running anime) only report a single lump season.
function seasonsFromTMDBDetails(details) {
    const listed = Array.isArray(details?.seasons) ? details.seasons : [];
    const real = listed.filter(s => (parseInt(s.season_number) || 0) > 0);
    if (real.length) {
        return real.map(s => ({
            number: parseInt(s.season_number),
            watched: 0,
            total: parseInt(s.episode_count) || 0
        }));
    }
    const count = parseInt(details?.number_of_seasons) || 0;
    return Array.from({ length: count }, (_, i) => ({ number: i + 1, watched: 0, total: 0 }));
}

// Resolves seasons through TMDB. Used as a fallback for both anime and live-action series.
async function tmdbSeasonsFor(item) {
    try {
        let tvId = item.tmdbId;
        if (!tvId) {
            const search = await callTMDB('search-tv', { query: item.title }, state.config);
            const best = search?.results?.[0];
            if (!best) return [];
            tvId = best.id;
            if (!item.poster && best.poster_path) item.poster = `https://image.tmdb.org/t/p/w500${best.poster_path}`;
        }
        const details = await callTMDB('tv-details', { tvId }, state.config);
        const seasons = seasonsFromTMDBDetails(details);
        if (seasons.length) item.tmdbId = tvId;
        return seasons;
    } catch (e) {
        console.warn('TMDB season fallback failed:', e.message);
        return [];
    }
}

async function fetchDeepDetails(item) {
    const cacheKey = item.category + '_' + (item.jikanId || item.tvmazeId || item.tmdbId || item.title);
    if (detailCache.has(cacheKey)) return detailCache.get(cacheKey);
    
    let seasons = [];
    let failed = false;

    try {
        if (item.category === 'anime-series' || item.category === 'anime') {
            let jId = item.jikanId;
            if (!jId) {
                const sData = await jikanFetch(`/anime?q=${encodeURIComponent(item.title)}&limit=1`);
                if (sData?.data?.[0]) jId = sData.data[0].mal_id;
            }

            if (jId) {
                const data = await jikanFetch(`/anime/${jId}`);
                if (data?.data) {
                    let eps = parseInt(data.data.episodes) || 0;
                    // Airing shows report no episode count; count the aired ones instead.
                    if (!eps) eps = await resolveAnimeEpisodeCount(jId);
                    seasons = [{ number: 1, watched: 0, total: eps }];
                    item.jikanId = jId; // save it
                }
            }

            // MAL search is frequently down, and it models long runners as one lump
            // season. Fall back to TMDB, which knows the real season breakdown.
            if (!seasons.length || (seasons.length === 1 && !seasons[0].total)) {
                const tmdbSeasons = await tmdbSeasonsFor(item);
                if (tmdbSeasons.length) seasons = tmdbSeasons;
            }
            if (!seasons.length) failed = true;
        } else if (item.category === 'series') {
            let tvId = item.tvmazeId;
            if (!tvId) {
                const sData = await fetchJSONRetry(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(item.title)}`);
                if (sData?.[0]?.show) tvId = sData[0].show.id;
            }
            if (tvId) {
                const data = await fetchJSONRetry(`https://api.tvmaze.com/shows/${tvId}/seasons`);
                if (Array.isArray(data)) {
                    seasons = data.filter(s => s.number > 0).map(s => ({
                        number: s.number,
                        watched: 0,
                        total: s.episodeOrder || 0
                    }));
                    item.tvmazeId = tvId; // save it
                }
            }

            if (!seasons.length) {
                const tmdbSeasons = await tmdbSeasonsFor(item);
                if (tmdbSeasons.length) seasons = tmdbSeasons;
            }
            if (!seasons.length) failed = true;
        }
    } catch (e) {
        console.warn('Deep fetch error:', e);
        failed = true;
    }

    if (failed) {
        showToast(`Couldn't reach the episode database for "${item.title}" — you can still set episodes manually.`, 'error');
    }

    if ((item.category === 'series' || item.category === 'anime-series') && seasons.length === 0) {
        seasons = [{ number: 1, watched: 0, total: 0 }];
    }
    
    cacheSet(cacheKey, seasons);
    return seasons;
}

// ── Environment Loading ──────────────────────────────────────────
let ENV_KEYS = {};
async function loadEnvKeys() {
    try {
        const m = await import('./env.js');
        if (m?.ENV_KEYS) ENV_KEYS = m.ENV_KEYS;
    } catch {
        console.log('Running locally without js/env.js');
    }
}

function loadConfig() {
    const isPlaceholder = v => !v || v.startsWith('PASTE_');
    state.config = {
        geminiKey: isPlaceholder(ENV_KEYS.geminiKey) ? '' : ENV_KEYS.geminiKey,
        groqKey: isPlaceholder(ENV_KEYS.groqKey) ? '' : ENV_KEYS.groqKey,
        openrouterKey: isPlaceholder(ENV_KEYS.openrouterKey) ? '' : ENV_KEYS.openrouterKey,
        cohereKey: isPlaceholder(ENV_KEYS.cohereKey) ? '' : ENV_KEYS.cohereKey,
        unsplashKey: isPlaceholder(ENV_KEYS.unsplashKey) ? '' : ENV_KEYS.unsplashKey,
        tmdbKey: isPlaceholder(ENV_KEYS.tmdbKey) ? '' : ENV_KEYS.tmdbKey,
    };
}

// ── Render Cycle ────────────────────────────────────────────────
const openDetail = (mediaOrId) => {
    let media = typeof mediaOrId === 'string' ? state.library.find(m => m.id === mediaOrId) : mediaOrId;
    if (!media) return;
    if (media.hasNew && media.id && !media.id.startsWith('preview_')) {
        media.hasNew = false;
        lib.updateMedia(state.library, media.id, { hasNew: false });
        render(); // Clear badge immediately
    }
    ui.openDetailModal(media);
    loadSimilarFor(media);
};

// "More Like This" — populated after the modal opens so it never delays it.
let similarToken = 0;
async function loadSimilarFor(media) {
    const token = ++similarToken;
    ui.renderSimilar([], { loading: true });

    const similar = await fetchSimilarTitles(media, state.config).catch(() => []);
    if (token !== similarToken) return; // a different item was opened meanwhile

    ui.renderSimilar(similar, {
        ownedTitles: new Set(state.library.map(m => lib.normalizeTitle(m.title))),
        onAdd: async (item) => {
            const dupe = state.library.some(m => lib.normalizeTitle(m.title) === lib.normalizeTitle(item.title));
            if (dupe) return true;
            try {
                const seasons = await fetchDeepDetails(item);
                const added = lib.addMedia(state.library, { ...item, seasons });
                showToast(`"${added.title}" added to vault ✓`, 'success');
                render();
                return true;
            } catch (e) {
                showToast(`Couldn't add "${item.title}"`, 'error');
                return false;
            }
        }
    });
}

function render() {
    const stats = getStats(state.library);
    ui.renderStats(stats);
    
    // Dynamically populate genre filter
    const genreSelect = document.getElementById('genre-filter');
    const currentGenre = genreSelect.value;
    const allGenres = new Set();
    state.library.forEach(m => {
        if (m.genre) m.genre.split(',').forEach(g => allGenres.add(g.trim()));
    });
    const sortedGenres = Array.from(allGenres).sort();
    genreSelect.innerHTML = `<option value="all">All Genres</option>` + 
        sortedGenres.map(g => `<option value="${escapeHTML(g)}">${escapeHTML(g)}</option>`).join('');
    genreSelect.value = sortedGenres.includes(currentGenre) ? currentGenre : 'all';
    state.filterGenre = genreSelect.value;
    const { continueItem, upcoming } = getDashboardItems(state.library);

    ui.renderDashboardWidgets(continueItem, upcoming, openDetail);
    
    const filtered = lib.getFilteredLibrary(state.library, state.currentCat, state.filterStatus, state.filterGenre, state.filterRating, state.sortBy, state.libraryQuery);
    const isFiltered = Boolean(state.libraryQuery) || state.filterStatus !== 'all'
        || state.filterGenre !== 'all' || state.filterRating !== 'all';
    ui.renderGrid(filtered, state.syncResults, state.currentCat, openDetail, isFiltered && state.library.length > 0);
    
    // Re-render recommendations if they are loaded so that "✓ In Vault" updates
    if (allRecosLoaded.length > 0 && recoCallback) {
        renderRecommendations(allRecosLoaded, state.library, recoCallback, openDetail);
    }
}

// ── Search cache ────────────────────────────────────────────────
// Persisted so repeat lookups stay instant across reloads, and so a flaky upstream
// (Jikan 504s) doesn't wipe out results you already fetched once.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_LIMIT = 100;
const SEARCH_CACHE_KEY = 'watchvault_search_cache';

function loadSearchCache() {
    try {
        const raw = JSON.parse(localStorage.getItem(SEARCH_CACHE_KEY) || '[]');
        if (!Array.isArray(raw)) return;
        const now = Date.now();
        raw.forEach(([q, entry]) => {
            if (entry && now - entry.timestamp < CACHE_TTL_MS) state.searchCache.set(q, entry);
        });
    } catch { /* corrupt cache is not worth recovering */ }
}

function persistSearchCache() {
    try {
        localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify([...state.searchCache]));
    } catch {
        // Quota exceeded — the cache is disposable, so drop it rather than fail.
        try { localStorage.removeItem(SEARCH_CACHE_KEY); } catch {}
    }
}

function getCachedSearch(query) {
    const q = query.toLowerCase();
    if (state.searchCache.has(q)) {
        const entry = state.searchCache.get(q);
        if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
            // Refresh recency so popular searches survive the LRU trim.
            state.searchCache.delete(q);
            state.searchCache.set(q, entry);
            return entry.results;
        }
        state.searchCache.delete(q);
    }
    return null;
}

function setCachedSearch(query, results) {
    const q = query.toLowerCase();
    state.searchCache.set(q, { results, timestamp: Date.now() });
    while (state.searchCache.size > CACHE_LIMIT) {
        state.searchCache.delete(state.searchCache.keys().next().value);
    }
    persistSearchCache();
}


// ── Poster backfill ─────────────────────────────────────────────
// Older entries (and anything added while an upstream was down) can be missing artwork.
// Fill those in from the keyless sources, a few per session so we never hammer them.
const POSTER_BACKFILL_LIMIT = 8;
async function backfillPosters() {
    const missing = state.library.filter(m => !m.poster && !m.posterTried).slice(0, POSTER_BACKFILL_LIMIT);
    if (!missing.length) return;

    let found = 0;
    for (const media of missing) {
        const poster = await findPosterFallback(media).catch(() => null);
        // Mark it either way so a title with no art isn't retried every session.
        const updates = { posterTried: true };
        if (poster) { updates.poster = poster; found++; }
        lib.updateMedia(state.library, media.id, updates);
    }
    if (found) render();
}

// ── Sync Handler ────────────────────────────────────────────────
async function handleRunSync() {
    try {
        let completed = 0;
        const total = state.library.length;
        showLoading('Running sync…', `Checking latest status of your tracked titles (0/${total})`);
        const res = await runSync(state.library, state.config, () => {
            completed++;
            document.getElementById('loading-sub').textContent = `Checking latest status of your tracked titles (${completed}/${total})`;
        });
        
        state.library = res.updatedLibrary;
        state.syncResults = res.syncResults;
        const syncMeta = { lastSync: new Date().toISOString() };
        
        lib.saveLibrary(state.library);
        lib.saveSyncResults(state.syncResults);
        lib.saveSyncMeta(syncMeta);
        
        hideLoading();
        showToast(`Sync complete! (via ${getLastProvider()})`, 'success');
        
        renderSyncScreen(state.library, state.syncResults);
        render();
    } catch (err) {
        hideLoading();
        showToast('Sync failed: ' + err.message, 'error');
    }
}

// ── Reco Handler ────────────────────────────────────────────────
let allRecosLoaded = [];
let recoCallback = null;
async function handleFetchRecos(append = false) {
    try {
        showLoading(append ? 'Loading more...' : 'Finding recommendations…', 'AI is analysing your taste profile');
        const timeout = setTimeout(() => {
            hideLoading();
            showToast('Recommendations took too long', 'error');
        }, 30000); // 30s safety timeout for slow LLMs
        
        const excludeTitles = append ? allRecosLoaded.map(r => r.title) : [];
        excludeTitles.push(...state.library.map(m => m.title));
        const recos = await fetchRecommendations(state.library, state.config, excludeTitles, (msg) => {
            showLoading(append ? 'Loading more...' : 'Finding recommendations…', msg);
        });
        
        if (append) {
            allRecosLoaded = [...allRecosLoaded, ...recos];
        } else {
            allRecosLoaded = recos;
        }

        clearTimeout(timeout);
        hideLoading();
        showToast(`Found recos! (via ${getLastProvider()})`, 'success');

        recoCallback = async (item) => {
            showLoading('Fetching details...');
            const detailTimeout = setTimeout(() => hideLoading(), 10000);
            const seasons = await fetchDeepDetails(item);
            clearTimeout(detailTimeout);
            hideLoading();
            
            const previewItem = {
                ...item,
                id: 'preview_' + Date.now(),
                status: 'plan-to-watch',
                seasons: seasons,
                rating: 0,
                notes: '',
                addedAt: new Date().toISOString(),
                rewatchCount: 0,
                tags: []
            };
            state.previewItem = previewItem;
            openDetail(previewItem);
        };

        // Show the grid straight away, then stream artwork into each card as it resolves.
        renderRecommendations(allRecosLoaded, state.library, recoCallback, openDetail);
        document.getElementById('load-more-reco-wrap').style.display = recos.length ? 'block' : 'none';

        for (const item of recos) {
            await enhanceRecommendation(item, state.config);
            updateRecommendationCard(item);
        }
    } catch (err) {
        hideLoading();
        showToast('Recommendations failed: ' + err.message, 'error');
    }
}

// ── Event Binding ───────────────────────────────────────────────
function bindEvents() {
    // Nav
    document.getElementById('home-btn').addEventListener('click', () => { ui.showScreen('screen-library'); render(); });
    document.getElementById('sync-nav-btn').addEventListener('click', () => { 
        ui.showScreen('screen-sync'); 
        renderSyncScreen(state.library, state.syncResults); 
    });
    document.getElementById('reco-nav-btn').addEventListener('click', () => {
        ui.showScreen('screen-reco'); 
        handleFetchRecos(); 
    });
    document.getElementById('refresh-reco-btn').addEventListener('click', () => handleFetchRecos(false));
    document.getElementById('load-more-reco-btn').addEventListener('click', () => handleFetchRecos(true));
    document.getElementById('settings-btn').addEventListener('click', () => ui.openModal('settings-modal'));
    
    // Back buttons
    document.querySelectorAll('.back-to-lib').forEach(btn => {
        btn.addEventListener('click', () => { ui.showScreen('screen-library'); render(); });
    });

    // Category Tabs
    document.querySelectorAll('.cat-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.currentCat = tab.dataset.cat;
            render();
        });
    });
    
    // Sort & Filter
    document.getElementById('sort-select').addEventListener('change', (e) => {
        state.sortBy = e.target.value;
        render();
    });
    document.getElementById('status-filter').addEventListener('change', (e) => {
        state.filterStatus = e.target.value;
        render();
    });
    document.getElementById('genre-filter').addEventListener('change', (e) => {
        state.filterGenre = e.target.value;
        render();
    });
    document.getElementById('rating-filter').addEventListener('change', (e) => {
        state.filterRating = e.target.value;
        render();
    });
    document.getElementById('library-filter').addEventListener('input', debounce((e) => {
        state.libraryQuery = e.target.value;
        render();
    }, 200));

    // Random Picker
    document.getElementById('random-picker-btn').addEventListener('click', () => {
        const pool = state.library.filter(m => m.status === 'plan-to-watch' || m.status === 'on-hold');
        if (pool.length === 0) {
            showToast("Your Plan to Watch list is empty!", "info");
            return;
        }
        const randomItem = pool[Math.floor(Math.random() * pool.length)];
        openDetail(randomItem);
    });

    // Search
    const searchInput = document.getElementById('search-input');
    const dropdown = document.getElementById('search-dropdown');
    setupSearch(searchInput, dropdown, state, getCachedSearch, setCachedSearch, lib, async (item) => {
        // onAdd
        const seasons = await fetchDeepDetails(item);
        const media = lib.addMedia(state.library, { ...item, seasons });
        showToast(`"${media.title}" added to vault ✓`, 'success');
        dropdown.style.display = 'none';
        searchInput.value = '';
        render();
    }, async (item) => {
        // onPreview
        dropdown.style.display = 'none';
        searchInput.value = '';
        showLoading('Fetching details...', '', 15000);
        const seasons = await fetchDeepDetails(item);
        hideLoading();

        state.previewItem = { ...item, id: 'preview_' + Date.now(), status: 'plan-to-watch', seasons };
        openDetail(state.previewItem);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { dropdown.style.display = 'none'; document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden')); } });

    // Manual Add Modal
    document.getElementById('manual-add-btn').addEventListener('click', () => ui.openModal('add-modal'));
    setupModalAccessibility('add-modal', 'add-modal-close', () => ui.closeModal('add-modal'));
    document.getElementById('add-cancel-btn').addEventListener('click', () => ui.closeModal('add-modal'));
    document.getElementById('add-modal').addEventListener('click', e => { if (e.target === e.currentTarget) ui.closeModal('add-modal'); });

    document.getElementById('add-confirm-btn').addEventListener('click', async () => {
        const title = document.getElementById('add-title').value.trim();
        const category = document.getElementById('add-category').value;
        if (!title || !category) { showToast('Fill in title and category', 'error'); return; }
        
        const normTitle = lib.normalizeTitle(title);
        const isDuplicate = state.library.some(m => lib.normalizeTitle(m.title) === normTitle && m.category === category);
        if (isDuplicate) {
            showToast(`"${title}" is already in your vault!`, 'error');
            return;
        }

        ui.closeModal('add-modal');
        showLoading('Finding details...', `Searching for ${title}`);

        let mediaData = {
            title, category,
            year: parseInt(document.getElementById('add-year').value) || null,
            genre: document.getElementById('add-genre').value.trim(),
            status: document.getElementById('add-status').value
        };

        try {
            if (category.startsWith('anime')) {
                const sData = await jikanFetch(`/anime?q=${encodeURIComponent(title)}&limit=1`);
                if (sData?.data?.[0]) {
                    const best = sData.data[0];
                    if (!mediaData.year && best.year) mediaData.year = best.year;
                    if (!mediaData.genre && best.genres && best.genres.length > 0) {
                        mediaData.genre = best.genres.map(g => g.name).join(', ');
                    }
                    mediaData.description = (best.synopsis || '').slice(0, 300) + (best.synopsis?.length > 300 ? '...' : '');
                    mediaData.poster = best.images?.jpg?.large_image_url || best.images?.jpg?.image_url;
                    mediaData.globalRating = best.score ? `${best.score} ★` : null;
                    mediaData.jikanId = best.mal_id;
                } else {
                    // MAL unreachable — pull what we can from TMDB instead of adding a bare title.
                    const endpoint = category === 'anime-movie' ? 'search-movie' : 'search-tv';
                    const alt = await callTMDB(endpoint, { query: title }, state.config).catch(() => null);
                    const best = alt?.results?.[0];
                    if (best) {
                        const date = best.release_date || best.first_air_date;
                        if (!mediaData.year && date) mediaData.year = parseInt(date.split('-')[0]);
                        if (best.poster_path) mediaData.poster = `https://image.tmdb.org/t/p/w500${best.poster_path}`;
                        if (best.vote_average) mediaData.globalRating = `${best.vote_average.toFixed(1)} ★`;
                        mediaData.description = (best.overview || '').slice(0, 300) + (best.overview?.length > 300 ? '...' : '');
                        mediaData.tmdbId = best.id;
                    }
                }
            } else {
                const endpoint = category.includes('movie') ? 'search-movie' : 'search-tv';
                const searchData = await callTMDB(endpoint, { query: title }, state.config);
                if (searchData && searchData.results && searchData.results.length > 0) {
                    const best = searchData.results[0];
                    if (!mediaData.year && (best.release_date || best.first_air_date)) {
                        mediaData.year = parseInt((best.release_date || best.first_air_date).split('-')[0]);
                    }
                    if (best.poster_path) mediaData.poster = `https://image.tmdb.org/t/p/w500${best.poster_path}`;
                    mediaData.tmdbId = best.id;
                    if (best.vote_average) mediaData.globalRating = `${best.vote_average.toFixed(1)} ★`;
                    mediaData.description = (best.overview || '').slice(0, 300) + (best.overview?.length > 300 ? '...' : '');

                    try {
                        const detailEnd = category.includes('movie') ? 'movie-details' : 'tv-details';
                        const details = await callTMDB(detailEnd, { tvId: best.id }, state.config);
                        if (!mediaData.genre && details.genres) {
                            mediaData.genre = details.genres.map(g => g.name).join(', ');
                        }
                    } catch(e) {}
                }
            }
        } catch (err) {
            console.warn('Failed to fetch details for manual add:', err);
        }

        const media = lib.addMedia(state.library, mediaData);
        
        try {
            const fetchedSeasons = await fetchDeepDetails(media);
            if (fetchedSeasons && fetchedSeasons.length > 0) {
                media.seasons = fetchedSeasons;
                lib.updateMedia(state.library, media.id, { seasons: fetchedSeasons });
            }
        } catch(e) {}

        hideLoading();
        render();
        showToast(`Added "${title}" to your vault`, 'success');
        
        ['add-title','add-year','add-genre'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('add-category').value = '';
        document.getElementById('add-status').value = 'plan-to-watch';
        
        setTimeout(() => openDetail(media), 100);
    });

    // Detail Modal
    const checkDetailUnsaved = () => {
        const currentData = ui.collectDetailData();
        let media = state.library.find(m => m.id === currentData.id);
        if (!media && currentData.id.startsWith('preview_')) {
            media = state.previewItem;
        }
        if (!media) return false;
        
        const normSeason = s => ({
            number: parseInt(s.number) || 0,
            watched: parseInt(s.watched) || 0,
            total: parseInt(s.total) || 0,
            completed: Boolean(s.completed)
        });
        let currentSeasonsNorm = (currentData.seasons || []).map(normSeason);
        let mediaSeasonsNorm = (media.seasons || []).map(normSeason);
        
        if (mediaSeasonsNorm.length === 0 && currentSeasonsNorm.length === 1 && currentSeasonsNorm[0].watched === 0 && currentSeasonsNorm[0].total === 0) {
            currentSeasonsNorm = [];
        }
        
        const seasonsMatch = JSON.stringify(currentSeasonsNorm) === JSON.stringify(mediaSeasonsNorm);
        return currentData.status !== media.status || 
               currentData.category !== media.category ||
               currentData.notes !== (media.notes || '') || 
               // Compare like with like: stored tags may predate the normalising rules.
               currentData.tags.join(',') !== normalizeTags(media.tags).join(',') ||
               currentData.rating !== (media.rating || 0) ||
               currentData.rewatchCount !== (media.rewatchCount || 0) ||
               !seasonsMatch;
    };

    const handleDetailClose = () => {
        if (checkDetailUnsaved()) {
            ui.renderConfirmModal(
                'Unsaved Changes',
                'You have unsaved changes. Are you sure you want to discard them?',
                'Discard',
                () => ui.closeModal('detail-modal')
            );
        } else {
            ui.closeModal('detail-modal');
        }
    };

    setupModalAccessibility('detail-modal', 'detail-close', handleDetailClose);
    document.getElementById('detail-cancel-btn').addEventListener('click', handleDetailClose);
    document.getElementById('detail-modal').addEventListener('click', e => { if (e.target === e.currentTarget) handleDetailClose(); });

    document.getElementById('add-season-btn').addEventListener('click', () => {
        const seasons = ui.collectDetailData().seasons;
        // Continue from the highest existing season number, not the row count.
        const nextNumber = seasons.reduce((max, s) => Math.max(max, s.number || 0), 0) + 1;
        seasons.push({ number: nextNumber, watched: 0, total: 0 });
        ui.renderSeasons(seasons);
    });

    document.getElementById('detail-save-btn').addEventListener('click', () => {
        const data = ui.collectDetailData();
        if (data.id.startsWith('preview_')) {
            const fullItem = { ...state.previewItem, ...data };
            delete fullItem.id; // Let lib.addMedia generate a real ID
            lib.addMedia(state.library, fullItem);
            state.previewItem = null;
            ui.closeModal('detail-modal');
            render();
            showToast('Added to vault ✓', 'success');
        } else {
            if (lib.updateMedia(state.library, data.id, { ...data, updatedAt: new Date().toISOString() })) {
                ui.closeModal('detail-modal');
                render();
                showToast('Saved ✓', 'success');
            }
        }
    });

    document.getElementById('detail-sync-btn').addEventListener('click', async () => {
        const data = ui.collectDetailData();
        let media = state.library.find(m => m.id === data.id);
        if (!media && data.id.startsWith('preview_')) media = state.previewItem;
        if (!media) return;
        
        showLoading('Syncing item...', 'Fetching latest seasons and episodes');
        try {
            // Re-fetch deep details
            detailCache.delete(media.category + '_' + (media.jikanId || media.tvmazeId || media.tmdbId || media.title));
            const newSeasons = await fetchDeepDetails(media);
            
            // Merge seasons, preferring watched counts the user has typed but not yet saved.
            if (newSeasons && newSeasons.length > 0) {
                newSeasons.forEach(ns => {
                    const prior = (data.seasons || []).find(s => s.number === ns.number)
                        || (media.seasons || []).find(s => s.number === ns.number);
                    if (prior) {
                        ns.watched = prior.watched;
                        if (prior.completed) ns.completed = true;
                    }
                });
                media.seasons = newSeasons;

                // Carry the user's in-progress edits across the re-render so Sync never discards them.
                media.notes = data.notes;
                media.tags = data.tags;
                media.rating = data.rating;
                media.category = data.category;
                media.rewatchCount = data.rewatchCount;
                media.status = data.status;

                openDetail(media);

                // Update sync results if not a preview
                if (!data.id.startsWith('preview_')) {
                    const totalWatched = media.seasons.reduce((acc, s) => acc + (parseInt(s.watched) || 0), 0);
                    const totalEpisodes = media.seasons.reduce((acc, s) => acc + (parseInt(s.total) || 0), 0);
                    const upToDate = totalEpisodes > 0 && totalWatched >= totalEpisodes;
                    state.syncResults[media.id] = {
                        latestSeason: media.seasons.length,
                        latestEpisodes: totalEpisodes,
                        upToDate: upToDate,
                        isOngoing: false // Simple assumption for manual sync
                    };
                    
                    if (!upToDate && media.status === 'completed') {
                        media.status = 'watching';
                    }
                    
                    lib.saveSyncResults(state.syncResults);
                    // Autosave the library to lock in the new seasons and status
                    lib.updateMedia(state.library, media.id, { seasons: media.seasons, status: media.status });
                    render();
                }
                showToast('Sync successful', 'success');
            } else {
                showToast('No new data found', 'info');
            }
        } catch (e) {
            showToast('Sync failed: ' + e.message, 'error');
        }
        hideLoading();
    });

    document.getElementById('detail-delete-btn').addEventListener('click', () => {
        const data = ui.collectDetailData();
        if (data.id.startsWith('preview_')) {
            // It's a preview item, delete just means cancel
            ui.closeModal('detail-modal');
            return;
        }

        const media = state.library.find(m => m.id === data.id);
        const clonedMedia = JSON.parse(JSON.stringify(media));
        
        lib.removeMedia(state.library, state.syncResults, data.id);
        ui.closeModal('detail-modal');
        render();
        
        showToast(`Removed "${media.title}"`, 'info', 'Undo', () => {
            lib.addMedia(state.library, clonedMedia);
            render();
            showToast(`Restored "${media.title}"`, 'success');
        }, 5000);
    });

    // Settings Modal
    setupModalAccessibility('settings-modal', 'settings-close', () => ui.closeModal('settings-modal'));
    document.getElementById('settings-cancel').addEventListener('click', () => ui.closeModal('settings-modal'));
    document.getElementById('settings-modal').addEventListener('click', e => { if (e.target === e.currentTarget) ui.closeModal('settings-modal'); });

    document.getElementById('export-btn').addEventListener('click', () => {
        lib.exportLibrary(state.library, state.syncResults);
        showToast('Export triggered', 'success');
    });

    // JSON Import
    document.getElementById('import-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const jsonStr = e.target.result;
            const res = lib.importLibrary(jsonStr);
            if (res.success) {
                state.library = res.library;
                state.syncResults = res.syncResults;
                render();
                showToast(`Imported ${res.count} titles!`, 'success');
                ui.closeModal('settings-modal');
            } else {
                showToast(`Import failed: ${res.error}`, 'error');
            }
            document.getElementById('import-file-input').value = '';
        };
        reader.readAsText(file);
    });

    document.getElementById('clear-all-btn').addEventListener('click', () => {
        if (state.library.length === 0) {
            showToast('Your vault is already empty', 'info');
            return;
        }

        ui.renderConfirmModal(
            'Clear All Data',
            `This will permanently delete all ${state.library.length} titles and their watch progress. Export a backup first if you want to keep them.`,
            'Delete Everything',
            () => {
                const clonedLib = JSON.parse(JSON.stringify(state.library));
                const clonedSync = JSON.parse(JSON.stringify(state.syncResults));

                const res = lib.clearAllData();
                state.library = res.library;
                state.syncResults = res.syncResults;
                ui.closeModal('settings-modal');
                render();

                showToast('All data cleared', 'info', 'Undo', () => {
                    state.library = clonedLib;
                    state.syncResults = clonedSync;
                    lib.saveLibrary(state.library);
                    lib.saveSyncResults(state.syncResults);
                    render();
                    showToast('Data restored', 'success');
                }, 8000);
            }
        );
    });

    // Sync screen actions
    document.body.addEventListener('click', e => {
        if (e.target.id === 'run-sync-btn' || e.target.id === 'run-sync-btn-empty') {
            handleRunSync();
        }
    });
}

// ── Initialization ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await loadEnvKeys();
    loadConfig();
    
    try {
        state.library = lib.loadLibrary();
    } catch (err) {
        const backup = lib.loadBackupLibrary();
        state.library = backup || [];
        setTimeout(() => showToast(
            backup
                ? 'Library data was corrupted — restored your last backup.'
                : 'Library data was corrupted and could not be recovered.',
            'error', null, null, 8000
        ), 500);
    }
    state.syncResults = lib.loadSyncResults();
    loadSearchCache();

    document.getElementById('add-year').max = new Date().getFullYear() + 5;

    bindEvents();
    render();

    // Fill in any missing artwork quietly in the background.
    setTimeout(() => backfillPosters(), 1200);

    // Daily auto-sync check
    const today = new Date().toDateString();
    if (localStorage.getItem('lastAutoSyncDate') !== today) {
        localStorage.setItem('lastAutoSyncDate', today);
        setTimeout(() => {
            if (state.library.length > 0) handleRunSync();
        }, 3000);
    }
});
