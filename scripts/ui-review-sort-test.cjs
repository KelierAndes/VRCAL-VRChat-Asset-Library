/* Real renderer/preload/IPC acceptance checks. Only private test files are used. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const startedAt = Date.now();
const runDir = path.resolve(root, '..', `review-sort-qa-${startedAt}`);
const source = path.join(runDir, '素材 中文 日本語 📦');
const profile = path.join(runDir, '资料库');
const backupDir = path.join(runDir, '自选备份');
const backup = path.join(backupDir, 'review.vrclib.json');
const checked = [], errors = [], fixtures = [];
const collator = new Intl.Collator('zh-CN', { numeric: true });
let app, page, clipboardTestPath, diagnosticSkipId;
fs.mkdirSync(source, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

function pass(label) { checked.push(label); console.log('REVIEW PASS:', label); }
function hashTree(directory) {
  const result = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else result[path.relative(directory, full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  }
  visit(directory); return result;
}
async function wait(check, message) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error(message);
}

// Store is closed before raw SQL adjusts fixture timestamps. The living Store's
// cache is never changed behind its back, and E:\VRChat is never accessed.
const { Store } = require('../dist/main/main/store');
const store = new Store(profile, [source]);
const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu'];
const modifiedDays = [8, 2, 10, 1, 5, 5, 12, 3, 9, 7, 11, 4, 6];
function addFixture(name, file, kind, modified, createdAt, index, avatar = 'Shinra') {
  if (kind === 'folder') {
    fs.mkdirSync(file, { recursive: true }); fs.writeFileSync(path.join(file, '说明.txt'), '原素材保持不变：中文 日本語 ✨');
  } else fs.writeFileSync(file, `readonly fixture ${name}`);
  fs.utimesSync(file, new Date(modified), new Date(modified));
  const record = store.upsertScan({ path: file, name, group: '排序测试', kind, size: index + 20, mtimeMs: modified,
    localCategory: '服装', localAvatars: [avatar], hintUrls: [] });
  store.updateManual([record.id], { tags: ['QA保持'], avatars: [avatar], notes: `保留备注 ${name}`, favorite: true });
  store.updateOnline(record.id, { status: 'review', message: '名称存在歧义，等待人工确认。', candidates: [
    { url: `https://booth.pm/ja/items/${8000000 + index}`, title: `测试候选 ${name}`, author: 'QA作者' }
  ] });
  const fixture = { id: record.id, path: file, name, kind, mtimeMs: modified, createdAt,
    updatedAt: new Date(Date.UTC(2035, 0, 31 - index)).toISOString(), avatar };
  fixtures.push(fixture); return fixture;
}
names.forEach((suffix, index) => addFixture(`QAReview ${suffix}`, path.join(source, `QAReview ${suffix}.zip`), 'archive',
  Date.UTC(2024, 0, modifiedDays[index], 12, 34, 56), new Date(Date.UTC(2024, 4, index + 1, 1, 2, 3)).toISOString(),
  index, index % 2 ? 'Moe' : 'Shinra'));
const bundleFolder = addFixture('QAReview Bundle', path.join(source, 'QAReview Bundle'), 'folder',
  Date.UTC(2021, 0, 1, 1, 2, 3), '2020-01-02T03:04:05.000Z', 13);
const bundleArchive = addFixture('QAReview Bundle_Shinra.zip', path.join(source, 'QAReview Bundle_Shinra.zip'), 'archive',
  Date.UTC(2030, 8, 9, 10, 11, 12), '2025-01-02T03:04:05.000Z', 14);
store.saveSettings({ onlineEnabled: true });
store.close();
const db = new DatabaseSync(path.join(profile, 'library.sqlite'));
for (const fixture of fixtures) {
  const record = JSON.parse(db.prepare('SELECT record FROM assets WHERE id=?').get(fixture.id).record);
  record.createdAt = fixture.createdAt; record.updatedAt = fixture.updatedAt;
  db.prepare('UPDATE assets SET record=? WHERE id=?').run(JSON.stringify(record), fixture.id);
}
db.close();
const sourceBefore = hashTree(source);
const projected = fixtures.filter(row => row.id !== bundleArchive.id).map(row => row.id === bundleFolder.id
  ? { ...row, mtimeMs: bundleArchive.mtimeMs } : row);
function expectedOrder(sort, rows = projected) {
  return [...rows].sort((a, b) => {
    const date = sort === 'modified' ? b.mtimeMs - a.mtimeMs : sort === 'modified-asc' ? a.mtimeMs - b.mtimeMs
      : sort === 'added' ? b.createdAt.localeCompare(a.createdAt) : sort === 'added-asc' ? a.createdAt.localeCompare(b.createdAt) : 0;
    return date || collator.compare(a.name, b.name) || a.id.localeCompare(b.id);
  }).map(row => row.id);
}
const region = () => page.getByRole('region', { name: '匹配确认', exact: true });
const rows = () => region().locator('.review-row');
const row = id => region().locator(`.review-row[data-asset-id="${id}"]`);
const sortSelect = () => page.getByLabel('匹配确认排序', { exact: true });
const menu = () => page.getByRole('menu', { name: '本地文件操作', exact: true });
const search = () => page.getByRole('textbox', { name: '搜索素材', exact: true });
const nav = label => page.locator('.sidebar .nav-item').filter({ hasText: label });
async function ids() { return rows().evaluateAll(elements => elements.map(element => element.dataset.assetId)); }
async function expectPage(expected, message) {
  await wait(async () => (await region().locator('.review-list').getAttribute('aria-busy')) === 'false'
    && JSON.stringify(await ids()) === JSON.stringify(expected), message);
  assert.deepEqual(await ids(), expected);
}
async function enterReview() { await nav('匹配确认').click(); await sortSelect().waitFor(); }
async function clipboardText() { return app.evaluate(({ clipboard }) => clipboard.readText()); }
async function restoreClipboard() {
  if (app && clipboardTestPath) await app.evaluate(async ({ clipboard }, expected) => {
    if (await clipboard.readText() === expected && globalThis.__reviewQAClipboard) await clipboard.write(globalThis.__reviewQAClipboard);
  }, clipboardTestPath);
  clipboardTestPath = undefined;
}
async function close() { if (app) { await restoreClipboard(); await app.close(); app = undefined; } }
async function launch() {
  app = await _electron.launch({ executablePath: process.env.VRC_UI_EXECUTABLE || require('electron'),
    args: process.env.VRC_UI_EXECUTABLE ? [] : [root], env: { ...process.env, VRC_LIBRARY_DATA_DIR: profile,
      VRC_LIBRARY_ROOT: source, VRC_LIBRARY_NO_NETWORK: '1', VRC_LIBRARY_NO_AUTOSCAN: '1', VRC_LIBRARY_TEST_HIDDEN: '1' } });
  page = await app.firstWindow(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.library);
  await page.evaluate(() => {
    window.__reviewQAChangeEvents = 0;
    window.library.onEvent(event => { if (event.type === 'change') window.__reviewQAChangeEvents++; });
  });
  await app.evaluate(async ({ BrowserWindow, dialog, shell, clipboard, ClipboardItem }, destinations) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    globalThis.__reviewQAReveals = [];
    shell.showItemInFolder = file => { globalThis.__reviewQAReveals.push(file); };
    // Only the native operating-system effect is captured; reveal/copy handlers,
    // preload and raw member IDs are all the real application implementations.
    globalThis.__reviewQAClipboard = await Promise.all((await clipboard.read()).map(async item => {
      const data = {}; for (const type of item.types) data[type] = await item.getType(type); return new ClipboardItem(data);
    }));
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destinations.backup });
    dialog.showOpenDialog = async (_window, options) => ({ canceled: false,
      filePaths: [(options || _window).properties?.includes('openDirectory') ? destinations.backupDir : destinations.backup] });
    dialog.showMessageBox = async () => ({ response: 0 });
  }, { backup, backupDir });
  await page.locator('.asset-card').first().waitFor();
}
async function revealCount() { return app.evaluate(() => globalThis.__reviewQAReveals.length); }
async function latestReveal() { return app.evaluate(() => globalThis.__reviewQAReveals.at(-1)); }
async function capture(destination) {
  const bytes = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise(resolve => setTimeout(resolve, 120));
    return (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  });
  fs.writeFileSync(destination, Buffer.from(bytes, 'base64'));
}
async function reviewReactDiagnostics() {
  return page.evaluate(() => {
    const node = document.querySelector('.review-page');
    if (!node) return { missing: true };
    const fiberKey = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
    let fiber = fiberKey && node[fiberKey];
    while (fiber && !(fiber.memoizedProps?.api && fiber.memoizedProps?.filters && 'revision' in fiber.memoizedProps)) fiber = fiber.return;
    if (!fiber) return { missingFiber: true };
    function describe(value, depth = 0, seen = new WeakSet()) {
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
      if (value === undefined) return '[undefined]';
      if (typeof value === 'function') return '[function]';
      if (value instanceof HTMLElement) return { element: value.tagName, className: value.className };
      if (typeof value !== 'object') return String(value);
      if (seen.has(value)) return '[circular]';
      if (depth > 4) return '[object]'; seen.add(value);
      if (Array.isArray(value)) return value.slice(0, 20).map(item => item?.id && item?.online
        ? { id: item.id, status: item.online.status, matchingMode: item.manual?.matchingMode }
        : describe(item, depth + 1, seen));
      if (value instanceof Map) return { map: [...value].slice(0, 20).map(([key, item]) => [key, describe(item, depth + 1, seen)]) };
      if (value instanceof Set) return { set: [...value].slice(0, 20) };
      if ('create' in value && 'deps' in value) return { effectDeps: describe(value.deps, depth + 1, seen) };
      if ('current' in value) return { current: describe(value.current, depth + 1, seen) };
      const keys = ['key', 'page', 'ids', 'top', 'focus', 'assetId', 'action', 'memberId', 'candidateUrl',
        'id', 'offset', 'initialTotal', 'total', 'unfound', 'pageIds', 'removedByPage', 'x', 'y', 'origin', 'file'];
      const selected = keys.filter(key => key in value);
      return Object.fromEntries((selected.length ? selected : Object.keys(value).filter(key => !['create', 'next', 'destroy'].includes(key)).slice(0, 20))
        .map(key => [key, describe(value[key], depth + 1, seen)]));
    }
    function collect(current) {
      if (!current) return null;
      const hooks = []; let hook = current.memoizedState;
      for (let index = 0; hook && index < 60; index++, hook = hook.next) hooks.push({ index, state: describe(hook.memoizedState) });
      return { props: { revision: current.memoizedProps.revision, filters: current.memoizedProps.filters,
        initialSort: current.memoizedProps.initialSort }, hooks };
    }
    return { current: collect(fiber), alternate: collect(fiber.alternate) };
  });
}
function report(ok, error) { return { ok, checked, errors, error, durationMs: Date.now() - startedAt, runDir, source, profile, backup,
  screenshots: [path.join(runDir, 'review-sort.png'), path.join(runDir, 'review-menu-200-percent.png')] }; }

(async () => {
  await launch();
  await page.getByLabel('排序', { exact: true }).selectOption('size');
  await enterReview();
  assert.equal(await sortSelect().inputValue(), 'modified');
  assert.deepEqual(await sortSelect().locator('option').evaluateAll(options => options.map(option => option.value)),
    ['modified', 'modified-asc', 'added', 'added-asc', 'name']);
  await expectPage(expectedOrder('modified').slice(0, 10), '默认应按本地文件修改时间全局倒序');
  pass('default-modified-desc-independent-of-gallery-sort-and-complete-sort-options');

  for (const sort of ['modified', 'modified-asc', 'added', 'added-asc', 'name']) {
    const expected = expectedOrder(sort);
    await sortSelect().selectOption(sort);
    await expectPage(expected.slice(0, 10), `${sort} 第一页顺序错误或排序未回第一页`);
    await region().getByRole('button', { name: '下一页', exact: true }).click();
    await expectPage(expected.slice(10), `${sort} 第二页必须是全局顺序剩余结果`);
    await region().getByText('第 2 / 2 页', { exact: true }).waitFor();
    assert.equal(new Set(expected).size, 14);
    pass(`global-${sort}-order-ties-and-pagination-before-slicing`);
  }

  await search().fill('QAReview');
  await page.getByLabel('角色分组', { exact: true }).selectOption('排序测试');
  await page.getByLabel('本地适配模型', { exact: true }).selectOption('Moe');
  const moeRows = projected.filter(record => record.avatar === 'Moe');
  await sortSelect().selectOption('modified');
  await expectPage(expectedOrder('modified', moeRows), '排序必须保留搜索、角色与本地适配筛选');
  assert.equal(await search().inputValue(), 'QAReview');
  assert.equal(await page.getByLabel('角色分组', { exact: true }).inputValue(), '排序测试');
  assert.equal(await page.getByLabel('本地适配模型', { exact: true }).inputValue(), 'Moe');
  pass('changing-review-sort-retains-search-group-and-local-avatar-filters');
  await search().fill(''); await page.getByLabel('角色分组', { exact: true }).selectOption('');
  await page.getByLabel('本地适配模型', { exact: true }).selectOption('');
  await sortSelect().selectOption('modified');
  await expectPage(expectedOrder('modified').slice(0, 10), '返回全部待确认结果应保持修改时间排序');

  const merged = row(bundleFolder.id);
  const modifiedTime = merged.locator('.review-local-times time').nth(0);
  const addedTime = merged.locator('.review-local-times time').nth(1);
  assert((await merged.locator('.review-local-times').innerText()).includes('文件修改'));
  assert((await merged.locator('.review-local-times').innerText()).includes('入库'));
  assert.equal(await modifiedTime.getAttribute('datetime'), new Date(bundleArchive.mtimeMs).toISOString());
  assert.equal(await addedTime.getAttribute('datetime'), bundleFolder.createdAt);
  const alpha = row(fixtures[0].id);
  assert.equal(await alpha.locator('.review-local-times time').nth(0).getAttribute('datetime'),
    new Date(fixtures[0].mtimeMs).toISOString());
  assert.equal(await alpha.locator('.review-local-times time').nth(1).getAttribute('datetime'), fixtures[0].createdAt);
  assert(!(await merged.locator('.review-local-times').innerText()).includes('2035'));
  pass('exact-file-modified-and-registration-times-with-latest-member-not-updatedAt');
  await capture(path.join(runDir, 'review-sort.png'));

  await merged.locator('.review-local-area').click({ button: 'right' });
  await menu().waitFor();
  assert.deepEqual(await menu().getByRole('menuitem').allTextContents(), ['打开所在文件夹', '复制路径', '从资料库隐藏']);
  await menu().getByRole('menuitem', { name: '复制路径', exact: true }).click();
  await wait(async () => await clipboardText() === bundleFolder.path, '默认菜单应复制代表目录原路径');
  clipboardTestPath = bundleFolder.path;
  await merged.locator('.review-local-area').click({ button: 'right' });
  const revealsBefore = await revealCount();
  await menu().getByRole('menuitem', { name: '打开所在文件夹', exact: true }).click();
  await wait(async () => await revealCount() === revealsBefore + 1, '默认打开路径未通过真实IPC触发');
  assert.equal(await latestReveal(), bundleFolder.path);
  pass('default-review-row-menu-real-ipc-reveals-and-copies-representative-path');

  await merged.locator('.review-member-list').locator('summary').click();
  assert.equal(await merged.locator('.review-member-entry').count(), 2);
  const archiveEntry = merged.locator('.review-member-entry').filter({hasText:bundleArchive.path});
  await archiveEntry.getByRole('button', { name: `操作本地文件：${bundleArchive.name}`, exact: true }).click();
  await menu().getByRole('menuitem', { name: '复制路径', exact: true }).click();
  await wait(async () => await clipboardText() === bundleArchive.path, '合并条目具体包必须使用成员原始ID和路径');
  clipboardTestPath = bundleArchive.path;
  await archiveEntry.click({ button: 'right' });
  const memberReveals = await revealCount();
  await menu().getByRole('menuitem', { name: '打开所在文件夹', exact: true }).click();
  await wait(async () => await revealCount() === memberReveals + 1, '具体成员打开路径未触发');
  assert.equal(await latestReveal(), bundleArchive.path);
  pass('merged-review-member-expansion-button-and-context-use-exact-raw-file-path');

  const localArea = merged.locator('.review-local-area');
  await localArea.focus(); await page.keyboard.press('Shift+F10'); await menu().waitFor();
  const firstFocus = await page.evaluate(() => document.activeElement.textContent.trim());
  assert(['打开所在文件夹', '复制路径'].includes(firstFocus));
  await page.keyboard.press('ArrowDown');
  const secondFocus = await page.evaluate(() => document.activeElement.textContent.trim());
  assert(['打开所在文件夹', '复制路径'].includes(secondFocus)); assert.notEqual(secondFocus, firstFocus);
  await page.keyboard.press('ArrowUp'); assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), firstFocus);
  await page.keyboard.press('Escape'); assert.equal(await menu().count(), 0);
  assert.equal(await localArea.evaluate(element => document.activeElement === element), true);
  await localArea.click({ button: 'right' }); await sortSelect().click(); assert.equal(await menu().count(), 0);
  await page.keyboard.press('Escape');
  pass('review-local-menu-keyboard-arrow-escape-focus-restore-and-outside-dismiss');

  await page.evaluate(() => window.library.setZoom(2));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 660));
  await localArea.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true,
    clientX: innerWidth - 1, clientY: innerHeight - 1 })));
  await menu().waitFor();
  const menuBounds = await menu().boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth }));
  assert(menuBounds.x >= 0 && menuBounds.y >= 0 && menuBounds.x + menuBounds.width <= viewport.width + 1
    && menuBounds.y + menuBounds.height <= viewport.height + 1, '200%缩放最小窗口菜单必须保持可见');
  assert(viewport.scrollWidth <= viewport.width, '最小窗口不应产生页面横向裁切');
  await capture(path.join(runDir, 'review-menu-200-percent.png'));
  await page.keyboard.press('Escape'); await page.evaluate(() => window.library.setZoom(1));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 940));
  pass('review-file-menu-clamped-and-operable-at-200-percent-minimum-window');

  // A real skip removes one row locally. Completion is then simulated by a
  // valid private Store export restored through the real application IPC; this
  // never substitutes a fake success response for an online download.
  await page.evaluate(() => window.library.backup());
  const sessionBase = path.join(runDir, 'before-session-check.vrclib.json');
  fs.copyFileSync(backup, sessionBase);
  const sessionIds = expectedOrder('modified'), firstBatch = sessionIds.slice(0, 10), skipId = firstBatch[4];
  diagnosticSkipId = skipId;
  const reviewList = () => region().locator('.review-list');
  async function scrollAnchor(excluded) {
    return reviewList().evaluate((element, excludedIds) => {
      const top = element.getBoundingClientRect().top;
      const anchor = [...element.querySelectorAll('.review-row')].find(item => !excludedIds.includes(item.dataset.assetId)
        && item.getBoundingClientRect().bottom > top + 1);
      return { id: anchor.dataset.assetId, offset: anchor.getBoundingClientRect().top - top };
    }, excluded);
  }
  async function expectAnchor(anchor) {
    const offset = await reviewList().evaluate((element, id) => [...element.querySelectorAll('.review-row')]
      .find(item => item.dataset.assetId === id).getBoundingClientRect().top - element.getBoundingClientRect().top, anchor.id);
    assert(Math.abs(offset - anchor.offset) < 4, `确认后可见素材锚点不应跳动：${offset} vs ${anchor.offset}`);
  }
  const skipButton = row(skipId).getByRole('button', { name: '跳过自动匹配', exact: true });
  await skipButton.scrollIntoViewIfNeeded(); const skipAnchor = await scrollAnchor([skipId]);
  fs.writeFileSync(path.join(runDir, 'before-skip-react.json'), JSON.stringify(await reviewReactDiagnostics(), null, 2));
  await skipButton.click();
  await expectPage(firstBatch.filter(id => id !== skipId), '跳过中间行后保留本页顺序且不得自动补入下一页行');
  await expectAnchor(skipAnchor);
  pass('review-session-middle-skip-does-not-reorder-refill-or-jump-visible-anchor');

  async function simulateCompleted(completedIds) {
    await page.evaluate(() => window.library.backup());
    const staged = new Store(path.join(runDir, `completed-staging-${Date.now()}`), [source]);
    staged.importData(backup);
    for (const id of completedIds) staged.updateOnline(id, { status: 'matched', url: `https://booth.pm/ja/items/${8000000 + fixtures.findIndex(record => record.id === id)}`,
      confirmedSource: true, message: '独立测试资料库中的已匹配记录' });
    staged.exportData(backup); staged.close();
    assert.equal(await page.evaluate(() => window.library.restore()), true);
  }
  const completeId = firstBatch[6], beforeCompletion = firstBatch.filter(id => id !== skipId);
  await row(completeId).scrollIntoViewIfNeeded(); const completedAnchor = await scrollAnchor([completeId]);
  await simulateCompleted([completeId]);
  await expectPage(beforeCompletion.filter(id => id !== completeId), '后台完成一行后仅移除完成行，不能重排或补行');
  await expectAnchor(completedAnchor);
  const remainingBatch = firstBatch.filter(id => id !== skipId && id !== completeId);
  await simulateCompleted(remainingBatch);
  await expectPage([], '当前批次全部处理后页面应清空并保留下一页入口');
  await region().getByRole('button', { name: '下一页', exact: true }).click();
  await expectPage(sessionIds.slice(10), '处理整页后下一页必须显示原下一批，不能因offset丢失素材');
  pass('review-session-background-completions-and-full-page-next-batch-have-no-gaps');
  fs.copyFileSync(sessionBase, backup); assert.equal(await page.evaluate(() => window.library.restore()), true);
  await region().getByRole('button', { name: '刷新待确认列表', exact: true }).click();
  await expectPage(sessionIds.slice(0, 10), '显式刷新才重建排序会话，并从第一批显示');
  pass('explicit-review-refresh-rebuilds-current-sort-from-first-page');

  await sortSelect().selectOption('added-asc');
  await expectPage(expectedOrder('added-asc').slice(0, 10), '保存前排序未更新');
  await wait(async () => (await page.evaluate(() => window.library.snapshot())).settings.reviewSort === 'added-asc', '确认页排序偏好未通过IPC持久化');
  await nav('全部素材').click();
  assert.equal(await page.getByLabel('排序', { exact: true }).inputValue(), 'size');
  await page.getByLabel('排序', { exact: true }).selectOption('name');
  await enterReview(); assert.equal(await sortSelect().inputValue(), 'added-asc');
  await expectPage(expectedOrder('added-asc').slice(0, 10), '导航返回应保留独立确认页排序');
  pass('review-sort-persistence-settings-and-gallery-sort-remain-independent');
  await page.evaluate(() => window.library.backup());
  assert.equal(JSON.parse(fs.readFileSync(backup, 'utf8')).settings.reviewSort, 'added-asc');
  await close(); await launch(); await enterReview(); assert.equal(await sortSelect().inputValue(), 'added-asc');
  await expectPage(expectedOrder('added-asc').slice(0, 10), '重启后确认页排序未保留');
  await sortSelect().selectOption('name');
  await wait(async () => (await page.evaluate(() => window.library.snapshot())).settings.reviewSort === 'name', '临时排序未保存');
  assert.equal(await page.evaluate(() => window.library.restore()), true);
  await wait(async () => await sortSelect().inputValue() === 'added-asc', '恢复备份必须同步确认页排序设置');
  await expectPage(expectedOrder('added-asc').slice(0, 10), '恢复备份排序错误');
  pass('review-sort-survives-restart-and-integrity-checked-backup-restore');

  // Skip while offline remains a local metadata operation. Both raw members and
  // representative annotations are checked through the actual public preload.
  await page.evaluate(() => window.library.setOnlineEnabled(false));
  const bundleBefore = await page.evaluate(id => window.library.get(id), bundleFolder.id);
  await row(bundleFolder.id).getByRole('button', { name: '跳过自动匹配', exact: true }).click();
  await wait(async () => (await page.evaluate(() => window.library.list({ view: 'manual', limit: 100 }))).items.some(item => item.id === bundleFolder.id), '跳过应加入手动归类库');
  const manualBundle = await page.evaluate(id => window.library.get(id), bundleFolder.id);
  assert.equal(manualBundle.manual.matchingMode, 'manual');
  assert.deepEqual(manualBundle.manual.tags, bundleBefore.manual.tags); assert.equal(manualBundle.manual.notes, bundleBefore.manual.notes);
  assert.equal(manualBundle.manual.favorite, bundleBefore.manual.favorite);
  assert(manualBundle.members.every(member => member.manual.matchingMode === 'manual'));
  assert.equal((await page.evaluate(() => window.library.snapshot())).stats.manual, 1);
  assert(!(await page.evaluate(() => window.library.list({ view: 'materials', status: 'review', limit: 100 }))).items.some(item => item.id === bundleFolder.id));
  pass('offline-skip-matching-real-ipc-all-members-preserves-annotations-and-updates-stats');
  await nav('手动归类').click(); await page.locator(`.asset-card[data-asset-id="${bundleFolder.id}"]`).waitFor();
  assert.equal(await page.locator('.asset-card').count(), 1);
  await search().fill('QAReview Bundle'); await page.getByLabel('本地适配模型', { exact: true }).selectOption('Shinra');
  await wait(async () => await page.locator('.asset-card').count() === 1, '手动归类筛选应支持名字与本地适配');
  await search().fill('无结果测试'); await wait(async () => await page.locator('.asset-card').count() === 0, '手动归类搜索必须参与筛选');
  await search().fill(''); await page.getByLabel('本地适配模型', { exact: true }).selectOption('');
  await close(); await launch();
  assert.equal((await page.evaluate(id => window.library.get(id), bundleFolder.id)).manual.matchingMode, 'manual');
  assert.equal((await page.evaluate(() => window.library.snapshot())).stats.manual, 1);
  await nav('手动归类').click(); const manualCard = page.locator(`.asset-card[data-asset-id="${bundleFolder.id}"]`); await manualCard.waitFor();
  pass('manual-navigation-filters-count-and-matching-mode-survive-restart');
  await manualCard.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '恢复自动匹配', exact: true }).click();
  await wait(async () => (await page.evaluate(id => window.library.get(id), bundleFolder.id)).manual.matchingMode === 'auto', '手动归类右键恢复未生效');
  const restoredBundle = await page.evaluate(id => window.library.get(id), bundleFolder.id);
  assert.deepEqual(restoredBundle.manual.tags, bundleBefore.manual.tags); assert.equal(restoredBundle.manual.notes, bundleBefore.manual.notes);
  assert.equal(restoredBundle.manual.favorite, bundleBefore.manual.favorite);
  assert(restoredBundle.members.every(member => member.manual.matchingMode === 'auto'));
  assert.equal((await page.evaluate(() => window.library.snapshot())).stats.manual, 0);
  pass('manual-card-context-restores-all-member-matching-and-retains-annotations');

  // Re-enable only by reopening the private Store while Electron is closed.
  // NO_NETWORK at launch keeps the real queue paused; no URL is downloaded.
  await close(); const onlineStore = new Store(profile, [source]); onlineStore.saveSettings({ onlineEnabled: true }); onlineStore.close();
  await launch(); await enterReview(); await sortSelect().selectOption('name');
  const betaId = fixtures[1].id, betaRow = row(betaId), betaInput = betaRow.getByRole('textbox', { name: `商品网址或 BOOTH 编号：${fixtures[1].name}`, exact: true });
  await betaInput.fill('待填写草稿');
  await nav('全部素材').click(); await enterReview(); await betaInput.waitFor(); assert.equal(await betaInput.inputValue(), '待填写草稿');
  pass('review-source-row-draft-preserved-across-navigation');
  for (const invalid of ['javascript:alert(1)', 'http://example.org/product', 'https://127.0.0.1/product', '1234567890123']) {
    await betaInput.fill(invalid); await betaRow.getByRole('button', { name: '读取并采用来源', exact: true }).click();
    await wait(async () => await betaRow.locator('.review-source-entry').getByRole('alert').count() > 0, '不安全或无效网址必须显示本行错误');
    assert.equal(await betaInput.inputValue(), invalid);
    assert(!(await page.evaluate(id => window.library.get(id), betaId)).manual.sourceUrl);
    assert.equal((await page.evaluate(() => window.library.snapshot())).queue.pending, 0);
  }
  pass('invalid-numeric-and-nonpublic-or-nonhttps-source-shows-row-error-without-saving-or-queueing');
  await betaInput.fill('5053741');
  await betaRow.getByRole('button', { name: '读取并采用来源', exact: true }).click();
  await wait(async () => (await page.evaluate(id => window.library.get(id), betaId)).manual.sourceUrl === 'https://booth.pm/ja/items/5053741', 'BOOTH纯编号应规范成商品网址');
  const linked = await page.evaluate(id => window.library.get(id), betaId);
  assert.equal(linked.online.url, 'https://booth.pm/ja/items/5053741'); assert.equal(linked.online.status, 'pending');
  assert.notEqual(linked.online.confirmedSource, true); assert(!linked.online.fetchedAt);
  const queue = JSON.parse(fs.readFileSync(path.join(profile, 'queue.json'), 'utf8'));
  assert(queue.paused); assert(queue.tasks.some(task => task.id === betaId && task.url === 'https://booth.pm/ja/items/5053741'));
  assert.equal((await page.evaluate(() => window.library.snapshot())).queue.downloadedBytes, 0);
  pass('numeric-booth-registration-real-ipc-queues-canonical-url-without-claiming-fetch-success');

  const gammaId = fixtures[2].id;
  await search().fill('QAReview Gamma');
  const gammaRow = row(gammaId); await gammaRow.waitFor();
  const gammaInput = gammaRow.getByRole('textbox', { name: `商品网址或 BOOTH 编号：${fixtures[2].name}`, exact: true });
  await gammaInput.fill('https://example.org/public-product?variant=shinra');
  await gammaRow.getByRole('button', { name: '读取并采用来源', exact: true }).click();
  await wait(async () => (await page.evaluate(id => window.library.get(id), gammaId)).manual.sourceUrl === 'https://example.org/public-product?variant=shinra', '公开HTTPS商品网址应登记到真实队列');
  assert.equal((await page.evaluate(id => window.library.get(id), gammaId)).online.status, 'pending');
  pass('public-https-direct-source-is-saved-and-queued-without-downloading-private-fixtures');

  await search().fill('QAReview Alpha');
  const alphaInput = row(fixtures[0].id).getByRole('textbox', { name: `商品网址或 BOOTH 编号：${fixtures[0].name}`, exact: true });
  await alphaInput.fill('5053999'); await page.evaluate(() => window.library.setOnlineEnabled(false));
  await wait(async () => await row(fixtures[0].id).getByRole('button', { name: '读取并采用来源', exact: true }).isDisabled(),
    '关闭联网后来源提交按钮必须同步为禁用状态');
  assert.equal(await row(fixtures[0].id).getByRole('button', { name: '读取并采用来源', exact: true }).isDisabled(), true);
  assert.equal(await alphaInput.inputValue(), '5053999');
  await row(fixtures[0].id).getByRole('button', { name: '跳过自动匹配', exact: true }).click();
  await nav('手动归类').click(); await search().fill('');
  const alphaManual = page.locator(`.asset-card[data-asset-id="${fixtures[0].id}"]`); await alphaManual.waitFor(); await alphaManual.click();
  await page.locator('.detail-panel').getByRole('button', { name: '恢复自动匹配', exact: true }).click();
  await wait(async () => (await page.evaluate(id => window.library.get(id), fixtures[0].id)).manual.matchingMode === 'auto', '详情恢复入口未生效');
  pass('offline-source-submit-disabled-draft-kept-skip-and-detail-restore-remain-available');

  await close(); await launch();
  assert.equal((await page.evaluate(id => window.library.get(id), betaId)).manual.sourceUrl, 'https://booth.pm/ja/items/5053741');
  assert.equal((await page.evaluate(id => window.library.get(id), gammaId)).manual.sourceUrl, 'https://example.org/public-product?variant=shinra');
  assert.equal((await page.evaluate(id => window.library.get(id), fixtures[0].id)).manual.matchingMode, 'auto');
  assert((await page.evaluate(() => window.library.snapshot())).queue.paused);
  pass('registered-sources-and-restored-matching-mode-persist-on-final-restart');
  assert.deepEqual(hashTree(source), sourceBefore); assert.deepEqual(errors, []);
  pass('all-private-source-fixture-hashes-unchanged-and-no-render-errors');
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report(true), null, 2));
  console.log(JSON.stringify(report(true), null, 2)); await close();
})().catch(async error => {
  console.error(error); fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report(false, error.stack || String(error)), null, 2));
  if (app) {
    try {
      const react = await reviewReactDiagnostics();
      const diagnostics = await page.evaluate(async skippedId => ({
        skipped: skippedId ? await window.library.get(skippedId) : undefined,
        snapshot: await window.library.snapshot(), changeEvents: window.__reviewQAChangeEvents,
        rows: [...document.querySelectorAll('.review-row')].map(element => element.dataset.assetId),
        busy: document.querySelector('.review-list')?.getAttribute('aria-busy'),
        footer: document.querySelector('.review-pagination')?.textContent,
        sourceScripts: [...document.scripts].map(script => script.src)
      }), diagnosticSkipId);
      diagnostics.react = react;
      fs.writeFileSync(path.join(runDir, 'failure-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
      console.error('REVIEW FAILURE DIAGNOSTICS:', JSON.stringify({
        skippedId: diagnostics.skipped?.id, matchingMode: diagnostics.skipped?.manual.matchingMode,
        status: diagnostics.skipped?.online.status, changeEvents: diagnostics.changeEvents,
        rows: diagnostics.rows, busy: diagnostics.busy, footer: diagnostics.footer, sourceScripts: diagnostics.sourceScripts
      }, null, 2));
    } catch (diagnosticError) { console.error('Unable to capture diagnostics:', diagnosticError); }
    try { console.error(await page.locator('body').innerText()); await capture(path.join(runDir, 'failure.png')); } catch {}
    try { await close(); } catch {}
  }
  process.exitCode = 1;
});
