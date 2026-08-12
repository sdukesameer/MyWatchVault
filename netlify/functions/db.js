// netlify/functions/db.js
// Turso-backed storage for the vault. Reads are public; writes need the admin passcode.
//
// Netlify environment variables:
//   TURSO_DATABASE_URL  e.g. libsql://your-db-name.turso.io
//   TURSO_AUTH_TOKEN    token from `turso db tokens create <db>`
//   ADMIN_PASSCODE      the passcode that unlocks editing

const VAULT_ROW_ID = 1;

// Turso speaks HTTP on the same host as the libsql:// URL.
function httpEndpoint(rawUrl) {
    const url = String(rawUrl || '').trim().replace(/\/+$/, '');
    if (!url) return '';
    return url.replace(/^libsql:\/\//, 'https://').replace(/^http:\/\//, 'https://');
}

const textArg = value => ({ type: 'text', value: String(value) });

async function turso(statements) {
    const base = httpEndpoint(process.env.TURSO_DATABASE_URL);
    const token = process.env.TURSO_AUTH_TOKEN;
    if (!base || !token) throw new Error('Turso is not configured');

    const res = await fetch(`${base}/v2/pipeline`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            requests: [
                ...statements.map(stmt => ({ type: 'execute', stmt })),
                { type: 'close' }
            ]
        })
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Turso HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }

    const body = await res.json();
    const failed = (body.results || []).find(r => r.type === 'error');
    if (failed) throw new Error(failed.error?.message || 'Turso query failed');
    return body.results || [];
}

// Turso returns rows as arrays of {type, value} cells.
function firstCell(result) {
    const rows = result?.response?.result?.rows;
    if (!rows || !rows.length) return null;
    const cell = rows[0][0];
    return cell && cell.type !== 'null' ? cell.value : null;
}

async function ensureTable() {
    await turso([{
        sql: `CREATE TABLE IF NOT EXISTS vault (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at TEXT NOT NULL
              )`,
        args: []
    }]);
}

// Timing-safe-ish comparison so the passcode can't be probed byte by byte.
function passcodeMatches(supplied) {
    const expected = process.env.ADMIN_PASSCODE || '';
    if (!expected) return false;
    const a = String(supplied || '');
    if (a.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= a.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
}

exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;

    const origin = event.headers.origin || event.headers.Origin || '';
    const allowedOrigins = ['http://localhost:3000', 'https://mywatchvault.netlify.app', 'http://127.0.0.1:5500'];
    const isLocal = origin.includes('127.0.0.1') || origin.includes('localhost');
    const corsHeaders = {
        'Access-Control-Allow-Origin': allowedOrigins.includes(origin) || isLocal ? (origin || allowedOrigins[1]) : allowedOrigins[1],
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    };
    const json = (statusCode, payload) => ({
        statusCode,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
    if (origin && !allowedOrigins.includes(origin) && !isLocal) {
        return json(403, { error: 'Forbidden Origin' });
    }

    const configured = Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);

    try {
        // ── Status: lets the frontend decide whether to show cloud features at all.
        // Only an explicit ?action=status asks for this; a plain GET reads the vault.
        if (event.httpMethod === 'GET' && event.queryStringParameters?.action === 'status') {
            return json(200, { configured, canLogin: Boolean(process.env.ADMIN_PASSCODE) });
        }

        if (!configured) return json(503, { error: 'Cloud sync is not configured' });

        // ── Read the vault (public).
        if (event.httpMethod === 'GET') {
            await ensureTable();
            const [row] = await turso([
                { sql: 'SELECT data FROM vault WHERE id = ?', args: [{ type: 'integer', value: String(VAULT_ROW_ID) }] }
            ]);
            const raw = firstCell(row);
            if (!raw) return json(200, { library: [], syncMeta: {}, updatedAt: null });

            const parsed = JSON.parse(raw);
            return json(200, {
                library: Array.isArray(parsed.library) ? parsed.library : [],
                syncMeta: parsed.syncMeta || {},
                updatedAt: parsed.updatedAt || null
            });
        }

        if (event.httpMethod !== 'POST') {
            return json(405, { error: 'Method Not Allowed' });
        }

        let body;
        try { body = JSON.parse(event.body || '{}'); }
        catch { return json(400, { error: 'Invalid JSON' }); }

        // ── Login: verify the passcode without touching data.
        if (body.action === 'login') {
            if (!process.env.ADMIN_PASSCODE) return json(503, { error: 'No admin passcode configured' });
            return passcodeMatches(body.passcode)
                ? json(200, { ok: true })
                : json(401, { error: 'Incorrect passcode' });
        }

        // ── Save: writes require the passcode.
        if (body.action === 'save') {
            if (!passcodeMatches(body.passcode)) return json(401, { error: 'Incorrect passcode' });
            if (!Array.isArray(body.library)) return json(400, { error: 'library must be an array' });

            await ensureTable();
            const updatedAt = new Date().toISOString();
            const payload = JSON.stringify({
                library: body.library,
                syncMeta: body.syncMeta || {},
                updatedAt
            });

            await turso([{
                sql: `INSERT INTO vault (id, data, updated_at) VALUES (?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
                args: [{ type: 'integer', value: String(VAULT_ROW_ID) }, textArg(payload), textArg(updatedAt)]
            }]);

            return json(200, { ok: true, updatedAt, count: body.library.length });
        }

        return json(400, { error: 'Unknown action' });
    } catch (err) {
        console.error('[db]', err);
        return json(500, { error: err.message });
    }
};
