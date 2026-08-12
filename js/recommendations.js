// js/recommendations.js
// AI Recommendation Engine

import { callAI, extractJSON, jikanFetch, fetchJSONRetry, kitsuAnime, findPosterFallback, callTMDB } from './api.js';
import { CAT_LABELS, CAT_EMOJI } from './constants.js';
import { escapeHTML } from './utils.js';
import { showStatusMenu } from './ui.js';
import { normalizeTitle } from './library.js';

const delay = ms => new Promise(res => setTimeout(res, ms));

export async function fetchRecommendations(library, config, excludeTitles = [], onProgress = null, count = 10) {
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

Recommend ${count} titles they would love that are NOT in their list.
Return JSON array:
[{ "title": "...", "year": 2023, "category": "anime-series|anime-movie|series|movie", "genre": "...", "description": "1-2 sentences about the show", "whyYouLikeIt": "Specific reason based on their taste (1 sentence)" }]
ONLY valid JSON array, no markdown.`;

    const text = await callAI(prompt, config);
    const recos = extractJSON(text) || [];

    // Drop anything already tracked — the AI ignores the exclusion list often enough.
    const owned = new Set(library.map(m => normalizeTitle(m.title)));
    const fresh = recos.filter(r => r?.title && !owned.has(normalizeTitle(r.title)));

    fresh.forEach(item => {
        // Normalize category if AI hallucinates it
        if (item.category === 'anime') item.category = 'anime-series';
        if (item.category === 'film') item.category = 'movie';
        if (!item.category) item.category = 'movie';
    });

    if (onProgress) onProgress(`Fetching artwork for ${fresh.length} titles…`);
    return fresh;
}

// Fills in poster/ids for one recommendation. Kept separate so the grid can render
// immediately and have artwork stream in rather than blocking on every lookup.
export async function enhanceRecommendation(item, config) {
    try {
        if (item.category.startsWith('anime')) {
            await delay(350); // Jikan allows ~3 requests/sec
            const res = await jikanFetch(`/anime?q=${encodeURIComponent(item.title)}&limit=1`, { retries: 1 });
            if (res?.data?.[0]) {
                const match = res.data[0];
                item.poster = match.images?.jpg?.large_image_url || match.images?.jpg?.image_url;
                item.jikanId = match.mal_id;
                item.year = match.year || item.year;
                item.globalRating = match.score ? `${match.score} ★` : null;
                if (match.type === 'Movie') item.category = 'anime-movie';
            } else {
                // MAL down — Kitsu needs no key and covers the same catalogue.
                const k = await kitsuAnime(item.title);
                if (k) {
                    item.poster = k.poster || item.poster;
                    item.year = k.year || item.year;
                    item.globalRating = k.globalRating || item.globalRating;
                    if (k.isMovie) item.category = 'anime-movie';
                }
            }
        } else if (item.category === 'series') {
            const res = await fetchJSONRetry(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(item.title)}`, { retries: 1 });
            if (res?.[0]?.show) {
                const match = res[0].show;
                item.poster = match.image?.original || match.image?.medium;
                item.tvmazeId = match.id;
                item.globalRating = match.rating?.average ? `${match.rating.average} ★` : null;
            }
        } else if (item.category === 'movie') {
            const res = await callTMDB('search-movie', { query: item.title }, config).catch(() => null);
            if (res?.results?.[0]) {
                const match = res.results[0];
                item.poster = match.poster_path ? 'https://image.tmdb.org/t/p/w500' + match.poster_path : null;
                item.tmdbId = match.id;
                item.globalRating = match.vote_average ? `${match.vote_average.toFixed(1)} ★` : null;
            }
        }
    } catch (e) {
        console.warn('Failed to enhance reco:', item.title, e.message);
    }

    // Last resort so a card is never left without artwork.
    if (!item.poster) {
        item.poster = await findPosterFallback(item).catch(() => null);
    }
    return item;
}

export function renderRecommendations(items, library, onQuickAdd, onOpenDetail, onAddWithStatus) {
    const grid = document.getElementById('reco-grid');
    if (!grid) return;
    
    grid.innerHTML = '';

    if (items.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="icon">🤔</div><h3>No recommendations yet</h3><p>Rate or complete some titles to get personalised picks.</p></div>';
        return;
    }
    
    // Suggestions stay on screen after being added, just marked as owned.
    const owned = new Set(library.map(m => normalizeTitle(m.title)));
    const visible = items;

    visible.forEach(item => {
        const isOwned = owned.has(normalizeTitle(item.title));
        const card = document.createElement('div');
        card.className = 'media-card'; // Use media-card class so it shares the grid styling
        if (isOwned) card.classList.add('reco-added');
        card.dataset.recoTitle = normalizeTitle(item.title);

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
                    ${item.globalRating ? `<span title="Global Rating">🌐 ${escapeHTML(item.globalRating)}</span>` : ''}
                </div>
                <div style="font-size:11px;color:var(--text-dim);margin-top:6px;font-style:italic;">
                    🎯 ${escapeHTML(item.whyYouLikeIt || item.description || '')}
                </div>
                <div class="reco-actions">
                    <button class="btn btn-secondary btn-sm reco-preview-btn">${isOwned ? 'Open' : 'Preview'}</button>
                    <button class="btn btn-primary btn-sm reco-add-now-btn" ${isOwned ? 'disabled' : ''}>${isOwned ? '✓ In Vault' : '+ Add'}</button>
                </div>
            </div>`;

        const vaultItem = isOwned
            ? library.find(m => normalizeTitle(m.title) === normalizeTitle(item.title))
            : null;
        const preview = () => (vaultItem && onOpenDetail ? onOpenDetail(vaultItem.id) : onQuickAdd(item));

        card.querySelector('.reco-preview-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            preview();
        });

        const addBtn = card.querySelector('.reco-add-now-btn');
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (document.body.classList.contains('read-only')) return;
            showStatusMenu(addBtn, async (status) => {
                addBtn.disabled = true;
                addBtn.textContent = 'Adding…';
                const ok = await onAddWithStatus?.(item, status);
                addBtn.textContent = ok ? '✓ Added' : '+ Add';
                addBtn.disabled = Boolean(ok);
                if (ok) card.classList.add('reco-added');
            });
        });

        card.querySelector('.card-poster').addEventListener('click', (e) => {
            e.stopPropagation();
            preview();
        });

        card.tabIndex = 0;
        card.addEventListener('click', preview);
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') preview();
        });
        grid.appendChild(card);
    });
}

// Filter/sort controls for the recommendations screen.
export function applyRecoFilters(items, { category = 'all', genre = 'all', rating = 'all', sortBy = 'default' } = {}) {
    let out = [...items];

    if (category !== 'all') out = out.filter(r => r.category === category);
    if (genre !== 'all') {
        out = out.filter(r => String(r.genre || '').toLowerCase().includes(genre.toLowerCase()));
    }
    if (rating !== 'all') {
        const min = parseFloat(rating);
        out = out.filter(r => (parseFloat(r.globalRating) || 0) >= min);
    }

    const score = r => parseFloat(r.globalRating) || 0;
    switch (sortBy) {
        case 'rating-desc': out.sort((a, b) => score(b) - score(a)); break;
        case 'year-desc': out.sort((a, b) => (b.year || 0) - (a.year || 0)); break;
        case 'year-asc': out.sort((a, b) => (a.year || 0) - (b.year || 0)); break;
        case 'name-asc': out.sort((a, b) => String(a.title).localeCompare(String(b.title))); break;
        default: break; // keep the AI's own ordering
    }
    return out;
}

export function recoGenres(items) {
    const set = new Set();
    items.forEach(r => String(r.genre || '').split(',').forEach(g => {
        const clean = g.trim();
        if (clean) set.add(clean);
    }));
    return [...set].sort();
}

// Updates one already-rendered card once its artwork/rating arrives, so the grid can
// appear instantly instead of waiting on every lookup.
export function updateRecommendationCard(item) {
    const card = document.querySelector(`#reco-grid .media-card[data-reco-title="${CSS.escape(normalizeTitle(item.title))}"]`);
    if (!card) return;

    if (item.poster) {
        const posterWrap = card.querySelector('.card-poster');
        const placeholder = posterWrap.querySelector('.card-poster-placeholder');
        if (!posterWrap.querySelector('img')) {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = item.title;
            img.src = item.poster;
            img.onerror = () => { img.remove(); if (placeholder) placeholder.style.display = 'flex'; };
            posterWrap.prepend(img);
            if (placeholder) placeholder.style.display = 'none';
        }
    }

    const badge = card.querySelector('.card-badge');
    if (badge) {
        badge.className = `card-badge ${item.category?.split('-')[0] || ''}`;
        badge.textContent = CAT_LABELS[item.category] || 'Unknown';
    }

    const meta = card.querySelector('.card-meta');
    if (meta) {
        meta.innerHTML = [
            item.year ? `<span>${escapeHTML(String(item.year))}</span>` : '',
            item.genre ? `<span>${escapeHTML(item.genre.split(',')[0])}</span>` : '',
            item.globalRating ? `<span title="Global Rating">🌐 ${escapeHTML(item.globalRating)}</span>` : ''
        ].join('');
    }
}
