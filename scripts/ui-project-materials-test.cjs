/* Read-only Unity project discovery through the real renderer/preload/IPC. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const { Store } = require('../dist/main/main/store');

const root = path.resolve(__dirname, '..');
const startedAt = Date.now();
const runDir = path.resolve(root, '..', `project-materials-qa-${startedAt}`);
const source = path.join(runDir, '素材与工程 日本語 📦');
const profile = path.join(runDir, '资料库');
const backupDir = path.join(runDir, '手动选择备份');
const backup = path.join(backupDir, 'project.vrclib.json');
const projectPath = path.join(source, 'QA工程 星の衣装 ✨');
const checked = [], errors = [];
let app, page;
for (const directory of [source, path.join(profile, 'cache'), backupDir,
  path.join(projectPath, 'Assets', 'Vendor', 'NebulaRibbon Coat'), path.join(projectPath, 'Packages'),
  path.join(projectPath, 'ProjectSettings'), path.join(projectPath, 'Library', 'ManualOnly Gloves')]) fs.mkdirSync(directory, { recursive: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cMTkAAAAASUVORK5CYII=', 'base64');
const coverFile = crypto.createHash('sha256').update(png).digest('hex') + '.png';
fs.writeFileSync(path.join(profile, 'cache', coverFile), png);
fs.writeFileSync(path.join(projectPath, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1');
fs.writeFileSync(path.join(projectPath, 'Packages', 'manifest.json'), '{"dependencies":{}}');
const prefab = path.join(projectPath, 'Assets', 'Vendor', 'NebulaRibbon Coat', 'NebulaRibbon Coat.prefab');
const model = path.join(projectPath, 'Assets', 'QuartzHalo Charm.fbx');
fs.writeFileSync(prefab, 'Unity prefab fixture; do not modify.');
fs.writeFileSync(model, 'Read-only FBX name discovery fixture.');
fs.writeFileSync(path.join(projectPath, 'Assets', 'TwinNebula Ribbon.prefab'), 'Two distinct catalogue products share this local name.');
fs.writeFileSync(path.join(projectPath, 'Library', 'ManualOnly Gloves', 'ManualOnly Gloves.prefab'), 'Unity cache must not establish material usage.');
fs.writeFileSync(path.join(projectPath, 'Assets', 'Body.prefab'), 'Generic project file is not catalogue identification.');

const store = new Store(profile, [source]);
function addMaterial(name, directory = source) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, name + '.zip'); fs.writeFileSync(file, `readonly archive ${name}`);
  const asset = store.upsertScan({ path: file, name, kind: 'archive', group: 'QA素材', size: 128, mtimeMs: Date.now(),
    localCategory: '服装', localAvatars: ['Shinra'], hintUrls: [] });
  store.updateManual([asset.id], { tags: ['QA保留'], notes: `原标注 ${name}` });
  store.updateOnline(asset.id, { status: 'matched', author: 'QA独立作者', coverFile }); return asset;
}
const coat = addMaterial('NebulaRibbon Coat');
const charm = addMaterial('QuartzHalo Charm');
const manualOnly = addMaterial('ManualOnly Gloves');
const unrelated = addMaterial('UnrelatedStarlight Shoes');
const ambiguousA = addMaterial('TwinNebula Ribbon', path.join(source, '独立作者 A'));
const ambiguousB = addMaterial('TwinNebula Ribbon', path.join(source, '独立作者 B'));
store.updateOnline(ambiguousA.id, { author: 'QAA独立作者' });
store.updateOnline(ambiguousB.id, { author: 'QAB独立作者' });
const project = store.upsertScan({ path: projectPath, name: 'QA工程 星の衣装 ✨', kind: 'unity-project', group: 'QA工程',
  size: 0, mtimeMs: Date.now(), localCategory: '工程', localAvatars: [], hintUrls: [] });
store.updateManual([project.id], { notes: '工程备注必须保留', projectStatus: '制作中' });
store.saveSettings({ onlineEnabled: false });
store.close();

function treeHashes() {
  const result = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else result[path.relative(source, full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  }
  visit(source); return result;
}
const sourceBefore = treeHashes();
function pass(label) { checked.push(label); console.log('PROJECT PASS:', label); }
async function wait(check, message) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await check()) return; await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error(message);
}
async function launch() {
  app = await _electron.launch({ executablePath: process.env.VRC_UI_EXECUTABLE || require('electron'),
    args: process.env.VRC_UI_EXECUTABLE ? [] : [root], env: { ...process.env, VRC_LIBRARY_DATA_DIR: profile,
      VRC_LIBRARY_ROOT: source, VRC_LIBRARY_NO_NETWORK: '1', VRC_LIBRARY_NO_AUTOSCAN: '1', VRC_LIBRARY_TEST_HIDDEN: '1' } });
  page = await app.firstWindow(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.library);
  await app.evaluate(({ BrowserWindow, dialog }, destinations) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destinations.backup });
    dialog.showOpenDialog = async (_window, options) => ({ canceled: false,
      filePaths: [(options || _window).properties?.includes('openDirectory') ? destinations.backupDir : destinations.backup] });
    dialog.showMessageBox = async () => ({ response: 0 });
  }, { backup, backupDir });
  await page.locator('.asset-card').first().waitFor();
}
async function close() { if (app) { await app.close(); app = undefined; } }
const section = () => page.getByRole('region', { name: '工程内素材', exact: true });
const matchCard = id => section().locator(`.project-material-card[data-asset-id="${id}"]`);
async function selectProject() {
  await page.locator('.sidebar .nav-item').filter({ hasText: '工程与成品' }).click();
  await page.locator(`.asset-card[data-asset-id="${project.id}"]`).click();
  await page.locator('.detail-title h2').getByText(project.name, { exact: true }).waitFor();
  await section().waitFor();
}
async function materials(refresh = false) { return page.evaluate(({ id, refresh }) => window.library.projectMaterials(id, refresh), { id: project.id, refresh }); }
async function expectRelation(id, relation) {
  await wait(async () => (await materials()).items.some(item => item.assetId === id && item.relation === relation), `${id} 应标记为 ${relation}`);
}
async function capture(destination) {
  const bytes = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise(resolve => setTimeout(resolve, 120));
    return (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  });
  fs.writeFileSync(destination, Buffer.from(bytes, 'base64'));
}
function report(ok, error) { return { ok, checked, errors, error, durationMs: Date.now() - startedAt, runDir, source, profile, projectPath, backup,
  screenshot: path.join(runDir, 'project-materials.png') }; }

(async () => {
  await launch();
  const catalogBefore = (await page.evaluate(() => window.library.list({ view: 'all', limit: 100 }))).items.map(asset => asset.id).sort();
  const discovered = await materials();
  assert.equal(discovered.projectId, project.id); assert(Number.isFinite(Date.parse(discovered.scannedAt)));
  assert(discovered.inspectedEntries >= 3); assert.equal(discovered.truncated, false); assert(Array.isArray(discovered.warnings));
  assert.deepEqual(discovered.items.map(item => item.assetId).sort(), [coat.id, charm.id, ambiguousA.id, ambiguousB.id].sort());
  assert(discovered.items.filter(item => [coat.id, charm.id].includes(item.assetId)).every(item => item.relation === 'detected'));
  assert(!discovered.items.some(item => item.assetId === manualOnly.id || item.assetId === unrelated.id));
  pass('real-project-materials-ipc-detects-existing-catalogue-and-excludes-unity-cache-or-unrelated-assets');
  assert(discovered.items.filter(item => [ambiguousA.id, ambiguousB.id].includes(item.assetId)).every(item => item.relation === 'uncertain'));
  assert(discovered.warnings.some(warning => warning.includes('多个') && warning.includes('不确定')));
  pass('duplicate-product-name-evidence-remains-uncertain-instead-of-choosing-one-asset');
  const coatEvidence = discovered.items.find(item => item.assetId === coat.id).evidence;
  const charmEvidence = discovered.items.find(item => item.assetId === charm.id).evidence;
  assert(coatEvidence.some(evidence => evidence.kind === 'directory' && evidence.name === 'NebulaRibbon Coat'));
  assert(coatEvidence.some(evidence => evidence.kind === 'prefab' && evidence.name.includes('NebulaRibbon Coat')));
  assert(charmEvidence.some(evidence => evidence.kind === 'model' && evidence.name.includes('QuartzHalo Charm')));
  for (const evidence of [...coatEvidence, ...charmEvidence]) {
    assert(evidence.path && evidence.alias); const resolved = path.isAbsolute(evidence.path) ? evidence.path : path.resolve(projectPath, evidence.path);
    assert(fs.existsSync(resolved), `工程依据必须对应真实本地文件：${resolved}`);
    assert(resolved.toLowerCase().startsWith(path.join(projectPath, 'Assets').toLowerCase() + path.sep));
  }
  pass('discovery-evidence-has-real-directory-prefab-model-paths-and-names');

  await selectProject(); await matchCard(coat.id).waitFor(); await matchCard(charm.id).waitFor();
  assert.equal(await section().locator('.project-material-card').count(), 4);
  await matchCard(coat.id).getByText('工程文件线索', { exact: true }).waitFor();
  await matchCard(charm.id).getByText('工程文件线索', { exact: true }).waitFor();
  await matchCard(ambiguousA.id).getByText('待核对', { exact: true }).waitFor();
  await matchCard(ambiguousB.id).getByText('待核对', { exact: true }).waitFor();
  assert((await section().locator('.project-material-warnings').innerText()).includes('不确定'));
  const covers = section().locator('.project-material-card img'); assert.equal(await covers.count(), 4);
  for (let index = 0; index < 4; index++) {
    await covers.nth(index).scrollIntoViewIfNeeded();
    await wait(() => covers.nth(index).evaluate(image => image.naturalWidth > 0), '工程关联素材应加载已有封面');
  }
  await matchCard(coat.id).locator('details summary').click();
  assert((await matchCard(coat.id).innerText()).includes('NebulaRibbon Coat.prefab'));
  pass('project-detail-detected-cards-cover-and-expandable-file-evidence-are-visible');
  const notes = (await page.evaluate(id => window.library.get(id), project.id)).manual.notes;
  await section().getByRole('button', { name: '刷新工程素材', exact: true }).click();
  await matchCard(coat.id).waitFor();
  assert.deepEqual((await page.evaluate(() => window.library.list({ view: 'all', limit: 100 }))).items.map(asset => asset.id).sort(), catalogBefore);
  assert.equal((await page.evaluate(id => window.library.get(id), project.id)).manual.notes, notes);
  assert.equal((await page.evaluate(id => window.library.get(id), project.id)).manual.projectStatus, '制作中');
  assert.deepEqual(treeHashes(), sourceBefore);
  pass('refresh-inspects-project-readonly-without-adding-catalogue-cards-or-altering-project-annotations');

  await section().getByRole('button', { name: '手动关联素材', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '关联素材', exact: true });
  await dialog.getByRole('textbox', { name: '搜索关联素材', exact: true }).fill(manualOnly.name);
  await dialog.locator('.relation-entry').filter({ hasText: manualOnly.name }).getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expectRelation(manualOnly.id, 'manual'); await matchCard(manualOnly.id).getByText('手动关联', { exact: true }).waitFor();
  assert((await page.evaluate(id => window.library.get(id), project.id)).manual.relatedIds.includes(manualOnly.id));
  pass('manual-project-material-link-uses-existing-dialog-and-real-persisted-annotations');
  await section().getByRole('button', { name: '手动关联素材', exact: true }).click();
  await dialog.getByRole('textbox', { name: '搜索关联素材', exact: true }).fill(coat.name);
  await dialog.locator('.relation-entry').filter({ hasText: coat.name }).getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expectRelation(coat.id, 'both'); await matchCard(coat.id).getByText('手动关联＋文件线索', { exact: true }).waitFor();
  assert.equal(await section().locator('.project-material-card').count(), 5);
  pass('manual-plus-detected-material-is-one-card-with-distinct-both-provenance');

  await section().getByRole('button', { name: `查看工程关联素材：${coat.name}`, exact: true }).click();
  await page.locator('.detail-title h2').getByText(coat.name, { exact: true }).waitFor();
  const back = page.getByRole('button', { name: `返回工程：${project.name}`, exact: true }); await back.waitFor(); await back.click();
  await page.locator('.detail-title h2').getByText(project.name, { exact: true }).waitFor(); await matchCard(coat.id).waitFor();
  await matchCard(manualOnly.id).waitFor();
  pass('project-material-opens-details-and-return-to-project-preserves-results');
  await section().scrollIntoViewIfNeeded();
  await section().evaluate(element => element.scrollIntoView({ block: 'start' }));
  await capture(path.join(runDir, 'project-materials.png'));
  await page.evaluate(() => window.library.backup());
  const saved = JSON.parse(fs.readFileSync(backup, 'utf8'));
  assert.deepEqual(saved.assets.find(asset => asset.id === project.id).manual.relatedIds.sort(), [manualOnly.id, coat.id].sort());
  await close(); await launch(); await selectProject();
  await matchCard(manualOnly.id).getByText('手动关联', { exact: true }).waitFor();
  await matchCard(coat.id).getByText('手动关联＋文件线索', { exact: true }).waitFor();
  await expectRelation(manualOnly.id, 'manual'); await expectRelation(coat.id, 'both');
  pass('manual-and-combined-project-associations-survive-restart-and-are-in-backup');
  await page.evaluate(id => window.library.annotate([id], { relatedIds: [] }), project.id);
  await expectRelation(coat.id, 'detected'); assert(!(await materials()).items.some(item => item.assetId === manualOnly.id));
  assert.equal(await page.evaluate(() => window.library.restore()), true);
  await expectRelation(manualOnly.id, 'manual'); await expectRelation(coat.id, 'both');
  pass('integrity-checked-backup-restores-manual-project-links-while-retaining-readonly-detection');

  const rejected = await page.evaluate(async id => { try { await window.library.projectMaterials(id, true); return false; } catch { return true; } }, coat.id);
  assert.equal(rejected, true, '素材包不能当作Unity工程执行工程识别');
  assert.deepEqual((await page.evaluate(() => window.library.list({ view: 'all', limit: 100 }))).items.map(asset => asset.id).sort(), catalogBefore);
  assert.deepEqual(treeHashes(), sourceBefore); assert.deepEqual(errors, []);
  pass('nonproject-inspection-rejected-catalogue-and-all-source-project-hashes-unchanged-no-render-errors');
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report(true), null, 2));
  console.log(JSON.stringify(report(true), null, 2)); await close();
})().catch(async error => {
  console.error(error); fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report(false, error.stack || String(error)), null, 2));
  if (app) { try { console.error(await page.locator('body').innerText()); await capture(path.join(runDir, 'failure.png')); } catch {} try { await close(); } catch {} }
  process.exitCode = 1;
});
