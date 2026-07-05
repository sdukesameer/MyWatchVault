// js/recommendations.js
// AI Recommendation Engine

import { callAI, extractJSON } from './api.js';
import { CAT_LABELS, CAT_EMOJI } from './ui.js';

export async function fetchRecommendations(library, config) {
    if (library.length < 2) {
        throw new Error('Add more titles for better recommendations!');
    }

    const liked = library
        .filter(m => m.rating >= 4 || m.status === 'completed')
        .map(m => m.title)
        .slice(0, 15)
        .join(', ');

    const allTitles = library.map(m => m.title).join(', ');
    const cats = [...new Set(library.map(m => m.category))].join(', ');

    const prompt = `You are a media recommendation expert. Based on this user's watch history:
Top rated / completed: ${liked || 'none yet'}
All tracked: ${allTitles}
Preferred categories: ${cats}

Recommend 8 titles they would love that are NOT in their list.
Return JSON array:
[{ "title": "...", "year": 2023, "category": "anime-series|anime-movie|series|movie", "genre": "...", "description": "1-2 sentences about the show", "whyYouLikeIt": "Specific reason based on their taste (1 sentence)" }]
ONLY valid JSON array, no markdown.`;

    const text = await callAI(prompt, config);
    return extractJSON(text);
}

export function renderRecommendations(recos, library, onQuickAdd) {
    const grid = document.getElementById('reco-grid');
    if (!recos.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🤔</div><h3>No recommendations yet</h3><p>Rate or complete some titles to get personalised picks.</p></div>`;
        return;
    }
    
    grid.innerHTML = '';
    recos.forEach(item => {
        const inLib = library.some(m => m.title.toLowerCase() === item.title.toLowerCase());
        const card = document.createElement('div');
        card.className = 'reco-card';
        card.innerHTML = `
            <div class="reco-poster">
                <div class="reco-poster-placeholder">${CAT_EMOJI[item.category] || '🎬'}</div>
                <div class="card-badge ${item.category?.split('-')[0]}" style="bottom:8px;left:8px;top:auto;">${CAT_LABELS[item.category] || ''}</div>
            </div>
            <div class="reco-body">
                <div class="reco-title">${item.title} <span style="font-size:11px;color:var(--text-muted);">${item.year || ''}</span></div>
                <div class="reco-why">🎯 ${item.whyYouLikeIt || item.description || ''}</div>
                ${inLib
                    ? `<div style="margin-top:10px;font-size:12px;color:var(--success);">✓ Already in your vault</div>`
                    : `<button class="reco-add-btn" data-item='${JSON.stringify(item).replace(/'/g, "&apos;")}'>+ Add to Vault</button>`}
            </div>`;

        const btn = card.querySelector('.reco-add-btn');
        if (btn) {
            btn.addEventListener('click', e => {
                const data = JSON.parse(e.target.dataset.item);
                onQuickAdd(data);
                e.target.textContent = '✓ Added!';
                e.target.style.color = 'var(--success)';
                e.target.disabled = true;
            });
        }
        grid.appendChild(card);
    });
}
