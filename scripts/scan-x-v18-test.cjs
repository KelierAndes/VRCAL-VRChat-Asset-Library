// After build: node scripts/scan-x-v18-test.cjs
// GUI scan over private, valid synthetic ZIPs only; no existing library/material access.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const project = path.resolve(__dirname, '..');
const runDir = fs.mkdtempSync(path.join(path.dirname(project), 'scan-x-v18-'));
const profile = path.join(runDir, 'Library'), source = path.join(runDir, 'SyntheticSources'), localAppData = path.join(runDir, 'LocalAppData');
const checks = [], errors = [], captures = [];
let app, page, sourceBefore, scanResult, selectedMaterial, savedManual, scannedAssets;
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function pass(label) { checks.push(label); console.log('SCAN X V18 PASS:', label); }
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
// ZIP32, UTF-8 filenames, stored method, CRC and central directory. No external encoder needed.
function tinyZip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const [name, text] of entries) {
    const filename = Buffer.from(name, 'utf8'), data = Buffer.from(text, 'utf8'), crc = crc32(data);
    const local = Buffer.alloc(30), directory = Buffer.alloc(46), date = ((2026 - 1980) << 9) | (10 << 5) | 16;
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(12 << 11, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(12 << 11, 12); directory.writeUInt16LE(date, 14); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42); locals.push(local, filename, data); central.push(directory, filename);
    offset += local.length + filename.length + data.length;
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}
function write(relative, bytes) { const file = path.join(source, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
function manifest() {
  const rows = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name); assert(!fs.lstatSync(file).isSymbolicLink());
      const relative = path.relative(source, file).replaceAll('\\', '/');
      if (entry.isDirectory()) { rows.push({ name: relative, kind: 'directory' }); visit(file); }
      else rows.push({ name: relative, kind: 'file', bytes: fs.statSync(file).size, sha256: hash(file) });
    }
  }; visit(source); return rows;
}
function prepare() {
  for (const folder of [profile, source, localAppData]) fs.mkdirSync(folder, { recursive: true });
  const packageBytes = tinyZip([['説明書_日本語.txt', 'ローカル合成素材。ネットワーク不要。\n'], ['衣装🌸/Airi_粉色外套.prefab', '%YAML 1.1\n# Synthetic fixture only\n']]);
  write('角色樱/粉色外套/粉色外套.zip', packageBytes);
  write('角色樱/粉色外套/README_合成.txt', '这是扫描验收素材，不是真实商品。\n');
  write('さくら_衣装🌸_中文.zip', tinyZip([['日本語/中文🌸.txt', 'Standalone Unicode ZIP fixture\n'], ['Airi/衣装.prefab', '%YAML 1.1\n']]));
  write('海盐发饰.zip', tinyZip([['海盐发饰/Airi_饰品.prefab', '%YAML 1.1\n']]));
  write('海盐发饰/海盐发饰.prefab', '%YAML 1.1\n# Expanded sibling for aggregation\n');
  write('海盐发饰/README.txt', 'Expanded synthetic sibling; never imported.\n');
  for (const auxiliary of ['Material', 'PSD', '新建文件夹']) write(`${auxiliary}/README.txt`, 'Only an auxiliary organizational directory, not a product.\n');
  // Recognition requires all three standard Unity directories; no actual Unity execution.
  const unity = '工程合集/目录/樱花_测试Unity工程';
  write(`${unity}/Assets/README.txt`, 'Synthetic Unity project; do not launch.\n');
  write(`${unity}/Packages/manifest.json`, '{"dependencies":{}}\n');
  write(`${unity}/ProjectSettings/ProjectVersion.txt`, 'm_EditorVersion: 2022.3.22f1\n');
  sourceBefore = manifest(); fs.writeFileSync(path.join(runDir, 'source-before.json'), JSON.stringify(sourceBefore, null, 2));
  pass('Valid CRC/UTF-8 tiny ZIPs, Unicode paths, archive/expanded siblings, auxiliary folders and nested Unity fixture created');
}
async function launch() {
  app = await _electron.launch({ executablePath: process.env.VRC_UI_EXECUTABLE || require('electron'), args: process.env.VRC_UI_EXECUTABLE ? [] : [project],
    env: { ...process.env, LOCALAPPDATA: localAppData, VRC_LIBRARY_DATA_DIR: profile, VRC_LIBRARY_ROOT: source,
      VRC_LIBRARY_LOCATION_FILE: path.join(runDir, 'isolated-location.json'), VRC_LIBRARY_NO_NETWORK: '1', VRC_LIBRARY_NO_AUTOSCAN: '1', VRC_LIBRARY_TEST_HIDDEN: '1' } });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(`page: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await app.evaluate(({ BrowserWindow, session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/dist/renderer/')).webContents.setBackgroundThrottling(false);
  });
  await page.waitForSelector('.app-shell');
}
async function captureFailure() {
  const data = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/dist/renderer/'));
    await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await new Promise(resolve => setTimeout(resolve, 100));
    return (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  });
  const file = path.join(runDir, 'failure.png'); fs.writeFileSync(file, Buffer.from(data, 'base64')); captures.push(file);
}
async function run() {
  prepare(); await launch();
  await page.getByRole('heading', { name: '从你的素材文件夹开始', exact: true }).waitFor();
  let snapshot = await page.evaluate(() => window.library.snapshot()); assert.equal(snapshot.stats.total, 0); assert.equal(snapshot.settings.theme, 'x');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'x');
  const bridge = await page.evaluate(() => { const before = window.library.initialTheme; let wrote; try { wrote = Reflect.set(window.library, 'initialTheme', 'nasa'); } catch { wrote = false; } return { before, after: window.library.initialTheme, wrote }; });
  assert.deepEqual(bridge, { before: 'x', after: 'x', wrote: false }); pass('Private library starts empty in X with readonly initialTheme');
  await page.getByRole('button', { name: '刷新素材', exact: true }).click();
  await page.waitForFunction(async () => { const state = await window.library.snapshot(); return !!state.scan.finishedAt && !state.scan.running && state.stats.total > 0; }, undefined, { timeout: 30000 });
  await page.waitForSelector('.asset-card');
  await page.waitForFunction(() => document.querySelector('.asset-grid')?.getAttribute('aria-busy') === 'false');
  snapshot = await page.evaluate(() => window.library.snapshot()); scanResult = snapshot.scan;
  assert.equal(scanResult.running, false); assert(scanResult.found > 0); assert.deepEqual(scanResult.errors, []);
  assert.equal(snapshot.settings.theme, 'x'); assert.equal(snapshot.settings.xThemeIntroduced, true);
  scannedAssets = (await page.evaluate(() => window.library.list({ view: 'all', limit: 100 }))).items;
  assert(scannedAssets.length > 0); assert(scannedAssets.every(asset => path.resolve(asset.path).startsWith(path.resolve(source) + path.sep)));
  assert(scannedAssets.every(asset => !/^(?:Material|PSD|新建文件夹)$/i.test(asset.name)));
  const visibleNames = await page.locator('.asset-card h3').allTextContents(); assert(visibleNames.every(name => !/^(?:Material|PSD|新建文件夹)$/i.test(name)));
  const unicode = scannedAssets.find(asset => asset.name === 'さくら_衣装🌸_中文.zip' || asset.members?.some(member => member.name === 'さくら_衣装🌸_中文.zip'));
  assert(unicode, 'Independent Japanese/Chinese/emoji ZIP must be present');
  pass('GUI refresh completes without scan errors, preserves X and displays Unicode material cards while auxiliary bare cards stay excluded');
  const recognizedProject = scannedAssets.find(asset => asset.kind === 'unity-project' && asset.name === '樱花_测试Unity工程');
  assert(recognizedProject, 'Nested Unity project must be recognized');
  await page.getByRole('button', { name: /工程与成品/ }).click();
  await page.locator(`.asset-card[data-asset-id="${recognizedProject.id}"]`).waitFor(); pass('Nested Unity project is recognized and appears in the project gallery');
  selectedMaterial = { id: unicode.id, name: unicode.name, path: unicode.path };
  await page.evaluate(id => window.library.annotate([id], { category: '服装', tags: ['X 扫描验收', '日本語🌸'], notes: '离线扫描、重启与原文件保护验收。', favorite: true }), selectedMaterial.id);
  savedManual = (await page.evaluate(id => window.library.get(id), selectedMaterial.id)).manual;
  assert.equal(savedManual.category, '服装'); assert.equal(savedManual.favorite, true); assert.deepEqual(savedManual.tags, ['X 扫描验收', '日本語🌸']);
  await page.getByLabel('界面主题', { exact: true }).selectOption('swiss');
  await page.waitForFunction(async () => document.documentElement.dataset.theme === 'swiss' && (await window.library.snapshot()).settings.theme === 'swiss');
  await app.close(); app = undefined; await launch();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'swiss');
  snapshot = await page.evaluate(() => window.library.snapshot()); assert.equal(snapshot.settings.theme, 'swiss'); assert.equal(snapshot.settings.xThemeIntroduced, true);
  assert.equal(await page.evaluate(() => window.library.initialTheme), 'swiss');
  const restored = await page.evaluate(id => window.library.get(id), selectedMaterial.id); assert(restored); assert.deepEqual(restored.manual, savedManual);
  pass('Manual clothing category/tags/notes/favorite and Swiss choice survive restart with introduction marker retained');
  assert.deepEqual(manifest(), sourceBefore); pass('All synthetic source file/directory names, sizes and SHA-256 hashes remain unchanged');
  assert.deepEqual(errors, []); pass('No renderer exceptions or error console messages');
}
function report(ok, error) {
  const file = path.join(runDir, 'report.json'); fs.writeFileSync(file, JSON.stringify({ ok, checks, errors, error: error?.stack,
    runDir, profile, source, executable: process.env.VRC_UI_EXECUTABLE || 'local electron', scanResult, selectedMaterial,
    savedManual, scannedAssets: scannedAssets?.map(({ id, name, path, kind, members }) => ({ id, name, path, kind, members })), captures,
    sourceBefore, isolation: 'Fresh private profile and wholly synthetic UTF-8 ZIP/folder fixtures; GUI refresh only, no import/unpack/network/account flow' }, null, 2));
  console.log('SCAN X V18 REPORT:', file);
}
(async () => {
  try { await run(); report(true); }
  catch (error) { if (app && page) try { await captureFailure(); } catch (captureError) { errors.push(`Failure capture: ${captureError.message}`); } report(false, error); console.error(error); process.exitCode = 1; }
  finally { if (app) await app.close(); }
})();
