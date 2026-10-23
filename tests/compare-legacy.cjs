// Optional local comparison. Requires the separately recovered legacy repository.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');

async function main() {
    assert(process.env.BOOKJS_LEGACY_ROOT, 'Set BOOKJS_LEGACY_ROOT to the original bookjs-eazy checkout containing reverse-engineering/bookjs-eazy');
    const legacy = path.resolve(process.env.BOOKJS_LEGACY_ROOT);
    const recovery = path.join(legacy, 'reverse-engineering/bookjs-eazy');
    const { cases, renderFixture } = await import(pathToFileURL(path.join(recovery, 'fixtures/cases.mjs')).href);
    const files = {
        recovered: path.join(recovery, 'recovered/deobfuscated.js'),
        rewrite: path.resolve(__dirname, '../bookjs-easy.js')
    };
    if (process.env.BOOKJS_BASELINE) files.baseline = path.resolve(process.env.BOOKJS_BASELINE);
    const scripts = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, file]) => [name, await fs.readFile(file)])));
    const vendors = Object.fromEntries(await Promise.all(['polyfill.min.js', 'jquery.min.js', 'lodash.min.js'].map(async name => [name, await fs.readFile(path.join(legacy, 'dist/static/js', name))])));
    const report = {
        scope: 'Local synthetic compatibility comparison; external requests blocked. Page counts and DOM structure need not be identical.',
        files: Object.fromEntries(Object.entries(scripts).map(([name, bytes]) => [name, { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }])),
        cases: []
    };
    const server = createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        const variant = url.searchParams.get('variant');
        const fixture = cases.find(item => url.pathname === '/fixture/' + item.name);
        const script = scripts[url.pathname.match(/^\/book\/(\w+)\/bookjs-eazy\.min\.js$/)?.[1]];
        const vendor = vendors[url.pathname.replace(/^\/vendor\//, '')];
        if (fixture && scripts[variant]) {
            let html = renderFixture(fixture, variant);
            if (variant !== 'recovered') html = html.replace('</head>', `<script>
                bookConfig.simplePageNum.pageBegin = 1;
                document.addEventListener('book.before-complete', event => fixtureEvents.push(event.detail));
            </script></head>`);
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(html);
        } else if (script || vendor) {
            response.writeHead(200, { 'Content-Type': 'application/javascript' });
            response.end(script || vendor);
        } else {
            response.writeHead(404);
            response.end();
        }
    });
    let browser;
    try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        const origin = `http://127.0.0.1:${server.address().port}`;
        const chrome = process.env.BOOKJS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        const installed = await fs.access(chrome).then(() => true, () => false);
        browser = await chromium.launch({ headless: true, ...(installed ? { executablePath: chrome } : {}) });
        report.browser = browser.version();
        for (const fixture of cases) {
            const result = { name: fixture.name, variants: {} };
            report.cases.push(result);
            for (const variant of Object.keys(scripts)) {
                const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
                const errors = [];
                const blocked = [];
                await context.addInitScript(() => { Math.random = () => 0.5; });
                await context.route('**/*', route => {
                    if (new URL(route.request().url()).origin === origin) return route.continue();
                    blocked.push(route.request().url());
                    return route.abort();
                });
                try {
                    const page = await context.newPage();
                    page.on('pageerror', error => errors.push(error.message));
                    page.on('dialog', dialog => { errors.push(dialog.message()); return dialog.dismiss(); });
                    await page.goto(`${origin}/fixture/${fixture.name}?variant=${variant}`);
                    if (fixture.deferred) {
                        await page.waitForTimeout(350);
                        assert.equal(await page.locator('.nop-page-item').count(), 0);
                        await page.evaluate(text => {
                            document.querySelector('.fixture-deferred').textContent = text;
                            bookConfig.start = true;
                        }, fixture.expected.deferredText);
                    }
                    await page.waitForFunction(() => window.status === 'PDFComplete', null, { timeout: 15000 });
                    const snapshot = await page.evaluate(selectors => {
                        const pages = [...document.querySelectorAll('.nop-page-item')];
                        const text = node => node.textContent.replace(/\s+/g, ' ').trim();
                        return {
                            pageCount: pages.length,
                            events: fixtureEvents.length,
                            blocks: [...document.querySelectorAll('.nop-page-item .fixture-block')].map(text),
                            fragments: Object.fromEntries(selectors.map(selector => [selector, pages.flatMap(page => [...page.querySelectorAll(selector)].map(node => node.textContent)).join('')])),
                            tableHeads: pages.flatMap(page => [...page.querySelectorAll('table thead')].map(head => [...head.querySelectorAll('th')].map(text).join(' '))),
                            catalog: [...document.querySelectorAll('.nop-page-item .fixture-catalog-link')].map(link => {
                                const target = document.getElementById(link.hash.slice(1));
                                const printed = target?.closest('.nop-page-item')?.querySelector('.fixture-page-number')?.textContent.match(/PAGE\s+(\d+)/)?.[1];
                                return { title: text(link).split(' / ')[0], validTarget: !!target && printed === link.getAttribute('data-page-number') };
                            }),
                            text: pages.map(text).join(' ')
                        };
                    }, (fixture.expected.textFragments || []).map(item => item.selector));
                    const failures = [];
                    const check = (condition, message) => { if (!condition) failures.push(message); };
                    check(errors.length === 0, 'uncaught browser errors');
                    check(blocked.length === 0, 'unexpected external requests');
                    check(snapshot.events === 1, 'one completion event');
                    const expected = fixture.expected;
                    if (expected.pageCount) check(snapshot.pageCount === expected.pageCount, 'page count');
                    if (expected.minPages) check(snapshot.pageCount >= expected.minPages, 'minimum page count');
                    if (expected.blocks) check(JSON.stringify(snapshot.blocks) === JSON.stringify(expected.blocks), 'block order');
                    for (const fragment of expected.textFragments || []) check(snapshot.fragments[fragment.selector].replace(/\s/g, '') === fragment.text.replace(/\s/g, ''), 'text conservation: ' + fragment.selector);
                    if (expected.table) check(snapshot.tableHeads.length === snapshot.pageCount && snapshot.tableHeads.every(head => head === 'ID 分组 内容'), 'repeated table headings');
                    if (expected.catalogTitles) {
                        check(JSON.stringify(snapshot.catalog.map(item => item.title)) === JSON.stringify(expected.catalogTitles), 'catalog titles');
                        check(snapshot.catalog.every(item => item.validTarget), 'catalog targets and printed page numbers');
                    }
                    if (expected.deferredText) check(snapshot.text.includes(expected.deferredText), 'deferred content');
                    result.variants[variant] = { pageCount: snapshot.pageCount, failures, errors, blocked, catalog: snapshot.catalog };
                } catch (error) {
                    result.variants[variant] = { failures: [error.message], errors, blocked };
                } finally {
                    await context.close();
                }
            }
            console.log(JSON.stringify(result));
        }
        assert(report.cases.every(item => ['recovered', 'rewrite'].every(variant => item.variants[variant].failures.length === 0)), 'Recovered/rewrite compatibility checks failed');
    } finally {
        await browser?.close();
        if (server.listening) await new Promise(resolve => server.close(resolve));
        await fs.mkdir(path.resolve(__dirname, '../test-results'), { recursive: true });
        await fs.writeFile(path.resolve(__dirname, '../test-results/legacy-comparison.json'), JSON.stringify(report, null, 2) + '\n');
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
