/* Actual Electron renderer, preload and IPC. Native trash is replaced only for
 * exact synthetic paths; every fixture and screenshot is retained for review. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { Store } = require('../dist/main/main/store');

const repo = path.resolve(__dirname, '..'), startedAt = Date.now();
const runDir = fs.mkdtempSync(path.resolve(repo, '../ui-recycle-'));
const source = path.join(runDir, 'Synthetic 素材 日本語 💝');
const profile = path.join(runDir, 'Private Library');
const recycled = path.join(runDir, 'Simulated Recycle Bin');
const checks = [], screenshots = [], renderErrors = [], fixtures = [];
const packaged = !!process.env.VRC_TEST_APP_EXECUTABLE;
let app, page, phase = 'fixture setup', evidence = { dialogs: [], calls: [], moves: [] };
fs.mkdirSync(source); fs.mkdirSync(recycled);

function pass(label) { checks.push(label); console.log('RECYCLE PASS:', label); }
function within(file, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(file));
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function hashTree(directory) {
  const result = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      assert(!entry.isSymbolicLink(), 'Synthetic fixtures must never contain links');
      if (entry.isDirectory()) visit(file);
      else result[path.relative(directory, file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }
  visit(directory); return result;
}
async function wait(check, message) {
  const deadline = Date.now() + 18000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(message);
}

const store = new Store(profile, [source]);
store.saveSettings({ onlineEnabled: false, theme: 'x', language: 'zh-CN', xThemeIntroduced: true, reviewSort: 'name' });
function add(name, kind = 'archive', status = 'not-found') {
  const file = path.join(source, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (kind === 'folder') {
    fs.mkdirSync(file); fs.writeFileSync(path.join(file, '说明 日本語 💝.txt'), 'Synthetic folder content ' + name);
  } else fs.writeFileSync(file, 'Synthetic source content ' + name);
  const stat = fs.statSync(file);
  const asset = store.upsertScan({ path: file, name: path.basename(file), kind, group: 'Private recycle QA', size: stat.size,
    mtimeMs: stat.mtimeMs, localCategory: '服装', localAvatars: ['Shinra'], hintUrls: [] });
  store.updateManual([asset.id], { notes: 'KEEP NOTES ' + name, tags: ['KEEP QA'], favorite: true });
  store.updateOnline(asset.id, { status, ...(status === 'review' ? { candidates: [], message: 'Synthetic review fixture' } : {}) });
  fixtures.push(asset); return asset;
}
const keeper = add('Keeper 保留 日本語💝.zip'), cancel = add('Cancel 原样保留.zip');
const bulk = [add('Bulk Alpha.zip'), add('Bulk Beta.zip')];
const partial = [add('Partial Good.zip'), add('Partial Failure.zip')];
const bundle = add('Recycle Bundle', 'folder'), bundleArchive = add('Recycle Bundle_Shinra.zip');
const bundleChild = add('Recycle Bundle/inside.unitypackage', 'unitypackage');
const merged = store.get(bundle.id);
assert(merged?.members?.some(member => member.id === bundleArchive.id), 'Folder and archive fixture must form a real merged card');
const hiddenSingle = add('Hidden Single.zip'), hiddenBulk = [add('Hidden Batch A.zip'), add('Hidden Batch B.zip')];
const hiddenScroll = Array.from({ length: 12 }, (_, index) => add('Hidden Scroll ' + String(index).padStart(2, '0') + '.zip'));
store.setHidden([hiddenSingle.id, ...hiddenBulk.map(asset => asset.id), ...hiddenScroll.map(asset => asset.id)], true);
const review = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'].map(name => add('QAReview ' + name + '.zip', 'archive', 'review'));
const reviewMemberFolder = add('QAReview Member Bundle', 'folder', 'review');
const reviewMemberArchive = add('QAReview Member Bundle_Shinra.zip', 'archive', 'review');
const reviewWholeFolder = add('QAReview Whole Bundle', 'folder', 'review');
const reviewWholeArchive = add('QAReview Whole Bundle_Shinra.zip', 'archive', 'review');
for (const [folder, archive] of [[reviewMemberFolder, reviewMemberArchive], [reviewWholeFolder, reviewWholeArchive]]) {
  assert(store.get(folder.id)?.members?.some(member => member.id === archive.id), 'Review scope fixture must form a merged card');
}
store.close();
const sourceBefore = hashTree(source);

const card = id => page.locator(`.asset-card[data-asset-id="${id}"]`);
const reviewRow = id => page.locator(`.review-row[data-asset-id="${id}"]`);
const context = () => page.locator('[role="menu"].context-menu');
const menuSettings = () => page.locator('[data-setting="context-menu"]');
const contextRow = id => menuSettings().locator(`[data-context-action="${id}"]`);
async function nativeState() {
  const current = await app.evaluate(() => {
    const state = globalThis.__recycleQA;
    return { dialogs: state.dialogs, calls: state.calls, moves: state.moves, answers: state.answers };
  });
  evidence = { dialogs: [...evidence.dialogs, ...current.dialogs], calls: [...evidence.calls, ...current.calls], moves: [...evidence.moves, ...current.moves] };
  await app.evaluate(() => { globalThis.__recycleQA.dialogs = []; globalThis.__recycleQA.calls = []; globalThis.__recycleQA.moves = []; });
  return current;
}
async function answer(response, failed = []) {
  await app.evaluate((_electron, options) => {
    globalThis.__recycleQA.answers.push(options.response);
    globalThis.__recycleQA.failed = options.failed;
  }, { response, failed });
}
async function capture(name) {
  const destination = path.join(runDir, name + '.png');
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/renderer/index.html'));
    await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    return (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  });
  fs.writeFileSync(destination, Buffer.from(base64, 'base64')); screenshots.push(destination);
}
async function launch() {
  app = await _electron.launch({ executablePath: process.env.VRC_TEST_APP_EXECUTABLE || require('electron'),
    args: packaged ? [] : [repo], env: { ...process.env, VRC_LIBRARY_DATA_DIR: profile, VRC_LIBRARY_ROOT: source,
      VRC_LIBRARY_NO_NETWORK: '1', VRC_LIBRARY_NO_AUTOSCAN: '1', VRC_LIBRARY_NO_RELAUNCH: '1', VRC_LIBRARY_TEST_HIDDEN: '1' } });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => renderErrors.push(error.stack || error.message));
  await page.waitForFunction(() => !!window.library);
  await app.evaluate(({ BrowserWindow, dialog, shell }, options) => {
    const fs = process.mainModule.require('node:fs'), path = process.mainModule.require('node:path');
    const key = value => path.resolve(value).toLowerCase();
    const within = (file, directory) => { const rel = path.relative(directory, file); return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
    const sourceReal = fs.realpathSync(options.source), trashReal = fs.realpathSync(options.recycled);
    const allowed = new Set(options.allowed.map(key));
    globalThis.__recycleQA = { answers: [], dialogs: [], calls: [], moves: [], failed: [], counter: options.counter };
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async (parent, settings) => {
      const value = settings || parent, state = globalThis.__recycleQA;
      state.dialogs.push({ type: value.type, title: value.title, message: value.message, detail: value.detail,
        buttons: value.buttons, defaultId: value.defaultId, cancelId: value.cancelId });
      if (!state.answers.length) throw new Error('QA blocked an unexpected native confirmation');
      return { response: state.answers.shift(), checkboxChecked: false };
    };
    dialog.showOpenDialog = async () => { throw new Error('QA blocked an unexpected native file picker'); };
    dialog.showSaveDialog = async () => { throw new Error('QA blocked an unexpected native save picker'); };
    // The real shell.trashItem is never called, including on assertion failures.
    shell.trashItem = async original => {
      const state = globalThis.__recycleQA, file = path.resolve(original);
      assertSafe(); state.calls.push(file);
      if (state.failed.some(failed => key(failed) === key(file))) throw new Error('Synthetic recycle failure: file is locked');
      const destination = path.join(trashReal, String(++state.counter).padStart(3, '0') + '-' + path.basename(file));
      if (!within(destination, trashReal) || fs.existsSync(destination)) throw new Error('QA refused an unsafe fixture destination');
      fs.renameSync(file, destination); state.moves.push({ path: file, destination });
      function assertSafe() {
        if (!allowed.has(key(file)) || !within(file, sourceReal) || key(fs.realpathSync(file)) !== key(file)) throw new Error('QA refused to trash a nonfixture or linked path');
      }
    };
  }, { source, recycled, allowed: fixtures.map(asset => asset.path), counter: evidence.moves.length });
  await card(keeper.id).waitFor();
  assert.equal(await page.evaluate(() => typeof window.library.recycleAssets), 'function');
}
async function close() { if (app) { await nativeState(); await app.close(); app = undefined; } }
async function closeResult() {
  await page.locator('.recycle-result .modal-header button').click();
  await page.locator('.recycle-result').waitFor({ state: 'detached' });
}
async function resultCounts(done, failed = 0) {
  await page.locator('.recycle-result').waitFor();
  assert.equal(await page.locator('[data-recycle-status="recycled"]').count(), done);
  assert.equal(await page.locator('[data-recycle-status="failed"]').count(), failed);
  assert.equal(await page.locator('[data-recycle-status="not-run"]').count(), 0);
}
async function settings() {
  if (!await menuSettings().count()) await page.locator('.settings-button').click();
  await menuSettings().waitFor();
}
async function closeSettings() { await page.locator('.modal:not(.recycle-result) .modal-header button').click(); await menuSettings().waitFor({ state: 'detached' }); }
async function hiddenPage() {
  await page.locator('button.hidden-nav').click(); await page.locator('section.hidden-page.hidden-materials').waitFor();
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'The hidden list must open as an independent page');
}
async function prefs() { return (await page.evaluate(() => window.library.snapshot())).settings.contextMenu; }
async function saved(predicate, message) {
  await wait(async () => await menuSettings().getAttribute('aria-busy') === 'false' && predicate(await prefs()), message);
}
async function selectCards(assets) {
  if (await page.locator('.selection-clear').count()) await page.locator('.selection-clear').click();
  for (const asset of assets) { await card(asset.id).scrollIntoViewIfNeeded(); await card(asset.id).locator('.card-select input').check(); }
}
async function enterReview() {
  await page.locator('.sidebar .nav-item').filter({ hasText: '匹配确认' }).click();
  await page.locator('.review-page').waitFor();
  await page.locator('.review-sort-label select').selectOption('name');
  await wait(async () => await page.locator('.review-list').getAttribute('aria-busy') === 'false', 'Review list did not settle');
}
async function rowIds() { return page.locator('.review-row').evaluateAll(rows => rows.map(row => row.dataset.assetId)); }
async function expectRows(expected, message) { await wait(async () => JSON.stringify(await rowIds()) === JSON.stringify(expected), message); }
function report(ok, error) { return { ok, phase, checks, renderErrors, error, packaged, durationMs: Date.now() - startedAt,
  runDir, source, profile, recycled, screenshots, evidence, fixtureCount: fixtures.length, fixtureFilesBefore: sourceBefore }; }

(async () => {
  await launch();
  phase = 'cancel gallery deletion';
  await answer(0); await card(cancel.id).click({ button: 'right' });
  await context().locator('[data-context-id="delete"]').click();
  await wait(async () => (await app.evaluate(() => globalThis.__recycleQA.dialogs.length)) === 1, 'Native delete confirmation did not open');
  const cancelled = await nativeState();
  assert.equal(cancelled.dialogs[0].defaultId, 0); assert.equal(cancelled.dialogs[0].cancelId, 0);
  assert(cancelled.dialogs[0].detail.includes(cancel.path)); assert.deepEqual(cancelled.calls, []);
  assert.deepEqual(hashTree(source), sourceBefore); assert(await page.evaluate(id => window.library.get(id), cancel.id));
  assert.equal(await page.locator('.recycle-result').count(), 0);
  pass('gallery-context-cancel-defaults-to-cancel-and-leaves-every-source-byte-unchanged');

  phase = 'gallery batch deletion';
  await selectCards(bulk); await answer(1); await page.locator('.selection-bar .bulk-delete').click();
  await resultCounts(2); await capture('gallery-batch-results');
  let batch = await nativeState(); assert.deepEqual(new Set(batch.calls), new Set(bulk.map(asset => asset.path)));
  for (const asset of bulk) { assert(!fs.existsSync(asset.path)); assert.equal(await page.evaluate(id => window.library.get(id), asset.id), null); }
  assert(batch.dialogs[0].detail.includes(bulk[0].path) && batch.dialogs[0].detail.includes(bulk[1].path));
  await closeResult(); pass('gallery-selection-confirmation-recycles-each-exact-synthetic-path-once');

  phase = 'partial failure';
  await selectCards(partial); await answer(1, [partial[1].path]); await page.locator('.selection-bar .bulk-delete').click();
  await resultCounts(1, 1); assert((await page.locator('[data-recycle-status="failed"]').innerText()).includes(partial[1].path));
  assert((await page.locator('[data-recycle-status="failed"]').innerText()).includes('Synthetic recycle failure'));
  assert(fs.existsSync(partial[1].path)); assert(await page.evaluate(id => window.library.get(id), partial[1].id));
  await capture('partial-failure-results'); await nativeState(); await closeResult();
  await card(partial[1].id).waitFor();
  assert.equal(await card(partial[1].id).locator('.card-select input').isChecked(), true, 'Failed assets must remain selected for retry');
  assert.equal(await page.locator('.asset-card.selected').count(), 1, 'Successful assets must leave the selection');
  await answer(1); await page.locator('.selection-bar .bulk-delete').click(); await resultCounts(1);
  batch = await nativeState(); assert.deepEqual(batch.calls, [partial[1].path]); await closeResult();
  pass('partial-failure-keeps-file-record-and-failed-selection-for-a-successful-direct-retry');

  phase = 'merged card deletion';
  await answer(1); await card(bundle.id).click({ button: 'right' }); await context().locator('[data-context-id="delete"]').click();
  await resultCounts(2); batch = await nativeState();
  assert.deepEqual(new Set(batch.calls), new Set([bundle.path, bundleArchive.path]));
  assert(!batch.calls.includes(bundleChild.path));
  for (const asset of [bundle, bundleArchive, bundleChild]) assert.equal(await page.evaluate(id => window.library.get(id), asset.id), null);
  await closeResult(); pass('merged-folder-and-archive-recycle-two-paths-without-recycling-the-covered-child-twice');

  phase = 'hidden independent page single and batch deletion';
  await hiddenPage(); await page.locator('.hidden-search').fill('Hidden');
  await wait(async () => await page.locator('.hidden-page .hidden-entry').count() === hiddenScroll.length + hiddenBulk.length + 1, 'Hidden page fixtures did not load');
  const hiddenTotal = hiddenScroll.length + hiddenBulk.length + 1;
  await wait(async () => Number(await page.locator('button.hidden-nav small').innerText()) === hiddenTotal, 'The sidebar hidden count did not refresh');
  const hiddenCancelId = await page.locator('.hidden-page .hidden-entry').last().getAttribute('data-hidden-id');
  const hiddenCancelRow = page.locator(`.hidden-page [data-hidden-id="${hiddenCancelId}"]`);
  await hiddenCancelRow.locator('input').check();
  const hiddenDelete = hiddenCancelRow.locator('.recycle-danger'); await hiddenDelete.scrollIntoViewIfNeeded();
  const hiddenBefore = hashTree(source), hiddenScrollBefore = await page.locator('section.hidden-page').evaluate(element => element.scrollTop);
  assert(hiddenScrollBefore > 0, 'Cancellation must be tested with the independent page genuinely scrolled');
  await answer(0); await hiddenDelete.click();
  await wait(async () => (await app.evaluate(() => globalThis.__recycleQA.dialogs.length)) === 1, 'Hidden delete confirmation did not open');
  await page.evaluate(async () => { await window.library.snapshot(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  assert.equal(await page.locator('section.hidden-page').count(), 1, 'Cancelling hidden deletion must keep the independent page open');
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'Cancelling hidden deletion must not open Settings or a result modal');
  assert.equal(await page.locator('.hidden-search').inputValue(), 'Hidden', 'Cancelling hidden deletion lost the search');
  assert.equal(await hiddenCancelRow.locator('input').isChecked(), true, 'Cancelling hidden deletion lost the selection');
  assert(Math.abs(await page.locator('section.hidden-page').evaluate(element => element.scrollTop) - hiddenScrollBefore) < 3,
    'Cancelling hidden deletion changed the independent page scroll position');
  assert.equal(await hiddenDelete.evaluate(element => document.activeElement === element), true, 'Cancel should return focus to the hidden delete button');
  assert.deepEqual(hashTree(source), hiddenBefore); batch = await nativeState(); assert.deepEqual(batch.calls, []);
  await capture('hidden-cancel-keeps-independent-page-search-selection-scroll');
  pass('hidden-delete-cancel-retains-independent-page-search-nonzero-scroll-selection-and-focus-without-moving-files');
  await hiddenCancelRow.locator('input').uncheck();
  const hiddenSingleRow = page.locator(`.hidden-page [data-hidden-id="${hiddenSingle.id}"]`);
  await answer(1); await hiddenSingleRow.locator('.recycle-danger').click(); await resultCounts(1); await closeResult();
  assert.equal(await page.locator('section.hidden-page').count(), 1);
  await page.locator('.hidden-search').fill('Hidden Batch');
  await wait(async () => await page.locator('.hidden-page .hidden-entry').count() === hiddenBulk.length, 'Hidden batch search did not settle');
  assert.equal(Number(await page.locator('button.hidden-nav small').innerText()), hiddenTotal - 1, 'The full sidebar total must not shrink to the page search result');
  for (const asset of hiddenBulk) await page.locator(`[data-hidden-id="${asset.id}"] input`).check();
  await answer(1); await page.locator('.hidden-bulk .recycle-danger').click(); await resultCounts(2); await closeResult();
  await nativeState();
  await page.locator('.hidden-search').fill('Hidden Scroll');
  await wait(async () => await page.locator('.hidden-page .hidden-entry').count() === hiddenScroll.length, 'Hidden scroll-fixture search did not settle');
  await page.locator('.hidden-bulk input').check();
  await page.locator('.hidden-bulk button:not(.recycle-danger)').click();
  await wait(async () => (await page.evaluate(() => window.library.hiddenAssets())).total === 0, 'Bulk restore did not clear the remaining hidden fixtures');
  assert.equal((await page.evaluate(() => window.library.hiddenAssets())).total, 0);
  await wait(async () => Number(await page.locator('button.hidden-nav small').innerText()) === 0, 'The sidebar total did not clear after bulk restore');
  await nativeState(); pass('independent-hidden-page-supports-single-and-batch-recycling-bulk-restore-and-full-sidebar-counts');

  phase = 'review selection hide and delete preserve order';
  await enterReview(); const originalRows = await rowIds(); assert.equal(originalRows.length, review.length + 2);
  const hideIds = [originalRows[1], originalRows[3]], beforeHide = hashTree(source);
  for (const id of hideIds) await reviewRow(id).locator('.review-row-select input').check();
  await page.locator('[data-review-bulk="hide"]').click();
  await expectRows(originalRows.filter(id => !hideIds.includes(id)), 'Bulk hiding reordered or refilled the review page');
  assert.deepEqual(hashTree(source), beforeHide);
  const beforeDelete = await rowIds(), deleteIds = [beforeDelete[0], beforeDelete[2]];
  for (const id of deleteIds) await reviewRow(id).locator('.review-row-select input').check();
  await answer(1); await page.locator('[data-review-bulk="delete"]').click(); await resultCounts(2); await closeResult();
  await expectRows(beforeDelete.filter(id => !deleteIds.includes(id)), 'Bulk recycling reordered or refilled the review page');
  await capture('review-bulk-remaining-order'); await nativeState();
  pass('review-checkbox-bulk-hide-does-not-touch-disk-and-bulk-delete-retains-remaining-row-order');

  phase = 'review individual member and whole-card scopes';
  const beforeMemberDelete = await rowIds();
  await reviewRow(reviewMemberFolder.id).locator('.review-member-list summary').click();
  const member = reviewRow(reviewMemberFolder.id).locator('.review-member-entry').filter({ hasText: reviewMemberArchive.path });
  await member.scrollIntoViewIfNeeded(); await answer(1); await member.click({ button: 'right' });
  await context().locator('[data-context-id="delete"]').click(); await resultCounts(1); batch = await nativeState();
  assert.deepEqual(batch.calls, [reviewMemberArchive.path], 'Expanded member deletion must recycle only the explicitly targeted raw member');
  assert(batch.dialogs[0].detail.includes(reviewMemberArchive.path));
  assert(!batch.dialogs[0].detail.includes(reviewMemberFolder.path + '\n'), 'Member confirmation must not include the enclosing folder target');
  assert(fs.existsSync(reviewMemberFolder.path)); assert(!fs.existsSync(reviewMemberArchive.path));
  await closeResult(); await expectRows(beforeMemberDelete, 'Deleting a merged member must retain the representative row and remaining order');
  const retained = await page.evaluate(id => window.library.get(id), reviewMemberFolder.id);
  assert(retained && retained.path === reviewMemberFolder.path); assert(!retained.members?.some(item => item.id === reviewMemberArchive.id));
  const whole = await page.evaluate(id => window.library.get(id), reviewWholeFolder.id);
  assert(whole.members.some(item => item.id === reviewWholeArchive.id));
  await answer(1); await reviewRow(reviewWholeFolder.id).locator('.review-local-area').click({ button: 'right' });
  await context().locator('[data-context-id="delete"]').click(); await resultCounts(2); batch = await nativeState();
  assert.deepEqual(new Set(batch.calls), new Set([reviewWholeFolder.path, reviewWholeArchive.path]), 'Row-header deletion must still apply to the entire merged card');
  await closeResult(); await expectRows(beforeMemberDelete.filter(id => id !== reviewWholeFolder.id), 'Whole-card deletion must remove only that review row');
  await capture('review-member-delete-and-whole-card-delete');
  pass('review-expanded-member-deletes-only-that-file-while-row-header-deletes-the-whole-merged-card');
  await page.locator('.sidebar .nav-item').filter({ hasText: '全部素材' }).click(); await card(keeper.id).waitFor();

  phase = 'custom context menu controls and persistence';
  await settings(); const defaults = await prefs();
  await contextRow('copy-path').locator('input').uncheck();
  await saved(value => value.hidden.includes('copy-path'), 'Visibility checkbox was not saved');
  const deleteIndex = defaults.order.indexOf('delete');
  await contextRow('delete').locator('button').nth(0).click();
  await saved(value => value.order.indexOf('delete') === deleteIndex - 1, 'Move up was not saved');
  await contextRow('delete').locator('button').nth(1).click();
  await saved(value => value.order.indexOf('delete') === deleteIndex, 'Move down was not saved');
  await menuSettings().locator('.context-menu-settings-heading button').click();
  await saved(value => JSON.stringify(value) === JSON.stringify(defaults), 'Restore defaults did not reset order and visibility');
  await contextRow('delete').locator('button').nth(0).click();
  await saved(value => value.order.indexOf('delete') === deleteIndex - 1, 'Custom order did not settle');
  const customOrder = (await prefs()).order;
  for (const id of customOrder) { await contextRow(id).locator('input').uncheck(); await saved(value => value.hidden.includes(id), 'Hide-all checkbox did not save: ' + id); }
  const allHidden = await prefs(); assert.equal(allHidden.hidden.length, allHidden.order.length);
  await closeSettings(); await card(keeper.id).click({ button: 'right' });
  assert.deepEqual(await context().locator('[data-context-id]').evaluateAll(items => items.map(item => item.dataset.contextId)), ['settings']);
  await context().locator('[data-context-id="settings"]').click(); await menuSettings().waitFor();
  await capture('all-actions-hidden-settings-still-reachable'); await closeSettings();
  await close(); await launch(); assert.deepEqual(await prefs(), allHidden);
  await card(keeper.id).click({ button: 'right' }); await context().locator('[data-context-id="settings"]').click(); await menuSettings().waitFor();
  assert.equal(await menuSettings().locator('input:checked').count(), 0);
  assert.deepEqual(await menuSettings().locator('[data-context-action]').evaluateAll(items => items.map(item => item.dataset.contextAction)), customOrder);
  await menuSettings().locator('.context-menu-settings-heading button').click();
  await saved(value => JSON.stringify(value) === JSON.stringify(defaults), 'Defaults failed after restart');
  pass('context-settings-checkboxes-up-down-defaults-hide-all-escape-hatch-and-restart-persistence');

  phase = 'four themes and three languages';
  const headings = { 'zh-CN': '右键菜单', en: 'Context menu', ja: '右クリックメニュー' };
  const menuLabels = { 'zh-CN': '删除（移入回收站）', en: 'Delete (move to Recycle Bin)', ja: '削除（ゴミ箱へ移動）' };
  for (const language of ['zh-CN', 'en', 'ja']) for (const theme of ['x', 'x-light', 'nasa', 'swiss']) {
    await page.evaluate(options => window.library.setViewPreferences(options), { language, theme });
    await page.waitForFunction(options => document.documentElement.dataset.theme === options.theme && document.documentElement.lang === options.language, { language, theme });
    assert.equal((await menuSettings().locator('h3').innerText()).trim(), headings[language]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await menuSettings().scrollIntoViewIfNeeded(); await capture('settings-' + language + '-' + theme);
    await closeSettings(); await card(keeper.id).click({ button: 'right' });
    assert.equal((await context().locator('[data-context-id="delete"]').innerText()).trim(), menuLabels[language]);
    await page.keyboard.press('Escape'); await settings();
  }
  pass('settings-and-delete-menu-localize-in-all-twelve-theme-and-language-combinations');

  phase = '980px window at 200 percent';
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 800));
  await page.evaluate(() => window.library.setZoom(2));
  await menuSettings().scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  const deleteSettings = contextRow('delete'); await deleteSettings.scrollIntoViewIfNeeded();
  assert(await deleteSettings.locator('input').isVisible()); assert(await deleteSettings.locator('button').nth(0).isVisible());
  await capture('settings-980px-200pct'); await closeSettings();
  await card(keeper.id).scrollIntoViewIfNeeded();
  await card(keeper.id).evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: innerWidth - 1, clientY: innerHeight - 1 })));
  await context().waitFor();
  const bounds = await context().boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, 'Context menu overflowed the 200% viewport');
  await context().locator('[data-context-id="settings"]').scrollIntoViewIfNeeded(); await capture('context-menu-980px-200pct'); await page.keyboard.press('Escape');
  pass('settings-actions-and-context-menu-remain-reachable-at-980px-and-200-percent');

  phase = 'source integrity and retained annotations';
  await page.evaluate(() => window.library.setZoom(1)); await close();
  const expectedSource = { ...sourceBefore }, recycledFiles = {};
  for (const move of evidence.moves) {
    assert(within(move.path, source) && within(move.destination, recycled));
    const relative = path.relative(source, move.path), movedStat = fs.statSync(move.destination);
    const contents = movedStat.isDirectory() ? hashTree(move.destination) : { '': crypto.createHash('sha256').update(fs.readFileSync(move.destination)).digest('hex') };
    for (const [suffix, digest] of Object.entries(contents)) {
      const original = suffix ? path.join(relative, suffix) : relative;
      assert.equal(digest, sourceBefore[original], 'Moved synthetic source bytes changed: ' + original);
      assert(Object.hasOwn(expectedSource, original), 'A synthetic source was moved twice: ' + original);
      delete expectedSource[original]; recycledFiles[original] = digest;
    }
  }
  assert.deepEqual(hashTree(source), expectedSource); assert.deepEqual(renderErrors, []);
  const reopened = new Store(profile, [source]);
  try {
    for (const fixture of fixtures) {
      const raw = reopened.getRaw(fixture.id); assert(raw, 'Raw annotated record was deleted');
      assert(raw.manual.notes.startsWith('KEEP NOTES ')); assert.deepEqual(raw.manual.tags, ['KEEP QA']);
      const wasMoved = evidence.moves.some(move => fixture.path === move.path || within(fixture.path, move.path));
      assert.equal(!!raw.recycledAt, wasMoved, 'Recycle record state differs from successful mock OS moves');
    }
  } finally { reopened.close(); }
  assert(evidence.moves.length > 0); pass('only-approved-fixture-paths-moved-by-rename-all-bytes-and-human-annotations-retained-no-render-errors');
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ ...report(true), recycledFiles }, null, 2));
  console.log(JSON.stringify({ ok: true, checks: checks.length, report: path.join(runDir, 'report.json'), screenshots: screenshots.length }));
})().catch(async error => {
  console.error(error);
  if (app) {
    await capture('failure').catch(() => {});
    try { fs.writeFileSync(path.join(runDir, 'failure-dom.txt'), await page.locator('body').innerText()); } catch {}
    try {
      const diagnostic = await page.evaluate(async () => ({
        activeElement: document.activeElement?.outerHTML,
        snapshot: await window.library.snapshot(),
        selectedCards: [...document.querySelectorAll('.asset-card.selected')].map(element => element.dataset.assetId),
        reviewRows: [...document.querySelectorAll('.review-row')].map(element => element.dataset.assetId),
        hiddenSearch: document.querySelector('.hidden-search')?.value,
        selectedHidden: [...document.querySelectorAll('.hidden-entry')].filter(element => element.querySelector('input')?.checked).map(element => element.dataset.hiddenId),
        hiddenPageScroll: document.querySelector('section.hidden-page')?.scrollTop,
        modalScroll: [...document.querySelectorAll('.modal-body')].map(element => element.scrollTop)
      }));
      fs.writeFileSync(path.join(runDir, 'failure-diagnostics.json'), JSON.stringify(diagnostic, null, 2));
    } catch {}
    try { await close(); } catch (closeError) { renderErrors.push('Close: ' + closeError.message); }
  }
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report(false, error.stack || String(error)), null, 2));
  console.error('RECYCLE REPORT:', path.join(runDir, 'report.json')); process.exitCode = 1;
});
