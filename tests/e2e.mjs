#!/usr/bin/env node
// tests/e2e.mjs — end-to-end suite for WatchVault.
//
//   npm test                      # serve + run everything
//   node tests/e2e.mjs --base http://127.0.0.1:3000
//   node tests/e2e.mjs --only "season"     # run matching suites only
//   node tests/e2e.mjs --headed            # watch it run
//
// Drives real Chrome via playwright-core. Network to the metadata APIs is stubbed so
// runs are deterministic; pass --live to let real API calls through.

import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : (args[i + 1] ?? true);
};
const BASE = flag('base', 'http://127.0.0.1:3000');
const ONLY = flag('only', null);
const HEADED = args.includes('--headed');
const LIVE = args.includes('--live');
const PASSCODE = 'test-pass';

const CHROME_PATHS = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
].filter(Boolean);

// ── tiny test harness ────────────────────────────────────────────
const results = [];
let currentSuite = '';

const suite = (name) => { currentSuite = name; console.log(`\n\x1b[1m${name}\x1b[0m`); };

function check(label, pass, detail = '') {
    results.push({ suite: currentSuite, label, pass });
    const mark = pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`  ${mark} ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`);
}
const eq = (label, actual, expected) =>
    check(label, JSON.stringify(actual) === JSON.stringify(expected),
          JSON.stringify(actual) === JSON.stringify(expected) ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

// ── fixtures ─────────────────────────────────────────────────────
const now = new Date().toISOString();
const item = (over = {}) => ({
    id: 'x', title: 'Item', year: 2015, category: 'series', genre: 'Drama',
    description: 'd', status: 'watching', rating: 0, globalRating: '8.0 ★',
    seasons: [{ number: 1, watched: 0, total: 10 }], notes: '', tags: [],
    poster: null, posterTried: true, addedAt: now, hasNew: false, rewatchCount: 0,
    ...over
});

const LIB = [
    item({ id: 'a', title: 'Alpha Series', year: 2024, seasons: [
        { number: 1, watched: 10, total: 10 }, { number: 2, watched: 3, total: 12 }] }),
    item({ id: 'b', title: 'Beta Anime', year: 2012, category: 'anime-series', genre: 'Action',
           status: 'plan-to-watch', rating: 5, seasons: [{ number: 1, watched: 0, total: 12 }] }),
    item({ id: 'c', title: 'Gamma Movie', year: 2019, category: 'movie', genre: 'Sci-Fi',
           status: 'completed', rating: 4, runtime: 148, seasons: [] }),
    item({ id: 'd', title: 'Delta Show', category: 'series', genre: 'Comedy', status: 'on-hold',
           rating: 3, year: null, hasNew: true, seasons: [{ number: 1, watched: 5, total: 8 }] }),
];

const seed = (library, extra = {}) => `(() => {
    localStorage.setItem('watchvault_library', ${JSON.stringify(JSON.stringify(library))});
    localStorage.setItem('watchvault_prefs', JSON.stringify(${JSON.stringify({
        autosync: false, dailySync: false, artwork: false, recoBatch: 10, askPasscode: false, ...extra
    })}));
    localStorage.setItem('lastAutoSyncDate', new Date().toDateString());
})()`;

// ── page helpers ─────────────────────────────────────────────────
async function newPage(browser, { library = LIB, prefs = {}, cloud = null, viewport } = {}) {
    const page = await browser.newPage({
        viewport: viewport || { width: 1280, height: 1000 },
        isMobile: Boolean(viewport && viewport.width < 700),
        hasTouch: Boolean(viewport && viewport.width < 700),
    });
    page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));

    if (!LIVE) {
        // Deterministic metadata: no live APIs during a normal run.
        await page.route('**/api.jikan.moe/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }));
        await page.route('**/graphql.anilist.co/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{"Media":null}}' }));
        await page.route('**/api.tvmaze.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
        await page.route('**/kitsu.io/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }));
        await page.route('**/itunes.apple.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[]}' }));
        await page.route('**/en.wikipedia.org/**', r => r.fulfill({ status: 404, body: '{}' }));
        await page.route('**/image.tmdb.org/**', r => r.fulfill({ status: 200, contentType: 'image/gif', body: '' }));
        await page.route('**/api.themoviedb.org/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    }

    // Cloud function: absent unless a suite asks for it.
    await page.route('**/.netlify/functions/db**', route => {
        if (!cloud) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"not configured"}' });
        const url = new URL(route.request().url());
        if (url.searchParams.get('action') === 'status') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":true,"canLogin":true}' });
        }
        if (route.request().method() === 'GET') {
            return route.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ library: cloud.library, syncMeta: {} }) });
        }
        const body = JSON.parse(route.request().postData() || '{}');
        if (body.action === 'login') {
            return route.fulfill({ status: body.passcode === PASSCODE ? 200 : 401,
                contentType: 'application/json',
                body: body.passcode === PASSCODE ? '{"ok":true}' : '{"error":"Incorrect passcode"}' });
        }
        cloud.saves.push(body.library);
        cloud.library = body.library;
        return route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, count: body.library.length }) });
    });
    await page.route('**/.netlify/functions/ai-proxy**', route =>
        route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"no AI in tests"}' }));

    await page.addInitScript(seed(library, prefs));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    return page;
}

const titles = page => page.$$eval('#media-grid .card-title', els => els.map(e => e.textContent.trim()));
const stored = (page, id) => page.evaluate(i =>
    JSON.parse(localStorage.getItem('watchvault_library')).find(m => m.id === i), id);
const confirmVisible = page => page.locator('.modal-overlay:not(.hidden) .confirm-cancel');

async function closeDetail(page) {
    await page.locator('#detail-close').click();
    await page.waitForTimeout(250);
    if (await confirmVisible(page).count()) {
        await page.locator('.modal-overlay:not(.hidden) .confirm-action').click();
        await page.waitForTimeout(250);
    }
}

const noOverflow = page => page.evaluate(() => {
    const de = document.documentElement;
    return de.scrollWidth <= de.clientWidth + 1;
});

// ── suites ───────────────────────────────────────────────────────
const SUITES = {

    'render + default sort': async (browser) => {
        const page = await newPage(browser);
        eq('all four items render', (await titles()).length, 4);
        eq('default sort is newest release first',
            await titles(),
            ['Alpha Series', 'Gamma Movie', 'Beta Anime', 'Delta Show']);
        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();

        async function titles() { return page.$$eval('#media-grid .card-title', e => e.map(x => x.textContent.trim())); }
    },

    'quick watch (+1 EP)': async (browser) => {
        const page = await newPage(browser);
        const card = page.locator('.media-card', { hasText: 'Alpha Series' }).first();
        await card.hover();
        await card.locator('.card-quick-watch').click();
        await page.waitForTimeout(600);

        const a = await stored(page, 'a');
        eq('advances the unfinished season, not season 1',
            a.seasons.map(s => `${s.watched}/${s.total}`), ['10/10', '4/12']);
        eq('stays "watching" while episodes remain', a.status, 'watching');
        check('stamps updatedAt', Boolean(a.updatedAt));

        // Undo restores the previous counts.
        await page.locator('.toast-action').first().click();
        await page.waitForTimeout(500);
        eq('undo restores counts',
            (await stored(page, 'a')).seasons.map(s => s.watched), [10, 3]);

        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();

        // Finishing the final episode, on a fixture that is one episode short.
        // (A fresh page, because addInitScript re-seeds storage on every navigation.)
        const last = await newPage(browser, { library: [
            item({ id: 'z', title: 'Nearly Done', seasons: [
                { number: 1, watched: 10, total: 10 }, { number: 2, watched: 11, total: 12 }] })] });
        const zCard = last.locator('.media-card').first();
        await zCard.hover();
        await zCard.locator('.card-quick-watch').click();
        await last.waitForTimeout(700);

        const done = await stored(last, 'z');
        eq('last episode completes the item', done.status, 'completed');
        eq('final counts', done.seasons.map(s => `${s.watched}/${s.total}`), ['10/10', '12/12']);
        check('stamps completedAt', Boolean(done.completedAt));
        eq('button disappears once finished', await last.locator('.card-quick-watch').count(), 0);
        check('no page errors on the completion page', last.errors.length === 0, last.errors.join('; '));
        await last.close();
    },

    'season numbers are stable identities': async (browser) => {
        const page = await newPage(browser, { library: [
            item({ id: 'g', title: 'Gap Show', seasons: [
                { number: 4, watched: 3, total: 10 }, { number: 5, watched: 1, total: 10 }] })] });

        await page.locator('.media-card').first().click();
        await page.waitForTimeout(400);
        eq('labels show the real season numbers',
            await page.$$eval('#seasons-grid .season-label', e => e.map(x => x.textContent.trim())),
            ['Season 4', 'Season 5']);

        await page.locator('#detail-save-btn').click();
        await page.waitForTimeout(500);
        eq('a no-op save does not renumber',
            (await stored(page, 'g')).seasons.map(s => s.number), [4, 5]);
        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();
    },

    'completion cascade': async (browser) => {
        const page = await newPage(browser, { library: [
            item({ id: 'm', title: 'Multi', seasons: [1, 2, 3].map(n => ({ number: n, watched: 0, total: 5 })) }),
            item({ id: 'u', title: 'Unknown Total', seasons: [{ number: 1, watched: 0, total: 0 }] })] });

        await page.locator('.media-card', { hasText: 'Multi' }).first().click();
        await page.waitForTimeout(400);
        await page.locator('#seasons-grid .season-row').nth(1).locator('.season-status').click();
        await page.waitForTimeout(300);
        eq('completing S2 also completes S1',
            await page.$$eval('#seasons-grid .season-status', e => e.map(x => x.textContent.trim())),
            ['Complete', 'Complete', 'Not started']);
        eq('item is watching while S3 is open',
            await page.$eval('#status-selector .status-opt.active', e => e.dataset.status), 'watching');

        await page.locator('#seasons-grid .season-row').nth(2).locator('.season-status').click();
        await page.waitForTimeout(300);
        eq('finishing the last season completes the item',
            await page.$eval('#status-selector .status-opt.active', e => e.dataset.status), 'completed');
        await closeDetail(page);

        await page.locator('.media-card', { hasText: 'Unknown Total' }).first().click();
        await page.waitForTimeout(400);
        await page.locator('#seasons-grid .season-status').first().click();
        await page.waitForTimeout(300);
        eq('a season with no episode count can still be completed',
            await page.$eval('#seasons-grid .season-status', e => e.textContent.trim()), 'Complete');
        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();
    },

    'unsaved-changes guard': async (browser) => {
        const page = await newPage(browser, { library: [
            item({ id: 't', title: 'Tagged', tags: ['Epic', 'Must Watch'] }),
            item({ id: 'v', title: 'Sparse Movie', category: 'movie', seasons: [] })] });

        await page.locator('.media-card', { hasText: 'Tagged' }).first().click();
        await page.waitForTimeout(400);
        await page.locator('#detail-cancel-btn').click();
        await page.waitForTimeout(300);
        check('no prompt when nothing changed (tags normalise equal)',
            await confirmVisible(page).count() === 0);
        if (await confirmVisible(page).count()) await confirmVisible(page).click();

        // A movie must not inherit the previous item's season rows.
        await page.locator('.media-card', { hasText: 'Sparse Movie' }).first().click();
        await page.waitForTimeout(400);
        eq('movie shows no season rows', await page.locator('#seasons-grid .season-row').count(), 0);
        await page.locator('#detail-save-btn').click();
        await page.waitForTimeout(500);
        eq('movie saves with no seasons', (await stored(page, 'v')).seasons, []);

        // A real edit does prompt.
        await page.locator('.media-card', { hasText: 'Tagged' }).first().click();
        await page.waitForTimeout(400);
        await page.fill('#detail-notes', 'changed');
        await page.locator('#detail-cancel-btn').click();
        await page.waitForTimeout(400);
        check('prompts on a real edit', await confirmVisible(page).count() > 0);
        if (await confirmVisible(page).count()) {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
            check('Esc dismisses only the prompt', await confirmVisible(page).count() === 0);
            check('detail modal stays open', await page.locator('#detail-modal:not(.hidden)').count() > 0);
            await closeDetail(page);
        }
        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();
    },

    'keyboard: Enter saves, Esc cancels': async (browser) => {
        const page = await newPage(browser);
        await page.locator('.media-card').first().click();
        await page.waitForTimeout(400);
        await page.fill('#detail-tags', 'keyboard');
        await page.locator('#detail-tags').press('Enter');
        await page.waitForTimeout(600);
        check('Enter saves and closes', await page.locator('#detail-modal.hidden').count() > 0);

        await page.locator('.media-card').first().click();
        await page.waitForTimeout(400);
        await page.locator('#detail-notes').click();
        await page.keyboard.type('one');
        await page.locator('#detail-notes').press('Enter');
        await page.keyboard.type('two');
        await page.waitForTimeout(300);
        check('Enter in the notes textarea inserts a newline',
            await page.locator('#detail-modal:not(.hidden)').count() > 0
            && (await page.locator('#detail-notes').inputValue()).includes('\n'));
        await closeDetail(page);
        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();
    },

    'filters, grouping and search': async (browser) => {
        const page = await newPage(browser);

        await page.selectOption('#status-filter', 'has-new');
        await page.waitForTimeout(400);
        eq('new-content filter', await titles(page), ['Delta Show']);
        await page.selectOption('#status-filter', 'all');

        await page.selectOption('#sort-select', 'year-asc');
        await page.waitForTimeout(400);
        eq('oldest first puts year-less items last',
            await titles(page), ['Beta Anime', 'Gamma Movie', 'Alpha Series', 'Delta Show']);
        await page.selectOption('#sort-select', 'year-desc');

        await page.selectOption('#group-by', 'status');
        await page.waitForTimeout(400);
        check('grouped headings appear', await page.locator('#media-grid .group-heading').count() >= 3);
        await page.selectOption('#group-by', 'none');

        await page.fill('#library-filter', 'gamma');
        await page.waitForTimeout(500);
        eq('vault text filter', await titles(page), ['Gamma Movie']);
        await page.fill('#library-filter', 'zzz');
        await page.waitForTimeout(500);
        eq('no-match empty state', (await page.locator('.empty-state h3').textContent()).trim(), 'No matches');
        await page.fill('#library-filter', '');
        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();
    },

    'bulk selection': async (browser) => {
        const page = await newPage(browser);
        await page.locator('#select-mode-btn').click();
        await page.waitForTimeout(300);
        await page.locator('.media-card').nth(0).click();
        await page.locator('.media-card').nth(1).click();
        await page.waitForTimeout(300);
        eq('two selected', (await page.locator('#bulk-count').textContent()).trim(), '2 selected');

        await page.locator('#bulk-select-all').click();
        await page.waitForTimeout(300);
        eq('select all', (await page.locator('#bulk-count').textContent()).trim(), '4 selected');
        await page.locator('#bulk-clear').click();
        await page.waitForTimeout(250);

        await page.locator('.media-card', { hasText: 'Beta Anime' }).first().click();
        await page.waitForTimeout(250);
        await page.locator('#bulk-status-btn').click();
        await page.waitForTimeout(300);
        await page.locator('.status-menu-item[data-status="completed"]').click();
        await page.waitForTimeout(600);
        const beta = await stored(page, 'b');
        eq('bulk complete fills episode counts', beta.seasons.map(s => `${s.watched}/${s.total}`), ['12/12']);
        eq('bulk complete sets status', beta.status, 'completed');
        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();
    },

    'rotating continue watching': async (browser) => {
        const page = await newPage(browser, { library: [
            item({ id: 'w1', title: 'Watch One', status: 'watching', seasons: [{ number: 1, watched: 1, total: 10 }] }),
            item({ id: 'w2', title: 'Watch Two', status: 'watching', seasons: [{ number: 1, watched: 2, total: 10 }] }),
            item({ id: 'w3', title: 'Watch Three', status: 'watching', seasons: [{ number: 1, watched: 3, total: 10 }] }),
            item({ id: 'w4', title: 'Not Watching', status: 'completed', seasons: [{ number: 1, watched: 10, total: 10 }] }),
        ]});

        const heroTitle = () => page.locator('#continue-hero .continue-hero-title').textContent();
        eq('one dot per watching title (completed excluded)',
            await page.locator('.continue-dot').count(), 3);

        const first = (await heroTitle()).trim();
        await page.waitForTimeout(5600);
        const second = (await heroTitle()).trim();
        check('rotates on its own', first !== second, `${first} → ${second}`);
        eq('active dot follows the hero',
            await page.locator('.continue-dot.active').getAttribute('data-index'), '1');

        // Hovering must pause it, so it can't move mid-click.
        await page.locator('#continue-hero').hover();
        const paused = (await heroTitle()).trim();
        await page.waitForTimeout(5600);
        eq('pauses while hovered', (await heroTitle()).trim(), paused);

        // Dots jump straight to a title.
        await page.locator('.continue-dot[data-index="2"]').click();
        await page.waitForTimeout(400);
        eq('dot click selects that title', (await heroTitle()).trim(), 'Watch Three');

        // Edit must open whatever is currently showing, not the original first item.
        await page.locator('#dash-continue-btn').click();
        await page.waitForTimeout(600);
        eq('Edit opens the visible title',
            (await page.locator('#detail-title').textContent()).trim(), 'Watch Three');
        await closeDetail(page);

        // Only one timer may ever be running, however many times we re-render.
        await page.evaluate(() => {
            document.getElementById('library-filter').value = '';
            document.getElementById('library-filter').dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForTimeout(600);
        const before = (await heroTitle()).trim();
        await page.waitForTimeout(5600);
        const after = (await heroTitle()).trim();
        const idxBefore = await page.locator('.continue-dot.active').getAttribute('data-index');
        await page.waitForTimeout(5600);
        const idxAfter = await page.locator('.continue-dot.active').getAttribute('data-index');
        check('advances exactly one step per tick (no stacked timers)',
            before !== after && ((parseInt(idxAfter) - parseInt(idxBefore) + 3) % 3) === 1,
            `${idxBefore} → ${idxAfter}`);

        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();
    },

    'single continue item does not rotate': async (browser) => {
        const page = await newPage(browser, { library: [
            item({ id: 'only', title: 'Only One', status: 'watching' })] });
        eq('no dots for a single title', await page.locator('.continue-dot').count(), 0);
        const t = (await page.locator('#continue-hero .continue-hero-title').textContent()).trim();
        await page.waitForTimeout(5600);
        eq('stays put', (await page.locator('#continue-hero .continue-hero-title').textContent()).trim(), t);
        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();
    },

    'batched artwork backfill': async (browser) => {
        // Count the requests: five anime must resolve in ONE AniList call.
        let anilistCalls = 0, otherCalls = 0;
        const browserPage = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
        browserPage.errors = [];
        browserPage.on('pageerror', e => browserPage.errors.push(e.message));

        await browserPage.route('**/graphql.anilist.co/**', route => {
            anilistCalls++;
            const body = JSON.parse(route.request().postData() || '{}');
            // Answer every alias in the batched query with a poster.
            const aliases = [...String(body.query || '').matchAll(/(a\d+):\s*Media/g)].map(m => m[1]);
            const data = {};
            aliases.forEach((a, i) => {
                data[a] = { id: 100 + i, title: { english: `Anime ${i}`, romaji: null }, format: 'TV',
                    status: 'FINISHED', episodes: 12, duration: 24, averageScore: 80, genres: ['Action'],
                    description: '', startDate: { year: 2020 },
                    coverImage: { extraLarge: `https://example.test/a${i}.jpg`, large: null },
                    nextAiringEpisode: null };
            });
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
        });
        for (const pattern of ['**/api.jikan.moe/**', '**/kitsu.io/**', '**/itunes.apple.com/**', '**/en.wikipedia.org/**']) {
            await browserPage.route(pattern, route => { otherCalls++; return route.fulfill({ status: 404, body: '{}' }); });
        }
        await browserPage.route('**/.netlify/functions/**', route => route.fulfill({ status: 503, body: '{}' }));

        const noArt = [1, 2, 3, 4, 5].map(n => item({
            id: `n${n}`, title: `Anime Title ${n}`, category: 'anime-series', poster: null, posterTried: false }));
        await browserPage.addInitScript(seed(noArt, { artwork: true }));
        await browserPage.goto(BASE, { waitUntil: 'networkidle' });
        await browserPage.waitForTimeout(4000);

        const withPosters = await browserPage.evaluate(() =>
            JSON.parse(localStorage.getItem('watchvault_library')).filter(m => m.poster).length);
        eq('all five got artwork', withPosters, 5);
        eq('five titles cost ONE AniList request', anilistCalls, 1);
        eq('no per-title fallback requests needed', otherCalls, 0);

        const enriched = await browserPage.evaluate(() =>
            JSON.parse(localStorage.getItem('watchvault_library'))[0]);
        check('batch also fills runtime', enriched.runtime === 24, String(enriched.runtime));
        check('no page errors', browserPage.errors.length === 0, browserPage.errors.join('; '));
        await browserPage.close();
    },

    'airing schedule': async (browser) => {
        const soon = Math.floor(Date.now() / 1000) + 3600 * 30;   // ~tomorrow
        const later = Math.floor(Date.now() / 1000) + 3600 * 24 * 6;
        const past = Math.floor(Date.now() / 1000) - 3600;
        const page = await newPage(browser, { library: [
            item({ id: 's1', title: 'Airing Later', nextEpisode: { number: 9, season: 2, airingAt: later } }),
            item({ id: 's2', title: 'Airing Soon', nextEpisode: { number: 4, season: 1, airingAt: soon } }),
            item({ id: 's3', title: 'Stale Date', nextEpisode: { number: 1, airingAt: past } }),
            item({ id: 's4', title: 'Dropped Show', status: 'dropped',
                   nextEpisode: { number: 2, airingAt: soon } }),
        ]});

        const upcoming = await page.$$eval('#upcoming-list .upcoming-title', e => e.map(x => x.textContent.trim()));
        eq('soonest first, stale and dropped excluded', upcoming, ['Airing Soon', 'Airing Later']);
        const when = await page.$$eval('#upcoming-list .upcoming-when', e => e.map(x => x.textContent.trim()));
        check('shows a human air time', /Tomorrow|Today|·/.test(when[0] || ''), when.join(' | '));
        eq('shows the episode label',
            await page.$$eval('#upcoming-list .upcoming-ep', e => e.map(x => x.textContent.trim())),
            ['S1E4', 'S2E9']);
        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();
    },

    'runtime-based stats': async (browser) => {
        const page = await newPage(browser, { library: [
            // 10 episodes x 30 min = 5 h, plus a 120-min film = 2 h → 7 h
            item({ id: 'r1', title: 'Half Hour', runtime: 30, seasons: [{ number: 1, watched: 10, total: 10 }] }),
            item({ id: 'r2', title: 'Long Film', category: 'movie', status: 'completed', runtime: 120, seasons: [] }),
        ]});
        eq('hours use the real runtime', (await page.locator('#stat-hours').textContent()).trim(), '7');
        eq('episode count', (await page.locator('#stat-episodes').textContent()).trim(), '10');
        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();
    },

    'read-only enforcement': async (browser) => {
        const cloud = { library: LIB, saves: [] };
        const page = await newPage(browser, { cloud });
        await page.waitForTimeout(1200);

        check('read-only banner shown', await page.locator('#readonly-banner').isVisible());
        eq('quick-watch not rendered while locked', await page.locator('.card-quick-watch').count(), 0);
        check('Add Manually hidden', !(await page.locator('#manual-add-btn').isVisible()));

        await page.locator('.media-card').first().click();
        await page.waitForTimeout(500);
        check('save disabled', await page.locator('#detail-save-btn').isDisabled());
        const before = await page.locator('#detail-rating').getAttribute('data-value');
        await page.locator('#detail-rating .star[data-value="2"]').click();
        await page.waitForTimeout(250);
        eq('rating stars inert', await page.locator('#detail-rating').getAttribute('data-value'), before);
        await closeDetail(page);
        eq('nothing written to the cloud while locked', cloud.saves.length, 0);

        // Unlock, then confirm edits write through.
        await page.locator('#settings-btn').click();
        await page.waitForTimeout(400);
        await page.fill('#cloud-passcode', PASSCODE);
        await page.locator('#cloud-login-btn').click();
        await page.waitForTimeout(1500);
        await page.locator('#settings-cancel').click();
        await page.waitForTimeout(400);
        check('editing unlocked', !(await page.evaluate(() => document.body.classList.contains('read-only'))));

        await page.locator('.media-card').first().click();
        await page.waitForTimeout(500);
        await page.fill('#detail-notes', 'synced note');
        await page.locator('#detail-save-btn').click();
        await page.waitForTimeout(1500);
        check('edit pushed to the cloud',
            cloud.saves.length > 0 && cloud.saves.at(-1).some(m => m.notes === 'synced note'));
        check('artwork stripped from the cloud payload',
            cloud.saves.at(-1).every(m => !('poster' in m) && !('posterTried' in m)));
        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();
    },

    'passcode prompt on load': async (browser) => {
        const cloud = { library: LIB, saves: [] };
        const page = await newPage(browser, { cloud, prefs: { askPasscode: true } });
        await page.waitForTimeout(1500);
        check('prompt appears', await page.locator('#passcode-modal:not(.hidden)').count() > 0);

        await page.fill('#passcode-input', 'wrong');
        await page.locator('#passcode-submit').click();
        await page.waitForTimeout(900);
        check('wrong code keeps it open with an error',
            await page.locator('#passcode-modal:not(.hidden)').count() > 0
            && (await page.locator('#passcode-error').textContent()).trim().length > 0);

        await page.fill('#passcode-input', PASSCODE);
        await page.locator('#passcode-input').press('Enter');
        await page.waitForTimeout(1600);
        check('Enter with the right code unlocks',
            await page.locator('#passcode-modal.hidden').count() > 0
            && !(await page.evaluate(() => document.body.classList.contains('read-only'))));
        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();
    },

    'corrupted storage recovery': async (browser) => {
        const browserPage = await browser.newPage();
        browserPage.errors = [];
        browserPage.on('pageerror', e => browserPage.errors.push(e.message));
        await browserPage.addInitScript(`(() => {
            localStorage.setItem('watchvault_library', '{{{not json');
            localStorage.setItem('watchvault_library_backup_previous', ${JSON.stringify(JSON.stringify([LIB[0]]))});
            localStorage.setItem('watchvault_prefs', '{"autosync":false,"dailySync":false,"artwork":false,"askPasscode":false}');
            localStorage.setItem('lastAutoSyncDate', new Date().toDateString());
        })()`);
        await browserPage.goto(BASE, { waitUntil: 'networkidle' });
        await browserPage.waitForTimeout(1200);
        check('app still renders', await browserPage.locator('#screen-library.active').count() > 0);
        eq('recovered from the backup snapshot', await browserPage.locator('#media-grid .media-card').count(), 1);
        check('no uncaught errors', browserPage.errors.length === 0, browserPage.errors.join('; '));
        await browserPage.close();
    },

    'PWA installability': async (browser) => {
        const page = await newPage(browser);
        const manifest = await page.evaluate(async () => {
            const link = document.querySelector('link[rel="manifest"]');
            if (!link) return null;
            const res = await fetch(link.href);
            return res.ok ? res.json() : null;
        });
        check('manifest loads', Boolean(manifest));
        if (manifest) {
            eq('standalone display', manifest.display, 'standalone');
            check('has 192 and 512 icons',
                manifest.icons.some(i => i.sizes === '192x192') && manifest.icons.some(i => i.sizes === '512x512'));
            check('has a maskable icon', manifest.icons.some(i => (i.purpose || '').includes('maskable')));
        }
        const icons = await page.evaluate(async () => {
            const urls = ['./icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
            const out = {};
            for (const u of urls) out[u] = (await fetch(u)).ok;
            return out;
        });
        check('icon files are served', Object.values(icons).every(Boolean), JSON.stringify(icons));
        check('apple-touch-icon declared', await page.locator('link[rel="apple-touch-icon"]').count() > 0);
        const sw = await page.evaluate(() => navigator.serviceWorker?.getRegistration().then(r => Boolean(r)));
        check('service worker registered', sw === true);
        check('no page errors', page.errors.length === 0, page.errors.join('; '));
        await page.close();
    },

    'responsive layout': async (browser) => {
        for (const [name, width, height] of [['iPhone SE', 320, 568], ['iPhone 13 Pro Max', 428, 926], ['iPad mini', 768, 1024]]) {
            const page = await newPage(browser, { viewport: { width, height } });
            check(`${name}: no horizontal overflow`, await noOverflow(page));

            const small = await page.evaluate(() => {
                const out = [];
                document.querySelectorAll('input, select, textarea').forEach(el => {
                    if (['checkbox', 'radio', 'button', 'submit', 'file'].includes(el.type)) return;
                    if (getComputedStyle(el).display === 'none') return;
                    if (parseFloat(getComputedStyle(el).fontSize) < 16) out.push(el.id || el.tagName);
                });
                return out;
            });
            check(`${name}: no field under 16px (iOS zoom)`, small.length === 0, small.join(', '));

            await page.locator('.media-card').first().click();
            await page.waitForTimeout(500);
            check(`${name}: detail modal fits`, await noOverflow(page));
            await closeDetail(page);
            check(`${name}: no page errors`, page.errors.length === 0, page.errors.join('; '));
            await page.close();
        }
    },
};

// ── runner ───────────────────────────────────────────────────────
let executablePath = null;
for (const p of CHROME_PATHS) {
    try { const { existsSync } = await import('node:fs'); if (existsSync(p)) { executablePath = p; break; } } catch {}
}
if (!executablePath) {
    console.error('Could not find Chrome. Set CHROME_PATH to a Chrome/Chromium binary.');
    process.exit(2);
}

const browser = await chromium.launch({ executablePath, headless: !HEADED });
const started = Date.now();

for (const [name, fn] of Object.entries(SUITES)) {
    if (ONLY && !name.toLowerCase().includes(String(ONLY).toLowerCase())) continue;
    suite(name);
    try {
        await fn(browser);
    } catch (err) {
        check(`suite threw: ${err.message.split('\n')[0]}`, false);
    }
}

await browser.close();

const failed = results.filter(r => !r.pass);
const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${'─'.repeat(60)}`);
console.log(`${results.length - failed.length}/${results.length} checks passed in ${secs}s`);
if (failed.length) {
    console.log('\n\x1b[31mFailures:\x1b[0m');
    failed.forEach(f => console.log(`  • [${f.suite}] ${f.label}`));
}
process.exit(failed.length ? 1 : 0);
