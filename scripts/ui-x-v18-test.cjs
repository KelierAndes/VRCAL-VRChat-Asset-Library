// Synthetic, isolated acceptance harness. Main agent runs this after npm run build.
// Never reads an existing library, imports an archive, or opens an account/web page.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { Store } = require('../dist/main/main/store');

const project = path.resolve(__dirname, '..');
const runDir = fs.mkdtempSync(path.join(path.dirname(project), 'x-ui-v18-'));
const profile = path.join(runDir, 'Library');
const source = path.join(runDir, 'Materials');
const cache = path.join(profile, 'cache');
const reportFile = path.join(runDir, 'report.json');
const checked = [], errors = [], captures = [], layouts = [];
let app, page, fixture;
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function pass(label) { checked.push(label); console.log('X V18 PASS:', label); }

// Built-in PNG encoder: RGBA, lossless, no remote or pre-existing image dependencies.
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, crc]);
}
function coverPng(index) {
  const width = 360, height = 420, stride = width * 4 + 1;
  const scanlines = Buffer.alloc(stride * height);
  const palettes = [[255, 88, 155], [51, 202, 238], [255, 184, 60], [146, 109, 255], [57, 220, 164], [248, 88, 62]];
  const base = palettes[index % palettes.length], accent = palettes[(index + 2) % palettes.length];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * stride + 1 + x * 4;
    const stripe = (Math.floor((x + y + index * 17) / 46) % 2) === 0;
    const silhouette = Math.abs(x - width / 2) < 28 + (y > 160 && y < 310 ? 62 : 0) && y > 80 && y < 365;
    for (let c = 0; c < 3; c++) scanlines[offset + c] = silhouette ? accent[c] : Math.round(base[c] * (stripe ? 0.85 : 0.58) + 24);
    scanlines[offset + 3] = 255;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}
function manifest(root) {
  const result = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      assert(!fs.lstatSync(file).isSymbolicLink(), 'Synthetic fixture must never contain links');
      if (entry.isDirectory()) { result.push([path.relative(root, file).replaceAll('\\', '/'), 'directory']); visit(file); }
      else result.push([path.relative(root, file).replaceAll('\\', '/'), hash(file)]);
    }
  };
  visit(root); return result;
}
function prepare() {
  fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(cache, { recursive: true });
  assert(!source.startsWith(project + path.sep), 'Fixture material directory must be outside the app');
  const store = new Store(profile, [source]);
  try {
    // Deliberately leave the introduction marker absent; startup owns introducing X.
    store.saveSettings({ theme: 'nasa', onlineEnabled: true, uiZoom: 1, viewMode: 'grid', density: 'standard', reviewSort: 'modified' });
    const groups = [
      ['服装', ['Aurora Jacket', 'Coral Summer Dress', 'Indigo Flight Suit', 'Lemon Sailor Set', 'Mint Hoodie', 'Rose Evening Coat']],
      ['头发', ['Amber Bob Hair', 'Bluebell Twin Tail', 'Cinnamon Long Hair', 'Lilac Wave Hair', 'Peach Short Hair', 'Silver Ribbon Hair']],
      ['饰品', ['Aqua Halo Accessory', 'Copper Ear Cuff', 'Emerald Glasses', 'Orchid Shoulder Bag', 'Ruby Hairpin', 'Sunset Necklace']]
    ];
    const ids = [], names = {}, reviewIds = [];
    let index = 0;
    const add = (name, category, review = false) => {
      const filename = path.join(source, `${String(index + 1).padStart(2, '0')}-${name}.zip`);
      fs.writeFileSync(filename, `Synthetic X theme acceptance fixture ${index}: ${name}\nThis is not an archive.\n`);
      const coverFile = `x-synthetic-cover-${String(index).padStart(2, '0')}.png`;
      fs.writeFileSync(path.join(cache, coverFile), coverPng(index));
      const stat = fs.statSync(filename);
      const asset = store.upsertScan({ path: filename, name, group: 'X 合成素材', kind: 'archive', size: stat.size,
        mtimeMs: Date.UTC(2026, 9, 10, 12, index), localCategory: category, localAvatars: ['Airi'], hintUrls: [],
        localNameHints: [name], localEvidence: [], compatibilityComplete: true, previewFile: coverFile });
      store.updateManual([asset.id], { category, tags: ['合成验收', category], notes: `仅用于 X 主题验收：${name}`, favorite: index === 0 });
      store.updateOnline(asset.id, { status: review ? 'review' : 'matched', title: name, author: `Synthetic Studio ${index + 1}`,
        url: `https://booth.pm/ja/items/${9801000 + index}`, coverFile, category,
        description: `${name} 的本地合成介绍。彩色封面用于核对图片没有被主题滤镜改色。`,
        candidates: review ? [0, 1].map(candidate => ({ url: `https://booth.pm/ja/items/${9901000 + index * 10 + candidate}`,
          title: `${name} · 候选 ${candidate + 1}`, author: 'Synthetic Candidate Studio', coverFile,
          reason: '合成候选，仅供离线布局验收' })) : [] });
      ids.push(asset.id); names[asset.id] = name; if (review) reviewIds.push(asset.id); index++; return asset.id;
    };
    for (const [category, entries] of groups) for (const name of entries) add(name, category);
    add('Review Azure Costume', '服装', true); add('Review Violet Hair', '头发', true); add('Review Golden Ornament', '饰品', true);
    const projectIds = [];
    for (let i = 0; i < 2; i++) {
      const folder = path.join(source, `X Synthetic Unity Project ${i + 1}`);
      fs.mkdirSync(path.join(folder, 'Assets'), { recursive: true }); fs.mkdirSync(path.join(folder, 'ProjectSettings'), { recursive: true });
      fs.writeFileSync(path.join(folder, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1\n');
      fs.writeFileSync(path.join(folder, 'Assets', 'AcceptanceReadme.txt'), 'Synthetic project: do not open or import.\n');
      const asset = store.upsertScan({ path: folder, name: `X Synthetic Unity Project ${i + 1}`, group: 'X 合成工程',
        kind: 'unity-project', size: 0, mtimeMs: Date.UTC(2026, 9, 10), localCategory: '工程', localAvatars: ['Airi'],
        hintUrls: [], localNameHints: [], localEvidence: [], compatibilityComplete: true });
      store.updateManual([asset.id], { relatedIds: [ids[i]], coverFile: `x-synthetic-cover-0${i}.png`, projectStatus: '制作中' });
      projectIds.push(asset.id);
    }
    const history = store.beginSourceChange([ids[0]], 'https://booth.pm/ja/items/9801000', ids[0], names[ids[0]]);
    store.updateOnline(ids[0], { status: 'matched', confirmedSource: true, coverFile: 'x-synthetic-cover-00.png' });
    store.saveCollection({ name: 'X 彩色服装', kind: 'smart', query: { view: 'materials', category: '服装', hasCover: true, sort: 'name' } });
    const fixture = { ids, names, reviewIds, projectIds, history, manual: store.getRaw(ids[0]).manual, sourceBefore: manifest(source), coversBefore: manifest(cache) };
    fs.writeFileSync(path.join(runDir, 'fixtures.json'), JSON.stringify(fixture, null, 2)); return fixture;
  } finally { store.close(); }
}
async function launch() {
  app = await _electron.launch({ executablePath: process.env.VRC_UI_EXECUTABLE || require('electron'),
    args: process.env.VRC_UI_EXECUTABLE ? [] : [project],
    env: { ...process.env, VRC_LIBRARY_DATA_DIR: profile, VRC_LIBRARY_ROOT: source,
      VRC_LIBRARY_NO_NETWORK: '1', VRC_LIBRARY_NO_AUTOSCAN: '1', VRC_LIBRARY_TEST_HIDDEN: '1' } });
  page = await app.firstWindow(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await app.evaluate(({ BrowserWindow, shell, session }) => {
    globalThis.__xQaReveals = [];
    shell.showItemInFolder = file => globalThis.__xQaReveals.push(file);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/dist/renderer/'));
    win.webContents.setBackgroundThrottling(false); win.setSize(1480, 940);
  });
  await page.waitForSelector('.asset-card'); await galleryReady();
  await page.evaluate(() => document.fonts.ready);
}
async function galleryReady() {
  await page.waitForFunction(() => document.querySelector('.asset-grid')?.getAttribute('aria-busy') === 'false');
}
async function visibleImagesReady() {
  // Ignore offscreen lazy images. Requiring all lazy images to load deadlocks long lists.
  await page.waitForFunction(() => [...document.images].filter(img => {
    const r = img.getBoundingClientRect(), s = getComputedStyle(img);
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && s.visibility !== 'hidden';
  }).every(img => img.complete && img.naturalWidth > 0));
  await page.evaluate(() => Promise.all([...document.images].filter(img => {
    const r = img.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }).map(img => img.decode().catch(() => {}))));
}
async function imageFilters(label) {
  await visibleImagesReady();
  const findings = await page.evaluate(() => {
    const visible = [...document.images].filter(img => {
      const r = img.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    });
    const bad = [];
    for (const img of visible) for (let node = img; node; node = node.parentElement) {
      const filter = getComputedStyle(node).filter;
      if (filter !== 'none') bad.push({ image: img.currentSrc, ancestor: node.tagName + '.' + node.className, filter });
    }
    return { count: visible.length, bad };
  });
  assert(findings.count > 0, `${label}: expected a visible synthetic image`); assert.deepEqual(findings.bad, [], `${label}: image/ancestor filter`);
  pass(`${label}: visible images and every ancestor retain filter:none`);
}
async function capture(name) {
  await visibleImagesReady();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // Hidden Electron compositor occasionally returns the preceding frame; warm once, then capture again.
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/dist/renderer/'));
    await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise(resolve => setTimeout(resolve, 100));
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const data = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/dist/renderer/'));
    return (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  });
  const file = path.join(runDir, `${name}.png`); fs.writeFileSync(file, Buffer.from(data, 'base64')); captures.push(file); console.log('X V18 SCREENSHOT:', file);
}
async function theme(value) {
  await page.getByLabel('界面主题', { exact: true }).selectOption(value);
  await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, value);
  await page.waitForFunction(async expected => (await window.library.snapshot()).settings.theme === expected, value);
}
async function layout(label) {
  const result = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme,
    htmlBackground: getComputedStyle(document.documentElement).backgroundColor, bodyBackground: getComputedStyle(document.body).backgroundColor,
    width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    contentHeight: document.querySelector('.content-layout')?.getBoundingClientRect().height ?? 0 }));
  layouts.push({ label, ...result }); assert(result.scrollWidth <= result.width, `${label}: horizontal document overflow`);
  assert(result.contentHeight > 55, `${label}: content must remain taller than 55px`); return result;
}
async function allMaterials() {
  await page.getByRole('button', { name: /全部素材/ }).click(); await page.waitForSelector('.asset-card'); await galleryReady();
}
async function closeDetail() {
  const button = page.locator('.detail-panel').getByRole('button', { name: '收起详情', exact: true });
  if (await button.count()) await button.click();
}
async function run() {
  fixture = prepare(); pass('21 synthetic colorful materials, 3 candidate rows and 2 Unity projects seeded through Store');
  await launch();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'x');
  const initial = await layout('x first launch'); assert.equal(initial.bodyBackground, 'rgb(0, 0, 0)');
  const initialBridge = await page.evaluate(() => {
    const before = window.library.initialTheme; let wrote;
    try { wrote = Reflect.set(window.library, 'initialTheme', 'nasa'); } catch { wrote = false; }
    return { before, after: window.library.initialTheme, wrote };
  });
  assert.deepEqual(initialBridge, { before: 'x', after: 'x', wrote: false });
  const windowBackground = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/dist/renderer/')).getBackgroundColor());
  assert(/^#(?:ff)?000000$/i.test(windowBackground), `X native window should be black, got ${windowBackground}`);
  assert.equal((await page.evaluate(() => window.library.snapshot())).settings.xThemeIntroduced, true);
  pass('First launch introduces X once, readonly initialTheme and browser/native black backgrounds');
  assert.deepEqual((await page.getByLabel('界面主题', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value))).sort(), ['nasa', 'swiss', 'x']);
  pass('Live selector exposes exactly X, NASA and Swiss');
  await imageFilters('x gallery'); await capture('x-gallery');

  const first = page.locator(`.asset-card[data-asset-id="${fixture.ids[0]}"]`);
  await first.getByRole('checkbox').check();
  const selectedIds = await page.locator('.asset-card.selected').evaluateAll(cards => cards.map(card => card.dataset.assetId));
  for (const skin of ['nasa', 'swiss', 'x']) {
    await theme(skin); assert.deepEqual(await page.locator('.asset-card.selected').evaluateAll(cards => cards.map(card => card.dataset.assetId)), selectedIds);
    await imageFilters(`${skin} gallery`); await layout(`${skin} gallery`);
    if (skin !== 'x') await capture(`${skin}-gallery`);
  }
  pass('All three themes switch live and preserve selected asset IDs');
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  await page.getByRole('button', { name: '列表视图', exact: true }).click(); await page.waitForSelector('.view-list');
  for (const density of ['compact', 'spacious', 'standard']) {
    await page.getByLabel('内容密度', { exact: true }).selectOption(density); await page.waitForSelector(`.asset-grid.density-${density}`); await layout(`x list ${density}`);
  }
  await page.getByRole('button', { name: '网格视图', exact: true }).click(); await page.waitForSelector('.view-grid');
  pass('X gallery/list and all three density choices remain usable');
  await first.locator('h3').hover(); await page.waitForSelector('.hover-preview'); await imageFilters('x hover');
  assert((await page.locator('.hover-preview').innerText()).includes(fixture.names[fixture.ids[0]]));
  await page.mouse.move(5, 5); await page.waitForSelector('.hover-preview', { state: 'hidden' }); pass('X hover introduction works');
  await first.click(); await page.waitForSelector('.detail-panel'); await imageFilters('x detail'); await capture('x-detail');
  await first.click({ button: 'right' }); await page.getByRole('menuitem', { name: '打开所在文件夹', exact: true }).click();
  const reveals = await app.evaluate(() => globalThis.__xQaReveals); assert.equal(reveals.length, 1);
  assert(reveals[0].startsWith(source + path.sep)); pass('X details and context locator target the synthetic source'); await closeDetail();

  await page.getByRole('button', { name: /匹配确认/ }).click(); await page.waitForSelector('.review-row');
  await page.waitForFunction(() => document.querySelector('.review-list')?.getAttribute('aria-busy') === 'false');
  assert.equal(await page.locator('.review-row').count(), 3);
  const order = await page.locator('.review-row').evaluateAll(rows => rows.map(row => row.dataset.assetId));
  const row = page.locator('.review-row').first(), rowId = await row.getAttribute('data-asset-id');
  const search = row.getByRole('textbox', { name: /^BOOTH 搜索：/ }), manual = row.getByRole('textbox', { name: /^商品网址或 BOOTH 编号：/ });
  await search.fill('Synthetic offline keyword'); await manual.fill('not a valid source');
  await row.getByRole('button', { name: '读取并采用来源', exact: true }).click();
  await row.getByRole('alert').waitFor(); assert((await row.getByRole('alert').innerText()).includes('有效'));
  await manual.fill('9901234');
  await imageFilters('x review candidate covers');
  await page.locator('.review-list').evaluate(element => { element.scrollTop = 0; });
  await capture('x-review');
  for (const skin of ['nasa', 'swiss', 'x']) {
    await theme(skin); assert.deepEqual(await page.locator('.review-row').evaluateAll(rows => rows.map(row => row.dataset.assetId)), order);
    assert.equal(await search.inputValue(), 'Synthetic offline keyword'); assert.equal(await manual.inputValue(), '9901234');
  }
  pass('Review BOOTH/manual-source inputs, invalid-source validation and stable row order survive theme changes offline');
  await row.getByRole('button', { name: '跳过自动匹配', exact: true }).click();
  await page.waitForFunction(id => !document.querySelector(`.review-row[data-asset-id="${id}"]`), rowId);
  assert.deepEqual(await page.locator('.review-row').evaluateAll(rows => rows.map(row => row.dataset.assetId)), order.filter(id => id !== rowId));
  assert.equal((await page.evaluate(id => window.library.get(id), rowId)).manual.matchingMode, 'manual'); pass('Review skip works and preserves remaining row order');

  await page.getByRole('button', { name: /工程与成品/ }).click(); await galleryReady();
  await page.locator(`.asset-card[data-asset-id="${fixture.projectIds[0]}"]`).click();
  const relation = page.locator(`.project-material-card[data-asset-id="${fixture.ids[0]}"]`);
  await relation.waitFor(); await relation.scrollIntoViewIfNeeded(); await imageFilters('x project related cover');
  assert((await relation.innerText()).includes('手动关联')); pass('Project manual relation and colorful cached related cover work'); await closeDetail();
  await page.getByRole('button', { name: /BOOTH 账号与下载/ }).click(); await page.waitForSelector('.booth-page');
  assert.equal(await page.locator('.booth-entry-card').count(), 4); pass('BOOTH management page retains four account/library entrances without opening them');
  await allMaterials();
  await page.getByRole('button', { name: '下载面板', exact: true }).click(); await page.waitForSelector('.download-modal'); await capture('x-network');
  await page.keyboard.press('Escape'); await page.waitForSelector('.download-modal', { state: 'hidden' }); pass('Network/speed modal opens and closes');
  await page.getByRole('button', { name: /设置与备份/ }).click(); await page.waitForSelector('.theme-settings');
  assert.equal(await page.locator('.theme-option').count(), 3); assert.equal(await page.locator('.theme-preview').count(), 3); await capture('x-settings');
  for (const skin of ['nasa', 'swiss', 'x']) {
    await page.locator(`.theme-option:has(.theme-preview-${skin})`).click();
    await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, skin);
    assert.equal(await page.locator(`.theme-option:has(.theme-preview-${skin})`).getAttribute('aria-pressed'), 'true');
  }
  await page.getByRole('button', { name: '完成', exact: true }).click(); pass('Settings shows exactly three previews and every preview switches theme');
  await closeDetail();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/dist/renderer/')).setSize(980, 720));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve))); await layout('x 980px'); await capture('x-980'); pass('X at 980px has usable content and no horizontal document overflow');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/dist/renderer/')).setSize(1480, 940));
  await page.mouse.move(650, 400); await page.keyboard.down('Control');
  try { await page.mouse.wheel(0, -100); } finally { await page.keyboard.up('Control'); }
  await page.waitForFunction(async () => (await window.library.snapshot()).settings.uiZoom > 1); pass('Ctrl-wheel changes saved zoom');
  await page.evaluate(() => window.library.setZoom(2));
  await page.waitForFunction(async () => (await window.library.snapshot()).settings.uiZoom === 2);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await layout('x 200 percent'); await capture('x-200percent'); pass('X at 200% keeps content above 55px and avoids horizontal document overflow');
  await page.evaluate(() => window.library.setZoom(1)); await theme('nasa');
  await app.close(); app = undefined; await launch();
  assert.equal(await page.getByLabel('界面主题', { exact: true }).inputValue(), 'nasa');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'nasa');
  assert.equal(await page.evaluate(() => window.library.initialTheme), 'nasa');
  const snapshot = await page.evaluate(() => window.library.snapshot()); assert.equal(snapshot.settings.xThemeIntroduced, true);
  assert.equal(snapshot.sourceUndo.token, fixture.history.token);
  const saved = await page.evaluate(id => window.library.get(id), fixture.ids[0]); assert.deepEqual(saved.manual, fixture.manual);
  pass('NASA choice persists across restart; X is not reintroduced; annotations/favorite/source history persist');
  assert.deepEqual(manifest(source), fixture.sourceBefore); assert.deepEqual(manifest(cache), fixture.coversBefore);
  pass('Every synthetic source name/hash and colorful cover hash remains unchanged');
  assert.deepEqual(errors, []); pass('No renderer exceptions or error console messages');
}
function report(ok, error) {
  fs.writeFileSync(reportFile, JSON.stringify({ ok, checked, errors, error: error?.stack, runDir, profile, source,
    executable: process.env.VRC_UI_EXECUTABLE || 'local electron', captures, layouts, fixtureCounts: fixture && { materials: fixture.ids.length, reviews: fixture.reviewIds.length, projects: fixture.projectIds.length },
    isolation: 'Synthetic Store database, locally encoded PNGs and fake archives only; network/autoscan disabled; no import/unpack/account activity' }, null, 2));
  console.log('X V18 REPORT:', reportFile);
}
(async () => {
  try { await run(); report(true); }
  catch (error) {
    // Failure evidence must be attempted before closing; do not block on lazy images here.
    if (app && page) try {
      const data = await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/dist/renderer/'));
        await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        await new Promise(resolve => setTimeout(resolve, 100));
        return (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
      });
      const file = path.join(runDir, 'failure.png'); fs.writeFileSync(file, Buffer.from(data, 'base64')); captures.push(file);
    } catch (captureError) { errors.push(`Failure capture: ${captureError.message}`); }
    report(false, error); console.error(error); process.exitCode = 1;
  } finally { if (app) await app.close(); }
})();
