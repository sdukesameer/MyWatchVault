// js/app.js
// Main Application Orchestrator

import * as lib from './library.js';
import * as ui from './ui.js';
import { runSync, renderSyncScreen } from './sync.js';
import { fetchRecommendations, renderRecommendations } from './recommendations.js';
import { callAI, extractJSON, getLastProvider } from './api.js';
import { escapeHTML } from './ui.js';

const state = {
    library: [],
    syncResults: {},
    config: {},
    currentCat: 'all',
    sortBy: 'recently-added',
    filterStatus: 'all',
    searchCache: new Map()
};

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
    };
}

// ── Render Cycle ────────────────────────────────────────────────
function render() {
    const stats = lib.getStats(state.library, state.syncResults);
    ui.renderStats(stats);
    
    const filtered = lib.getFilteredLibrary(state.library, state.currentCat, state.filterStatus, state.sortBy);
    ui.renderGrid(filtered, state.syncResults, state.currentCat, (id) => {
        const media = state.library.find(m => m.id === id);
        if (media) ui.openDetailModal(media);
    });
}

// ── Search & Unsplash (Posters) ─────────────────────────────────
let _searchTimer = null;
async function searchTitles(query) {
    const dropdown = document.getElementById('search-dropdown');
    if (query.length < 2) { dropdown.style.display = 'none'; return; }

    dropdown.style.display = 'block';
    
    // Skeleton loader
    dropdown.innerHTML = `
        <div class="search-item skeleton" style="height: 80px;"></div>
        <div class="search-item skeleton" style="height: 80px;"></div>
        <div class="search-item skeleton" style="height: 80px;"></div>
    `;

    let results = [];
    if (state.searchCache.has(query.toLowerCase())) {
        results = state.searchCache.get(query.toLowerCase());
    } else {
        try {
            const prompt = `Search for entertainment titles matching: "${query}"
Return a JSON array of up to 6 results. Each: { "title": "...", "year": 2024, "category": "anime-series|anime-movie|series|movie", "genre": "Action, Drama", "description": "1-2 sentence description" }
ONLY valid JSON array, no markdown.`;

            const text = await callAI(prompt, state.config);
            results = extractJSON(text);
            state.searchCache.set(query.toLowerCase(), results);
        } catch (err) {
            dropdown.innerHTML = `<div class="search-no-results">${err.message}</div>`;
            return;
        }
    }

    if (!results.length) {
        dropdown.innerHTML = `<div class="search-no-results">No results. Try "+ Add Manually"</div>`;
        return;
    }

    dropdown.innerHTML = '';
        results.forEach(item => {
            const inLib = state.library.some(m => m.title.toLowerCase() === item.title.toLowerCase());
            const div = document.createElement('div');
            div.className = 'search-item';
            div.tabIndex = 0;
            div.innerHTML = `
                <div class="card-poster-placeholder" style="width:40px;height:56px;font-size:24px;border-radius:6px;background:var(--surface);border:1px solid var(--border);">${ui.CAT_EMOJI[item.category] || '🎬'}</div>
                <div class="search-item-info">
                    <div class="search-item-title">${escapeHTML(item.title)}</div>
                    <div class="search-item-meta">${ui.CAT_LABELS[item.category] || ''} · ${escapeHTML(item.year || '?')} · ${escapeHTML(item.genre || '')}</div>
                </div>
                ${inLib
                    ? `<span style="font-size:11px;color:var(--success);font-weight:600;">✓ In Vault</span>`
                    : `<button class="search-item-add" tabindex="-1" data-title='${JSON.stringify(item).replace(/'/g, "&apos;")}'>+ Add</button>`}`;

            if (!inLib) {
                const addHandler = async (e) => {
                    e.stopPropagation();
                    const btn = div.querySelector('.search-item-add');
                    if (btn) {
                        btn.textContent = 'Adding...';
                        btn.disabled = true;
                    }
                    ui.showLoading(`Adding ${item.title}...`, 'Fetching posters');
                    
                    try {
                        let posterUrl = null;
                        if (item.category.includes('anime')) {
                            const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(item.title)}&limit=1`);
                            const json = await res.json();
                            posterUrl = json.data?.[0]?.images?.jpg?.large_image_url || json.data?.[0]?.images?.jpg?.image_url;
                        } 
                        if (!posterUrl && (item.category === 'series' || item.category.includes('anime'))) {
                            const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(item.title)}`);
                            const json = await res.json();
                            posterUrl = json[0]?.show?.image?.original || json[0]?.show?.image?.medium;
                        }
                        if (!posterUrl && state.config.unsplashKey) {
                             const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(item.title + ' movie poster')}&per_page=1&orientation=portrait&client_id=${state.config.unsplashKey}`);
                             const photoData = await res.json();
                             posterUrl = photoData.results?.[0]?.urls?.small;
                        }
                        if (posterUrl) item.poster = posterUrl;
                    } catch(err) {
                        console.warn('Poster fetch failed', err);
                    }
                    
                    const media = lib.addMedia(state.library, item);
                    ui.hideLoading();
                    ui.showToast(`"${media.title}" added to vault ✓`, 'success');
                    dropdown.style.display = 'none';
                    document.getElementById('search-input').value = '';
                    render();
                    ui.openDetailModal(media);
                };
                
                div.addEventListener('click', addHandler);
                div.addEventListener('keydown', (e) => { if (e.key === 'Enter') addHandler(e); });
            }
            dropdown.appendChild(div);
        });
}

// ── Sync Handler ────────────────────────────────────────────────
async function handleRunSync() {
    try {
        ui.showLoading('Running sync…', 'Checking latest status of your tracked titles');
        const res = await runSync(state.library, state.config);
        
        state.library = res.updatedLibrary;
        state.syncResults = res.syncResults;
        const syncMeta = { lastSync: new Date().toISOString() };
        
        lib.saveLibrary(state.library);
        lib.saveSyncResults(state.syncResults);
        lib.saveSyncMeta(syncMeta);
        
        ui.hideLoading();
        ui.showToast(`Sync complete! (via ${getLastProvider()})`, 'success');
        
        renderSyncScreen(state.library, state.syncResults);
        render();
    } catch (err) {
        ui.hideLoading();
        ui.showToast('Sync failed: ' + err.message, 'error');
    }
}

// ── Reco Handler ────────────────────────────────────────────────
async function handleFetchRecos() {
    try {
        ui.showLoading('Finding recommendations…', 'AI is analysing your taste profile');
        const recos = await fetchRecommendations(state.library, state.config);
        ui.hideLoading();
        ui.showToast(`Found recos! (via ${getLastProvider()})`, 'success');
        
        renderRecommendations(recos, state.library, (item) => {
            lib.addMedia(state.library, item);
            render();
            ui.showToast(`"${item.title}" added!`, 'success');
        });
    } catch (err) {
        ui.hideLoading();
        ui.showToast('Recommendations failed: ' + err.message, 'error');
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
    document.getElementById('sync-nav-btn2')?.addEventListener('click', () => { 
        ui.showScreen('screen-sync'); 
        renderSyncScreen(state.library, state.syncResults); 
    });
    document.getElementById('reco-nav-btn').addEventListener('click', () => { 
        ui.showScreen('screen-reco'); 
        handleFetchRecos(); 
    });
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

    // Search
    const searchInput = document.getElementById('search-input');
    const dropdown = document.getElementById('search-dropdown');
    searchInput.addEventListener('input', () => {
        clearTimeout(_searchTimer);
        const q = searchInput.value.trim();
        if (q.length < 2) { dropdown.style.display = 'none'; return; }
        _searchTimer = setTimeout(() => searchTitles(q), 500);
    });
    searchInput.addEventListener('blur', () => setTimeout(() => { dropdown.style.display = 'none'; }, 200));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { dropdown.style.display = 'none'; document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden')); } });

    // Manual Add Modal
    document.getElementById('manual-add-btn').addEventListener('click', () => ui.openModal('add-modal'));
    document.getElementById('add-modal-close').addEventListener('click', () => ui.closeModal('add-modal'));
    document.getElementById('add-cancel-btn').addEventListener('click', () => ui.closeModal('add-modal'));
    document.getElementById('add-modal').addEventListener('click', e => { if (e.target === e.currentTarget) ui.closeModal('add-modal'); });

    document.getElementById('add-confirm-btn').addEventListener('click', () => {
        const title = document.getElementById('add-title').value.trim();
        const category = document.getElementById('add-category').value;
        if (!title || !category) { ui.showToast('Fill in title and category', 'error'); return; }
        
        const isDuplicate = state.library.some(m => m.title.toLowerCase() === title.toLowerCase() && m.category === category);
        if (isDuplicate) {
            ui.showToast(`"${title}" is already in your vault!`, 'error');
            return;
        }

        const media = lib.addMedia(state.library, {
            title, category,
            year: parseInt(document.getElementById('add-year').value) || null,
            genre: document.getElementById('add-genre').value.trim(),
            status: document.getElementById('add-status').value
        });
        
        ui.closeModal('add-modal');
        render();
        ui.showToast(`"${title}" added ✓`, 'success');
        ['add-title','add-year','add-genre'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('add-category').value = '';
        document.getElementById('add-status').value = 'plan-to-watch';
        
        setTimeout(() => ui.openDetailModal(media), 300);
    });

    // Detail Modal
    const checkDetailUnsaved = () => {
        const currentData = ui.collectDetailData();
        const media = state.library.find(m => m.id === currentData.id);
        if (!media) return false;
        const seasonsMatch = JSON.stringify(currentData.seasons || []) === JSON.stringify(media.seasons || []);
        return currentData.status !== media.status || 
               currentData.rating !== (media.rating || 0) || 
               currentData.notes !== (media.notes || '') || 
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

    document.getElementById('detail-close').addEventListener('click', handleDetailClose);
    document.getElementById('detail-cancel-btn').addEventListener('click', handleDetailClose);
    document.getElementById('detail-modal').addEventListener('click', e => { if (e.target === e.currentTarget) handleDetailClose(); });

    document.getElementById('add-season-btn').addEventListener('click', () => {
        const grid = document.getElementById('seasons-grid');
        const existing = grid.querySelectorAll('.season-row').length;
        const seasons = ui.collectDetailData().seasons;
        seasons.push({ number: existing + 1, watched: 0, total: 0 });
        ui.renderSeasons(seasons);
    });

    document.getElementById('detail-save-btn').addEventListener('click', () => {
        const data = ui.collectDetailData();
        if (lib.updateMedia(state.library, data.id, data)) {
            ui.closeModal('detail-modal');
            render();
            ui.showToast('Saved ✓', 'success');
        }
    });

    document.getElementById('detail-delete-btn').addEventListener('click', () => {
        const data = ui.collectDetailData();
        const media = state.library.find(m => m.id === data.id);
        
        ui.renderConfirmModal(
            'Remove Title', 
            `Are you sure you want to remove "${media?.title}" from your vault?`, 
            'Remove',
            () => {
                lib.removeMedia(state.library, state.syncResults, data.id);
                ui.closeModal('detail-modal');
                render();
                ui.showToast('Removed from vault', 'info');
            }
        );
    });

    // Settings Modal
    document.getElementById('settings-close').addEventListener('click', () => ui.closeModal('settings-modal'));
    document.getElementById('settings-cancel').addEventListener('click', () => ui.closeModal('settings-modal'));
    document.getElementById('settings-modal').addEventListener('click', e => { if (e.target === e.currentTarget) ui.closeModal('settings-modal'); });

    document.getElementById('export-btn').addEventListener('click', () => {
        lib.exportLibrary(state.library, state.syncResults);
        ui.showToast('Export triggered', 'success');
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
                ui.showToast(`Imported ${res.count} titles!`, 'success');
                ui.closeModal('settings-modal');
            } else {
                ui.showToast(`Import failed: ${res.error}`, 'error');
            }
            document.getElementById('import-file-input').value = '';
        };
        reader.readAsText(file);
    });

    document.getElementById('clear-all-btn').addEventListener('click', () => {
        ui.renderConfirmModal(
            'Clear ALL Data',
            'This will permanently delete your entire watch history. This cannot be undone.',
            'Clear Everything',
            () => {
                const res = lib.clearAllData();
                state.library = res.library;
                state.syncResults = res.syncResults;
                ui.closeModal('settings-modal');
                render();
                ui.showToast('All data cleared', 'info');
            }
        );
    });

    // Sync screen actions
    document.body.addEventListener('click', e => {
        if (e.target.id === 'run-sync-btn' || e.target.id === 'run-sync-btn-empty') {
            handleRunSync();
        }
    });

    // Reco actions
    document.getElementById('refresh-reco-btn').addEventListener('click', handleFetchRecos);
}

// ── Initialization ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await loadEnvKeys();
    loadConfig();
    
    state.library = lib.loadLibrary();
    state.syncResults = lib.loadSyncResults();
    
    if (!state.library.length) {
        state.library = lib.seedDemoData(state.library);
    }
    
    bindEvents();
    render();
});
