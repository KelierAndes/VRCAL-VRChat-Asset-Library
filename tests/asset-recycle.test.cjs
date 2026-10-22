const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const {spawnSync} = require('node:child_process');
const ts = require('typescript');

// Load only this source file, without generating dist or loading Electron.
const source = path.join(__dirname, '../src/main/asset-recycle.ts');
function loadService() {
  if (!fs.existsSync(source)) return {};
  const output = ts.transpileModule(fs.readFileSync(source, 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const loaded = new Module(source, module);
  loaded.filename = source;
  loaded.paths = Module._nodeModulePaths(path.dirname(source));
  loaded._compile(output, source);
  return loaded.exports;
}
const {prepareAssetRecycle, executeAssetRecycle} = loadService();

function fixture(t) {
  const area = fs.mkdtempSync(path.join(os.tmpdir(), 'vrcal-recycle-test-'));
  const root = path.join(area, 'materials'), dataDir = path.join(area, 'library');
  fs.mkdirSync(root); fs.mkdirSync(dataDir);
  t.after(() => {
    const resolved = fs.realpathSync(area), relative = path.relative(os.tmpdir(), resolved);
    assert(relative && !relative.startsWith('..') && path.basename(resolved).startsWith('vrcal-recycle-test-'));
    fs.rmSync(resolved, {recursive:true, force:true, maxRetries:3});
  });
  const assets = [];
  return {area,root,dataDir,assets,
    file(relative, bytes='source bytes') { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, bytes); return file; },
    add(file, kind='file', id=`asset-${assets.length}`) { const record = {id,path:file,kind}; assets.push(record); return record; },
    options(selectedIds=assets.map(a => a.id), extra={}) { return {selectedIds,assets,roots:[root],dataDir,...extra}; }
  };
}
function directoryLink(target, link) { fs.mkdirSync(path.dirname(link), {recursive:true}); fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); }
function project(directory) { fs.mkdirSync(path.join(directory, 'Assets'), {recursive:true}); fs.mkdirSync(path.join(directory, 'ProjectSettings'), {recursive:true}); fs.writeFileSync(path.join(directory, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1'); }
function recordingTrash(calls) { return async file => { calls.push(file); }; }
function shortPath(t, file) {
  if (process.platform !== 'win32') { t.skip('Windows short names require GetShortPathNameW'); return; }
  const command = `[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class RecycleShortName {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern uint GetShortPathName(string path, StringBuilder result, uint capacity);
}
'@
$buffer=New-Object System.Text.StringBuilder 32768
$length=[RecycleShortName]::GetShortPathName($env:VRCAL_RECYCLE_SHORT_SOURCE,$buffer,32768)
if($length -eq 0){throw 'GetShortPathNameW failed'}
[Console]::Write($buffer.ToString())`;
  const result = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile','-NonInteractive','-Command',command], {
    encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,VRCAL_RECYCLE_SHORT_SOURCE:file}
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  const shortened = result.stdout.trim();
  if (shortened.toLowerCase() === fs.realpathSync(file).toLowerCase()) { t.skip('8.3 aliases are unavailable on the fixture volume'); return; }
  assert.match(shortened, /~/);
  return shortened;
}

test('exports prepare/execute functions and prepares only registered existing files', async t => {
  assert.equal(typeof prepareAssetRecycle, 'function', 'safe recycle preparation is not implemented');
  assert.equal(typeof executeAssetRecycle, 'function', 'safe recycle execution is not implemented');
  const f = fixture(t), item = f.add(f.file('Dress.unitypackage'), 'unitypackage');
  const plan = await prepareAssetRecycle(f.options());
  assert.deepEqual(plan.targets, [{path:item.path,assetIds:[item.id],kind:'file'}]);
  assert.equal(fs.readFileSync(item.path, 'utf8'), 'source bytes');
  await assert.rejects(prepareAssetRecycle(f.options(['unknown-id'])), /登记|素材/);
  const missing = f.add(path.join(f.root, 'missing.zip'));
  await assert.rejects(prepareAssetRecycle(f.options([missing.id])), /不存在|ENOENT/);
});

test('rejects unregistered paths and out-of-scope records, including sibling prefix paths', async t => {
  const f = fixture(t), outside = path.join(f.area, 'materials-other', 'Private.zip');
  fs.mkdirSync(path.dirname(outside)); fs.writeFileSync(outside, 'private');
  const item = f.add(outside);
  await assert.rejects(prepareAssetRecycle(f.options()), /范围/);
  item.path = path.relative(f.area, outside);
  await assert.rejects(prepareAssetRecycle(f.options()), /绝对|路径/);
  item.path = outside + '\0';
  await assert.rejects(prepareAssetRecycle(f.options()), /路径/);
});

test('protects disk roots, every configured source root, and their ancestors', async t => {
  const f = fixture(t), nested = path.join(f.root, 'nested-source'); fs.mkdirSync(nested);
  for (const target of [path.parse(f.root).root, f.root, f.area]) {
    f.assets.length = 0; f.add(target, 'folder');
    await assert.rejects(prepareAssetRecycle(f.options()), /根目录|保护|资料库/);
  }
  const shelf = path.join(f.root, 'Shelf'), childRoot = path.join(shelf, 'Other source'); fs.mkdirSync(childRoot, {recursive:true});
  f.assets.length = 0; f.add(shelf, 'folder');
  await assert.rejects(prepareAssetRecycle(f.options(undefined, {roots:[f.root,childRoot]})), /根目录|保护/);
  const directFile = f.file('Direct.zip'); f.assets.length = 0; f.add(directFile);
  await assert.rejects(prepareAssetRecycle(f.options(undefined, {roots:[directFile]})), /根目录|保护/);
});

test('protects the library, ancestors and descendants while allowing exact approved download files', async t => {
  const f = fixture(t), download = path.join(f.dataDir, 'downloads', 'Product.zip');
  fs.mkdirSync(path.dirname(download)); fs.writeFileSync(download, 'download');
  const cache = path.join(f.dataDir, 'session-cache'); fs.mkdirSync(cache);
  for (const target of [f.dataDir, f.area, cache, download]) {
    f.assets.length = 0; f.add(target, fs.statSync(target).isDirectory() ? 'folder' : 'file');
    await assert.rejects(prepareAssetRecycle(f.options(undefined, {roots:[f.area]})), /资料库|保护|根目录/);
  }
  f.assets.length = 0; const approved = f.add(download);
  const plan = await prepareAssetRecycle(f.options(undefined, {allowedDownloadFiles:[download]}));
  assert.deepEqual(plan.targets[0].assetIds, [approved.id]);
  f.assets.length = 0; f.add(path.dirname(download), 'folder');
  await assert.rejects(prepareAssetRecycle(f.options(undefined, {allowedDownloadFiles:[path.dirname(download)]})), /资料库|保护|普通文件/);
});

test('approved external BOOTH paths authorize only the exact ordinary file', async t => {
  const f = fixture(t), directory = path.join(f.area, 'Downloads'); fs.mkdirSync(directory);
  const file = path.join(directory, 'Product.zip'), other = path.join(directory, 'Other.zip');
  fs.writeFileSync(file, 'product'); fs.writeFileSync(other, 'other');
  const item = f.add(file); await prepareAssetRecycle(f.options(undefined, {allowedDownloadFiles:[file]}));
  item.path = other;
  await assert.rejects(prepareAssetRecycle(f.options(undefined, {allowedDownloadFiles:[file]})), /范围/);
  item.path = directory; item.kind = 'folder';
  await assert.rejects(prepareAssetRecycle(f.options(undefined, {allowedDownloadFiles:[directory]})), /范围|普通文件/);
});

test('only explicitly approved selected manual source assets may recycle their own source root', async t => {
  const f = fixture(t), zip = f.file('Manual.zip'), child = f.file('Manual folder/Asset.fbx'), folder = path.dirname(child);
  const zipped = f.add(zip), bundled = f.add(folder, 'folder');
  const roots = [f.root,zip,folder];
  for (const item of [zipped,bundled]) await assert.rejects(prepareAssetRecycle(f.options([item.id], {roots})), /根目录|保护/);
  const plan = await prepareAssetRecycle(f.options(undefined, {roots,allowedSourceRootAssets:[zip,folder]}));
  assert.deepEqual(plan.targets.map(t => t.path), [zip,folder]);
  f.assets.length = 0; f.add(f.root, 'folder');
  await assert.rejects(prepareAssetRecycle(f.options(undefined, {roots,allowedSourceRootAssets:[zip,folder]})), /根目录|保护/);
  // An approved manual folder must still protect an independent nested source.
  f.assets.length = 0; f.add(folder, 'folder'); const nested = path.join(folder, 'Independent source'); fs.mkdirSync(nested);
  await assert.rejects(prepareAssetRecycle(f.options(undefined, {roots:[...roots,nested],allowedSourceRootAssets:[folder]})), /根目录|保护/);
});

test('fixed protected directories and their ancestors stay protected under a broader active root', async t => {
  const f = fixture(t), inside = f.file('Container/Default source/Product.zip');
  const fixedRoot = path.dirname(inside), ancestor = path.dirname(fixedRoot);
  const directory = f.add(fixedRoot, 'folder'), parent = f.add(ancestor, 'folder'), product = f.add(inside);
  for (const target of [directory,parent]) {
    await t.test(target === directory ? 'the protected directory itself' : 'an ancestor of the protected directory', async () => {
      await assert.rejects(prepareAssetRecycle(f.options([target.id], {protectedPaths:[fixedRoot]})), /保护|根目录/);
    });
  }
  const plan = await prepareAssetRecycle(f.options([product.id], {protectedPaths:[fixedRoot]})), calls = [];
  const result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(calls, [inside]); assert.equal(result.results[0].status, 'recycled');
});

test('manual source exceptions cannot recycle detached nested sources or their enclosing bundle', async t => {
  const f = fixture(t), inside = f.file('Bundle/OtherSource/Current.zip');
  const detached = path.dirname(inside), bundle = path.dirname(detached);
  const bundled = f.add(bundle, 'folder'), oldRoot = f.add(detached, 'folder'), product = f.add(inside);
  const policy = {roots:[bundle],allowedSourceRootAssets:[bundle,detached],protectedPaths:[detached]};
  for (const target of [bundled,oldRoot]) {
    await t.test(target === oldRoot ? 'the detached directory itself' : 'its approved manual-source ancestor', async () => {
      await assert.rejects(prepareAssetRecycle(f.options([target.id], policy)), /保护|根目录/);
    });
  }
  const plan = await prepareAssetRecycle(f.options([product.id], policy)), calls = [];
  const result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(calls, [inside]); assert.equal(result.results[0].status, 'recycled');
});

test('protected path policy is copied before caller mutations and rechecked during execution', async t => {
  const f = fixture(t), item = f.add(f.file('Protected source/Current.zip'));
  const protectedPaths = [path.dirname(item.path)];
  const plan = await prepareAssetRecycle(f.options(undefined, {protectedPaths}));
  protectedPaths[0] = item.path;
  const calls = [], result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(calls, [item.path]); assert.equal(result.results[0].status, 'recycled');
});

test('fixed protection includes a junction target even if the real directory is an approved manual source', async t => {
  const f = fixture(t), inside = f.file('Actual sources/Product.zip'), actual = path.dirname(inside), alias = path.join(f.area, 'Default source');
  directoryLink(actual, alias);
  const root = f.add(actual, 'folder'), child = f.add(inside);
  const policy = {roots:[actual],allowedSourceRootAssets:[actual],protectedPaths:[alias]};
  await assert.rejects(prepareAssetRecycle(f.options([root.id], policy)), /保护|根目录/);
  const plan = await prepareAssetRecycle(f.options([child.id], policy)), calls = [];
  const result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(calls, [inside]); assert.equal(result.results[0].status, 'recycled');
  const throughLink = f.add(path.join(alias, 'Product.zip'));
  await assert.rejects(prepareAssetRecycle(f.options([throughLink.id], {...policy,roots:[actual,alias]})), /链接/);
});

test('a shared scanning root alias keeps its real directory protected from a second manual-root exception', async t => {
  const f = fixture(t), inside = f.file('Actual sources/Product.zip'), actual = path.dirname(inside), alias = path.join(f.area, 'Shared source');
  directoryLink(actual, alias);
  const root = f.add(actual, 'folder'), child = f.add(inside);
  const policy = {roots:[alias,actual],allowedSourceRootAssets:[actual]};
  await assert.rejects(prepareAssetRecycle(f.options([root.id], policy)), /保护|根目录/);
  const plan = await prepareAssetRecycle(f.options([child.id], policy)), calls = [];
  await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(calls, [inside]);
});

test('library aliases protect the actual directory and cache files with only the exact download exception', async t => {
  const f = fixture(t), inside = f.file('Actual library/cache/session.bin'), actual = path.join(f.root, 'Actual library'), alias = path.join(f.area, 'Library alias');
  directoryLink(actual, alias);
  const root = f.add(actual, 'folder'), child = f.add(inside);
  const policy = {dataDir:alias,roots:[f.root,actual],allowedSourceRootAssets:[actual]};
  await assert.rejects(prepareAssetRecycle(f.options([root.id], policy)), /资料库|保护/);
  await assert.rejects(prepareAssetRecycle(f.options([child.id], policy)), /资料库|保护/);
  const plan = await prepareAssetRecycle(f.options([child.id], {...policy,allowedDownloadFiles:[inside]})), calls = [];
  await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(calls, [inside]);
});

test('known project aliases protect actual project ancestors, the project and its internal records', async t => {
  const f = fixture(t), inside = f.file('Container/Actual project/Assets/Source.zip'), actual = path.join(f.root, 'Container', 'Actual project'), alias = path.join(f.area, 'Project alias');
  directoryLink(actual, alias);
  const parent = f.add(path.dirname(actual), 'folder'), root = f.add(actual, 'folder'), child = f.add(inside);
  for (const target of [parent,root,child]) {
    await t.test(target === parent ? 'project ancestor' : target === root ? 'project directory' : 'project internal file', async () => {
      await assert.rejects(prepareAssetRecycle(f.options([target.id], {knownProjectPaths:[alias]})), /Unity|工程/);
    });
  }
  f.add(alias, 'unity-project');
  await assert.rejects(prepareAssetRecycle(f.options([child.id])), /Unity|工程/);
});

test('nonexistent protected paths retain lexical ancestor protection', async t => {
  const f = fixture(t); f.file('Retained folder/Current.zip'); const parent = f.add(path.join(f.root, 'Retained folder'), 'folder');
  await assert.rejects(prepareAssetRecycle(f.options([parent.id], {protectedPaths:[path.join(parent.path, 'Missing source')]})), /保护/);
});

test('rechecks protection aliases that are redirected during the confirmation interval', async t => {
  const f = fixture(t), inside = f.file('Selected/Product.zip'), selected = path.dirname(inside), other = path.join(f.area, 'Initially protected'), alias = path.join(f.area, 'Protection alias');
  fs.mkdirSync(other); directoryLink(other, alias); f.add(selected, 'folder');
  const plan = await prepareAssetRecycle(f.options(undefined, {roots:[selected],allowedSourceRootAssets:[selected],protectedPaths:[alias]}));
  fs.unlinkSync(alias); directoryLink(selected, alias);
  const calls = [], result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(calls, []); assert.equal(result.results[0].status, 'failed'); assert.match(result.results[0].error, /保护/);
  assert.equal(fs.readFileSync(inside, 'utf8'), 'source bytes');
});

test('protects known Unity projects, their ancestors and internal files even without marker files', async t => {
  const f = fixture(t), unity = path.join(f.root, 'Unity'), asset = f.file('Unity/Assets/Avatar.fbx');
  const known = f.add(unity, 'unity-project');
  for (const target of [known, f.add(path.join(f.root, 'Unity', 'Assets'), 'folder'), f.add(asset)]) {
    await assert.rejects(prepareAssetRecycle(f.options([target.id])), /Unity|工程/);
  }
  const container = path.join(f.root, 'Container'), knownPath = path.join(container, 'Separate'); fs.mkdirSync(knownPath, {recursive:true});
  const selected = f.add(container, 'folder');
  await assert.rejects(prepareAssetRecycle(f.options([selected.id], {knownProjectPaths:[knownPath]})), /Unity|工程/);
});

test('detects Unity signatures inside selected folders and on every ancestor without broad scans', async t => {
  const f = fixture(t), containing = path.join(f.root, 'Mixed bundle'), unity = path.join(containing, 'Deep project'); project(unity);
  const folder = f.add(containing, 'folder');
  await assert.rejects(prepareAssetRecycle(f.options([folder.id])), /Unity|工程/);
  const internal = f.add(path.join(unity, 'ProjectSettings', 'ProjectVersion.txt'));
  await assert.rejects(prepareAssetRecycle(f.options([internal.id])), /Unity|工程/);
  const unknownProject = path.join(f.area, 'Unknown project'); project(unknownProject);
  const internal2 = path.join(unknownProject, 'Assets', 'Material.zip'); fs.writeFileSync(internal2, 'material');
  const loose = f.add(internal2);
  await assert.rejects(prepareAssetRecycle(f.options([loose.id], {roots:[path.join(unknownProject, 'Assets')]})), /Unity|工程/);
});

test('protects scanner-style Unity projects with three engine directories but no version marker', async t => {
  const f = fixture(t), unity = path.join(f.root, 'Container', 'Unity project');
  for (const name of ['Assets','Packages','ProjectSettings']) fs.mkdirSync(path.join(unity, name), {recursive:true});
  const inside = path.join(unity, 'Assets', 'Model.fbx'); fs.writeFileSync(inside, 'model');
  const root = f.add(unity, 'folder'), container = f.add(path.dirname(unity), 'folder'), child = f.add(inside);
  for (const target of [root,container,child]) {
    await t.test(target === root ? 'project directory' : target === container ? 'containing asset folder' : 'internal asset file', async () => {
      await assert.rejects(prepareAssetRecycle(f.options([target.id])), /Unity|工程/);
    });
  }
});

test('rejects links at the target, on its ancestor chain, and inside a selected directory', async t => {
  const f = fixture(t), real = path.join(f.area, 'real'); fs.mkdirSync(real); fs.writeFileSync(path.join(real, 'Private.zip'), 'private');
  const linked = path.join(f.root, 'linked'); directoryLink(real, linked);
  const rootLink = f.add(linked, 'folder'), insideLink = f.add(path.join(linked, 'Private.zip'));
  for (const item of [rootLink,insideLink]) await assert.rejects(prepareAssetRecycle(f.options([item.id])), /链接/);
  const container = path.join(f.root, 'Bundle'); fs.mkdirSync(container); directoryLink(real, path.join(container, 'nested'));
  const folder = f.add(container, 'folder');
  await assert.rejects(prepareAssetRecycle(f.options([folder.id])), /链接/);
  assert.equal(fs.readFileSync(path.join(real, 'Private.zip'), 'utf8'), 'private');
});

test('deduplicates folder/package overlaps and maps every registered covered record', async t => {
  const f = fixture(t), child = f.file('Product/inside.unitypackage'), second = f.file('Product/Textures/a.png'), unrelated = f.file('Other.zip');
  const packageItem = f.add(child, 'unitypackage'), folder = f.add(path.dirname(child), 'folder'), nested = f.add(second), duplicate = f.add(child, 'archive'), other = f.add(unrelated);
  const plan = await prepareAssetRecycle(f.options([packageItem.id,folder.id,packageItem.id]));
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.targets[0].path, folder.path);
  assert.deepEqual([...plan.targets[0].assetIds].sort(), [packageItem.id,folder.id,nested.id,duplicate.id].sort());
  assert(!plan.targets[0].assetIds.includes(other.id));
  const calls = [], result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(calls, [folder.path]); assert.equal(result.results[0].status, 'recycled');
});

test('scattered members produce independent targets and successful IDs stay attached to their path', async t => {
  const f = fixture(t), first = f.add(f.file('A/Product.zip')), second = f.add(f.file('B/Product.unitypackage'));
  const plan = await prepareAssetRecycle(f.options()); const calls = [];
  const result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(new Set(calls), new Set([first.path,second.path]));
  assert.deepEqual(result.results.map(r => [r.path,r.assetIds,r.status]), [[first.path,[first.id],'recycled'],[second.path,[second.id],'recycled']]);
});

test('bounds selected-folder validation and never enumerates unrelated roots or data', async t => {
  const f = fixture(t), file = f.file('Small/sub/file.png'); f.add(path.join(f.root, 'Small'), 'folder');
  f.file('Unrelated/deep/private.zip');
  const original = fsp.opendir, reads = [];
  fsp.opendir = async function(directory, ...args) { reads.push(String(directory)); assert(String(directory).startsWith(path.join(f.root, 'Small'))); return original.call(this, directory, ...args); };
  try { await prepareAssetRecycle(f.options()); } finally { fsp.opendir = original; }
  assert.equal(reads.length, 2); assert(fs.existsSync(file));
  await assert.rejects(prepareAssetRecycle(f.options(undefined, {maxEntries:2})), /上限|过多|规模/);
  await assert.rejects(prepareAssetRecycle(f.options(undefined, {maxDepth:1})), /上限|过深|规模/);
});

test('enforces the entry budget across the complete confirmation plan', async t => {
  const f = fixture(t); f.add(f.file('First.zip')); f.add(f.file('Second.zip'));
  await assert.rejects(prepareAssetRecycle(f.options(undefined, {maxEntries:1})), /上限|过多|规模/);
});

test('globally rejects a replaced target before recycling any selected item', async t => {
  const f = fixture(t), first = f.add(f.file('A.zip')), second = f.add(f.file('B.zip'));
  const plan = await prepareAssetRecycle(f.options());
  fs.renameSync(second.path, second.path + '.original'); fs.writeFileSync(second.path, 'replacement');
  const calls = [], result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(calls, []);
  assert.deepEqual(result.results.map(r => r.status), ['not-run','failed']);
  assert.match(result.results[1].error, /变化|更改|替换/);
  assert(fs.existsSync(first.path)); assert.equal(fs.readFileSync(second.path, 'utf8'), 'replacement');
});

test('rejects changed directory descendants and additions during confirmation', async t => {
  const f = fixture(t), inside = f.file('Product/file.zip'), folder = f.add(path.dirname(inside), 'folder');
  for (const mutate of [() => fs.writeFileSync(inside, 'changed source bytes'), () => fs.writeFileSync(path.join(folder.path, 'new.zip'), 'new')]) {
    const plan = await prepareAssetRecycle(f.options()); mutate(); const calls = [];
    const result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
    assert.equal(result.results[0].status, 'failed'); assert.deepEqual(calls, []);
  }
});

test('rejects an ancestor replaced with a directory link during confirmation', async t => {
  const f = fixture(t), file = f.file('Parent/Asset.zip'); f.add(file);
  const plan = await prepareAssetRecycle(f.options()), parent = path.dirname(file), moved = parent + '-original';
  fs.renameSync(parent, moved); directoryLink(moved, parent);
  const calls = [], result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(calls, []); assert.equal(result.results[0].status, 'failed'); assert.match(result.results[0].error, /链接|变化/);
});

test('rechecks each remaining item after the previous trash call and preserves replacements', async t => {
  const f = fixture(t), first = f.add(f.file('A.zip')), second = f.add(f.file('B.zip'));
  const plan = await prepareAssetRecycle(f.options()), calls = [];
  const result = await executeAssetRecycle(plan, {trashItem:async file => {
    calls.push(file);
    if (file === first.path) { fs.renameSync(first.path, first.path + '.recycled'); fs.renameSync(second.path, second.path + '.original'); fs.writeFileSync(second.path, 'new user file'); }
  }});
  assert.deepEqual(calls, [first.path]); assert.deepEqual(result.results.map(r => r.status), ['recycled','failed']);
  assert.equal(fs.readFileSync(second.path, 'utf8'), 'new user file');
});

test('returns per-path partial failures and never permanently deletes a failed source', async t => {
  const f = fixture(t), first = f.add(f.file('A.zip')), second = f.add(f.file('B.zip')), third = f.add(f.file('C.zip'));
  const plan = await prepareAssetRecycle(f.options()), calls = [];
  const result = await executeAssetRecycle(plan, {trashItem:async file => {
    calls.push(file);
    if (file === second.path) throw new Error('OS recycle bin unavailable');
    fs.renameSync(file, file + '.recycled');
  }});
  assert.deepEqual(calls, [first.path,second.path,third.path]);
  assert.deepEqual(result.results.map(r => r.status), ['recycled','failed','recycled']);
  assert.equal(result.cancelled, false); assert.match(result.results[1].error, /OS recycle bin unavailable/);
  assert.equal(fs.readFileSync(second.path, 'utf8'), 'source bytes');
  assert.deepEqual(f.assets.map(a => a.id), [first.id,second.id,third.id]);
});

test('allows cancellation before any target and between successful targets', async t => {
  const f = fixture(t); f.add(f.file('A.zip')); f.add(f.file('B.zip'));
  let plan = await prepareAssetRecycle(f.options()), calls = [];
  let result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls),shouldCancel:() => true});
  assert.equal(result.cancelled, true); assert.deepEqual(result.results.map(r => r.status), ['not-run','not-run']); assert.deepEqual(calls, []);
  plan = await prepareAssetRecycle(f.options()); let cancelled = false;
  result = await executeAssetRecycle(plan, {trashItem:async file => { calls.push(file); cancelled = true; },shouldCancel:async () => cancelled});
  assert.equal(result.cancelled, true); assert.deepEqual(result.results.map(r => r.status), ['recycled','not-run']); assert.deepEqual(calls, [f.assets[0].path]);
});

test('checks cancellation again after awaited validation and fails closed on cancellation check errors', async t => {
  const f = fixture(t), item = f.add(f.file('A.zip'));
  const plan = await prepareAssetRecycle(f.options()), calls = [];
  const result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls),shouldCancel:() => { throw new Error('library context changed'); }});
  assert.deepEqual(calls, []); assert.equal(result.cancelled, true); assert.equal(result.results[0].status, 'not-run'); assert.match(result.results[0].error, /library context changed/);
  assert(fs.existsSync(item.path));
});

test('revalidates descendants after an asynchronous cancellation hook yields', async t => {
  const f = fixture(t), inside = f.file('Product/Inside.zip'); f.add(path.dirname(inside), 'folder');
  const plan = await prepareAssetRecycle(f.options()), calls = []; let checks = 0;
  const result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls),shouldCancel:async () => {
    if (++checks === 3) { await Promise.resolve(); fs.writeFileSync(inside, 'replacement after validation'); }
    return false;
  }});
  assert.deepEqual(calls, []); assert.equal(result.results[0].status, 'failed');
  assert.equal(fs.readFileSync(inside, 'utf8'), 'replacement after validation');
});

test('rejects a deep directory switched to a junction after the last external hook', async t => {
  const f = fixture(t), inside = f.file('Product/Deep/Source.zip'), folder = path.join(f.root, 'Product');
  const external = path.join(f.area, 'Unrelated'); fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'Private.zip'), 'private');
  f.add(folder, 'folder'); const plan = await prepareAssetRecycle(f.options()), calls = []; let checks = 0;
  const result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls),shouldCancel:async () => {
    if (++checks === 3) { fs.renameSync(path.dirname(inside), path.join(f.area, 'Original deep')); directoryLink(external, path.dirname(inside)); }
    return false;
  }});
  assert.deepEqual(calls, []); assert.equal(result.results[0].status, 'failed'); assert.match(result.results[0].error, /链接/);
  assert.equal(fs.readFileSync(path.join(external, 'Private.zip'), 'utf8'), 'private');
});

test('plans are immutable, cannot be forged, and cannot execute twice', async t => {
  const f = fixture(t); f.add(f.file('A.zip')); const plan = await prepareAssetRecycle(f.options());
  assert(Object.isFrozen(plan)); assert(Object.isFrozen(plan.targets)); assert(Object.isFrozen(plan.targets[0].assetIds));
  const calls = [];
  await assert.rejects(executeAssetRecycle({targets:plan.targets}, {trashItem:recordingTrash(calls)}), /计划|准备/);
  await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  await assert.rejects(executeAssetRecycle(plan, {trashItem:recordingTrash(calls)}), /计划|执行/);
  assert.equal(calls.length, 1);
});

test('caller mutations after preparation cannot broaden the saved scope or alter IDs', async t => {
  const f = fixture(t), item = f.add(f.file('A.zip')), input = f.options();
  const plan = await prepareAssetRecycle(input);
  input.roots[0] = f.area; item.path = path.join(f.area, 'private.zip'); item.id = 'replacement-id';
  const calls = [], result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(calls, [path.join(f.root, 'A.zip')]); assert.deepEqual(result.results[0].assetIds, ['asset-0']);
});

test('real Windows 8.3 file paths are eligible under long-name roots and preserve the displayed original path', async t => {
  const f = fixture(t), file = f.file('Long original material filename.fbx'), shortened = shortPath(t, file); if (!shortened) return;
  const item = f.add(shortened), plan = await prepareAssetRecycle(f.options()), calls = [];
  assert.equal(plan.targets[0].path, shortened);
  const result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(calls, [shortened]); assert.equal(result.results[0].status, 'recycled'); assert.deepEqual(result.results[0].assetIds, [item.id]);
});

test('real Windows 8.3 folders validate descendants and cover long-name child records without duplicate trash calls', async t => {
  const f = fixture(t), file = f.file('Long product folder/Deep material folder/Material.fbx'), folder = path.join(f.root, 'Long product folder'), shortened = shortPath(t, folder); if (!shortened) return;
  const parent = f.add(shortened, 'folder'), child = f.add(file), plan = await prepareAssetRecycle(f.options()), calls = [];
  assert.equal(plan.targets.length, 1); assert.deepEqual([...plan.targets[0].assetIds].sort(), [parent.id,child.id].sort());
  const result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(calls, [shortened]); assert.equal(result.results[0].status, 'recycled');
});

test('real Windows 8.3 targets still respect long-name fixed, library, known-project and shared-root protection', async t => {
  const f = fixture(t), file = f.file('Long protected folder/Material.fbx'), folder = path.dirname(file), shortened = shortPath(t, folder); if (!shortened) return;
  f.add(shortened, 'folder');
  const base = {roots:[shortened],allowedSourceRootAssets:[shortened]};
  for (const [name, extra, error] of [
    ['fixed path',{protectedPaths:[folder]},/保护/],
    ['library',{dataDir:folder},/资料库|保护/],
    ['known project',{knownProjectPaths:[folder]},/Unity|工程/],
    ['shared root',{roots:[folder,shortened]},/根目录|保护/]
  ]) await t.test(name, async () => { await assert.rejects(prepareAssetRecycle(f.options(undefined, {...base,...extra})), error); });
});

test('a junction substituted for a real Windows 8.3 ancestor is rejected after confirmation', async t => {
  const f = fixture(t), file = f.file('Long ordinary ancestor/Material.fbx'), shortened = shortPath(t, file); if (!shortened) return;
  f.add(shortened); const plan = await prepareAssetRecycle(f.options()), parent = path.dirname(file), moved = path.join(f.area, 'Moved original folder');
  fs.renameSync(parent, moved); directoryLink(moved, path.dirname(shortened));
  const calls = [], result = await executeAssetRecycle(plan, {trashItem:recordingTrash(calls)});
  assert.deepEqual(calls, []); assert.equal(result.results[0].status, 'failed'); assert.match(result.results[0].error, /链接|变化/);
});
