// netlify/functions/ai-proxy.js
// Keeps API keys server-side. Frontend calls /.netlify/functions/ai-proxy

exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    
    const origin = event.headers.origin || event.headers.Origin || '';
    const allowedOrigins = ['http://localhost:3000', 'https://mywatchvault.netlify.app', 'http://127.0.0.1:5500'];
    const corsHeaders = {
        'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[1],
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    if (origin && !allowedOrigins.includes(origin) && !origin.includes('127.0.0.1') && !origin.includes('localhost')) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Forbidden Origin' }) };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
    }

    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, body: 'Invalid JSON' }; }

    const { prompt } = body;
    if (!prompt) {
        return { statusCode: 400, body: 'Missing prompt' };
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const cohereKey = process.env.COHERE_API_KEY;

    const PROVIDER_TIMEOUT_MS = 12000;
    const withTimeout = (promise, ms, name) =>
        Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)
            )
        ]);

    // ── TIER 1: Gemini 2.5 Flash ────────
    async function gemini25Flash(prompt) {
        if (!geminiKey) throw new Error("Gemini Key missing");
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                })
            }
        );
        if (!res.ok) throw new Error(`Gemini 2.5 Flash error [${res.status}]`);
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text;
    }

    // ── TIER 1b: Gemini 2.5 Flash Lite ──
    async function gemini25FlashLite(prompt) {
        if (!geminiKey) throw new Error("Gemini Key missing");
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                })
            }
        );
        if (!res.ok) throw new Error(`Gemini 2.5 Flash Lite error [${res.status}]`);
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text;
    }

    // ── TIER 2: Groq - Llama 3.3 70B Versatile ────
    async function groq33Versatile(prompt) {
        if (!groqKey) throw new Error("Groq Key missing");
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${groqKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: "You are an entertainment assistant. Always respond with valid JSON only, no markdown." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 4096
            })
        });
        if (!res.ok) throw new Error(`Groq 70B error [${res.status}]`);
        const data = await res.json();
        return data?.choices?.[0]?.message?.content;
    }

    // ── TIER 2b: Groq - Llama 3.1 8B Instant ───
    async function groq31Instant(prompt) {
        if (!groqKey) throw new Error("Groq Key missing");
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${groqKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: "You are an entertainment assistant. Always respond with valid JSON only, no markdown." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 4096
            })
        });
        if (!res.ok) throw new Error(`Groq 8B error [${res.status}]`);
        const data = await res.json();
        return data?.choices?.[0]?.message?.content;
    }

    // ── TIER 3: OpenRouter Llama 3.1 8B Free ─
    async function openrouterFree(prompt) {
        if (!openrouterKey) throw new Error("OpenRouter Key missing");
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openrouterKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "google/gemma-4-31b-it:free",
                messages: [
                    { role: "system", content: "You are an entertainment assistant. Always respond with valid JSON only, no markdown." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 4096
            })
        });
        if (!res.ok) throw new Error(`OpenRouter error [${res.status}]`);
        const data = await res.json();
        return data?.choices?.[0]?.message?.content;
    }
    
    // ── TIER 4: Cohere Command R ─
    async function cohereCommandR(prompt) {
        if (!cohereKey) throw new Error("Cohere Key missing");
        const res = await fetch("https://api.cohere.com/v2/chat", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${cohereKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "command-r-08-2024",
                messages: [
                    { role: "system", content: "You are an entertainment assistant. Always respond with valid JSON only, no markdown." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.7
            })
        });
        if (!res.ok) throw new Error(`Cohere error [${res.status}]`);
        const data = await res.json();
        const parts = data?.message?.content;
        if (Array.isArray(parts)) return parts.map(c => c.text || '').join('');
        return data?.text;
    }

    const providers = [
        { name: 'Gemini 2.5 Flash', fn: gemini25Flash, needs: () => !!geminiKey },
        { name: 'Gemini 2.5 Flash Lite', fn: gemini25FlashLite, needs: () => !!geminiKey },
        { name: 'Groq Llama 3.3 70B', fn: groq33Versatile, needs: () => !!groqKey },
        { name: 'Groq Llama 3.1 8B', fn: groq31Instant, needs: () => !!groqKey },
        { name: 'OpenRouter Gemma 4 31B Free', fn: openrouterFree, needs: () => !!openrouterKey },
        { name: 'Cohere Command R', fn: cohereCommandR, needs: () => !!cohereKey },
    ];

    // Optional AI_PROVIDER_ORDER env var lets you promote whichever free tier is
    // actually working today (e.g. "groq,gemini,cohere") without a code change.
    const orderPref = String(process.env.AI_PROVIDER_ORDER || '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    const rank = (name) => {
        const n = name.toLowerCase();
        const i = orderPref.findIndex(pref => n.includes(pref));
        return i === -1 ? orderPref.length + 1 : i;
    };
    const ordered = orderPref.length
        ? [...providers].sort((a, b) => rank(a.name) - rank(b.name))
        : providers;

    let text = null;
    let providerUsed = null;
    let errorDetails = [];

    for (const provider of ordered) {
        // No key configured for this provider: skip without spending a timeout on it.
        if (provider.needs && !provider.needs()) {
            errorDetails.push(`${provider.name}: no API key configured`);
            continue;
        }
        try {
            text = await withTimeout(provider.fn(prompt), PROVIDER_TIMEOUT_MS, provider.name);
            if (text) {
                providerUsed = provider.name;
                console.log(`[ai-proxy] ✅ Success with ${provider.name}`);
                break;
            }
        } catch (err) {
            console.warn(`[ai-proxy] ❌ ${provider.name} failed:`, err.message);
            errorDetails.push(`${provider.name}: ${err.message}`);
        }
    }

    if (!text) {
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'All AI providers failed', details: errorDetails.join(', ') })
        };
    }

    return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, providerUsed }),
    };
};
