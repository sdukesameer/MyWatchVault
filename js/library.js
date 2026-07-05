// js/library.js
// CRUD operations and local storage management

const DB_KEY = 'watchvault_library';
const SYNC_KEY = 'watchvault_sync';

export function loadLibrary() {
    try { return JSON.parse(localStorage.getItem(DB_KEY) || '[]'); } catch { return []; }
}

export function saveLibrary(lib) {
    try { localStorage.setItem(DB_KEY, JSON.stringify(lib)); }
    catch (e) { console.error('Storage error', e); throw e; }
}

export function loadSyncResults() {
    try { 
        const res = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}');
        // Migrate old _meta out if it exists
        if (res._meta) {
            saveSyncMeta(res._meta);
            delete res._meta;
            saveSyncResults(res);
        }
        return res;
    } catch { return {}; }
}

export function saveSyncResults(results) {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(results)); } catch {}
}

export function loadSyncMeta() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY + '_meta') || '{}'); } catch { return {}; }
}

export function saveSyncMeta(meta) {
    try { localStorage.setItem(SYNC_KEY + '_meta', JSON.stringify(meta)); } catch {}
}

export function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function normalizeTitle(title) {
    if (!title) return '';
    // Remove spaces, punctuation, symbols, and lowercase
    return title.toLowerCase().replace(/[\s\-_'",.:;!?()[\]{}]/g, '');
}

export function addMedia(lib, item) {
    const media = {
        id: uid(),
        title: item.title,
        year: item.year || null,
        category: item.category,
        genre: item.genre || '',
        description: item.description || '',
        status: item.status || 'plan-to-watch',
        seasons: item.seasons || [],
        rating: item.rating || 0,
        notes: item.notes || '',
        poster: item.poster || null,
        addedAt: new Date().toISOString(),
        hasNew: false,
        rewatchCount: item.rewatchCount || 0,
        tags: item.tags || [],
        jikanId: item.jikanId || null,
        tvmazeId: item.tvmazeId || null,
        tmdbId: item.tmdbId || null
    };
    
    if ((media.category === 'series' || media.category === 'anime-series') && media.seasons.length === 0) {
        media.seasons = [{ number: 1, watched: 0, total: 0 }];
    }
    
    lib.unshift(media);
    saveLibrary(lib);
    return media;
}

export function updateMedia(lib, id, updates) {
    const index = lib.findIndex(m => m.id === id);
    if (index !== -1) {
        lib[index] = { ...lib[index], ...updates };
        saveLibrary(lib);
        return true;
    }
    return false;
}

export function removeMedia(lib, syncResults, id) {
    const index = lib.findIndex(m => m.id === id);
    if (index !== -1) {
        lib.splice(index, 1);
        delete syncResults[id];
        saveLibrary(lib);
        saveSyncResults(syncResults);
        return true;
    }
    return false;
}

export function getFilteredLibrary(lib, cat, statusFilter, genreFilter, ratingFilter, sortBy) {
    let filtered = lib;
    
    // Category filter
    if (cat !== 'all') {
        filtered = filtered.filter(m => m.category === cat);
    }
    
    // Status filter
    if (statusFilter && statusFilter !== 'all') {
        filtered = filtered.filter(m => m.status === statusFilter);
    }

    // Genre filter
    if (genreFilter && genreFilter !== 'all') {
        filtered = filtered.filter(m => m.genre && m.genre.toLowerCase().includes(genreFilter.toLowerCase()));
    }

    // Rating filter
    if (ratingFilter && ratingFilter !== 'all') {
        if (ratingFilter === '5') {
            filtered = filtered.filter(m => m.rating === 5);
        } else if (ratingFilter === '4+') {
            filtered = filtered.filter(m => m.rating >= 4);
        } else if (ratingFilter === '3+') {
            filtered = filtered.filter(m => m.rating >= 3);
        }
    }
    
    // Sorting
    filtered = [...filtered];
    switch (sortBy) {
        case 'name-asc':
            filtered.sort((a, b) => a.title.localeCompare(b.title));
            break;
        case 'name-desc':
            filtered.sort((a, b) => b.title.localeCompare(a.title));
            break;
        case 'rating-desc':
            filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
            break;
        case 'status':
            const order = { watching: 1, 'plan-to-watch': 2, completed: 3, 'on-hold': 4, dropped: 5 };
            filtered.sort((a, b) => (order[a.status] || 9) - (order[b.status] || 9));
            break;
        case 'recently-added':
        default:
            filtered.sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
            break;
    }
    
    return filtered;
}

export function getStats(lib, syncResults) {
    let totalEpisodes = 0;
    let totalMinutes = 0;
    let totalRating = 0;
    let ratedCount = 0;
    let genreCounts = {};

    lib.forEach(m => {
        if (m.category === 'movie' || m.category === 'anime-movie') {
            if (m.status === 'completed') {
                totalEpisodes += 1;
                totalMinutes += 120;
            } else if (m.status === 'watching') {
                totalMinutes += 60;
            }
        } else {
            const watchedEps = m.seasons?.reduce((acc, s) => acc + (parseInt(s.watched) || 0), 0) || 0;
            totalEpisodes += watchedEps;
            const minsPerEp = m.category.includes('anime') ? 24 : 45;
            totalMinutes += (watchedEps * minsPerEp);
        }

        if (m.rating > 0) {
            totalRating += m.rating;
            ratedCount += 1;
        }

        if (m.genre) {
            m.genre.split(',').forEach(g => {
                const clean = g.trim();
                if (clean && clean !== 'Anime' && clean !== 'Series' && clean !== 'Movie') {
                    genreCounts[clean] = (genreCounts[clean] || 0) + 1;
                }
            });
        }
    });

    let topGenre = '-';
    let max = 0;
    for (const [g, count] of Object.entries(genreCounts)) {
        if (count > max) { max = count; topGenre = g; }
    }

    return {
        total: lib.length,
        watching: lib.filter(m => m.status === 'watching').length,
        completed: lib.filter(m => m.status === 'completed').length,
        newCount: lib.filter(m => m.hasNew && syncResults[m.id]).length,
        catCounts: {
            'all': lib.length,
            'anime-series': lib.filter(m => m.category === 'anime-series').length,
            'anime-movie': lib.filter(m => m.category === 'anime-movie').length,
            'series': lib.filter(m => m.category === 'series').length,
            'movie': lib.filter(m => m.category === 'movie').length,
        },
        hoursWatched: Math.floor(totalMinutes / 60),
        totalEpisodes,
        avgRating: ratedCount ? (totalRating / ratedCount).toFixed(1) : '0.0',
        topGenre
    };
}

export function exportLibrary(lib, syncResults) {
    const data = { library: lib, syncResults, syncMeta: loadSyncMeta(), exportDate: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watchvault-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

export function importLibrary(jsonString) {
    try {
        const data = JSON.parse(jsonString);
        if (!data.library || !Array.isArray(data.library)) {
            throw new Error("Invalid backup format: missing library array");
        }
        
        const validCategories = ['anime-series', 'anime-movie', 'series', 'movie'];
        const validStatuses = ['watching', 'completed', 'plan-to-watch', 'on-hold', 'dropped'];
        
        data.library.forEach((item, index) => {
            if (!item.id || !item.title) throw new Error(`Item at index ${index} missing id or title`);
            if (!validCategories.includes(item.category)) throw new Error(`Invalid category "${item.category}" for "${item.title}"`);
            if (!validStatuses.includes(item.status)) item.status = 'plan-to-watch';
            if (!Array.isArray(item.seasons)) item.seasons = [];
        });

        // Basic merge (replace all)
        saveLibrary(data.library);
        
        const sr = data.syncResults || {};
        delete sr._meta; // Ensure no old meta sneaks in
        saveSyncResults(sr);
        
        if (data.syncMeta) saveSyncMeta(data.syncMeta);
        
        return { success: true, count: data.library.length, library: data.library, syncResults: sr };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export function clearAllData() {
    saveLibrary([]);
    saveSyncResults({});
    return { library: [], syncResults: {} };
}

export function seedDemoData(lib) {
    if (lib.length > 0) return lib;
    
    const demo = [
        {
            id: uid(), title: 'Attack on Titan', year: 2013, category: 'anime-series',
            genre: 'Action, Dark Fantasy', description: 'Humanity fights for survival against giant humanoid Titans.',
            status: 'completed', rating: 5, notes: 'Absolute masterpiece',
            seasons: [
                { number: 1, watched: 25, total: 25 },
                { number: 2, watched: 12, total: 12 },
                { number: 3, watched: 22, total: 22 },
                { number: 4, watched: 30, total: 30 }
            ], poster: null, addedAt: new Date().toISOString(), hasNew: false
        },
        {
            id: uid(), title: 'One Piece', year: 1999, category: 'anime-series',
            genre: 'Adventure, Action', description: 'A young pirate searches for the legendary One Piece treasure.',
            status: 'watching', rating: 4, notes: 'Currently on Wano arc',
            seasons: [
                { number: 1, watched: 130, total: 130 },
                { number: 2, watched: 80, total: 130 }
            ], poster: null, addedAt: new Date().toISOString(), hasNew: false
        },
        {
            id: uid(), title: 'Breaking Bad', year: 2008, category: 'series',
            genre: 'Crime, Drama', description: 'A chemistry teacher turns to making crystal meth after a cancer diagnosis.',
            status: 'completed', rating: 5, notes: '',
            seasons: [
                { number: 1, watched: 7, total: 7 },
                { number: 2, watched: 13, total: 13 },
                { number: 3, watched: 13, total: 13 },
                { number: 4, watched: 13, total: 13 },
                { number: 5, watched: 16, total: 16 }
            ], poster: null, addedAt: new Date().toISOString(), hasNew: false
        },
        {
            id: uid(), title: 'Inception', year: 2010, category: 'movie',
            genre: 'Sci-Fi, Thriller', description: 'A thief who steals corporate secrets through dream-sharing technology.',
            status: 'completed', rating: 5, notes: 'Rewatched 3 times',
            seasons: [], poster: null, addedAt: new Date().toISOString(), hasNew: false
        }
    ];
    saveLibrary(demo);
    return demo;
}
