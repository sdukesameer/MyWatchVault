// js/ui.js
// DOM Rendering functions

export const CAT_LABELS = {
    'anime-series': 'Anime', 'anime-movie': 'Anime Film',
    'series': 'Series', 'movie': 'Movie'
};

export const CAT_EMOJI = {
    'anime-series': '⛩️', 'anime-movie': '🎌',
    'series': '📺', 'movie': '🎬'
};

export const STATUS_LABELS = {
    'watching': '▶ Watching', 'completed': '✓ Completed',
    'plan-to-watch': '⊕ Plan to Watch', 'on-hold': '⏸ On Hold', 'dropped': '✗ Dropped'
};

const STATUS_DOT_CLASS = {
    'watching': 'watching', 'completed': 'completed',
    'plan-to-watch': 'not-started', 'on-hold': 'on-hold', 'dropped': 'on-hold'
};

let editingId = null;

export function renderStats(stats) {
    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-watching').textContent = stats.watching;
    document.getElementById('stat-completed').textContent = stats.completed;
    document.getElementById('stat-new').textContent = stats.newCount;

    document.getElementById('count-all').textContent = stats.total;
    ['anime-series', 'anime-movie', 'series', 'movie'].forEach(c => {
        const el = document.getElementById(`count-${c}`);
        if (el) el.textContent = stats.catCounts[c] || 0;
    });

    const banner = document.getElementById('new-content-banner');
    if (stats.newCount > 0) {
        document.getElementById('new-banner-count').textContent = stats.newCount;
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
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

        const syncData = syncResults[media.id];
        const hasNew = media.hasNew && syncData;

        const posterHTML = media.poster
            ? `<img src="${media.poster}" alt="${media.title}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
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

        card.innerHTML = `
            <div class="card-poster">
                ${posterHTML}
                <div class="card-poster-placeholder" ${placeholderStyle}>
                    <span>${CAT_EMOJI[media.category] || '🎬'}</span>
                    <span>${media.title.slice(0, 18)}</span>
                </div>
                <div class="card-badge ${media.category?.split('-')[0]}">${CAT_LABELS[media.category] || 'Unknown'}</div>
                <div class="card-status-dot ${statusDotClass}" title="${STATUS_LABELS[media.status] || ''}"></div>
                ${newBadge}
            </div>
            <div class="card-body">
                <div class="card-title" title="${media.title}">${media.title}</div>
                <div class="card-meta">
                    ${media.year ? `<span>${media.year}</span>` : ''}
                    ${media.genre ? `<span>${media.genre.split(',')[0]}</span>` : ''}
                    ${media.rating ? `<span>⭐ ${media.rating}/5</span>` : ''}
                </div>
                ${progressHTML}
            </div>`;

        card.addEventListener('click', () => onCardClick(media.id));
        grid.appendChild(card);
    });
}

export function openDetailModal(media) {
    editingId = media.id;

    document.getElementById('detail-title').textContent = media.title;
    document.getElementById('detail-subtitle').textContent = `${CAT_LABELS[media.category] || ''} · ${media.year || 'Year unknown'}`;

    const posterWrap = document.getElementById('detail-poster-wrap');
    if (media.poster) {
        posterWrap.innerHTML = `<img class="detail-poster" src="${media.poster}" alt="${media.title}" onerror="this.outerHTML='<div class=detail-poster-placeholder>${CAT_EMOJI[media.category]}</div>'">`;
    } else {
        posterWrap.innerHTML = `<div class="detail-poster-placeholder">${CAT_EMOJI[media.category] || '🎬'}</div>`;
    }

    const metaEl = document.getElementById('detail-meta');
    const pills = [];
    if (media.year) pills.push({ text: media.year });
    if (media.genre) pills.push({ text: media.genre });
    if (media.seasons?.length) pills.push({ text: `${media.seasons.length} Season${media.seasons.length !== 1 ? 's' : ''}`, highlight: true });
    metaEl.innerHTML = pills.map(p => `<span class="meta-pill${p.highlight ? ' highlight' : ''}">${p.text}</span>`).join('');

    document.getElementById('detail-desc').textContent = media.description || '';

    const statuses = ['watching', 'completed', 'plan-to-watch', 'on-hold', 'dropped'];
    const ssEl = document.getElementById('status-selector');
    ssEl.innerHTML = statuses.map(s => `
        <span class="status-opt ${s} ${media.status === s ? 'active' : ''}" data-status="${s}">
            ${STATUS_LABELS[s]}
        </span>`).join('');
        
    ssEl.querySelectorAll('.status-opt').forEach(el => {
        el.addEventListener('click', () => {
            ssEl.querySelectorAll('.status-opt').forEach(o => o.classList.remove('active'));
            el.classList.add('active');
        });
    });

    const ratingEl = document.getElementById('rating-stars');
    ratingEl.innerHTML = [1, 2, 3, 4, 5].map(n =>
        `<span class="star ${(media.rating || 0) >= n ? 'filled' : 'empty'}" data-val="${n}">★</span>`
    ).join('');
    
    ratingEl.querySelectorAll('.star').forEach(star => {
        star.addEventListener('click', () => {
            const val = parseInt(star.dataset.val);
            ratingEl.querySelectorAll('.star').forEach((s, i) => {
                s.className = `star ${i < val ? 'filled' : 'empty'}`;
            });
        });
    });

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
}

export function collectDetailData() {
    return {
        id: editingId,
        status: document.querySelector('#status-selector .status-opt.active')?.dataset.status || 'plan-to-watch',
        rating: document.querySelectorAll('#rating-stars .star.filled').length,
        notes: document.getElementById('detail-notes').value,
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

export function showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3200);
}

export function showLoading(text = 'Working on it…', sub = '') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-sub').textContent = sub;
    document.getElementById('loading-overlay').classList.remove('hidden');
}

export function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
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
                <div class="modal-title">${title}</div>
            </div>
            <div class="modal-body">
                <p style="font-size: 14px; color: var(--text-dim); line-height: 1.6;">${text}</p>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary confirm-cancel">Cancel</button>
                <button class="btn btn-primary confirm-action" style="background:var(--danger); box-shadow: 0 4px 20px rgba(255,71,87,0.35);">${confirmText}</button>
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
