// js/constants.js
// Shared configuration, mappings, and system constants

export const CAT_LABELS = {
    'anime-series': 'Anime Series',
    'anime-movie': 'Anime Movie',
    'series': 'Web Series',
    'movie': 'Movie',
    'anime': 'Anime'
};

export const CAT_EMOJI = {
    'anime-series': '⛩️',
    'anime-movie': '🎬',
    'series': '📺',
    'movie': '🍿',
    'anime': '⛩️'
};

export const STATUS_LABELS = {
    'plan-to-watch': 'Plan to Watch',
    'watching': 'Watching',
    'completed': 'Completed',
    'on-hold': 'On Hold',
    'dropped': 'Dropped'
};

export const STATUS_COLORS = {
    'plan-to-watch': 'var(--accent2)',
    'watching': 'var(--accent)',
    'completed': 'var(--success)',
    'on-hold': 'var(--warning)',
    'dropped': 'var(--danger)'
};

export const STATUS_DOT_CLASS = {
    'watching': 'watching', 'completed': 'completed',
    'plan-to-watch': 'not-started', 'on-hold': 'on-hold', 'dropped': 'on-hold'
};

export const AI_PROVIDERS = [
    { name: 'Gemini 2.5 Flash', model: 'gemini-2.5-flash', type: 'gemini' },
    { name: 'Gemini 2.5 Flash Lite', model: 'gemini-2.5-flash-lite', type: 'gemini' },
    { name: 'Llama 3.3 70B Versatile (Groq)', model: 'llama-3.3-70b-versatile', type: 'groq' },
    { name: 'Llama 3.1 8B Instant (Groq)', model: 'llama-3.1-8b-instant', type: 'groq' },
    { name: 'OpenRouter Llama 3.1 8B Free', model: 'meta-llama/llama-3.1-8b-instruct:free', type: 'openrouter' },
    { name: 'Cohere Command R', model: 'command-r', type: 'cohere' }
];

export const PROXY_AI = '/.netlify/functions/ai-proxy';
export const PROXY_TMDB = '/.netlify/functions/tmdb-proxy';
export const PROXY_TIMEOUT_MS = 35000;
export const REQUEST_TIMEOUT_MS = 25000;
