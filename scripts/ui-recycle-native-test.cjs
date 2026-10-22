/* Native Windows Recycle Bin acceptance. Only two newly created GUID paths are
 * eligible. No trash mock, permanent deletion, bin emptying or fixture cleanup. */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { _electron } = require('playwright');
const { Store } = require('../dist/main/main/store');

const repo = path.resolve(__dirname, '..');
const guid = crypto.randomUUID();
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrcal-native-recycle-'));
const source = path.join(runDir, 'GUID Fixtures');
const profile = path.join(runDir, 'Private Library');
const artifacts = path.join(repo, 'outputs', 'native-recycle-' + guid);
const configFile = path.join(artifacts, 'exact-shell-targets.json');
const reportFile = path.join(artifacts, 'report.json');
const startedAt = Date.now(), checks = [], screenshots = [], rendererErrors = [];
const packaged = !!process.env.VRC_TEST_APP_EXECUTABLE;
const targets = [
  { name: 'vrcal-native-file-' + guid + '.fbx', isFolder: false },
  { name: 'vrcal-native-folder-' + guid, isFolder: true }
].map(target => ({ ...target, path: path.join(source, target.name) }));
let app, page, phase = 'prepare', original, initialAssets, nativeResult;
let shellBefore, shellAfterRecycle, shellAfterRestore, restoreRequest, failureRecovery;
let genuineTrashVerified = false;

// The shell only exposes candidates whose name contains this run's GUID and
// whose DeletedFrom exactly equals the private root. Other bin entries are not
// inspected beyond their name, logged, restored or changed.
const POWERSHELL_SOURCE = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$config = Get-Content -LiteralPath $env:VRCAL_NATIVE_RECYCLE_CONFIG -Raw | ConvertFrom-Json
if ($config.guid -notmatch '^[a-f0-9-]{36}$' -or @($config.targets).Count -ne 2) { throw 'Invalid exact-target fixture configuration' }
function Normalize-LocalPath([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  return [System.IO.Path]::GetFullPath($value).TrimEnd([char[]]@('\','/')).ToLowerInvariant()
}
$root = Normalize-LocalPath ([string]$config.source)
foreach ($target in $config.targets) {
  if ((Normalize-LocalPath ([System.IO.Path]::GetDirectoryName([string]$target.path))) -ne $root -or
      ([System.IO.Path]::GetFileName([string]$target.path)) -cne [string]$target.name -or
      ([string]$target.name).IndexOf([string]$config.guid, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw 'Refused a target outside the exact GUID fixture root'
  }
}
$shell = New-Object -ComObject Shell.Application
$bin = $shell.Namespace(10)
if ($null -eq $bin) { throw 'Windows Recycle Bin namespace is unavailable' }
$matches = @()
foreach ($item in $bin.Items()) {
  $name = [string]$item.Name
  if ($name.IndexOf([string]$config.guid, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
  $deletedFrom = [string]$item.ExtendedProperty('System.Recycle.DeletedFrom')
  if ((Normalize-LocalPath $deletedFrom) -ne $root) { continue }
  $isFolder = [bool]$item.IsFolder
  $candidates = @($config.targets | Where-Object {
    [bool]$_.isFolder -eq $isFolder -and
    ($name -ceq [string]$_.name -or
      (-not $isFolder -and $name -ceq [System.IO.Path]::GetFileNameWithoutExtension([string]$_.name)))
  })
  if ($candidates.Count -ne 1) { throw 'A GUID recycle entry has an unexpected name or type; no restore was attempted' }
  $matches += [pscustomobject]@{ Item = $item; Target = $candidates[0]; Name = $name; DeletedFrom = $deletedFrom; IsFolder = $isFolder }
}
if ($matches.Count -gt 2 -or @($matches | ForEach-Object { $_.Target.path } | Select-Object -Unique).Count -ne $matches.Count) {
  throw 'Duplicate GUID recycle entries found; no restore was attempted'
}
$restored = @()
if ($env:VRCAL_NATIVE_RECYCLE_MODE -eq 'restore') {
  if ($env:VRCAL_NATIVE_RECYCLE_ALLOW_PARTIAL -ne '1' -and $matches.Count -ne 2) { throw 'Expected exactly two matching recycle entries before restore' }
  foreach ($match in $matches) {
    if (Test-Path -LiteralPath ([string]$match.Target.path)) { throw 'Refused restore because an original fixture path already exists' }
  }
  foreach ($match in $matches) {
    [void]$match.Item.InvokeVerb('undelete')
    $restored += [string]$match.Target.path
  }
} elseif ($env:VRCAL_NATIVE_RECYCLE_MODE -ne 'inspect') { throw 'Unknown exact-target shell mode' }
[pscustomobject]@{
  entries = @($matches | ForEach-Object { [pscustomobject]@{ name = $_.Name; deletedFrom = $_.DeletedFrom; isFolder = $_.IsFolder; originalPath = $_.Target.path } })
  restoreRequested = @($restored)
} | ConvertTo-Json -Depth 5 -Compress
`;

function pass(message) { checks.push(message); console.log('NATIVE RECYCLE PASS:', message); }
function key(file) { return path.resolve(file).toLowerCase(); }
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function tree(directory) {
  const entries = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, entry.name), relative = path.relative(directory, file);
      assert(!entry.isSymbolicLink(), 'A private fixture must not contain a link');
      if (entry.isDirectory()) { entries.push({ path: relative, type: 'folder' }); visit(file); }
      else { assert(entry.isFile(), 'A private fixture must contain only regular files'); entries.push({ path: relative, type: 'file', sha256: hash(file), bytes: fs.statSync(file).size }); }
    }
  }
  visit(directory);
  return { entries, sha256: crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
}
function assertPrivateTargets() {
  assert.equal(fs.realpathSync(source), path.resolve(source));
  assert.deepEqual(fs.readdirSync(source).sort(), targets.map(target => target.name).sort());
  for (const target of targets) {
    assert.equal(path.dirname(target.path), source);
    assert(target.name.includes(guid));
    const stat = fs.lstatSync(target.path);
    assert(!stat.isSymbolicLink());
    assert.equal(stat.isDirectory(), target.isFolder);
    assert.equal(stat.isFile(), !target.isFolder);
    assert.equal(fs.realpathSync(target.path), path.resolve(target.path));
  }
}
function shellQuery(mode, options = {}) {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(POWERSHELL_SOURCE, 'utf16le').toString('base64')], {
    env: { ...process.env, VRCAL_NATIVE_RECYCLE_CONFIG: configFile, VRCAL_NATIVE_RECYCLE_MODE: mode,
      VRCAL_NATIVE_RECYCLE_ALLOW_PARTIAL: options.allowPartial ? '1' : '0' },
    encoding: 'utf8', timeout: options.timeout || 12000, windowsHide: true, maxBuffer: 256 * 1024
  });
  return JSON.parse(output.replace(/^\uFEFF/, '').trim());
}
async function wait(check, message, maximum = 15000) {
  const deadline = Date.now() + Math.min(maximum, 15000);
  while (Date.now() < deadline) {
    if (await check(Math.max(1, deadline - Date.now()))) return;
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(200, remaining)));
  }
  throw new Error(message);
}
function rawRecords() {
  const db = new DatabaseSync(path.join(profile, 'library.sqlite'), { readOnly: true });
  try {
    return targets.map(target => {
      const row = db.prepare('SELECT record FROM assets WHERE path=?').get(target.path);
      assert(row, 'The private library must retain each registered original record');
      return JSON.parse(row.record);
    });
  } finally { db.close(); }
}
function restoredExactly() {
  if (!targets.every(target => fs.existsSync(target.path))) return false;
  assertPrivateTargets();
  assert.equal(hash(targets[0].path), original.fileSha256);
  assert.deepEqual(tree(targets[1].path), original.folder);
  assert.equal(hash(original.coverPath), original.coverSha256);
  return true;
}
async function capture(name) {
  if (!app) return;
  const file = path.join(artifacts, name + '.png');
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('/renderer/index.html'));
    if (!win) throw new Error('The fixture renderer window is unavailable');
    await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    return (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  });
  fs.writeFileSync(file, Buffer.from(base64, 'base64')); screenshots.push(file);
}
function report(ok, error) {
  return { ok, phase, error, checks, guid, packaged, executable: process.env.VRC_TEST_APP_EXECUTABLE || require('electron'),
    runDir, source, profile, exactNativeTargets: targets, original, initialAssets, nativeResult,
    shellBefore, shellAfterRecycle, shellAfterRestore, restoreRequest, failureRecovery, rendererErrors, screenshots,
    genuineShellTrashItemVerified: genuineTrashVerified, nativeRestoreVerb: 'undelete', maximumRestorePollMs: 15000,
    unrelatedRecycleItemsTouched: false, permanentDeletionUsed: false, fixturesRetained: true,
    durationMs: Date.now() - startedAt };
}

(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  assert.equal(process.platform, 'win32', 'This acceptance requires the real Windows Recycle Bin');
  fs.mkdirSync(source); fs.mkdirSync(targets[1].path);
  fs.writeFileSync(targets[0].path, Buffer.from('VRCAL native file fixture\n' + guid + '\n素材 日本語\n'));
  fs.writeFileSync(path.join(targets[1].path, 'inside-source.fbx'), 'Synthetic folder model\n' + guid);
  fs.mkdirSync(path.join(targets[1].path, '空目录 Empty'));
  fs.mkdirSync(path.join(targets[1].path, 'Nested'));
  fs.writeFileSync(path.join(targets[1].path, 'Nested', '说明 日本語.txt'), 'Synthetic nested data\n' + guid);
  assertPrivateTargets();
  fs.writeFileSync(configFile, JSON.stringify({ guid, source, targets }, null, 2));
  shellBefore = shellQuery('inspect');
  assert.equal(shellBefore.entries.length, 0, 'The new GUID must not already exist in this fixture root\'s Recycle Bin entries');

  const store = new Store(profile, [source]);
  let coverPath;
  try {
    store.saveSettings({ onlineEnabled: false, theme: 'x-light', language: 'zh-CN', xThemeIntroduced: true });
    const coverName = 'native-cover-' + guid + '.png';
    coverPath = path.join(profile, 'cache', coverName);
    fs.mkdirSync(path.dirname(coverPath), { recursive: true });
    fs.writeFileSync(coverPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c3n8AAAAASUVORK5CYII=', 'base64'));
    initialAssets = targets.map((target, index) => {
      const stat = fs.statSync(target.path);
      const asset = store.upsertScan({ path: target.path, name: target.name, kind: target.isFolder ? 'folder' : 'file',
        group: 'GUID native fixture', size: stat.isFile() ? stat.size : 0, mtimeMs: stat.mtimeMs,
        localCategory: '饰品', localAvatars: [], hintUrls: [] });
      store.updateManual([asset.id], { notes: 'KEEP native fixture notes ' + index + ' ' + guid,
        tags: ['KEEP ' + guid, '人工标签 日本語'], coverFile: coverName, favorite: true });
      return store.getRaw(asset.id);
    });
  } finally { store.close(); }
  original = { fileSha256: hash(targets[0].path), folder: tree(targets[1].path), coverPath, coverSha256: hash(coverPath) };
  pass('Created exactly one GUID file and one GUID folder; original SHA256 and annotations recorded');

  phase = 'launch genuine packaged app and bridge';
  const env = { ...process.env, VRC_LIBRARY_DATA_DIR: profile, VRC_LIBRARY_ROOT: source,
    VRC_LIBRARY_LOCATION_FILE: path.join(runDir, 'private-location.json'),
    VRC_LIBRARY_NO_NETWORK: '1', VRC_LIBRARY_NO_AUTOSCAN: '1', VRC_LIBRARY_NO_RELAUNCH: '1', VRC_LIBRARY_TEST_HIDDEN: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: process.env.VRC_TEST_APP_EXECUTABLE || require('electron'), args: packaged ? [] : [repo], env });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => rendererErrors.push(error.stack || error.message));
  await page.waitForFunction(() => !!window.library?.recycleAssets && !!window.library?.scan);
  await page.locator('.asset-card').first().waitFor();
  const startingState = await page.evaluate(async ids => Promise.all(ids.map(id => window.library.get(id))), initialAssets.map(asset => asset.id));
  assert.deepEqual(startingState.map(asset => asset.manual), initialAssets.map(asset => asset.manual));
  await app.evaluate(({ BrowserWindow, dialog, shell }, options) => {
    const path = process.mainModule.require('node:path');
    const normalized = values => values.map(value => path.resolve(value).toLowerCase()).sort();
    globalThis.__nativeRecycleQA = { originalTrashItem: shell.trashItem, confirmations: [] };
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    dialog.showMessageBox = async (parent, settings) => {
      const value = settings || parent;
      const shown = String(value.detail || '').split(/\r?\n/).map(line => line.trim()).filter(line => /^(?:[A-Za-z]:[\\/]|\/)/.test(line));
      if (value.type !== 'warning' || value.defaultId !== 0 || value.cancelId !== 0 ||
          JSON.stringify(normalized(shown)) !== JSON.stringify(normalized(options.paths))) {
        throw new Error('Native acceptance refused a confirmation that did not contain exactly the two GUID paths');
      }
      globalThis.__nativeRecycleQA.confirmations.push({ title: value.title, message: value.message, detail: value.detail });
      return { response: 1, checkboxChecked: false };
    };
  }, { paths: targets.map(target => target.path) });
  await capture('01-before-native-recycle');

  phase = 'real shell.trashItem through renderer preload IPC';
  assertPrivateTargets();
  nativeResult = await page.evaluate(ids => window.library.recycleAssets(ids, 'file'), initialAssets.map(asset => asset.id));
  assert.equal(nativeResult.cancelled, false);
  assert.equal(nativeResult.results.length, 2);
  assert.deepEqual(nativeResult.results.map(result => key(result.path)).sort(), targets.map(target => key(target.path)).sort());
  assert(nativeResult.results.every(result => result.status === 'recycled'), JSON.stringify(nativeResult));
  assert(targets.every(target => !fs.existsSync(target.path)), 'Native trash must remove both original paths');
  const genuine = await app.evaluate(({ shell }) => ({ untouched: shell.trashItem === globalThis.__nativeRecycleQA.originalTrashItem,
    confirmations: globalThis.__nativeRecycleQA.confirmations.length }));
  assert.equal(genuine.untouched, true, 'The real shell.trashItem must never be replaced');
  genuineTrashVerified = true;
  assert.equal(genuine.confirmations, 1);
  assert(rawRecords().every(record => typeof record.recycledAt === 'string' && record.missing === true));
  const absent = await page.evaluate(async ids => Promise.all(ids.map(id => window.library.get(id))), initialAssets.map(asset => asset.id));
  assert.deepEqual(absent, [null, null]);
  pass('Real Electron shell.trashItem recycled only the two GUID paths and persisted tombstones');
  await wait(remaining => {
    shellAfterRecycle = shellQuery('inspect', { timeout: Math.min(remaining, 5000) });
    return shellAfterRecycle.entries.length === 2;
  }, 'The two exact GUID entries were not visible in Windows Recycle Bin within 15 seconds');
  assert.deepEqual(shellAfterRecycle.entries.map(entry => key(entry.originalPath)).sort(), targets.map(target => key(target.path)).sort());
  assert(shellAfterRecycle.entries.every(entry => key(entry.deletedFrom) === key(source)));
  await wait(async () => (await page.evaluate(() => window.library.list({ view: 'all', limit: 100 }))).total === 0, 'Recycled items remained visible');
  await capture('02-native-recycle-tombstones');

  phase = 'Windows Shell undelete of exact GUID entries';
  restoreRequest = shellQuery('restore');
  assert.equal(restoreRequest.restoreRequested.length, 2);
  await wait(() => restoredExactly(), 'Windows undelete did not restore exact original paths and hashes within 15 seconds');
  await wait(remaining => {
    shellAfterRestore = shellQuery('inspect', { timeout: Math.min(remaining, 5000) });
    return shellAfterRestore.entries.length === 0;
  }, 'Restored GUID entries remained in Windows Recycle Bin');
  pass('Shell.Application Namespace(10) undelete restored exact paths, file SHA256 and the complete folder tree');

  phase = 'real scan clears tombstones and preserves annotations';
  await page.evaluate(() => window.library.scan());
  await page.waitForFunction(async () => !(await window.library.snapshot()).scan.running);
  const restored = await page.evaluate(async ids => Promise.all(ids.map(id => window.library.get(id))), initialAssets.map(asset => asset.id));
  assert(restored.every(Boolean), 'Restored sources must reappear through the real preload API');
  const rawAfter = rawRecords();
  rawAfter.forEach((record, index) => {
    assert.equal(record.recycledAt, undefined, 'The scan must clear the recycle tombstone');
    assert.equal(record.missing, false);
    assert.equal(record.id, initialAssets[index].id, 'Restoration must keep the original asset identity');
    assert.deepEqual(record.manual, initialAssets[index].manual, 'Original notes, tags, manual cover and favorite must survive');
    assert.deepEqual(restored[index].manual, initialAssets[index].manual);
  });
  assert(restoredExactly());
  await wait(async () => (await page.locator('.asset-card').count()) === 2, 'The restored source cards did not render');
  await capture('03-restored-after-real-scan');
  assert.deepEqual(rendererErrors, []);
  pass('window.library.scan() cleared tombstones while preserving IDs, notes, manual cover bytes and tags');
  await app.close(); app = undefined;
  phase = 'complete';
  fs.writeFileSync(reportFile, JSON.stringify(report(true), null, 2));
  console.log(JSON.stringify({ ok: true, report: reportFile, checks: checks.length, exactNativeTargets: targets.map(target => target.path) }));
})().catch(async error => {
  console.error(error);
  if (app) {
    await capture('failure').catch(() => {});
    await app.close().catch(() => {}); app = undefined;
  }
  // On a partial native failure, attempt only the same fully matched synthetic
  // entries. A failed recovery stays a failure and is described in the report.
  if (fs.existsSync(configFile) && process.platform === 'win32') {
    try {
      const remaining = shellQuery('inspect');
      failureRecovery = { remainingBefore: remaining.entries };
      if (remaining.entries.length) {
        failureRecovery.request = shellQuery('restore', { allowPartial: true });
        await wait(() => targets.every(target => fs.existsSync(target.path)), 'Failure recovery did not restore both synthetic original paths within 15 seconds');
      }
      failureRecovery.remainingAfter = shellQuery('inspect').entries;
      if (original && targets.every(target => fs.existsSync(target.path))) failureRecovery.originalHashesMatch = restoredExactly();
    } catch (recoveryError) { failureRecovery = { ...failureRecovery, error: recoveryError.stack || String(recoveryError) }; }
  }
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify(report(false, error.stack || String(error)), null, 2));
  console.error('NATIVE RECYCLE REPORT:', reportFile);
  process.exitCode = 1;
});
