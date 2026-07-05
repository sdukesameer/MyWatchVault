// js/search.js
import { escapeHTML, debounce } from './utils.js';
import { callTMDB } from './api.js';

let activeSearchController = null;

export function setupSearch(searchInput, dropdown, state, getCachedSearch, setCachedSearch, lib, onAdd, onPreview) {
    const handleSearch = async (query) => {
        if (query.length < 2) { 
            dropdown.style.display = 'none'; 
            return; 
        }

        dropdown.style.display = 'block';
        dropdown.innerHTML = `
            <div class="search-item skeleton" style="height: 80px;"></div>
            <div class="search-item skeleton" style="height: 80px;"></div>
            <div class="search-item skeleton" style="height: 80px;"></div>
        `;

        if (activeSearchController) {
            activeSearchController.abort();
        }
        activeSearchController = new AbortController();
        const signal = activeSearchController.signal;

        let results = getCachedSearch(query);
        if (!results) {
            try {
                results = [];
                const [jikanRes, tvmazeRes, tmdbMovie, tmdbTv] = await Promise.allSettled([
                    fetch(\`https://api.jikan.moe/v4/anime?q=\${encodeURIComponent(query)}&limit=3\`, { signal }).then(r=>r.json()),
                    fetch(\`https://api.tvmaze.com/search/shows?q=\${encodeURIComponent(query)}\`, { signal }).then(r=>r.json()),
                    callTMDB('search-movie', { query }, state.config, signal),
                    callTMDB('search-tv', { query }, state.config, signal)
                ]);

                if (signal.aborted) return;

                if (jikanRes.status === 'fulfilled' && jikanRes.value.data) {
                    jikanRes.value.data.slice(0, 3).forEach(a => {
                        results.push({
                            title: a.title_english || a.title,
                            year: a.year || (a.aired?.from ? new Date(a.aired.from).getFullYear() : null),
                            category: a.type === 'Movie' ? 'anime-movie' : 'anime-series',
                            genre: a.genres?.map(g => g.name).join(', ') || 'Anime',
                            description: (a.synopsis || '').slice(0, 150) + '...',
                            poster: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url,
                            jikanId: a.mal_id,
                            globalRating: a.score ? \`\${a.score} ★\` : null
                        });
                    });
                }

                if (tvmazeRes.status === 'fulfilled' && Array.isArray(tvmazeRes.value)) {
                    tvmazeRes.value.slice(0, 3).forEach(item => {
                        const s = item.show;
                        results.push({
                            title: s.name,
                            year: s.premiered ? new Date(s.premiered).getFullYear() : null,
                            category: 'series',
                            genre: s.genres?.join(', ') || 'Series',
                            description: (s.summary || '').replace(/<[^>]*>?/gm, '').slice(0, 150) + '...',
                            poster: s.image?.original || s.image?.medium,
                            tvmazeId: s.id,
                            globalRating: s.rating?.average ? \`\${s.rating.average} ★\` : null
                        });
                    });
                }

                if (tmdbMovie.status === 'fulfilled' && tmdbMovie.value.results) {
                    tmdbMovie.value.results.slice(0, 3).forEach(m => {
                        results.push({
                            title: m.title,
                            year: m.release_date ? new Date(m.release_date).getFullYear() : null,
                            category: 'movie',
                            genre: 'Movie',
                            description: (m.overview || '').slice(0, 150) + '...',
                            poster: m.poster_path ? \`https://image.tmdb.org/t/p/w500\${m.poster_path}\` : null,
                            tmdbId: m.id,
                            globalRating: m.vote_average ? \`\${m.vote_average.toFixed(1)} ★\` : null
                        });
                    });
                }

                if (tmdbTv.status === 'fulfilled' && tmdbTv.value.results) {
                    tmdbTv.value.results.slice(0, 2).forEach(s => {
                        results.push({
                            title: s.name,
                            year: s.first_air_date ? new Date(s.first_air_date).getFullYear() : null,
                            category: 'series',
                            genre: 'Series',
                            description: (s.overview || '').slice(0, 150) + '...',
                            poster: s.poster_path ? \`https://image.tmdb.org/t/p/w500\${s.poster_path}\` : null,
                            tmdbId: s.id,
                            globalRating: s.vote_average ? \`\${s.vote_average.toFixed(1)} ★\` : null
                        });
                    });
                }

                if (results.length > 0) setCachedSearch(query, results);

            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error("Search API failed", err);
                if (!signal.aborted) {
                    dropdown.innerHTML = \`<div style="padding:16px;color:var(--danger);text-align:center;">Search failed. Please try again.</div>\`;
                }
                return;
            }
        }

        if (signal && signal.aborted) return;

        if (results.length === 0) {
            dropdown.innerHTML = `<div style="padding:16px;color:var(--text-muted);text-align:center;">No titles found. Try adding manually!</div>`;
            return;
        }

        dropdown.innerHTML = '';
        results.forEach((item, idx) => {
            const normItemTitle = lib.normalizeTitle(item.title);
            const inLib = state.library.some(m => lib.normalizeTitle(m.title) === normItemTitle && m.category === item.category);

            const div = document.createElement('div');
            div.className = 'search-item';
            div.tabIndex = 0; // Keyboard accessible
            div.dataset.index = idx;
            
            const posterHTML = item.poster 
                ? `<img src="${item.poster}" class="card-poster-placeholder" style="width:40px;height:56px;border-radius:6px;object-fit:cover;">` 
                : `<div class="card-poster-placeholder" style="width:40px;height:56px;font-size:24px;border-radius:6px;background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;">🎬</div>`;
            
            div.innerHTML = `
                ${posterHTML}
                <div class="search-item-info">
                    <div class="search-item-title">${escapeHTML(item.title)} ${item.year ? `(${item.year})` : ''}</div>
                    <div class="search-item-meta">${item.category} ${item.globalRating ? '· ' + item.globalRating : ''}</div>
                </div>
                ${inLib
                    ? `<span style="font-size:11px;color:var(--success);font-weight:600;">✓ In Vault</span>`
                    : `<button class="search-item-add" tabindex="-1">+ Add</button>`}
            `;
            
            if (!inLib) {
                div.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // prevent blur
                    if (e.target.classList.contains('search-item-add')) {
                        const btn = div.querySelector('.search-item-add');
                        if (btn) { btn.textContent = 'Adding...'; btn.disabled = true; }
                        onAdd(item);
                    } else {
                        onPreview(item);
                    }
                });
                div.addEventListener('keydown', (e) => { 
                    if (e.key === 'Enter') div.dispatchEvent(new MouseEvent('mousedown')); 
                });
            }
            
            dropdown.appendChild(div);
        });
    };

    const debouncedSearch = debounce((q) => handleSearch(q), 400);

    searchInput.addEventListener('input', () => {
        debouncedSearch(searchInput.value.trim());
    });
    
    // Keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' && dropdown.style.display === 'block') {
            e.preventDefault();
            const firstItem = dropdown.querySelector('.search-item');
            if (firstItem) firstItem.focus();
        }
    });

    dropdown.addEventListener('keydown', (e) => {
        const items = Array.from(dropdown.querySelectorAll('.search-item'));
        const index = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (index < items.length - 1) items[index + 1].focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (index > 0) items[index - 1].focus();
            else searchInput.focus();
        }
    });

    searchInput.addEventListener('blur', () => setTimeout(() => { dropdown.style.display = 'none'; }, 200));
}
