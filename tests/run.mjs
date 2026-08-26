#!/usr/bin/env node
// tests/run.mjs — starts a local static server on a free port, runs the e2e suite
// against it, then shuts the server down. This is what `npm test` calls.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        // Keep requests inside the project directory.
        const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
        let file = join(ROOT, rel === '/' ? 'index.html' : rel);

        try {
            if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
        } catch {
            // Serverless functions don't exist locally — the suite stubs them, but a
            // stray request should 404 rather than fall through to index.html.
            if (rel.includes('/.netlify/')) { res.writeHead(404).end('not found'); return; }
            res.writeHead(404).end('not found');
            return;
        }

        const body = await readFile(file);
        res.writeHead(200, {
            'Content-Type': MIME[extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
            // A service worker may only control pages at or below its own path.
            'Service-Worker-Allowed': '/',
        });
        res.end(body);
    } catch (err) {
        res.writeHead(500).end(String(err.message));
    }
});

const port = await new Promise((resolve, reject) => {
    server.on('error', reject);
    // Port 0 lets the OS hand us a free one, so parallel runs never collide.
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const base = `http://127.0.0.1:${port}`;
console.log(`serving ${ROOT} at ${base}\n`);

const child = spawn(
    process.execPath,
    [join(ROOT, 'tests', 'e2e.mjs'), '--base', base, ...process.argv.slice(2)],
    { stdio: 'inherit' }
);

child.on('exit', (code) => {
    server.close();
    process.exit(code ?? 1);
});
