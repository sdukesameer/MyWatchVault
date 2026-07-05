// js/sync.js
// AI Sync Engine

import { callTMDB, getLastProvider, callAI, extractJSON } from './api.js';
import { CAT_LABELS, CAT_EMOJI, STATUS_LABELS } from './constants.js';
import { escapeHTML, showToast } from './utils.js';
import { loadSyncMeta, normalizeTitle } from './library.js';

export async function runSync(library, config, onProgress) {
    if (!library.length) throw new Error('Add some titles first!');
    
    const newSyncResults = {};
    const updatedLibrary = [...library];
    
    const promises = updatedLibrary.map(async (media) => {
        let result = null;
        try {
            if (media.category === 'movie' || media.category === 'anime-movie') {
                result = { latestStatus: 'Released', isOngoing: false, upToDate: true };
            } else if (media.jikanId) {
                const res = await fetch(`https://api.jikan.moe/v4/anime/${media.jikanId}`).then(r=>r.json());
                if (res.data) {
                    result = {
                        latestStatus: res.data.status,
                        latestEpisodes: res.data.episodes || 0,
                        latestSeason: 1,
                        isOngoing: res.data.status === 'Currently Airing',
                        upToDate: false
                    };
                    if (media.seasons.length > 0 && result.latestEpisodes) {
                        media.seasons[0].total = result.latestEpisodes;
                    }
                    const totalWatched = media.seasons.reduce((acc, s) => acc + s.watched, 0);
                    if (result.latestEpisodes && totalWatched >= result.latestEpisodes) result.upToDate = true;
                    if (res.data.status === 'Finished Airing' && totalWatched >= result.latestEpisodes) result.upToDate = true;
                }
            } else if (media.tvmazeId) {
                const [showRes, seasonsRes] = await Promise.all([
                    fetch(`https://api.tvmaze.com/shows/${media.tvmazeId}`).then(r=>r.json()),
                    fetch(`https://api.tvmaze.com/shows/${media.tvmazeId}/seasons`).then(r=>r.json()).catch(()=>[])
                ]);
                
                if (showRes && showRes.status) {
                    result = {
                        latestStatus: showRes.status,
                        isOngoing: showRes.status !== 'Ended',
                        upToDate: false
                    };
                    
                    if (Array.isArray(seasonsRes) && seasonsRes.length > 0) {
                        const validSeasons = seasonsRes.filter(s => s.number > 0);
                        result.latestSeason = validSeasons.length;
                        
                        let totalAvailableEpisodes = 0;
                        validSeasons.forEach(s => {
                            if (s.episodeOrder) totalAvailableEpisodes += s.episodeOrder;
                            let ms = media.seasons.find(ms => ms.number === s.number);
                            if (ms) {
                                ms.total = s.episodeOrder || ms.total;
                            } else {
                                media.seasons.push({ number: s.number, watched: 0, total: s.episodeOrder || 0 });
                            }
                        });
                        
                        const totalWatched = media.seasons.reduce((acc, s) => acc + s.watched, 0);
                        if (totalAvailableEpisodes > 0 && totalWatched >= totalAvailableEpisodes) {
                            result.upToDate = true;
                        }
                        if (showRes.status === 'Ended' && totalWatched >= totalAvailableEpisodes) {
                            result.upToDate = true;
                        }
                    }
                }
            } else if (media.tmdbId) {
                if (media.category === 'movie') {
                    const res = await (await fetch(`https://api.themoviedb.org/3/movie/${media.tmdbId}?api_key=${config.tmdbKey || ''}`)).json().catch(()=>({}));
                    if (res.status) {
                        result = {
                            latestStatus: res.status,
                            isOngoing: res.status !== 'Released',
                            upToDate: true
                        };
                    }
                } else if (media.category === 'series' || media.category === 'anime-series') {
                    const res = await (await fetch(`https://api.themoviedb.org/3/tv/${media.tmdbId}?api_key=${config.tmdbKey || ''}`)).json().catch(()=>({}));
                    if (res.status) {
                        result = {
                            latestStatus: res.status,
                            latestSeason: res.number_of_seasons,
                            latestEpisodes: res.number_of_episodes,
                            isOngoing: res.status === 'Returning Series',
                            upToDate: false
                        };
                        
                        if (res.number_of_seasons > media.seasons.length) {
                            while(media.seasons.length < res.number_of_seasons) {
                                media.seasons.push({ number: media.seasons.length + 1, watched: 0, total: 0 });
                            }
                        }
                        
                        const totalWatched = media.seasons.reduce((acc, s) => acc + s.watched, 0);
                        if (res.number_of_episodes && totalWatched >= res.number_of_episodes) {
                            result.upToDate = true;
                        }
                    }
                }
            }
            
            if (result) {
                result.hasNewContent = !result.upToDate;
                newSyncResults[media.id] = result;
                media.hasNew = result.hasNewContent;
                
                if (media.category.includes('series')) {
                    if (result.latestSeason && typeof result.latestSeason === 'number') {
                        while (media.seasons.length < result.latestSeason) {
                            media.seasons.push({ number: media.seasons.length + 1, watched: 0, total: 0 });
                        }
                    }
                }
            }
        } catch (e) {
            console.warn(`Sync failed for ${media.title}:`, e);
        }
        if (onProgress) onProgress();
    });

    await Promise.allSettled(promises);
    return { updatedLibrary, syncResults: newSyncResults };
}

export function renderSyncScreen(library, syncResults) {
    const list = document.getElementById('sync-list');

    if (!library.length) {
        list.innerHTML = `<div class="empty-state"><div class="icon">⚡</div><h3>Nothing to sync</h3><p>Add titles to your vault first, then run a sync.</p></div>`;
        return;
    }

    if (!Object.keys(syncResults).length) {
        list.innerHTML = `<div class="empty-state"><div class="icon">🔄</div><h3>No sync data yet</h3><p>Click "Run Full Sync" to check the latest status of everything you're tracking.</p><button class="btn btn-primary" id="run-sync-btn-empty" style="margin-top:16px;">Run Full Sync</button></div>`;
        return;
    }

    list.innerHTML = '';
    
    // Add Last Synced Time
    const syncMeta = loadSyncMeta();
    if (syncMeta?.lastSync) {
        const lastSyncDate = new Date(syncMeta.lastSync).toLocaleString();
        const metaDiv = document.createElement('div');
        metaDiv.style.cssText = "margin-bottom: 20px; font-size: 13px; color: var(--text-muted); text-align: right;";
        metaDiv.textContent = `Last synced: ${lastSyncDate}`;
        list.appendChild(metaDiv);
    }

    library.forEach(media => {
        const result = syncResults[media.id];
        const card = document.createElement('div');
        card.className = 'sync-card';

        const hasNew = result?.hasNewContent && !result?.upToDate;

        const posterHTML = media.poster
            ? `<img class="sync-card-poster" src="${media.poster}" alt="${media.title}" onerror="this.style.display='none'">`
            : `<div class="sync-card-poster" style="display:flex;align-items:center;justify-content:center;font-size:24px;">${CAT_EMOJI[media.category]}</div>`;

        card.innerHTML = `
            <div class="sync-card-header">
                ${posterHTML}
                <div class="sync-card-info">
                    <div class="sync-card-title">${escapeHTML(media.title)}</div>
                    <div class="sync-card-meta">${CAT_LABELS[media.category]} · ${STATUS_LABELS[media.status] || media.status}</div>
                </div>
                ${hasNew
                    ? `<span class="sync-new-tag">🆕 NEW</span>`
                    : (result ? `<span class="sync-ok-tag">✓ Up to date</span>` : `<span style="color:var(--text-muted);font-size:12px;">Not synced</span>`)}
            </div>`;

        if (result) {
            const resultDiv = document.createElement('div');
            resultDiv.className = `sync-result ${hasNew ? 'has-new' : 'up-to-date'}`;
            let content = `<strong style="color:var(--text)">${escapeHTML(result.latestStatus)}</strong>`;
            if (hasNew && result.newContentSummary) {
                content += `<br><span style="color:var(--accent);">▶ ${escapeHTML(result.newContentSummary)}</span>`;
            }
            if (result.latestSeason) {
                content += `<br><span style="color:var(--text-muted);">Latest: Season ${escapeHTML(result.latestSeason)}${result.latestEpisodes ? ', ' + escapeHTML(result.latestEpisodes) + ' episodes' : ''}</span>`;
            }
            resultDiv.innerHTML = content;
            card.appendChild(resultDiv);
        }

        list.appendChild(card);
    });
}
