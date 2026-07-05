// js/recommendations.js
// AI Recommendation Engine

import { callAI, extractJSON } from './api.js';
import { CAT_LABELS, CAT_EMOJI, escapeHTML } from './ui.js';

const delay = ms => new Promise(res => setTimeout(res, ms));

export async function fetchRecommendations(library, config, excludeTitles = []) {
    if (library.length < 2) {
        throw new Error('Add more titles for better recommendations!');
    }

    const liked = library
        .filter(m => m.rating >= 4 || m.status === 'completed')
        .map(m => m.title)
        .slice(0, 15)
        .join(', ');

    const allTitles = [...library.map(m => m.title), ...excludeTitles].join(', ');
    const cats = [...new Set(library.map(m => m.category))].join(', ');

    const prompt = `You are a media recommendation expert. Based on this user's watch history:
Top rated / completed: ${liked || 'none yet'}
All tracked and previously recommended: ${allTitles}
Preferred categories: ${cats}

Recommend 5 titles they would love that are NOT in their list.
Return JSON array:
[{ "title": "...", "year": 2023, "category": "anime-series|anime-movie|series|movie", "genre": "...", "description": "1-2 sentences about the show", "whyYouLikeIt": "Specific reason based on their taste (1 sentence)" }]
ONLY valid JSON array, no markdown.`;

    const text = await callAI(prompt, config);
    const recos = extractJSON(text) || [];
    
    // Enhance with real API data for posters and IDs sequentially to avoid rate limits
    const enhanced = [];
    for (const item of recos) {
        try {
            // Normalize category if AI hallucinates it
            if (item.category === 'anime') item.category = 'anime-series';
            if (item.category === 'film') item.category = 'movie';

            if (item.category.startsWith('anime')) {
                await delay(400); // Jikan 3 requests/sec limit
                const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(item.title)}&limit=1`).then(r=>r.json());
                if (res.data?.[0]) {
                    const match = res.data[0];
                    item.poster = match.images?.jpg?.large_image_url || match.images?.jpg?.image_url;
                    item.jikanId = match.mal_id;
                    item.year = match.year || item.year;
                    item.globalRating = match.score ? `${match.score} ★` : null;
                    if (match.type === 'Movie') item.category = 'anime-movie';
                }
            } else if (item.category === 'series') {
                const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(item.title)}`).then(r=>r.json());
                if (res?.[0]?.show) {
                    const match = res[0].show;
                    item.poster = match.image?.original || match.image?.medium;
                    item.tvmazeId = match.id;
                    item.globalRating = match.rating?.average ? `${match.rating.average} ★` : null;
                }
            } else if (item.category === 'movie') {
                const res = await import('./api.js').then(m => m.callTMDB('search-movie', { query: item.title }, config));
                if (res?.results?.[0]) {
                    const match = res.results[0];
                    item.poster = match.poster_path ? 'https://image.tmdb.org/t/p/w500' + match.poster_path : null;
                    item.tmdbId = match.id;
                    item.globalRating = match.vote_average ? `${match.vote_average.toFixed(1)} ★` : null;
                }
            }
        } catch (e) {
            console.warn("Failed to enhance reco:", item.title);
        }
        enhanced.push(item);
    }
    return enhanced;
}

export function renderRecommendations(recos, library, onQuickAdd, append = false) {
    const grid = document.getElementById('reco-grid');
    if (!recos.length && !append) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🤔</div><h3>No recommendations yet</h3><p>Rate or complete some titles to get personalised picks.</p></div>`;
        return;
    }
    
    if (!append) grid.innerHTML = '';
    recos.forEach(item => {
        const inLib = library.some(m => m.title.toLowerCase() === item.title.toLowerCase());
        const card = document.createElement('div');
        card.className = 'media-card'; // Use media-card class so it shares the grid styling
        
        const escapedTitle = escapeHTML(item.title);
        const posterHTML = item.poster
            ? `<img src="${escapeHTML(item.poster)}" alt="${escapedTitle}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : '';
        const placeholderStyle = item.poster ? 'style="display:none"' : '';

        card.innerHTML = `
            <div class="card-poster">
                ${posterHTML}
                <div class="card-poster-placeholder" ${placeholderStyle}>
                    <span>${CAT_EMOJI[item.category] || '🎬'}</span>
                    <span>${escapedTitle.slice(0, 18)}</span>
                </div>
                <div class="card-badge ${item.category?.split('-')[0]}">${CAT_LABELS[item.category] || 'Unknown'}</div>
            </div>
            <div class="card-body">
                <div class="card-title" title="${escapedTitle}">${escapedTitle}</div>
                <div class="card-meta">
                    ${item.year ? `<span>${escapeHTML(item.year.toString())}</span>` : ''}
                    ${item.genre ? `<span>${escapeHTML(item.genre.split(',')[0])}</span>` : ''}
                </div>
                <div style="font-size:11px;color:var(--text-dim);margin-top:6px;font-style:italic;">
                    🎯 ${escapeHTML(item.whyYouLikeIt || item.description || '')}
                </div>
                ${inLib 
                    ? `<div style="margin-top:10px;font-size:11px;color:var(--success);font-weight:600;">✓ In Vault</div>`
                    : `<button class="btn btn-secondary btn-sm reco-add-btn" style="margin-top:10px;" data-item='${JSON.stringify(item).replace(/'/g, "&apos;")}'>Preview</button>`
                }
            </div>`;

        card.tabIndex = 0;
        card.addEventListener('click', (e) => {
            if (inLib) return;
            onQuickAdd(item); // Note: we'll rename the callback usage in app.js
        });
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !inLib) onQuickAdd(item); });
        grid.appendChild(card);
    });
}
