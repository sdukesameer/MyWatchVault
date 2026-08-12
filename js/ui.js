// js/ui.js
// DOM Rendering functions

import { CAT_LABELS, CAT_EMOJI, STATUS_LABELS, STATUS_DOT_CLASS, isSeriesCategory, normalizeTags } from './constants.js';
import { escapeHTML } from './utils.js';
import { normalizeTitle } from './library.js';

let editingId = null;

export function renderStats(stats) {
    const elHours = document.getElementById('stat-hours');
    const elEp = document.getElementById('stat-episodes');

    const elGenre = document.getElementById('stat-fav-genre');
    
    if (elHours) elHours.textContent = stats.hoursWatched || 0;
    if (elEp) elEp.textContent = stats.totalEpisodes || 0;
    const elGlobal = document.getElementById('stat-global-rating');
    if (elGlobal) elGlobal.textContent = stats.avgGlobalRating || '0.0';
    if (elGenre) elGenre.textContent = stats.topGenre || '-';

    document.getElementById('count-all').textContent = stats.total;
    ['anime-series', 'anime-movie', 'series', 'movie'].forEach(c => {
        const el = document.getElementById(`count-${c}`);
        if (el) el.textContent = stats.catCounts[c] || 0;
    });
}

export function renderDashboardWidgets(continueItem, upcomingItems, onCardClick) {
    // 1. Continue Watching
    const continueWrap = document.getElementById('continue-content');
    if (continueWrap) {
        if (!continueItem) {
            continueWrap.innerHTML = `<div class="continue-empty">Your vault is completely empty. Start tracking your favorites!</div>`;
        } else {
            let progressText = '';
            let progressPercent = 0;
            
            if (continueItem.isFallback) {
                progressText = 'Next up in your vault';
                progressPercent = 0;
            } else if (continueItem.category === 'movie' || continueItem.category === 'anime-movie') {
                progressText = 'Watching';
                progressPercent = 50;
            } else {
                const totalWatched = continueItem.seasons?.reduce((acc, s) => acc + (parseInt(s.watched)||0), 0) || 0;
                const totalEpisodes = continueItem.seasons?.reduce((acc, s) => acc + (parseInt(s.total)||0), 0) || 0;
                progressText = totalEpisodes > 0 ? `Watched ${totalWatched} / ${totalEpisodes} EP` : `Watched ${totalWatched} EP`;
                progressPercent = totalEpisodes > 0 ? Math.min(100, Math.max(5, (totalWatched / totalEpisodes) * 100)) : 5;
            }
            const posterHTML = continueItem.poster
                ? `<img class="continue-hero-bg" src="${escapeHTML(continueItem.poster)}" alt="">`
                : `<div class="continue-hero-bg continue-hero-fallback">${CAT_EMOJI[continueItem.category] || '🎬'}</div>`;

            continueWrap.innerHTML = `
                <div class="continue-hero">
                    ${posterHTML}
                    <div class="continue-hero-scrim"></div>
                    <div class="continue-hero-content">
                        <p class="continue-eyebrow">Continue Watching</p>
                        <h3 class="continue-hero-title">${escapeHTML(continueItem.title)}</h3>
                        <div class="continue-hero-footer">
                            <div class="continue-hero-progress">
                                <p class="continue-progress-text">${escapeHTML(progressText)}</p>
                                <div class="continue-bar">
                                    <div class="continue-bar-fill" style="width:${progressPercent}%"></div>
                                </div>
                            </div>
                            <button class="btn btn-primary continue-edit-btn" id="dash-continue-btn">Edit →</button>
                        </div>
                    </div>
                </div>
            `;
            const btn = document.getElementById('dash-continue-btn');
            if (btn) btn.addEventListener('click', () => onCardClick(continueItem.id));
        }
    }

    // 2. Upcoming / New Releases
    const upcomingWrap = document.getElementById('upcoming-list');
    if (upcomingWrap) {
        if (!upcomingItems || !upcomingItems.length) {
            upcomingWrap.innerHTML = `<div class="upcoming-empty">No new releases available.</div>`;
        } else {
            upcomingWrap.innerHTML = '';
            upcomingItems.forEach(item => {
                const posterHTML = item.poster 
                    ? `<img src="${item.poster}" class="upcoming-poster">` 
                    : `<div class="upcoming-poster" style="display:flex;align-items:center;justify-content:center;font-size:20px;background:var(--surface);border:1px solid var(--border)">${CAT_EMOJI[item.category]||'🎬'}</div>`;
                
                const div = document.createElement('div');
                div.className = 'upcoming-item';
                div.innerHTML = `
                    ${posterHTML}
                    <div class="upcoming-info">
                        <div class="upcoming-title">${escapeHTML(item.title)}</div>
                        <div class="upcoming-meta">${item.hasNew ? 'New Content!' : 'Coming Soon'}</div>
                    </div>
                `;
                div.addEventListener('click', () => onCardClick(item.id));
                upcomingWrap.appendChild(div);
            });
        }
    }
}

// Splits the library into labelled sections for the "Group by" control.
function groupLibrary(items, groupBy) {
    if (!groupBy || groupBy === 'none') return [{ label: null, items }];

    const buckets = new Map();
    const keyFor = m => {
        switch (groupBy) {
            case 'status': return STATUS_LABELS[m.status] || 'Unknown';
            case 'category': return CAT_LABELS[m.category] || 'Unknown';
            case 'rating': return m.rating > 0 ? `${'★'.repeat(m.rating)} (${m.rating})` : 'Unrated';
            case 'genre': return String(m.genre || '').split(',')[0].trim() || 'No genre';
            default: return 'All';
        }
    };
    items.forEach(m => {
        const k = keyFor(m);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(m);
    });

    const order = groupBy === 'status'
        ? ['Watching', 'Plan to Watch', 'On Hold', 'Completed', 'Dropped']
        : null;

    return [...buckets.entries()]
        .sort((a, b) => {
            if (order) {
                const ai = order.indexOf(a[0]), bi = order.indexOf(b[0]);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            }
            if (groupBy === 'rating') {
                // Highest rating first, with "Unrated" last.
                const num = s => (s.match(/\((\d)\)/) ? parseInt(s.match(/\((\d)\)/)[1]) : -1);
                return num(b[0]) - num(a[0]);
            }
            return a[0].localeCompare(b[0]);
        })
        .map(([label, groupItems]) => ({ label, items: groupItems }));
}

export function renderGrid(filteredLib, syncResults, currentCat, onCardClick, isFiltered = false,
                           { groupBy = 'none', selectMode = false, selectedIds = new Set(), onToggleSelect } = {}) {
    const grid = document.getElementById('media-grid');

    if (!filteredLib.length) {
        grid.innerHTML = isFiltered
            ? `<div class="empty-state" style="grid-column:1/-1">
                <div class="icon">🔍</div>
                <h3>No matches</h3>
                <p>Nothing in your vault matches these filters. Try clearing them.</p>
            </div>`
            : `<div class="empty-state" style="grid-column:1/-1">
                <div class="icon">${currentCat === 'all' ? '🎬' : CAT_EMOJI[currentCat]}</div>
                <h3>Nothing here yet</h3>
                <p>Search for a title above or click "+ Add Manually" to start building your vault.</p>
            </div>`;
        return;
    }

    grid.innerHTML = '';
    const groups = groupLibrary(filteredLib, groupBy);
    groups.forEach(group => {
      if (group.label) {
        const heading = document.createElement('div');
        heading.className = 'group-heading';
        heading.innerHTML = `${escapeHTML(group.label)}<span class="group-count">${group.items.length}</span>`;
        grid.appendChild(heading);
      }
      group.items.forEach(media => {
        const card = document.createElement('div');
        card.className = 'media-card';
        if (selectMode) card.classList.add('selectable');
        if (selectedIds.has(media.id)) card.classList.add('selected');
        card.dataset.id = media.id;
        card.tabIndex = 0;

        const syncData = syncResults[media.id];
        const hasNew = media.hasNew && syncData;

        const escapedTitle = escapeHTML(media.title);
        const posterHTML = media.poster
            ? `<img src="${escapeHTML(media.poster)}" alt="${escapedTitle}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : '';
        const placeholderStyle = media.poster ? 'style="display:none"' : '';

        let progress = 0;
        if (media.seasons?.length) {
            const totalEp = media.seasons.reduce((s, se) => s + (parseInt(se.total) || 0), 0);
            const watchedEp = media.seasons.reduce((s, se) => s + (parseInt(se.watched) || 0), 0);
            if (totalEp > 0) progress = Math.round((watchedEp / totalEp) * 100);
        }

        const progressHTML = (media.category === 'series' || media.category === 'anime-series') && media.seasons?.length
            ? `<div class="card-progress"><div class="card-progress-fill" style="width:${progress}%"></div></div>`
            : '';

        const statusDotClass = hasNew ? 'new-available' : (STATUS_DOT_CLASS[media.status] || 'not-started');
        const newBadge = hasNew ? `<div class="card-new-badge">🆕 NEW CONTENT</div>` : '';

        const tagsHTML = media.tags?.length
            ? `<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap;">
                ${media.tags.slice(0, 2).map(t => `<span style="font-size:9px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);padding:2px 6px;border-radius:4px;color:var(--text-dim)">#${escapeHTML(t)}</span>`).join('')}
                ${media.tags.length > 2 ? `<span style="font-size:9px;color:var(--text-muted);align-self:center;">+${media.tags.length - 2}</span>` : ''}
               </div>`
            : '';

        card.innerHTML = `
            <div class="card-poster">
                ${posterHTML}
                <div class="card-poster-placeholder" ${placeholderStyle}>
                    <span>${CAT_EMOJI[media.category] || '🎬'}</span>
                    <span>${escapedTitle.slice(0, 18)}</span>
                </div>
                ${selectMode
                    ? `<div class="card-select-box">${selectedIds.has(media.id) ? '✓' : ''}</div>`
                    : `<div class="card-badge ${media.category?.split('-')[0]}">${CAT_LABELS[media.category] || 'Unknown'}</div>`}
                <div class="card-status-dot ${statusDotClass}" title="${STATUS_LABELS[media.status] || ''}"></div>
                ${newBadge}
            </div>
            <div class="card-body">
                <div class="card-title" title="${escapedTitle}">${escapedTitle}</div>
                <div class="card-meta">
                    ${media.year ? `<span>${escapeHTML(media.year.toString())}</span>` : ''}
                    ${media.genre ? `<span>${escapeHTML(media.genre.split(',')[0])}</span>` : ''}
                    ${media.globalRating ? `<span title="Global Rating">🌐 ${escapeHTML(media.globalRating)}</span>` : ''}
                    ${media.rating > 0 ? `<span title="Your Rating" style="color:var(--accent3)">${'★'.repeat(media.rating)}</span>` : ''}
                </div>
                ${progressHTML}
                ${tagsHTML}
            </div>`;

        // In select mode a click toggles selection instead of opening the item.
        const activate = () => (selectMode ? onToggleSelect?.(media.id) : onCardClick(media.id));
        card.addEventListener('click', activate);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter') activate(); });
        grid.appendChild(card);
      });
    });
}

export function openDetailModal(media) {
    editingId = media.id;

    const isPreview = media.id.startsWith('preview_');
    document.getElementById('detail-save-btn').textContent = isPreview ? 'Add to Vault' : 'Save Changes';
    document.getElementById('detail-delete-btn').style.display = isPreview ? 'none' : 'block';

    document.getElementById('detail-title').textContent = media.title;
    document.getElementById('detail-subtitle').textContent = `${CAT_LABELS[media.category] || ''} · ${media.year || 'Year unknown'}`;

    const posterWrap = document.getElementById('detail-poster-wrap');
    if (media.poster) {
        posterWrap.innerHTML = `<img class="detail-poster" src="${escapeHTML(media.poster)}" alt="${escapeHTML(media.title)}" onerror="this.outerHTML='<div class=detail-poster-placeholder>${CAT_EMOJI[media.category]}</div>'">`;
    } else {
        posterWrap.innerHTML = `<div class="detail-poster-placeholder">${CAT_EMOJI[media.category] || '🎬'}</div>`;
    }

    const metaEl = document.getElementById('detail-meta');
    const pills = [];
    if (media.year) pills.push({ text: media.year });
    if (media.genre) pills.push({ text: media.genre });
    if (media.seasons?.length) pills.push({ text: `${media.seasons.length} Season${media.seasons.length !== 1 ? 's' : ''}`, highlight: true });
    metaEl.innerHTML = pills.map(p => `<span class="meta-pill${p.highlight ? ' highlight' : ''}">${escapeHTML(p.text)}</span>`).join('');

    document.getElementById('detail-desc').textContent = media.description || '';

    const statuses = ['watching', 'completed', 'plan-to-watch', 'on-hold', 'dropped'];
    const ssEl = document.getElementById('status-selector');
    ssEl.innerHTML = statuses.map(s => `
        <span class="status-opt ${s} ${media.status === s ? 'active' : ''}" data-status="${s}">
            ${STATUS_LABELS[s]}
        </span>`).join('');
        
    const rewatchWrap = document.getElementById('rewatch-container');
    const rewatchCountEl = document.getElementById('rewatch-count');
    const rewatchBtn = document.getElementById('rewatch-btn');
    let currentRewatch = media.rewatchCount || 0;
    
    const updateRewatchUI = (status) => {
        if (status === 'completed') {
            rewatchWrap.style.display = 'flex';
            rewatchCountEl.textContent = currentRewatch;
        } else {
            rewatchWrap.style.display = 'none';
        }
    };
    updateRewatchUI(media.status);

    // Remove old listeners to avoid multiple fires if reopened
    const newRewatchBtn = rewatchBtn.cloneNode(true);
    rewatchBtn.parentNode.replaceChild(newRewatchBtn, rewatchBtn);
    newRewatchBtn.addEventListener('click', () => {
        if (document.body.classList.contains('read-only')) return;
        currentRewatch++;
        document.getElementById('rewatch-count').textContent = currentRewatch;
    });

    ssEl.querySelectorAll('.status-opt').forEach(el => {
        el.addEventListener('click', () => {
            if (document.body.classList.contains('read-only')) return;
            ssEl.querySelectorAll('.status-opt').forEach(o => o.classList.remove('active'));
            el.classList.add('active');
            updateRewatchUI(el.dataset.status);
            
            // Marking the whole item complete finishes every season, even ones whose
            // episode count is unknown.
            if (el.dataset.status === 'completed') {
                markAllSeasonsComplete();
            }
        });
    });

    const catSelect = document.getElementById('detail-category');
    catSelect.innerHTML = Object.entries(CAT_LABELS).map(([k, v]) => 
        `<option value="${k}" ${media.category === k ? 'selected' : ''}>${escapeHTML(v)}</option>`
    ).join('');

    document.getElementById('detail-global-rating').textContent = media.globalRating || '—';
    renderRatingStars(media.rating || 0);

    document.getElementById('detail-tags').value = (media.tags || []).join(', ');
    document.getElementById('detail-notes').value = media.notes || '';

    const trackerSection = document.getElementById('tracker-section');
    const tracksSeasons = isSeriesCategory(media.category);
    trackerSection.style.display = tracksSeasons ? 'block' : 'none';
    // Always re-render — otherwise a hidden grid keeps the previous item's rows and
    // collectDetailData() would save them onto this one.
    renderSeasons(tracksSeasons ? (media.seasons || []) : []);

    openModal('detail-modal');
}

function renderRatingStars(rating) {
    const wrap = document.getElementById('detail-rating');
    if (!wrap) return;

    wrap.dataset.value = rating;
    wrap.innerHTML = [1, 2, 3, 4, 5].map(n =>
        `<span class="star ${n <= rating ? 'filled' : 'empty'}" data-value="${n}" role="button" tabindex="0"
               title="Rate ${n} star${n !== 1 ? 's' : ''}" aria-label="Rate ${n} star${n !== 1 ? 's' : ''}">★</span>`
    ).join('');

    wrap.querySelectorAll('.star').forEach(star => {
        const setRating = () => {
            if (document.body.classList.contains('read-only')) return;
            const clicked = parseInt(star.dataset.value);
            // Clicking the current rating clears it, so a misclick is recoverable.
            renderRatingStars(clicked === parseInt(wrap.dataset.value) ? 0 : clicked);
        };
        star.addEventListener('click', setRating);
        star.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRating(); }
        });
    });
}

// A season counts as finished when the episode counts say so. When the total is unknown
// (ongoing shows report no count) we fall back to an explicit flag the user can set.
function isSeasonComplete({ watched, total, completed }) {
    const w = parseInt(watched) || 0;
    const t = parseInt(total) || 0;
    return t > 0 ? w >= t : Boolean(completed);
}

function seasonStateOf(season) {
    if (isSeasonComplete(season)) return { cls: 'done', label: 'Complete' };
    if ((parseInt(season.watched) || 0) > 0) return { cls: 'progress', label: 'In progress' };
    return { cls: 'not-started', label: 'Not started' };
}

export function renderSeasons(seasons) {
    const grid = document.getElementById('seasons-grid');
    grid.innerHTML = '';
    // Season numbers are stable identifiers, not positions — display them in order but never renumber.
    const ordered = [...seasons].sort((a, b) => (a.number || 0) - (b.number || 0));
    ordered.forEach((s, idx) => {
        const number = parseInt(s.number) || idx + 1;
        const watched = parseInt(s.watched) || 0;
        const total = parseInt(s.total) || 0;
        const completed = isSeasonComplete(s);
        const { cls, label } = seasonStateOf(s);

        const row = document.createElement('div');
        row.className = 'season-row';
        row.dataset.number = number;
        row.dataset.completed = completed ? 'true' : 'false';
        row.innerHTML = `
            <div class="season-label">Season ${number}</div>
            <div class="season-ep-track">
                <input class="ep-input" type="number" min="0" value="${watched}" placeholder="0" title="Watched episodes">
                <span class="ep-sep">/ </span>
                <input class="ep-input" type="number" min="0" value="${total || ''}" placeholder="?" title="Total episodes">
                <span style="font-size:11px;color:var(--text-muted);">ep</span>
            </div>
            <span class="season-status ${cls}" role="button" tabindex="0">${label}</span>
            <button class="season-delete" title="Remove season">✕</button>`;

        row.querySelectorAll('.ep-input').forEach(inp => {
            inp.addEventListener('input', () => {
                // Typed counts take over from the manual flag.
                row.dataset.completed = 'false';
                updateSeasonStatus(row);
            });
        });

        const statusSpan = row.querySelector('.season-status');
        statusSpan.style.cursor = 'pointer';
        statusSpan.title = 'Click to cycle: Complete → In progress → Not started';
        const cycle = () => cycleSeasonState(row);
        statusSpan.addEventListener('click', cycle);
        statusSpan.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle(); }
        });

        row.querySelector('.season-delete').addEventListener('click', () => {
            if (document.body.classList.contains('read-only')) return;
            // Re-render from the remaining rows so the labels can never drift from the data.
            renderSeasons(collectSeasonRows().filter(s => s.number !== number));
            updateOverallStatusFromSeasons();
        });

        grid.appendChild(row);
    });
}

// Reads the tracker rows back out, keeping each row's real season number.
export function collectSeasonRows() {
    return Array.from(document.querySelectorAll('#seasons-grid .season-row')).map((row, idx) => {
        const [watchedInp, totalInp] = row.querySelectorAll('.ep-input');
        const season = {
            number: parseInt(row.dataset.number) || idx + 1,
            watched: parseInt(watchedInp.value) || 0,
            total: parseInt(totalInp.value) || 0
        };
        // Only persist the flag when it's actually load-bearing (unknown total).
        if (season.total === 0 && row.dataset.completed === 'true') season.completed = true;
        return season;
    });
}

function rowIsComplete(row) {
    const [watchedInp, totalInp] = row.querySelectorAll('.ep-input');
    return isSeasonComplete({
        watched: watchedInp.value,
        total: totalInp.value,
        completed: row.dataset.completed === 'true'
    });
}

function markRowComplete(row) {
    const [watchedInp, totalInp] = row.querySelectorAll('.ep-input');
    const total = parseInt(totalInp.value) || 0;
    if (total > 0) {
        watchedInp.value = total;
        row.dataset.completed = 'false';
    } else {
        // No episode count available — record completion explicitly.
        row.dataset.completed = 'true';
    }
    updateSeasonStatus(row, { silent: true });
}

function markRowInProgress(row) {
    const [watchedInp, totalInp] = row.querySelectorAll('.ep-input');
    const total = parseInt(totalInp.value) || 0;
    row.dataset.completed = 'false';
    if (total > 1) watchedInp.value = total - 1;
    else if (total === 1) watchedInp.value = 0;
    else watchedInp.value = Math.max(1, parseInt(watchedInp.value) || 0);
    updateSeasonStatus(row, { silent: true });
}

function markRowNotStarted(row) {
    const [watchedInp] = row.querySelectorAll('.ep-input');
    watchedInp.value = 0;
    row.dataset.completed = 'false';
    updateSeasonStatus(row, { silent: true });
}

// Complete → In progress → Not started. Completing a season also completes every earlier
// one, since you can't reach season N without finishing the ones before it.
function cycleSeasonState(row) {
    if (document.body.classList.contains('read-only')) return;
    const number = parseInt(row.dataset.number) || 0;
    const watched = parseInt(row.querySelectorAll('.ep-input')[0].value) || 0;

    if (rowIsComplete(row)) {
        markRowInProgress(row);
    } else if (watched > 0) {
        markRowNotStarted(row);
    } else {
        document.querySelectorAll('#seasons-grid .season-row').forEach(r => {
            if ((parseInt(r.dataset.number) || 0) <= number) markRowComplete(r);
        });
    }

    updateOverallStatusFromSeasons();
}

// Small popup anchored to a button, letting the user pick which status to add/set.
const STATUS_ORDER = ['plan-to-watch', 'watching', 'completed', 'on-hold', 'dropped'];
let openStatusMenu = null;

export function closeStatusMenu() {
    if (openStatusMenu) { openStatusMenu.remove(); openStatusMenu = null; }
}

export function showStatusMenu(anchorEl, onPick, { heading = 'Add as…' } = {}) {
    closeStatusMenu();

    const menu = document.createElement('div');
    menu.className = 'status-menu';
    menu.innerHTML = `
        <div class="status-menu-head">${escapeHTML(heading)}</div>
        ${STATUS_ORDER.map(s => `
            <button class="status-menu-item" data-status="${s}">
                <span class="status-menu-dot ${s}"></span>${escapeHTML(STATUS_LABELS[s])}
            </button>`).join('')}`;

    document.body.appendChild(menu);

    // Anchor below the button, flipping/clamping so it stays on screen.
    const r = anchorEl.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    let left = Math.min(r.left, window.innerWidth - mw - 8);
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(Math.max(8, left))}px`;

    menu.querySelectorAll('.status-menu-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const status = btn.dataset.status;
            closeStatusMenu();
            onPick(status);
        });
    });

    // Defer so the click that opened the menu doesn't immediately close it.
    setTimeout(() => {
        const away = (e) => {
            if (!menu.contains(e.target)) { closeStatusMenu(); document.removeEventListener('click', away); }
        };
        document.addEventListener('click', away);
    }, 0);

    openStatusMenu = menu;
    return menu;
}

// Collapses the section back down without fetching anything.
export function resetSimilar() {
    const section = document.getElementById('similar-section');
    const list = document.getElementById('similar-list');
    const toggle = document.getElementById('similar-toggle');
    if (!section || !list || !toggle) return;
    section.style.display = 'block';
    list.style.display = 'none';
    list.innerHTML = '';
    toggle.setAttribute('aria-expanded', 'false');
}

export function renderSimilar(items, { loading = false, onAdd, ownedTitles = new Set() } = {}) {
    const section = document.getElementById('similar-section');
    const list = document.getElementById('similar-list');
    const toggle = document.getElementById('similar-toggle');
    if (!section || !list) return;

    section.style.display = 'block';
    list.style.display = 'grid';
    if (toggle) toggle.setAttribute('aria-expanded', 'true');

    if (loading) {
        list.innerHTML = Array.from({ length: 4 },
            () => `<div class="similar-card skeleton" style="height:200px;"></div>`).join('');
        return;
    }

    if (!items.length) {
        list.innerHTML = `<div class="similar-empty">No suggestions available right now.</div>`;
        return;
    }

    list.innerHTML = '';
    items.forEach(item => {
        const owned = ownedTitles.has(normalizeTitle(item.title));
        const card = document.createElement('div');
        card.className = 'similar-card';
        const poster = item.poster
            ? `<img class="similar-poster" src="${escapeHTML(item.poster)}" alt="" loading="lazy"
                    onerror="this.outerHTML='<div class=&quot;similar-poster&quot;>${CAT_EMOJI[item.category] || '🎬'}</div>'">`
            : `<div class="similar-poster">${CAT_EMOJI[item.category] || '🎬'}</div>`;

        card.innerHTML = `
            ${poster}
            <div class="similar-body">
                <div class="similar-title" title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</div>
                <div class="similar-meta">${escapeHTML(CAT_LABELS[item.category] || '')}${item.year ? ' · ' + escapeHTML(String(item.year)) : ''}</div>
                <button class="similar-add" ${owned ? 'disabled' : ''}>${owned ? '✓ In Vault' : '+ Add'}</button>
            </div>`;

        if (!owned) {
            const btn = card.querySelector('.similar-add');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (document.body.classList.contains('read-only')) return;
                // Pick the watch status instead of always defaulting to Plan to Watch.
                showStatusMenu(btn, async (status) => {
                    btn.disabled = true;
                    btn.textContent = 'Adding…';
                    const ok = await onAdd?.(item, status);
                    btn.textContent = ok ? '✓ In Vault' : '+ Add';
                    btn.disabled = Boolean(ok);
                });
            });
        }
        list.appendChild(card);
    });
}

export function hideSimilar() {
    const section = document.getElementById('similar-section');
    if (section) section.style.display = 'none';
}

// Sets every season to complete — used when the item itself is marked completed.
export function markAllSeasonsComplete() {
    document.querySelectorAll('#seasons-grid .season-row').forEach(markRowComplete);
}

function updateSeasonStatus(row, { silent = false } = {}) {
    const [watchedInp, totalInp] = row.querySelectorAll('.ep-input');
    const statusEl = row.querySelector('.season-status');
    const { cls, label } = seasonStateOf({
        watched: watchedInp.value,
        total: totalInp.value,
        completed: row.dataset.completed === 'true'
    });
    statusEl.className = `season-status ${cls}`;
    statusEl.textContent = label;

    // Callers doing a bulk update recompute the item status once at the end.
    if (!silent) updateOverallStatusFromSeasons();
}

function updateOverallStatusFromSeasons() {
    const rows = Array.from(document.querySelectorAll('#seasons-grid .season-row'));
    if (rows.length === 0) return;

    let anyProgress = false;
    let allCompleted = true;

    rows.forEach(row => {
        const watched = parseInt(row.querySelectorAll('.ep-input')[0].value) || 0;
        const complete = rowIsComplete(row);
        if (!complete) allCompleted = false;
        if (complete || watched > 0) anyProgress = true;
    });

    const ssEl = document.getElementById('status-selector');
    if (!ssEl) return;
    const opts = ssEl.querySelectorAll('.status-opt');
    const current = ssEl.querySelector('.status-opt.active')?.dataset.status;
    let targetStatus = null;

    if (allCompleted) {
        // Every season finished always means the item is finished.
        targetStatus = 'completed';
    } else if (anyProgress) {
        // Partway through — but don't stomp a deliberate On Hold / Dropped.
        targetStatus = (current === 'on-hold' || current === 'dropped') ? current : 'watching';
    } else if (current === 'completed' || current === 'watching') {
        // Progress was cleared, so "completed"/"watching" no longer holds.
        targetStatus = 'plan-to-watch';
    }

    if (targetStatus) {
        opts.forEach(o => o.classList.remove('active'));
        const targetOpt = Array.from(opts).find(o => o.dataset.status === targetStatus);
        if (targetOpt) {
            targetOpt.classList.add('active');
            const rewatchWrap = document.getElementById('rewatch-container');
            if (rewatchWrap) {
                rewatchWrap.style.display = targetStatus === 'completed' ? 'flex' : 'none';
            }
        }
    }
}

export function collectDetailData() {
    const tags = normalizeTags(document.getElementById('detail-tags').value);
    const rewatchText = document.getElementById('rewatch-count').textContent;

    return {
        id: editingId,
        category: document.getElementById('detail-category').value || 'movie',
        status: document.querySelector('#status-selector .status-opt.active')?.dataset.status || 'plan-to-watch',
        notes: document.getElementById('detail-notes').value,
        tags: tags,
        rating: parseInt(document.getElementById('detail-rating').dataset.value) || 0,
        rewatchCount: parseInt(rewatchText) || 0,
        seasons: collectSeasonRows()
    };
}

export function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

export function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

export function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function renderConfirmModal(title, text, confirmText, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
        <div class="modal-card narrow">
            <div class="modal-header">
                <div class="modal-title">${escapeHTML(title)}</div>
            </div>
            <div class="modal-body">
                <p style="font-size: 14px; color: var(--text-dim); line-height: 1.6;">${escapeHTML(text)}</p>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary confirm-cancel">Cancel</button>
                <button class="btn btn-primary confirm-action" style="background:var(--danger); box-shadow: 0 4px 20px rgba(255,71,87,0.35);">${escapeHTML(confirmText)}</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Animate in
    setTimeout(() => modal.classList.remove('hidden'), 10);
    
    const close = () => {
        modal.classList.add('hidden');
        setTimeout(() => modal.remove(), 250);
    };
    
    modal.querySelector('.confirm-cancel').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    // Own the keyboard while open: Esc dismisses, Enter activates the focused button.
    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
    // Focus Cancel, not the destructive action, so a stray Enter is harmless.
    setTimeout(() => modal.querySelector('.confirm-cancel')?.focus(), 20);
    modal.querySelector('.confirm-action').addEventListener('click', () => {
        onConfirm();
        close();
    });
}
