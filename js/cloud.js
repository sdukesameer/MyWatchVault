// js/cloud.js
// Talks to the Turso-backed Netlify function. Reading is open to anyone; writing
// needs the admin passcode, which is held in sessionStorage for the tab's lifetime.

const DB_ENDPOINT = '/.netlify/functions/db';
const PASSCODE_KEY = 'watchvault_admin_passcode';

let status = { configured: false, canLogin: false, checked: false };

export function cloudStatus() { return status; }
export function isCloudEnabled() { return status.configured; }

export function getPasscode() {
    try { return sessionStorage.getItem(PASSCODE_KEY) || ''; } catch { return ''; }
}
export function isEditor() { return Boolean(getPasscode()); }

function setPasscode(code) {
    try {
        if (code) sessionStorage.setItem(PASSCODE_KEY, code);
        else sessionStorage.removeItem(PASSCODE_KEY);
    } catch { /* private mode — editing just won't persist across reloads */ }
}

export function logout() { setPasscode(''); }

// Probes whether cloud sync is set up at all, so the UI can stay local-only otherwise.
export async function checkCloud() {
    try {
        const res = await fetch(`${DB_ENDPOINT}?action=status`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        status = { configured: Boolean(data.configured), canLogin: Boolean(data.canLogin), checked: true };
    } catch {
        status = { configured: false, canLogin: false, checked: true };
    }
    return status;
}

export async function login(passcode) {
    const res = await fetch(DB_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', passcode })
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Login failed (${res.status})`);
    }
    setPasscode(passcode);
    return true;
}

export async function pull() {
    const res = await fetch(DB_ENDPOINT);
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Could not read cloud data (${res.status})`);
    }
    return res.json();
}

// Artwork is deliberately left out of the database — it is re-fetched locally from the
// keyless poster sources, so the rows stay small and hold only the text you typed.
function stripArtwork(library) {
    return library.map(({ poster, posterTried, ...rest }) => rest);
}

export async function push(library, syncMeta = {}) {
    const passcode = getPasscode();
    if (!passcode) throw new Error('Not logged in');

    const res = await fetch(DB_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', passcode, library: stripArtwork(library), syncMeta })
    });

    if (res.status === 401) { logout(); throw new Error('Session expired — log in again'); }
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Could not save to cloud (${res.status})`);
    }
    return res.json();
}
