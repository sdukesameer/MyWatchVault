// netlify/functions/tmdb-proxy.js
// Proxies TMDB requests to hide the API key

exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    
    const origin = event.headers.origin || event.headers.Origin || '';
    const allowedOrigins = ['http://localhost:3000', 'https://mywatchvault.netlify.app', 'http://127.0.0.1:5500'];
    const corsHeaders = {
        'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[1],
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    if (origin && !allowedOrigins.includes(origin) && !origin.includes('127.0.0.1') && !origin.includes('localhost')) {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Forbidden Origin' }) };
    }

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
    }

    const tmdbKey = process.env.TMDB_API_KEY;
    if (!tmdbKey) {
        return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'TMDB API Key missing in Netlify' }) };
    }

    const endpoint = event.queryStringParameters.endpoint;
    const query = event.queryStringParameters.query;
    const tvId = event.queryStringParameters.tvId;

    let url = '';
    if (endpoint === 'search-movie') {
        url = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${encodeURIComponent(query)}`;
    } else if (endpoint === 'search-tv') {
        url = `https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&query=${encodeURIComponent(query)}`;
    } else if (endpoint === 'tv-details' && tvId) {
        url = `https://api.themoviedb.org/3/tv/${tvId}?api_key=${tmdbKey}`;
    } else if (endpoint === 'movie-details' && tvId) {
        url = `https://api.themoviedb.org/3/movie/${tvId}?api_key=${tmdbKey}`;
    } else {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid endpoint or parameters' }) };
    }

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`TMDB responded with ${res.status}`);
        const data = await res.json();
        
        return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: err.message })
        };
    }
};
