// js/csv.js
// CSV parsing plus the column-guessing used by the import wizard.

// Full RFC-4180-ish parser: handles quoted fields, embedded commas/newlines and "" escapes.
export function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    const src = String(text).replace(/^﻿/, ''); // strip BOM

    for (let i = 0; i < src.length; i++) {
        const ch = src[i];

        if (inQuotes) {
            if (ch === '"') {
                if (src[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += ch;
            continue;
        }

        if (ch === '"') { inQuotes = true; continue; }
        if (ch === ',') { row.push(field); field = ''; continue; }
        if (ch === '\r') continue;
        if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
        field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    // Drop entirely blank lines
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

export const CSV_FIELDS = [
    { key: 'title',   label: 'Title',           required: true },
    { key: 'category',label: 'Type / Category',  required: false },
    { key: 'status',  label: 'Watch Status',     required: false },
    { key: 'year',    label: 'Year',             required: false },
    { key: 'genre',   label: 'Genre',            required: false },
    { key: 'rating',  label: 'Your Rating',      required: false },
    { key: 'notes',   label: 'Notes',            required: false },
    { key: 'tags',    label: 'Tags',             required: false }
];

// Header names seen in MyAnimeList / Trakt / IMDb / Letterboxd exports.
const HEADER_HINTS = {
    title: ['title', 'name', 'series', 'show', 'anime', 'movie', 'film', 'series_title', 'primary title'],
    category: ['type', 'category', 'media type', 'kind', 'format', 'title type'],
    status: ['status', 'watch status', 'my status', 'state', 'list'],
    year: ['year', 'release year', 'start date', 'released', 'aired', 'first aired'],
    genre: ['genre', 'genres', 'category name'],
    rating: ['rating', 'score', 'my score', 'your rating', 'my rating', 'user rating'],
    notes: ['notes', 'comment', 'comments', 'review', 'my comments'],
    tags: ['tags', 'tag', 'labels']
};

export function guessMapping(headers) {
    const norm = h => String(h || '').trim().toLowerCase();
    const mapping = {};
    const used = new Set();

    for (const { key } of CSV_FIELDS) {
        const hints = HEADER_HINTS[key] || [];
        // Exact match first, then a looser contains match.
        let idx = headers.findIndex((h, i) => !used.has(i) && hints.includes(norm(h)));
        if (idx === -1) {
            idx = headers.findIndex((h, i) => !used.has(i) && hints.some(hint => norm(h).includes(hint)));
        }
        if (idx !== -1) { mapping[key] = idx; used.add(idx); }
    }
    return mapping;
}

const CATEGORY_RULES = [
    [/anime.*(movie|film)|(movie|film).*anime/i, 'anime-movie'],
    [/\banime\b|\bona\b|\bova\b|\bmanga\b/i, 'anime-series'],
    [/\b(tv|series|show|season|mini.?series)\b/i, 'series'],
    [/\b(movie|film|feature)\b/i, 'movie']
];

export function normalizeCategory(raw, fallback = 'movie') {
    const value = String(raw || '').trim();
    if (!value) return fallback;
    if (['anime-series', 'anime-movie', 'series', 'movie'].includes(value)) return value;
    for (const [re, cat] of CATEGORY_RULES) if (re.test(value)) return cat;
    return fallback;
}

const STATUS_RULES = [
    [/complet|finish|watched|seen/i, 'completed'],
    [/watching|current|progress/i, 'watching'],
    [/hold|pause/i, 'on-hold'],
    [/drop|abandon/i, 'dropped'],
    [/plan|want|watchlist|todo|backlog/i, 'plan-to-watch']
];

export function normalizeStatus(raw, fallback = 'plan-to-watch') {
    const value = String(raw || '').trim();
    if (!value) return fallback;
    if (['watching', 'completed', 'plan-to-watch', 'on-hold', 'dropped'].includes(value)) return value;
    for (const [re, st] of STATUS_RULES) if (re.test(value)) return st;
    return fallback;
}

// Ratings arrive on 5-point, 10-point and 100-point scales; store them out of 5.
export function normalizeRating(raw) {
    const n = parseFloat(String(raw || '').replace(/[^\d.]/g, ''));
    if (!isFinite(n) || n <= 0) return 0;
    let out = n;
    if (n > 10) out = n / 20;        // 0-100
    else if (n > 5) out = n / 2;     // 0-10
    return Math.max(1, Math.min(5, Math.round(out)));
}

export function extractYear(raw) {
    const m = String(raw || '').match(/(19|20)\d{2}/);
    return m ? parseInt(m[0]) : null;
}

// Turns raw rows into candidate items using the chosen column mapping.
export function buildRows(rows, mapping, { defaultCategory = 'movie' } = {}) {
    const [, ...body] = rows;
    const at = (row, key) => (mapping[key] === undefined ? '' : (row[mapping[key]] ?? ''));

    return body.map(row => {
        const title = String(at(row, 'title') || '').trim();
        return {
            title,
            category: normalizeCategory(at(row, 'category'), defaultCategory),
            status: normalizeStatus(at(row, 'status')),
            year: extractYear(at(row, 'year')),
            genre: String(at(row, 'genre') || '').trim(),
            rating: normalizeRating(at(row, 'rating')),
            notes: String(at(row, 'notes') || '').trim(),
            tags: String(at(row, 'tags') || '').split(/[,;|]/).map(t => t.trim()).filter(Boolean)
        };
    }).filter(r => r.title);
}

export function toCSV(library) {
    const cols = ['title', 'category', 'status', 'year', 'genre', 'rating', 'notes', 'tags',
                  'watchedEpisodes', 'totalEpisodes', 'rewatchCount'];
    const esc = v => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(',')];
    library.forEach(m => {
        const watched = (m.seasons || []).reduce((a, s) => a + (parseInt(s.watched) || 0), 0);
        const total = (m.seasons || []).reduce((a, s) => a + (parseInt(s.total) || 0), 0);
        lines.push([
            m.title, m.category, m.status, m.year || '', m.genre || '', m.rating || '',
            m.notes || '', (m.tags || []).join('; '), watched, total, m.rewatchCount || 0
        ].map(esc).join(','));
    });
    return lines.join('\n');
}
