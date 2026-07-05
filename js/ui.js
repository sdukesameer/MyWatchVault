// js/ui.js
// DOM Rendering functions

import { CAT_LABELS, CAT_EMOJI, STATUS_LABELS, STATUS_DOT_CLASS } from './constants.js';
import { escapeHTML } from './utils.js';

let editingId = null;

export function renderStats(stats) {
    const elHours = document.getElementById('stat-hours');
    const elEp = document.getElementById('stat-episodes');
    const elRating = document.getElementById('stat-avg-rating');
    const elGenre = document.getElementById('stat-fav-genre');
    
    if (elHours) elHours.textContent = stats.hoursWatched || 0;
    if (elEp) elEp.textContent = stats.totalEpisodes || 0;
    if (elRating) elRating.textContent = `${stats.avgRating || '0.0'}★`;
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
                ? `<img src="${escapeHTML(continueItem.poster)}" alt="Poster" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:0.4;">`
                : `<div style="position:absolute;top:0;left:0;width:100%;height:100%;background:var(--bg-card);z-index:0;display:flex;align-items:center;justify-content:center;font-size:100px;opacity:0.1">${CAT_EMOJI[continueItem.category] || '🎬'}</div>`;

            continueWrap.innerHTML = `
                <div style="position:relative;width:100%;height:100%;min-height:220px;background:#000;display:flex;flex-direction:column;justify-content:flex-end;padding:24px;box-sizing:border-box;">
                    ${posterHTML}
                    <div style="position:absolute;bottom:0;left:0;right:0;height:100%;background:linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.4) 50%, transparent 100%);z-index:1;pointer-events:none;"></div>
                    
                    <div style="position:relative;z-index:2;display:flex;justify-content:space-between;align-items:flex-end;gap:15px;">
                        <div style="flex:1;">
                            <p style="margin:0 0 6px 0;font-size:11px;color:var(--accent);text-transform:uppercase;font-weight:700;letter-spacing:1px;">Continue Watching</p>
                            <h3 style="margin:0 0 8px 0;font-size:24px;line-height:1.2;color:#fff;text-shadow:0 2px 4px rgba(0,0,0,0.8);">${escapeHTML(continueItem.title)}</h3>
                            <div style="display:flex;align-items:center;gap:10px;">
                                <p style="margin:0;font-size:13px;color:#ddd;font-weight:500;">${progressText}</p>
                                <div style="flex:1;height:4px;background:rgba(255,255,255,0.2);border-radius:2px;overflow:hidden;max-width:120px;">
                                    <div style="height:100%;width:${progressPercent}%;background:var(--accent);border-radius:2px;"></div>
                                </div>
                            </div>
                        </div>
                        <button class="btn btn-primary" id="dash-continue-btn" style="flex-shrink:0;padding:8px 20px;font-size:14px;box-shadow:0 4px 12px rgba(255,255,255,0.15);">Play →</button>
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

export function renderGrid(filteredLib, syncResults, currentCat, onCardClick) {
    const grid = document.getElementById('media-grid');

    if (!filteredLib.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
            <div class="icon">${currentCat === 'all' ? '🎬' : CAT_EMOJI[currentCat]}</div>
            <h3>Nothing here yet</h3>
            <p>Search for a title above or click "+ Add Manually" to start building your vault.</p>
        </div>`;
        return;
    }

    grid.innerHTML = '';
    filteredLib.forEach(media => {
        const card = document.createElement('div');
        card.className = 'media-card';
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
                <div class="card-badge ${media.category?.split('-')[0]}">${CAT_LABELS[media.category] || 'Unknown'}</div>
                <div class="card-status-dot ${statusDotClass}" title="${STATUS_LABELS[media.status] || ''}"></div>
                ${newBadge}
            </div>
            <div class="card-body">
                <div class="card-title" title="${escapedTitle}">${escapedTitle}</div>
                <div class="card-meta">
                    ${media.year ? `<span>${escapeHTML(media.year.toString())}</span>` : ''}
                    ${media.genre ? `<span>${escapeHTML(media.genre.split(',')[0])}</span>` : ''}
                    ${media.globalRating ? `<span title="Global Rating">🌐 ${escapeHTML(media.globalRating)}</span>` : ''}
                </div>
                ${progressHTML}
                ${tagsHTML}
            </div>`;

        card.addEventListener('click', () => onCardClick(media.id));
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter') onCardClick(media.id); });
        grid.appendChild(card);
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
        currentRewatch++;
        document.getElementById('rewatch-count').textContent = currentRewatch;
    });

    ssEl.querySelectorAll('.status-opt').forEach(el => {
        el.addEventListener('click', () => {
            ssEl.querySelectorAll('.status-opt').forEach(o => o.classList.remove('active'));
            el.classList.add('active');
            updateRewatchUI(el.dataset.status);
            
            if (el.dataset.status === 'completed') {
                document.querySelectorAll('#seasons-grid .season-row').forEach(row => {
                    const [watchedInp, totalInp] = row.querySelectorAll('.ep-input');
                    if (totalInp.value && parseInt(totalInp.value) > 0) {
                        watchedInp.value = totalInp.value;
                    }
                    updateSeasonStatus(row);
                });
            }
        });
    });

    document.getElementById('detail-global-rating').textContent = media.globalRating || '—';
    
    document.getElementById('detail-tags').value = (media.tags || []).join(', ');
    document.getElementById('detail-notes').value = media.notes || '';

    const trackerSection = document.getElementById('tracker-section');
    if (media.category === 'series' || media.category === 'anime-series') {
        trackerSection.style.display = 'block';
        renderSeasons(media.seasons || []);
    } else {
        trackerSection.style.display = 'none';
    }

    openModal('detail-modal');
}

export function renderSeasons(seasons) {
    const grid = document.getElementById('seasons-grid');
    grid.innerHTML = '';
    seasons.forEach((s, idx) => {
        const watched = parseInt(s.watched) || 0;
        const total = parseInt(s.total) || 0;
        let statusClass = 'not-started', statusLabel = 'Not started';
        if (watched > 0 && total > 0 && watched >= total) { statusClass = 'done'; statusLabel = 'Complete'; }
        else if (watched > 0) { statusClass = 'progress'; statusLabel = 'In progress'; }

        const row = document.createElement('div');
        row.className = 'season-row';
        row.dataset.idx = idx;
        row.innerHTML = `
            <div class="season-label">Season ${s.number || idx + 1}</div>
            <div class="season-ep-track">
                <input class="ep-input" type="number" min="0" value="${watched}" placeholder="0" title="Watched episodes">
                <span class="ep-sep">/ </span>
                <input class="ep-input" type="number" min="0" value="${total || ''}" placeholder="?" title="Total episodes">
                <span style="font-size:11px;color:var(--text-muted);">ep</span>
            </div>
            <span class="season-status ${statusClass}">${statusLabel}</span>
            <button class="season-delete" title="Remove season">✕</button>`;

        row.querySelectorAll('.ep-input').forEach(inp => {
            inp.addEventListener('input', () => updateSeasonStatus(row));
        });
        
        const statusSpan = row.querySelector('.season-status');
        statusSpan.style.cursor = 'pointer';
        statusSpan.title = 'Click to toggle completion';
        statusSpan.addEventListener('click', () => {
            const [watchedInp, totalInp] = row.querySelectorAll('.ep-input');
            const w = parseInt(watchedInp.value) || 0;
            const t = parseInt(totalInp.value) || 0;
            if (w === t && t > 0) {
                watchedInp.value = 0; // reset
            } else if (t > 0) {
                watchedInp.value = t; // complete
            } else {
                watchedInp.value = w + 1; // increment if total unknown
            }
            updateSeasonStatus(row);
        });
        
        row.querySelector('.season-delete').addEventListener('click', () => {
            row.remove();
        });

        grid.appendChild(row);
    });
}

function updateSeasonStatus(row) {
    const [watchedInp, totalInp] = row.querySelectorAll('.ep-input');
    const watched = parseInt(watchedInp.value) || 0;
    const total = parseInt(totalInp.value) || 0;
    const statusEl = row.querySelector('.season-status');
    if (watched > 0 && total > 0 && watched >= total) {
        statusEl.className = 'season-status done'; statusEl.textContent = 'Complete';
    } else if (watched > 0) {
        statusEl.className = 'season-status progress'; statusEl.textContent = 'In progress';
    } else {
        statusEl.className = 'season-status not-started'; statusEl.textContent = 'Not started';
    }
    
    updateOverallStatusFromSeasons();
}

function updateOverallStatusFromSeasons() {
    const rows = document.querySelectorAll('#seasons-grid .season-row');
    if (rows.length === 0) return;
    
    let anyWatching = false;
    let allCompleted = true;
    
    rows.forEach(row => {
        const [watchedInp, totalInp] = row.querySelectorAll('.ep-input');
        const w = parseInt(watchedInp.value) || 0;
        const t = parseInt(totalInp.value) || 0;
        
        if (w > 0) anyWatching = true;
        if (w === 0 || t === 0 || w < t) allCompleted = false;
    });
    
    const ssEl = document.getElementById('status-selector');
    if (!ssEl) return;
    const opts = ssEl.querySelectorAll('.status-opt');
    let targetStatus = null;
    
    if (allCompleted && rows.length > 0) {
        targetStatus = 'completed';
    } else if (anyWatching) {
        targetStatus = 'watching';
    } else {
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
    const rawTags = document.getElementById('detail-tags').value;
    const tags = rawTags.split(',').map(t => t.trim().toLowerCase().replace(/[^a-z0-9\-]/g, '')).filter(t => t.length > 0);
    const rewatchText = document.getElementById('rewatch-count').textContent;

    return {
        id: editingId,
        status: document.querySelector('#status-selector .status-opt.active')?.dataset.status || 'plan-to-watch',
        notes: document.getElementById('detail-notes').value,
        tags: tags,
        rewatchCount: parseInt(rewatchText) || 0,
        seasons: Array.from(document.querySelectorAll('#seasons-grid .season-row')).map((row, idx) => {
            const [watchedInp, totalInp] = row.querySelectorAll('.ep-input');
            return {
                number: idx + 1,
                watched: parseInt(watchedInp.value) || 0,
                total: parseInt(totalInp.value) || 0
            };
        })
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
    modal.querySelector('.confirm-action').addEventListener('click', () => {
        onConfirm();
        close();
    });
}
