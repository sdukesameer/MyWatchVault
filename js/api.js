// js/api.js
// AI provider abstraction with fallback chain for WatchVault

const AI_PROVIDERS = [
    { name: 'Gemini 2.5 Flash', model: 'gemini-2.5-flash', type: 'gemini' },
    { name: 'Gemini 2.5 Flash Lite', model: 'gemini-2.5-flash-lite', type: 'gemini' },
    { name: 'Llama 3.3 70B Versatile (Groq)', model: 'llama-3.3-70b-versatile', type: 'groq' },
    { name: 'Llama 3.1 8B Instant (Groq)', model: 'llama-3.1-8b-instant', type: 'groq' },
    { name: 'OpenRouter Llama 3.1 8B Free', model: 'meta-llama/llama-3.1-8b-instruct:free', type: 'openrouter' },
    { name: 'Cohere Command R', model: 'command-r', type: 'cohere' }
];

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_BASE = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const COHERE_BASE = 'https://api.cohere.ai/v1/chat';

const PROXY_AI = '/.netlify/functions/ai-proxy';
const PROXY_TMDB = '/.netlify/functions/tmdb-proxy';
const PROXY_TIMEOUT_MS = 35000;
const REQUEST_TIMEOUT_MS = 25000;

function isProxied() {
    const hn = window.location.hostname;
    if (hn === 'localhost' || hn === '127.0.0.1' || hn.startsWith('192.168.') || hn.startsWith('10.')) {
        return false;
    }
    return true;
}

let lastProviderUsed = '';
export function getLastProvider() { return lastProviderUsed; }

async function callViaProxy(prompt) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
    try {
        const res = await fetch(PROXY_AI, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
            signal: controller.signal,
        });
        if (!res.ok) {
            const msg = await res.text().catch(() => `HTTP ${res.status}`);
            throw new Error(msg);
        }
        return await res.json();
    } catch (err) {
        if (err.name === 'AbortError') throw new Error('Proxy timed out');
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

export async function callTMDB(proxyEndpoint, params, config) {
    if (config && config.tmdbKey && !isProxied()) {
        let url = '';
        const tmdbKey = config.tmdbKey;
        if (proxyEndpoint === 'search-movie') url = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${encodeURIComponent(params.query)}`;
        else if (proxyEndpoint === 'search-tv') url = `https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&query=${encodeURIComponent(params.query)}`;
        else if (proxyEndpoint === 'tv-details') url = `https://api.themoviedb.org/3/tv/${params.tvId}?api_key=${tmdbKey}`;
        else if (proxyEndpoint === 'movie-details') url = `https://api.themoviedb.org/3/movie/${params.tvId}?api_key=${tmdbKey}`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error(`TMDB error ${res.status}`);
        return await res.json();
    } else {
        const queryParams = new URLSearchParams({ endpoint: proxyEndpoint, ...params });
        const res = await fetch(`${PROXY_TMDB}?${queryParams.toString()}`);
        if (!res.ok) {
            const errText = await res.text().catch(()=>'');
            throw new Error(`TMDB proxy error ${res.status}: ${errText}`);
        }
        return await res.json();
    }
}

export async function callAI(prompt, config) {
    const errors = [];

    if (isProxied()) {
        try {
            const data = await callViaProxy(prompt);
            lastProviderUsed = data.providerUsed || 'Unknown';
            return data.text || '';
        } catch (err) {
            console.warn('[proxy] failed, trying direct fallback:', err.message);
        }
    }

    for (const provider of AI_PROVIDERS) {
        if (provider.type === 'groq' && !config.groqKey) continue;
        if (provider.type === 'gemini' && !config.geminiKey) continue;
        if (provider.type === 'openrouter' && !config.openrouterKey) continue;
        if (provider.type === 'cohere' && !config.cohereKey) continue;

        try {
            let text;
            if (provider.type === 'gemini') {
                text = await callGemini(config.geminiKey, provider.model, prompt);
            } else if (provider.type === 'groq') {
                text = await callGroq(config.groqKey, provider.model, prompt);
            } else if (provider.type === 'openrouter') {
                text = await callOpenRouter(config.openrouterKey, provider.model, prompt);
            } else if (provider.type === 'cohere') {
                text = await callCohere(config.cohereKey, provider.model, prompt);
            }
            lastProviderUsed = provider.name;
            return text;
        } catch (err) {
            console.warn(`[${provider.name}] failed:`, err.message);
            errors.push(`${provider.name}: ${err.message}`);
        }
    }
    throw new Error('All AI providers failed:\n' + errors.join('\n'));
}

async function callGemini(apiKey, model, prompt) {
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;
    const body = { contents: [{ parts: [{ text: prompt }] }] };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } finally { clearTimeout(timeout); }
}

async function callGroq(apiKey, model, prompt) {
    const body = {
        model,
        messages: [
            { role: 'system', content: 'You are an entertainment assistant. Always respond with valid JSON only, no markdown.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.7, max_tokens: 8192,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(GROQ_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    } finally { clearTimeout(timeout); }
}

async function callOpenRouter(apiKey, model, prompt) {
    const body = {
        model,
        messages: [
            { role: 'system', content: 'You are an entertainment assistant. Always respond with valid JSON only, no markdown.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.7, max_tokens: 8192,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(OPENROUTER_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    } finally { clearTimeout(timeout); }
}

async function callCohere(apiKey, model, prompt) {
    const body = {
        model,
        message: prompt,
        preamble: "You are an entertainment assistant. Always respond with valid JSON only, no markdown.",
        temperature: 0.7,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(COHERE_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.text || '';
    } finally { clearTimeout(timeout); }
}

export function extractJSON(text) {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    let raw = fenceMatch ? fenceMatch[1] : text;

    const start = raw.search(/[\[{]/);
    const lastBrace = raw.lastIndexOf('}');
    const lastBracket = raw.lastIndexOf(']');
    const end = Math.max(lastBrace, lastBracket);
    if (start === -1 || end === -1) throw new Error('No JSON found in response');
    raw = raw.slice(start, end + 1);

    try { return JSON.parse(raw); } catch { /* fall through */ }

    let repaired = raw
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/(["\w])\s*\n\s*(["\[{])/g, '$1,$2')
        .replace(/\t/g, ' ');

    try { return JSON.parse(repaired); } catch (e) {
        const lastComplete = Math.max(repaired.lastIndexOf('},'), repaired.lastIndexOf('}\n'));
        if (lastComplete > start) {
            try {
                const truncated = repaired.slice(0, lastComplete + 1) + (repaired[start] === '[' ? ']' : '}');
                return JSON.parse(truncated);
            } catch { /* ignore */ }
        }
        throw new Error('JSON parse failed after repairs: ' + e.message);
    }
}
