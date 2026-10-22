/* Genuine Electron renderer/preload/IPC. Private synthetic candidates are read
 * from this profile's synthetic HTML cache; no public page or source is changed. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { Store } = require('../dist/main/main/store');
const { parseProduct } = require('../dist/main/main/online');
const { MATCH_RULE_VERSION } = require('../dist/main/main/matching');
const repo = path.resolve(__dirname, '..'), guid = crypto.randomUUID(), startedAt = Date.now();
const runDir = fs.mkdtempSync(path.resolve(repo, '../ui-review-header-'));
const source = path.join(runDir, 'Private Review Sources'), profile = path.join(runDir, 'Private Library');
const checks = [], screenshots = [], renderErrors = [], fixtures = [], measurements = [], controlLabels = {};
const packaged = !!process.env.VRC_TEST_APP_EXECUTABLE;
const matrixLanguages = packaged ? ['zh-CN', 'en', 'ja'] : ['zh-CN'];
const matrixThemes = packaged ? ['x', 'x-light', 'nasa', 'swiss'] : ['x'];
let app, page, phase = 'private fixture setup';
fs.mkdirSync(source); fs.mkdirSync(profile); fs.mkdirSync(path.join(profile, 'cache'));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const store = new Store(profile, [source]);
store.saveSettings({ onlineEnabled: true, theme: 'x', language: 'zh-CN', xThemeIntroduced: true, reviewSort: 'name' });
for (let index = 0; index < 24; index++) {
  const name = 'Header QA ' + String(index).padStart(2, '0'), file = path.join(source, name + '.zip');
  fs.writeFileSync(file, 'READ ONLY header acceptance ' + guid + ' ' + index);
  const asset = store.upsertScan({ path: file, name, kind: 'archive', group: 'Private header fixture', size: fs.statSync(file).size,
    mtimeMs: Date.UTC(2025, 0, index + 1), localCategory: '服装', localAvatars: ['Airi', 'Shinra', 'Moe', 'QA long avatar label ' + index], hintUrls: [] });
  const candidates = [0, 1].map(choice => {
    const url = `https://review-header.example.org/products/${guid}/${index}/${choice}`, title = name + ' candidate ' + choice;
    const html = '<!doctype html><title>' + title + '</title><script type="application/ld+json">' + JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Product', url, name: title, brand: { name: 'Private QA Creator' },
      category: '服装', description: 'Private synthetic cached product ' + guid
    }) + '</script><h1>' + title + '</h1>';
    assert.equal(parseProduct(html, url).title, title, 'The synthetic cache must be a real parseable product');
    fs.writeFileSync(path.join(profile, 'cache', 'page-' + digest(url) + '.json'), JSON.stringify({ at: Date.now(), url, html }));
    return { url, title, author: 'Private QA Creator' };
  });
  store.updateOnline(asset.id, { status: 'review', candidates, matchingCheckedVersion: MATCH_RULE_VERSION, message: 'Private synthetic review candidates' });
  store.updateManual([asset.id], { notes: 'KEEP NOTES ' + index, tags: ['KEEP ' + guid], favorite: true });
  fixtures.push({ id: asset.id, name, path: file, candidates });
}
store.close();
const beforeSources = Object.fromEntries(fixtures.map(fixture => [fixture.path, digest(fs.readFileSync(fixture.path))]));
const allIds = fixtures.map(fixture => fixture.id);
function pass(label) { checks.push(label); console.log('REVIEW HEADER PASS:', label); }
async function wait(check, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 75)); }
  throw new Error(message);
}
const review = () => page.locator('section.review-page');
const row = id => review().locator(`[data-asset-id="${id}"]`);
const toggle = () => page.locator('button[data-review-header-toggle]');
const host = () => page.locator('main.review-workspace.review-header-unpinned, main.review-workspace.review-header-pinned section.review-page');
const sort = () => review().locator('.review-sort-label select');
async function order() {
  return review().locator('.review-row').evaluateAll(rows => rows.map(element => ({ id: element.dataset.assetId,
    candidates: [...element.querySelectorAll('[data-candidate-url]')].map(candidate => candidate.dataset.candidateUrl) })));
}
async function ids() { return (await order()).map(entry => entry.id); }
async function expectRows(expected, message) {
  await wait(async () => await review().locator('.review-list').getAttribute('aria-busy') === 'false' && JSON.stringify(await ids()) === JSON.stringify(expected), message);
}
async function settle() {
  let previous, stable = 0;
  await wait(async () => {
    const current = await host().evaluate(element => {
      const header = document.querySelector('.workspace-header'), first = element.querySelector('.review-row');
      return JSON.stringify([element.className, element.scrollTop, element.clientHeight, element.scrollHeight,
        header?.getBoundingClientRect().top, header?.getBoundingClientRect().bottom, first?.getBoundingClientRect().top]);
    });
    stable = current === previous ? stable + 1 : 0; previous = current; return stable >= 2;
  }, 'Review layout did not settle');
}
async function expand(id, selector) {
  const details = row(id).locator(selector);
  if (!await details.evaluate(element => element.open)) await details.locator(':scope > summary').click();
  assert.equal(await details.evaluate(element => element.open), true); return details;
}
async function assertCompact(id) {
  const local = row(id).locator('.review-local-area'), details = local.locator('details.review-local-details'), tools = local.locator('details.review-source-tools');
  assert.equal(await review().locator('.review-local-adaptation').count(), 0, 'Review must not render local-avatar tag strings');
  assert.equal(await details.evaluate(element => element.open), false); assert.equal(await tools.evaluate(element => element.open), false);
  assert.equal(await local.locator('.review-local-path').getAttribute('title'), fixtures.find(fixture => fixture.id === id).path);
  const initial = await local.boundingBox(), candidates = await order();
  await expand(id, 'details.review-local-details'); assert.equal(await local.locator('.review-local-times').isVisible(), true);
  assert.equal(await local.locator('.review-full-path').innerText(), fixtures.find(fixture => fixture.id === id).path);
  await expand(id, 'details.review-source-tools');
  const input = local.locator('.review-source-entry input'); await input.fill('private retained draft');
  const expanded = await local.boundingBox(); assert(expanded.height > initial.height + 40, 'Collapsing local metadata and source tools must reclaim actual row height');
  await tools.locator(':scope > summary').click(); await expand(id, 'details.review-source-tools');
  assert.equal(await input.inputValue(), 'private retained draft', 'Collapsing source tools must retain the mounted draft');
  await tools.locator(':scope > summary').click(); await details.locator(':scope > summary').click();
  assert.deepEqual(await order(), candidates, 'Expanding local details must not change candidate order');
  const button = local.locator('[data-review-action="skip"]'); await button.scrollIntoViewIfNeeded();
  const visual = await button.evaluate(element => {
    const rect = element.getBoundingClientRect(), actions = element.parentElement.getBoundingClientRect(), style = getComputedStyle(element);
    const otherTops = [...element.parentElement.querySelectorAll('button')].filter(button => button !== element).map(button => button.getBoundingClientRect().top);
    const rgb = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = value => rgb(value).map(channel => { const normalized = channel / 255; return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4; }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const foreground = lum(style.color), background = lum(style.backgroundColor);
    return { width: rect.width, available: actions.width, height: rect.height, top: rect.top, otherTops,
      weight: Number(style.fontWeight), background: style.backgroundColor, contrast: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) };
  });
  assert(visual.height >= 40 && visual.width >= visual.available - 3, 'Skip must be a full-width, easy-to-hit action');
  assert(visual.otherTops.every(top => visual.top <= top), 'Skip must be visually ahead of secondary local actions');
  assert(visual.weight >= 600 && visual.contrast >= 4.5 && !['transparent', 'rgba(0, 0, 0, 0)'].includes(visual.background), 'The prominent Skip action must retain readable contrast');
  assert.equal(await local.locator('.review-booth-search').isVisible(), true);
  assert(await local.locator('.review-booth-search').getAttribute('title'), 'BOOTH guidance should remain available as a tooltip');
  measurements.push({ label: 'compact-local-column', collapsedHeight: initial.height, expandedHeight: expanded.height, skip: visual });
}
async function assertControl() {
  const state = await toggle().evaluate(element => {
    const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { visible: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      hit: !!hit && (element === hit || element.contains(hit)), label: element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent.trim() };
  });
  assert(state.visible && state.hit, 'The pin control must remain visible and clickable at the current scroll position');
  assert(state.label, 'The pin control needs an accessible label'); return state.label;
}
async function setPinned(value) {
  if ((await toggle().getAttribute('aria-pressed')) !== String(value)) await toggle().click();
  await wait(async () => await toggle().getAttribute('aria-pressed') === String(value) &&
    ((await page.evaluate(() => window.library.snapshot())).settings.reviewHeaderPinned ?? false) === value,
  'The pin preference did not save through the real IPC');
  await page.locator('main.review-workspace.review-header-' + (value ? 'pinned' : 'unpinned')).waitFor(); await settle();
}
async function assertKeyboardToggle() {
  await setPinned(false); await top(); await deepScroll();
  const ordering = await order(), original = await anchor([]);
  await toggle().focus(); await page.keyboard.press('Space');
  await wait(async () => await toggle().getAttribute('aria-pressed') === 'true' &&
    (await page.evaluate(() => window.library.snapshot())).settings.reviewHeaderPinned === true, 'Space did not pin and save the Review header');
  await expectAnchor(original, 'Keyboard pinning shifted the visible material');
  assert.equal(await toggle().evaluate(element => document.activeElement === element), true);
  const pinned = await anchor([]); await page.keyboard.press('Enter');
  await wait(async () => await toggle().getAttribute('aria-pressed') === 'false' &&
    (await page.evaluate(() => window.library.snapshot())).settings.reviewHeaderPinned === false, 'Enter did not unpin and save the Review header');
  await expectAnchor(pinned, 'Keyboard unpinning shifted the visible material');
  assert.equal(await toggle().evaluate(element => document.activeElement === element), true);
  assert.deepEqual(await order(), ordering); await assertControl();
}
async function assertCompactLanguage(language) {
  const expected = {
    'zh-CN': ['本地信息与文件 · 1 份', '手动填写商品来源', '跳过后移到“手动归类”，可稍后继续整理。'],
    en: ['Local details and files · 1', 'Enter product source manually', 'Skipping moves this material to Manual organization, where you can organize it later.'],
    ja: ['ローカル情報とファイル · 1 件', '商品の出典を手入力', 'スキップすると「手動整理」に移動し、後で整理を続けられます。']
  }[language];
  const first = review().locator('.review-row').first();
  assert.equal(await first.locator('details.review-local-details > summary').innerText(), expected[0]);
  assert.equal(await first.locator('details.review-source-tools > summary').innerText(), expected[1]);
  assert.equal(await first.locator('[data-review-action="skip"]').getAttribute('title'), expected[2]);
}
async function top() { await host().evaluate(element => { element.scrollTop = 0; }); await settle(); }
async function deepScroll() {
  const bounds = await host().boundingBox(); assert(bounds && bounds.height > 60, 'Review needs a usable scroll viewport');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + Math.min(bounds.height - 20, Math.max(30, bounds.height / 2)));
  await page.mouse.wheel(0, 1600);
  await wait(async () => await host().evaluate(element => element.scrollTop) > 500, 'Wheel input did not move the active Review scroll container'); await settle();
}
async function headerGeometry() {
  return page.locator('main.review-workspace').evaluate(element => {
    const viewport = element.getBoundingClientRect(), header = element.querySelector('.workspace-header').getBoundingClientRect();
    return { viewportTop: viewport.top, headerTop: header.top, headerBottom: header.bottom, headerHeight: header.height,
      pieces: ['.topbar', '.filter-area', '.network-panel'].map(selector => {
        const node = element.querySelector('.workspace-header ' + selector); if (!node) return { selector, missing: true };
        const rect = node.getBoundingClientRect(); return { selector, top: rect.top, bottom: rect.bottom };
      }) };
  });
}
async function assertLayout(pinned, label) {
  await setPinned(pinned); await top(); const before = await headerGeometry(), ordering = await order();
  assert.equal(before.pieces.filter(piece => piece.missing).length, 0, 'The global header, filters and network summary must be present');
  await deepScroll(); const after = await headerGeometry(); await assertControl();
  if (pinned) {
    assert(Math.abs(before.headerTop - after.headerTop) < 2 && Math.abs(before.headerBottom - after.headerBottom) < 2,
      'Pinned header geometry must stay fixed while the Review page scrolls');
    assert(after.headerHeight <= (await page.evaluate(() => innerHeight)) * .45 + 2 || (await page.evaluate(() => innerWidth)) > 980,
      'The narrow pinned header must leave space for review content');
  } else {
    assert(after.pieces.every(piece => piece.bottom <= after.viewportTop + 2), 'Unlocked topbar, search/filter and network must scroll completely out of view');
  }
  assert.deepEqual(await order(), ordering, 'Scrolling must not reorder candidate rows');
  measurements.push({ label, pinned, before, after });
}
async function capture(name) {
  const file = path.join(runDir, name + '.png');
  const bytes = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('/renderer/index.html'));
    await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    return (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  }); fs.writeFileSync(file, Buffer.from(bytes, 'base64')); screenshots.push(file);
}
async function launch() {
  const env = { ...process.env, VRC_LIBRARY_DATA_DIR: profile, VRC_LIBRARY_ROOT: source, VRC_LIBRARY_LOCATION_FILE: path.join(runDir, 'private-location.json'),
    VRC_LIBRARY_NO_NETWORK: '1', VRC_LIBRARY_NO_AUTOSCAN: '1', VRC_LIBRARY_NO_RELAUNCH: '1', VRC_LIBRARY_TEST_HIDDEN: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: process.env.VRC_TEST_APP_EXECUTABLE || require('electron'), args: packaged ? [] : [repo], env });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => renderErrors.push(error.stack || error.message));
  await page.locator('.asset-card').first().waitFor();
  await app.evaluate(({ net, BrowserWindow }) => {
    const original = net.fetch.bind(net); globalThis.__headerUnexpectedFetches = [];
    net.fetch = async (raw, init) => {
      if (String(raw).startsWith('file:')) return original(raw, init);
      globalThis.__headerUnexpectedFetches.push(String(raw)); throw new Error('Private Review header acceptance blocks every public fetch');
    };
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
  });
}
async function close() {
  if (!app) return;
  assert.deepEqual(await app.evaluate(() => globalThis.__headerUnexpectedFetches), [], 'No public fetch should be needed for private cached candidates');
  await app.close(); app = undefined;
}
async function enterReview() {
  await page.locator('.sidebar .nav-item').filter({ hasText: '匹配确认' }).click(); await review().waitFor(); await toggle().waitFor();
  await wait(async () => await review().locator('.review-list').getAttribute('aria-busy') === 'false', 'Review did not settle');
}
async function anchor(excluded) {
  return host().evaluate((element, omitted) => {
    const rect = element.getBoundingClientRect();
    const visible = [...element.querySelectorAll('.review-row')].find(item => !omitted.includes(item.dataset.assetId) &&
      item.getBoundingClientRect().bottom > rect.top + 1 && item.getBoundingClientRect().top < rect.bottom - 1);
    if (!visible) throw new Error('No surviving visible Review anchor was available');
    return { id: visible.dataset.assetId, offset: visible.getBoundingClientRect().top - rect.top };
  }, excluded);
}
async function expectAnchor(saved, message) {
  await settle(); const offset = await host().evaluate((element, id) => element.querySelector(`[data-asset-id="${id}"]`).getBoundingClientRect().top - element.getBoundingClientRect().top, saved.id);
  assert(Math.abs(offset - saved.offset) < 6, `${message}: ${offset} vs ${saved.offset}`);
}
function report(ok, error) { return { ok, phase, error, checks, renderErrors, measurements, controlLabels, screenshots, runDir, source, profile, packaged, executablePath: process.env.VRC_TEST_APP_EXECUTABLE || require('electron'),
  languageThemeMatrix: { languages: matrixLanguages, themes: matrixThemes },
  genuineRendererPreloadIPC: true, syntheticCachedProducts: true, durationMs: Date.now() - startedAt }; }

(async () => {
  await launch(); await enterReview(); await expectRows(allIds.slice(0, 10), 'Initial Review page must follow its saved name order');
  assert.notEqual((await page.evaluate(() => window.library.snapshot())).settings.reviewHeaderPinned, true, 'New profiles must start unlocked');
  assert.equal(await toggle().getAttribute('aria-pressed'), 'false');
  phase = 'compact local information and prominent skip';
  await assertCompact(allIds[0]); await capture('review-compact-local-and-prominent-skip');
  pass('local-avatar-labels-removed-collapsed-details-and-source-draft-preserved-full-width-readable-skip');
  phase = 'default unlocked scrolling and pin migration';
  await assertLayout(false, 'default-unlocked'); await capture('review-header-unlocked-scrolled-zh-CN-x');
  const beforeToggle = await order(); await setPinned(true); assert.deepEqual(await order(), beforeToggle);
  await assertLayout(true, 'initial-pinned'); await capture('review-header-pinned-scrolled-zh-CN-x');
  await setPinned(false); assert.deepEqual(await order(), beforeToggle); await assertControl();
  pass('default-unlocked-header-scrolls-away-floating-pin-stays-usable-and-toggling-preserves-row-candidate-order');

  phase = 'unlocked skip preserves actual scroll host anchor';
  const skipId = allIds[4], skip = row(skipId).locator('[data-review-action="skip"]');
  await skip.scrollIntoViewIfNeeded(); await settle(); const skippedAnchor = await anchor([skipId]);
  await skip.click(); const afterSkip = allIds.slice(0, 10).filter(id => id !== skipId);
  await expectRows(afterSkip, 'Skipping must remove just that row without refill or reorder');
  await expectAnchor(skippedAnchor, 'Skipping shifted the unlocked visible anchor');
  assert.equal((await page.evaluate(id => window.library.get(id), skipId)).manual.matchingMode, 'manual');
  pass('real-skip-keeps-unlocked-scroll-anchor-and-remaining-page-order');

  phase = 'pinned real candidate confirmation preserves anchor';
  await setPinned(true); await page.evaluate(() => window.library.resumeEnrichment());
  const confirmId = allIds[6], accept = row(confirmId).locator('[data-review-action="accept"]').first();
  await accept.scrollIntoViewIfNeeded(); await settle(); const confirmedAnchor = await anchor([confirmId]);
  await accept.click();
  await wait(async () => (await page.evaluate(id => window.library.get(id), confirmId)).online.status === 'matched', 'The private cached product did not complete real confirmation');
  const remainingBatch = afterSkip.filter(id => id !== confirmId); await expectRows(remainingBatch, 'Confirmation must remove just the completed row');
  await expectAnchor(confirmedAnchor, 'Confirmation shifted the pinned visible anchor');
  pass('real-candidate-confirmation-through-preload-ipc-and-cache-keeps-pinned-scroll-anchor');

  phase = 'pagination and refresh on the correct scroll host';
  await review().locator('.review-pagination button').nth(1).click(); await expectRows(allIds.slice(10, 20), 'The next batch must not lose rows after local removals');
  assert(await host().evaluate(element => element.scrollTop) < 3, 'Changing page must reset the active Review host');
  await review().locator('.review-pagination button').nth(0).click(); await expectRows(remainingBatch, 'Returning to the first batch must retain its removals');
  await review().locator('.review-toolbar-actions > button').first().click();
  await expectRows(allIds.filter(id => id !== skipId && id !== confirmId).slice(0, 10), 'Explicit refresh must rebuild the current order from page one');
  assert(await host().evaluate(element => element.scrollTop) < 3, 'Explicit refresh must reset the active Review host');
  pass('pagination-and-explicit-refresh-use-the-active-host-without-gaps-or-surprise-refill');

  phase = 'saved pinned preference survives restart';
  await setPinned(true); await close(); await launch(); await enterReview();
  assert.equal((await page.evaluate(() => window.library.snapshot())).settings.reviewHeaderPinned, true);
  assert.equal(await toggle().getAttribute('aria-pressed'), 'true'); await assertLayout(true, 'after-restart');
  pass('pinned-preference-survives-real-application-restart');

  phase = 'three languages and four themes';
  for (const language of matrixLanguages) for (const theme of matrixThemes) {
    await page.evaluate(value => window.library.setViewPreferences(value), { language, theme });
    await page.waitForFunction(value => document.documentElement.lang === value.language && document.documentElement.dataset.theme === value.theme, { language, theme });
    await assertCompactLanguage(language);
    const ordering = await order(); await assertLayout(false, language + '-' + theme + '-unlocked');
    const unlockedLabel = await assertControl(); await assertLayout(true, language + '-' + theme + '-pinned');
    controlLabels[language] = { unlocked: unlockedLabel, pinned: await assertControl() };
    assert.deepEqual(await order(), ordering); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await capture('review-header-' + language + '-' + theme);
  }
  assert.equal(new Set(Object.values(controlLabels).map(value => value.unlocked)).size, matrixLanguages.length, 'Pin action labels must localize in each tested language');
  assert.equal(new Set(Object.values(controlLabels).map(value => value.pinned)).size, matrixLanguages.length, 'Unpin action labels must localize in each tested language');
  pass(packaged ? 'both-header-modes-and-floating-control-work-in-all-twelve-language-theme-combinations' : 'both-header-modes-and-floating-control-pass-Chinese-source-behavior-check');

  phase = '980px window and 200 percent';
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 800));
  await page.evaluate(() => window.library.setZoom(2));
  for (const language of matrixLanguages) {
    await page.evaluate(value => window.library.setViewPreferences(value), { language, theme: 'x' });
    await page.waitForFunction(value => document.documentElement.lang === value, language);
    await assertLayout(false, '980-200pct-' + language + '-unlocked');
    await assertLayout(true, '980-200pct-' + language + '-pinned'); await assertControl();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await capture('review-header-980-200pct-' + language);
  }
  await assertKeyboardToggle();
  pass('keyboard-space-and-enter-save-pin-preference-retain-focus-and-preserve-visible-material-anchor-at-980px-200-percent');
  pass(packaged ? 'floating-pin-and-both-scroll-modes-remain-operable-at-980px-and-200-percent-in-three-languages' : 'floating-pin-and-both-scroll-modes-pass-980px-200-percent-Chinese-source-behavior');
  phase = 'source and annotation integrity';
  fixtures.forEach(fixture => assert.equal(digest(fs.readFileSync(fixture.path)), beforeSources[fixture.path]));
  const records = await page.evaluate(async fixtureIds => Promise.all(fixtureIds.map(id => window.library.get(id))), allIds);
  records.forEach((record, index) => { assert.equal(record.manual.notes, 'KEEP NOTES ' + index); assert.deepEqual(record.manual.tags, ['KEEP ' + guid]); });
  assert.deepEqual(renderErrors, []); await close(); pass('all-source-bytes-and-human-annotations-are-retained-with-no-render-errors-or-public-fetches');
  phase = 'complete'; fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report(true), null, 2));
  console.log(JSON.stringify({ ok: true, checks: checks.length, report: path.join(runDir, 'report.json'), screenshots: screenshots.length }));
})().catch(async error => {
  console.error(error);
  if (app) {
    await capture('failure').catch(() => {});
    try { fs.writeFileSync(path.join(runDir, 'failure-dom.txt'), await page.locator('body').innerText()); } catch {}
    try { fs.writeFileSync(path.join(runDir, 'failure-layout.json'), JSON.stringify({ order: await order(), geometry: await headerGeometry(), host: await host().evaluate(element => ({ className: element.className, top: element.scrollTop, height: element.clientHeight, total: element.scrollHeight })) }, null, 2)); } catch {}
    await app.close().catch(() => {}); app = undefined;
  }
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report(false, error.stack || String(error)), null, 2)); process.exitCode = 1;
});
