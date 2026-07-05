// js/sync.js
// AI Sync Engine

import { callAI, extractJSON } from './api.js';
import { CAT_LABELS, CAT_EMOJI, STATUS_LABELS } from './ui.js';

export async function runSync(library, config, onProgress) {
    if (!library.length) {
        throw new Error('Add some titles first!');
    }

    const summaries = library.map(m => {
        const seasons = m.seasons?.length
            ? m.seasons.map(s => `S${s.number}: watched ${s.watched}/${s.total || '?'} ep`).join(', ')
            : '';
        return `- ${m.title} (${CAT_LABELS[m.category]}, ${m.year || '?'}) | Status: ${m.status}${seasons ? ' | ' + seasons : ''}`;
    }).join('\n');

    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const prompt = `Today is ${today}. You are a knowledgeable entertainment database assistant with knowledge up to your training cutoff.

The user tracks these titles:
${summaries}

For each title, check your knowledge and return what you know about the latest status:
- For anime/series: latest season number, episode count, whether it's ongoing/completed/cancelled
- For movies: sequels, prequels, upcoming releases
- Compare against what the user has watched and flag if there's new content they haven't seen

Return a JSON array, one object per title (in same order), with:
{
  "title": "...",
  "latestStatus": "brief description of latest known status",
  "latestSeason": 3,
  "latestEpisodes": 24,
  "isOngoing": true,
  "hasNewContent": true,
  "newContentSummary": "Season 4 announced / Movie sequel confirmed / etc",
  "upToDate": false
}

For "upToDate": compare what user has watched vs what's available. If they've watched all available content, set true.
Return ONLY valid JSON array.`;

    const text = await callAI(prompt, config);
    const results = extractJSON(text);

    const newSyncResults = {};
    const updatedLibrary = [...library];
    
    updatedLibrary.forEach((media) => {
        const result = results.find(r => r.title?.toLowerCase().includes(media.title.toLowerCase()) || media.title.toLowerCase().includes(r.title?.toLowerCase()));
        if (result) {
            newSyncResults[media.id] = result;
            media.hasNew = result.hasNewContent && !result.upToDate;
        }
    });

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
    const syncMeta = syncResults._meta;
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
                    <div class="sync-card-title">${media.title}</div>
                    <div class="sync-card-meta">${CAT_LABELS[media.category]} · ${STATUS_LABELS[media.status] || media.status}</div>
                </div>
                ${hasNew
                    ? `<span class="sync-new-tag">🆕 NEW</span>`
                    : (result ? `<span class="sync-ok-tag">✓ Up to date</span>` : `<span style="color:var(--text-muted);font-size:12px;">Not synced</span>`)}
            </div>`;

        if (result) {
            const resultDiv = document.createElement('div');
            resultDiv.className = `sync-result ${hasNew ? 'has-new' : 'up-to-date'}`;
            let content = `<strong style="color:var(--text)">${result.latestStatus}</strong>`;
            if (hasNew && result.newContentSummary) {
                content += `<br><span style="color:var(--accent);">▶ ${result.newContentSummary}</span>`;
            }
            if (result.latestSeason) {
                content += `<br><span style="color:var(--text-muted);">Latest: Season ${result.latestSeason}${result.latestEpisodes ? ', ' + result.latestEpisodes + ' episodes' : ''}</span>`;
            }
            resultDiv.innerHTML = content;
            card.appendChild(resultDiv);
        }

        list.appendChild(card);
    });
}
