const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const script = path.resolve(process.env.BOOKJS_SCRIPT || path.join(__dirname, '..', 'bookjs-easy.js'));
const chrome = process.env.BOOKJS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseConfig = { start: false, pageSize: 'ISO_A5', padding: '300px 120px', simplePageNum: false, printDelay: 0 };
let browser;

before(async () => {
    browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
});
after(async () => { await browser?.close(); });

async function fixture(t, content, config = {}, css = '') {
    const context = await browser.newContext();
    t.after(() => context.close());
    await context.route(/^https?:/, route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<!doctype html><html><head><style>
        body { margin: 0; font-family: Arial, sans-serif; }
        p { margin: 0; font-size: 14px; line-height: 20px; }
        table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 12px; }
        th, td { border: 1px solid; padding: 2px; overflow-wrap: anywhere; }
        ${css}
    </style></head><body><div id="content-box" style="display:none">${content}</div></body></html>`);
    await page.evaluate(value => {
        window.bookConfig = value;
        window.events = [];
        for (const name of ['book.before-render', 'book.before-complete', 'book.after-complete', 'book.abort']) {
            document.addEventListener(name, event => events.push({ name, info: event.detail, rendered: !!window.BookJS?.instance?.isRendered }));
        }
    }, { ...baseConfig, ...config });
    await page.addScriptTag({ path: script });
    await page.waitForFunction(() => !!window.BookJS?.instance);
    return { page, errors };
}

async function render(page) {
    await page.evaluate(async () => { await BookJS.instance.render(); });
}

async function assertFits(page) {
    const overflow = await page.locator('.nop-page-content:not(.nop-measure-box)').evaluateAll(elements => elements.flatMap((element, index) => {
        const rect = element.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        const bounds = range.getBoundingClientRect();
        const vertical = bounds.bottom - rect.bottom;
        const horizontal = Math.max(bounds.right - rect.right, rect.left - bounds.left);
        return vertical > 2 || (bounds.width && horizontal > 2) ? [{ page: index + 1, vertical, horizontal }] : [];
    }));
    assert.deepEqual(overflow, [], 'all content must remain inside the printable region');
}

test('rich text is fragmented per page without losing Unicode, breaks or inline images', async t => {
    const text = '中文 A👨‍👩‍👧‍👦 é and English words '.repeat(30);
    const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const { page, errors } = await fixture(t, `<p data-op-type="text" class="rich">${text}<strong>粗体结尾</strong><br>最后一行<img src="${pixel}" width="12" height="12"></p>`);
    const expected = await page.locator('#content-box .rich').textContent();
    await render(page);
    const actual = await page.locator('.nop-book .rich').evaluateAll(items => ({ text: items.map(x => x.textContent).join(''), count: items.length }));
    assert.equal(actual.text, expected);
    assert.equal(await page.locator('.nop-book .rich img').count(), 1);
    assert.equal(await page.locator('.nop-book .rich br').count(), 1);
    assert.ok(actual.count <= await page.locator('.nop-page-item').count(), 'one paragraph fragment per page, not per line');
    assert.equal(await page.locator('.nop-text-chunk').count(), 0);
    await assertFits(page);
    assert.deepEqual(errors, []);
});

test('measurement inherits the same page typography as the rendered content', async t => {
    const content = Array.from({ length: 15 }, (_, i) => `<div class="metric">item ${i}</div>`).join('');
    const { page } = await fixture(t, content, {}, '.metric {font-size:24px;line-height:36px} .nop-book .metric {font-size:12px;line-height:18px}');
    await render(page);
    assert.equal(await page.locator('.nop-page-item').count(), 2);
    await assertFits(page);
});

test('custom paper, whitespace padding and boolean page numbers use one configuration', async t => {
    const { page } = await fixture(t, '<p>custom paper</p>', {
        pageSizeOption: { width: '100mm', height: '140mm' }, orientation: 'landscape', padding: '5mm \n 10mm\t5mm', simplePageNum: true
    });
    await render(page);
    const rect = await page.locator('.nop-page-item').first().boundingBox();
    assert.ok(Math.abs(rect.width - 140 * 96 / 25.4) < 0.1);
    assert.ok(Math.abs(rect.height - 100 * 96 / 25.4) < 0.1);
    const styles = await page.locator('#bookjs-print-styles').textContent();
    assert.match(styles, /size:\s*140mm 100mm/);
    assert.equal(await page.locator('.pendant-pageNumSimple').count(), 1);
});

test('an empty source waits for content and completes only after successful pagination', async t => {
    const { page, errors } = await fixture(t, '', { start: true });
    assert.equal(await page.evaluate(() => BookJS.instance.isRendered), false);
    assert.equal(await page.locator('.nop-page-item').count(), 0);
    await page.locator('#content-box').evaluate(el => { el.innerHTML = '<p>late content</p>'; });
    await page.waitForFunction(() => window.status === 'PDFComplete', null, { timeout: 3000 });
    assert.equal(await page.locator('.nop-book p').textContent(), 'late content');
    assert.deepEqual(await page.evaluate(() => events.map(x => x.name)), ['book.before-render', 'book.before-complete', 'book.after-complete']);
    assert.equal(await page.evaluate(() => events.at(-1).rendered), true);
    assert.deepEqual(errors, []);
});

test('source text and DOM changes rerender once; forced renders do not leak measurement nodes', async t => {
    const { page } = await fixture(t, '<p>before</p>', { start: true });
    await page.waitForFunction(() => BookJS.instance.isRendered);
    await page.locator('#content-box p').evaluate(el => { el.firstChild.data = 'after'; });
    await page.waitForFunction(() => document.querySelector('.nop-book p')?.textContent === 'after', null, { timeout: 2500 });
    await page.evaluate(async () => { for (let i = 0; i < 3; i++) await BookJS.instance.forceRender(); });
    assert.equal(await page.locator('.nop-book').count(), 1);
    assert.equal(await page.locator('.nop-measure-box').count(), 0);
    assert.equal(await page.locator('.nop-book p').textContent(), 'after');
    await page.locator('#content-box').evaluate(el => { el.replaceChildren(); });
    await page.waitForFunction(() => !document.querySelector('.nop-book'));
    assert.notEqual(await page.evaluate(() => window.status), 'PDFComplete');
    await page.locator('#content-box').evaluate(el => { el.innerHTML = '<p>restored</p>'; });
    await page.waitForFunction(() => document.querySelector('.nop-book p')?.textContent === 'restored');
    await page.evaluate(() => BookJS.instance.cleanup());
    await page.locator('#content-box p').evaluate(el => { el.textContent = 'stopped'; });
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.nop-book p').textContent(), 'restored');
});

test('page numbering does not depend on headers and new headers inherit after a clear', async t => {
    const { page } = await fixture(t, `
        <p>one</p><div data-op-type="new-page"></div>
        <div data-op-type="pendants"><div class="header">OLD</div></div>
        <div data-op-type="pendants"></div>
        <div data-op-type="pendants"><div class="header">NEW \${PAGE}/\${TOTAL_PAGE}</div></div>
        <p>two</p><div data-op-type="new-page"></div><p>three</p>
    `, { simplePageNum: { enable: true } });
    await render(page);
    assert.equal(await page.locator('.pendant-pageNumSimple').count(), 3);
    assert.deepEqual(await page.locator('.nop-book .header').allTextContents(), ['NEW 2/3', 'NEW 3/3']);
});

for (const type of ['text-box', 'block-box', 'mix-box']) {
    test(`${type} preserves its shell and all fill content across pages`, async t => {
        const contents = type === 'text-box' ? '连续内容 👩‍💻。\n'.repeat(120)
            : Array.from({ length: 10 }, (_, i) => `<p style="height:45px" data-op-type="block">block ${i}</p>`).join('');
        const { page } = await fixture(t, `<section data-op-type="${type}" class="frame"><header>repeated shell</header><div class="nop-fill-box">${contents}</div></section>`, {}, '.frame{border:1px solid;padding:4px} .frame header{height:20px} .nop-fill-box{white-space:pre-wrap;font-size:12px;line-height:16px}');
        const expected = await page.locator('#content-box .nop-fill-box').textContent();
        await render(page);
        assert.equal(await page.locator('.nop-book .nop-fill-box').evaluateAll(items => items.map(x => x.textContent).join('')), expected);
        const pages = await page.locator('.nop-page-item').count();
        assert.ok(pages > 1);
        assert.equal(await page.locator('.nop-book .frame').count(), pages);
        assert.equal(await page.locator('.nop-book .frame > header').count(), pages);
        await assertFits(page);
    });
}

test('oversized mixed blocks retain direct text nodes and nested markup', async t => {
    const { page } = await fixture(t, `<section class="mixed">PREFIX <strong>STRONG</strong>${'<p data-op-type="text">long nested text '.repeat(1)}${'paragraph '.repeat(220)}</p> SUFFIX</section>`);
    const expected = await page.locator('#content-box .mixed').textContent();
    await render(page);
    assert.equal(await page.locator('.nop-book .mixed').evaluateAll(items => items.map(x => x.textContent).join('')), expected);
    await assertFits(page);
});

test('staggered rowspan and colspan retain their logical columns after a page break', async t => {
    const { page } = await fixture(t, `<table data-op-type="table" data-split-strategy="precise">
        <thead><tr><th colspan="4">header</th></tr></thead><tbody>
        <tr><td rowspan="4" data-split-repeat="true">A</td><td>B0</td><td colspan="2">C0</td></tr>
        <tr><td rowspan="4" data-split-repeat="true">B</td><td>C1</td><td>D1</td></tr>
        <tr><td colspan="2">C2</td></tr><tr><td>C3</td><td>D3</td></tr>
        <tr><td>A4</td><td>C4</td><td>D4</td></tr><tr><td>A5</td><td>B5</td><td>C5</td><td>D5</td></tr>
        </tbody></table>`, {}, 'tbody tr{height:60px}');
    await render(page);
    const widths = await page.locator('.nop-book tbody').evaluateAll(bodies => bodies.flatMap(body => {
        const grid = [];
        for (const [r, row] of [...body.rows].entries()) {
            grid[r] ||= [];
            let c = 0;
            for (const cell of row.cells) {
                while (grid[r][c]) c++;
                for (let y = 0; y < cell.rowSpan; y++) {
                    grid[r + y] ||= [];
                    for (let x = 0; x < cell.colSpan; x++) grid[r + y][c + x] = true;
                }
                c += cell.colSpan;
            }
        }
        return grid.map(row => row.filter(Boolean).length);
    }));
    assert.ok(widths.length >= 6);
    assert.ok(widths.every(width => width === 4), JSON.stringify(widths));
    await assertFits(page);
});

test('multiple tbody sections and rowspan=0 do not duplicate or drop cells', async t => {
    const rows = prefix => Array.from({ length: 7 }, (_, i) => `<tr>${i === 0 ? '<td rowspan="0" data-split-repeat="true">group</td>' : ''}<td class="value">${prefix}${i}</td></tr>`).join('');
    const { page } = await fixture(t, `<table data-op-type="table"><thead><tr><th colspan="2">header</th></tr></thead><tbody>${rows('A')}</tbody><tbody>${rows('B')}</tbody></table>`, {}, 'tbody tr{height:40px}');
    await render(page);
    assert.deepEqual(await page.locator('.nop-book td.value').allTextContents(), [...Array(7)].map((_, i) => `A${i}`).concat([...Array(7)].map((_, i) => `B${i}`)));
    await assertFits(page);
});

test('a row taller than a page splits cell contents instead of clipping them', async t => {
    const text = 'long-cell 中文 🧪 '.repeat(140);
    const { page } = await fixture(t, `<h1 style="margin:0;font-size:18px;line-height:24px">Table title</h1><table data-op-type="table"><thead><tr><th>label</th><th>content</th></tr></thead><tbody><tr><td data-split-repeat="true">R1</td><td class="long"><p>${text}</p></td></tr></tbody></table>`);
    await render(page);
    assert.equal((await page.locator('.nop-book td.long').allTextContents()).join(''), text);
    assert.ok(await page.locator('.nop-page-item').count() > 1);
    assert.equal(await page.locator('.nop-page-item').first().locator('table').count(), 1);
    await assertFits(page);
});

test('a nested table paginates inside its repeated container', async t => {
    const rows = Array.from({ length: 10 }, (_, i) => `<tr><td>nested ${i}</td></tr>`).join('');
    const { page } = await fixture(t, `<section class="outer" data-op-type="mix-box"><header>shell</header><div class="nop-fill-box"><table><tbody>${rows}</tbody></table></div></section>`, {}, '.outer{padding:10px;border:1px solid} .outer header{height:20px} tbody tr{height:45px}');
    await render(page);
    assert.deepEqual(await page.locator('.nop-book .outer table td').allTextContents(), Array.from({ length: 10 }, (_, i) => `nested ${i}`));
    assert.equal(await page.locator('.nop-book .outer').count(), await page.locator('.nop-page-item').count());
    await assertFits(page);
});

test('no-split groups stay on the current page when the complete group fits', async t => {
    const { page } = await fixture(t, '<div style="height:60px">before table</div><table data-op-type="table"><thead><tr><th>head</th></tr></thead><tbody><tr class="no-split"><td rowspan="2">group</td></tr><tr></tr></tbody></table>', {}, 'thead tr{height:20px} tbody tr{height:50px}');
    await render(page);
    assert.equal(await page.locator('.nop-page-item').count(), 1);
    await assertFits(page);
});

test('images finish loading before layout and render requests during loading are coalesced', async t => {
    const { page } = await fixture(t, '<p>image follows</p>');
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('https://assets.test/delayed.svg', async route => {
        await held;
        await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="160"><rect width="200" height="160" fill="navy"/></svg>' });
    });
    await page.locator('#content-box').evaluate(el => { el.insertAdjacentHTML('beforeend', '<img src="https://assets.test/delayed.svg">'); });
    await page.evaluate(() => { window.pendingRender = BookJS.instance.render(); });
    await page.waitForFunction(() => !!document.querySelector('.nop-measure-box img'));
    assert.equal(await page.evaluate(() => BookJS.instance.isRendered), false);
    await page.evaluate(() => { BookJS.instance.forceRender(); BookJS.instance.forceRender(); });
    release();
    await page.evaluate(() => pendingRender);
    assert.equal(await page.locator('.nop-book img').count(), 1);
    assert.equal(await page.evaluate(() => document.querySelector('.nop-book img').naturalHeight), 160);
    assert.equal(await page.evaluate(() => window.status), 'PDFComplete');
    assert.equal(await page.locator('.nop-measure-box').count(), 0);
    assert.ok((await page.evaluate(() => events.filter(x => x.name === 'book.after-complete').length)) <= 2);
    await assertFits(page);
});

test('an unsplittable block rejects rendering without a success event or PDFComplete', async t => {
    const { page } = await fixture(t, '<div style="height:900px"></div>');
    const error = await page.evaluate(async () => {
        try { await BookJS.instance.render(); } catch (error) { return error.message; }
    });
    assert.match(error, /exceeds the page height/);
    assert.equal(await page.evaluate(() => BookJS.instance.isRendered), false);
    assert.notEqual(await page.evaluate(() => window.status), 'PDFComplete');
    assert.deepEqual(await page.evaluate(() => events.map(x => x.name)), ['book.before-render', 'book.abort']);
    assert.equal(await page.locator('.nop-book, .nop-measure-box').count(), 0);
});

test('an explicit instance keeps its own content selector and updates print dimensions on rerender', async t => {
    const { page } = await fixture(t, '<p>global source</p>');
    await page.evaluate(async () => {
        const source = document.createElement('div');
        source.id = 'custom-source';
        source.innerHTML = '<p>instance source</p>';
        document.body.appendChild(source);
        window.localConfig = { contentBox: source, pageSizeOption: { width: '300px', height: '220px' }, padding: '10px', simplePageNum: false };
        await BookJS.create(localConfig).render();
    });
    assert.equal(await page.locator('.nop-book p').textContent(), 'instance source');
    assert.equal((await page.locator('.nop-page-item').boundingBox()).width, 300);
    await page.evaluate(async () => { localConfig.orientation = 'landscape'; await BookJS.instance.forceRender(); });
    assert.equal((await page.locator('.nop-page-item').boundingBox()).width, 220);
    assert.match(await page.locator('#bookjs-print-styles').textContent(), /size:\s*220px 300px/);
});

test('cleanup cancels a queued render before it can publish completion', async t => {
    const { page } = await fixture(t, '<p>cancelled</p>');
    const error = await page.evaluate(async () => {
        const pending = BookJS.instance.render();
        BookJS.instance.cleanup();
        try { await pending; } catch (error) { return error.name; }
    });
    assert.equal(error, 'AbortError');
    assert.equal(await page.locator('.nop-book').count(), 0);
    assert.notEqual(await page.evaluate(() => window.status), 'PDFComplete');
    assert.deepEqual(await page.evaluate(() => events.map(x => x.name)), []);
});

test('a heading stays with a splittable row that would fit on a fresh page', async t => {
    const { page } = await fixture(t, `<h1 style="margin:0;font-size:18px;line-height:40px">Title</h1><table data-op-type="table"><thead><tr><th>header</th></tr></thead><tbody><tr><td><p>${'     ' + '0'.repeat(300)}</p></td></tr></tbody></table>`, {}, 'table{border-collapse:separate;border-spacing:2px}');
    await render(page);
    assert.equal(await page.locator('.nop-page-item').first().locator('h1').count(), 1);
    assert.equal(await page.locator('.nop-page-item').first().locator('table').count(), 1);
    await assertFits(page);
});
