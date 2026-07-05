// js/dashboard.js
// Handles Stats computation, Continue Watching, and Upcoming logic

let lastLibraryHash = '';
let cachedStats = null;

function computeLibraryHash(library) {
    return library.length + '-' + library.map(m => m.status + m.addedAt + m.hasNew + (m.seasons?.length||0) + m.rating).join('');
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
    const catCounts = { 'anime-series': 0, 'anime-movie': 0, 'series': 0, 'movie': 0 };
    const genreCounts = {};

    library.forEach(m => {
        if (catCounts[m.category] !== undefined) catCounts[m.category]++;
        if (m.rating > 0) {
            sumRating += parseFloat(m.rating);
            ratedCount++;
        }
        
        if (m.genre) {
            const genres = m.genre.split(',').map(g => g.trim());
            genres.forEach(g => {
                if (!genreCounts[g]) genreCounts[g] = 0;
                genreCounts[g]++;
            });
        }

        if (m.category === 'movie' || m.category === 'anime-movie') {
            if (m.status === 'completed') hours += 2; // avg 2 hours
        } else {
            const watchedEps = m.seasons?.reduce((acc, s) => acc + (parseInt(s.watched) || 0), 0) || 0;
            eps += watchedEps;
            if (m.category === 'anime-series') hours += watchedEps * 0.4; // 24m
            else hours += watchedEps * 0.75; // 45m
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
        topGenre,
        catCounts
    };
    lastLibraryHash = hash;
    
    return cachedStats;
}

export function getDashboardItems(library) {
    const watching = library.filter(m => m.status === 'watching');
    watching.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    let continueItem = watching.length > 0 ? watching[0] : null;

    if (!continueItem) {
        const planToWatch = library.filter(m => m.status === 'plan-to-watch');
        if (planToWatch.length > 0) {
            continueItem = planToWatch[Math.floor(Math.random() * planToWatch.length)];
            continueItem = { ...continueItem, isFallback: true };
        }
    }

    let upcoming = library.filter(m => m.hasNew || m.status === 'plan-to-watch');
    upcoming.sort((a, b) => {
        if (a.hasNew && !b.hasNew) return -1;
        if (!a.hasNew && b.hasNew) return 1;
        return new Date(b.addedAt) - new Date(a.addedAt);
    });
    upcoming = upcoming.slice(0, 4);

    return { continueItem, upcoming };
}
