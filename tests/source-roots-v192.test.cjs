const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const {Store} = require('../dist/main/main/store');
const {Scanner} = require('../dist/main/main/scanner');
const {matchingCatalog} = require('../dist/main/main/matching-catalog');
function fixture(t) {
  const area = fs.mkdtempSync(path.join(__dirname, '.fixtures-source-roots-')), root = path.join(area, '母目录'), data = path.join(area, '应用资料'), stores = [];
  fs.mkdirSync(root);
  t.after(() => { for (const store of stores) try { store.close(); } catch {} const resolved = fs.realpathSync(area); assert(path.relative(__dirname, resolved) && !path.relative(__dirname, resolved).startsWith('..')); fs.rmSync(resolved, {recursive:true, force:true, maxRetries:3}); });
  return {area, root, data, open:(directory=data, roots=[root]) => { const store = new Store(directory, roots); stores.push(store); return store; }};
}
function write(root, relative, bytes='untouched source bytes') { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, bytes); return file; }
function input(file) { return {path:file, name:path.basename(file), group:'Airi', kind:'file', size:10, mtimeMs:1, localCategory:'服装', localAvatars:[], hintUrls:[]}; }
function snapshot(root) { const result = {}; function visit(dir) { for (const entry of fs.readdirSync(dir, {withFileTypes:true})) { const file = path.join(dir, entry.name); result[path.relative(root, file)] = entry.isSymbolicLink() ? 'LINK' : entry.isDirectory() ? 'DIR' : crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); if (entry.isDirectory() && !entry.isSymbolicLink()) visit(file); }} visit(root); return result; }
function legacyBackup(file, mutate) { const value = JSON.parse(fs.readFileSync(file)); value.version = 1; delete value.metadataSha256; mutate(value); fs.writeFileSync(file, JSON.stringify(value)); }

test('removing the final source hides active cards/search/stats/queue but preserves source bytes and annotations across restart/re-add', async t => {
  const f = fixture(t), file = write(f.root, 'Dress_Airi.fbx'), before = snapshot(f.root), store = f.open();
  const item = store.upsertScan(input(file)); store.updateManual([item.id], {title:'私有标题', notes:'中文 Japanese 日本語', tags:['保留标签'], favorite:true}); store.updateOnline(item.id, {status:'review', candidates:[{url:'https://booth.pm/items/1234567', title:'保留候选'}]});
  const collection = store.saveCollection({name:'保留集合', kind:'manual'}); store.updateCollectionMembers(collection.id, [item.id], 'add');
  assert.equal(store.list().total, 1); assert.equal(store.stats().favorites, 1); store.removeRoot(f.root);
  assert.deepEqual(store.settings().roots, []); assert.deepEqual(store.settings().detachedRoots, [f.root]); assert.equal(store.all().length, 0); assert.equal(store.get(item.id), null); assert.equal(store.list({search:'私有标题'}).total, 0); assert.equal(store.stats().total, 0); assert.deepEqual(store.stats().groups, []); assert.equal(store.listTags().length, 0); assert.deepEqual(matchingCatalog(store).all(), []); assert.equal(matchingCatalog(store).get(item.id), null);
  assert.equal(store.getRaw(item.id).manual.notes, '中文 Japanese 日本語'); await new Scanner(store).scan(); assert.deepEqual(snapshot(f.root), before); store.close();
  const reopened = f.open(); assert.deepEqual(reopened.settings().roots, []); assert.equal(reopened.list().total, 0); reopened.saveSettings({theme:'x-light'}); assert.deepEqual(reopened.settings().roots, []);
  reopened.saveSettings({roots:[f.root]}); assert.deepEqual(reopened.settings().detachedRoots || [], []); assert.equal(reopened.get(item.id).manual.title, '私有标题'); assert.equal(reopened.stats().favorites, 1); assert.equal(reopened.list({collectionId:collection.id}).total, 1); assert.equal(reopened.getRaw(item.id).online.candidates[0].title, '保留候选'); assert.deepEqual(snapshot(f.root), before);
});

test('detached records survive verified backup/restore without activating them or widening write destinations', t => {
  const f = fixture(t), store = f.open(), item = store.upsertScan(input(write(f.root, 'Hair_Airi.fbx'))); store.updateManual([item.id], {notes:'恢复后仍保留'}); store.removeRoot(f.root);
  const backup = path.join(f.area, 'inactive-backup.json'); store.exportData(backup); const saved = JSON.parse(fs.readFileSync(backup)); assert.deepEqual(saved.settings.roots, []); assert.deepEqual(saved.settings.detachedRoots, [f.root]); assert.equal(saved.assets.length, 1);
  assert.throws(() => store.exportData(path.join(f.root, 'forbidden.json')), /保护/); assert.throws(() => store.saveSettings({backupDir:f.root}), /保护/); assert.throws(() => store.saveSettings({boothDownloadDir:f.root}), /保护/);
  const restored = f.open(path.join(f.area, '恢复库'), []); restored.importData(backup); assert.deepEqual(restored.settings().roots, []); assert.deepEqual(restored.settings().detachedRoots, [f.root]); assert.equal(restored.all().length, 0); assert.equal(restored.getRaw(item.id).manual.notes, '恢复后仍保留');
  const again = path.join(f.area, 'inactive-again.json'); restored.exportData(again); assert.equal(JSON.parse(fs.readFileSync(again)).assets.length, 1); restored.saveSettings({roots:[f.root]}); assert.equal(restored.list().total, 1); assert.equal(restored.get(item.id).manual.notes, '恢复后仍保留');
});

test('replacing child roots with their parent preserves identity, while partial reactivation leaves other detached branches hidden', t => {
  const f = fixture(t), a = path.join(f.root, '衣服'), b = path.join(f.root, '发型'), store = f.open(f.data, [a,b]); const first = store.upsertScan(input(write(a, 'Dress_Airi.fbx'))), second = store.upsertScan(input(write(b, 'Hair_Airi.fbx'))); store.updateManual([first.id], {notes:'原身份'});
  store.saveSettings({roots:[f.root]}); assert.deepEqual(store.settings().detachedRoots || [], []); assert.equal(store.all().length, 2); assert.equal(store.getRaw(first.id).manual.notes, '原身份');
  store.removeRoot(f.root); store.saveSettings({roots:[a]}); assert.equal(store.all().length, 1); assert.equal(store.get(second.id), null); assert.equal(store.get(first.id).manual.notes, '原身份'); assert.deepEqual(store.settings().detachedRoots, [f.root]);
  const backup = path.join(f.area, 'partly-active.json'); store.exportData(backup); const restored = f.open(path.join(f.area, '部分恢复'), []); restored.importData(backup); assert.deepEqual(restored.settings().roots, [a]); assert.equal(restored.all().length, 1); assert.equal(restored.getRaw(second.id).id, second.id); restored.saveSettings({roots:[f.root]}); assert.equal(restored.all().length, 2);
});

test('inactive backup scopes are validated before mutation and cannot import arbitrary paths or overlap application data', t => {
  const f = fixture(t), store = f.open(); store.upsertScan(input(write(f.root, 'Body_Airi.fbx'))); store.removeRoot(f.root); const backup = path.join(f.area, 'invalid-inactive.json'); store.exportData(backup); const restored = f.open(path.join(f.area, '安全恢复'), []), before = restored.settings();
  legacyBackup(backup, value => { value.settings.detachedRoots = ['relative']; }); assert.throws(() => restored.importData(backup), /路径|根目录/); assert.deepEqual(restored.settings(), before);
  store.exportData(backup); legacyBackup(backup, value => { value.assets[0].path = path.join(f.area, 'outside.fbx'); }); assert.throws(() => restored.importData(backup), /素材记录/); assert.equal(restored.all().length, 0);
  store.exportData(backup); legacyBackup(backup, value => { value.settings.detachedRoots = [f.area]; }); assert.throws(() => restored.importData(backup), /保护/); assert.deepEqual(restored.settings(), before);
});

test('one mother root traverses Chinese/Japanese/English category buckets and generic parents but keeps product bundles whole', async t => {
  const f = fixture(t), store = f.open();
  const dress = path.join(f.root, '2026 收藏', '下载批次', '衣服', '独立衣装'); write(dress, 'Assets/Textures/colour.png'); write(dress, 'Assets/Dress_Airi.fbx');
  const hair = path.join(f.root, '发型', '独立发型'); write(hair, '独立发型/素材包/Hair_Airi.fbx');
  const body = path.join(f.root, '身体', 'Body_Airi.unitypackage'); write(f.root, path.relative(f.root, body));
  const prop = path.join(f.root, 'Props', '小道具'); write(prop, 'Prop.fbx');
  const japanese = path.join(f.root, '衣装', '日本語商品'); write(japanese, '商品.fbx');
  // An exact category name can itself be a product bundle with engine internals.
  const bundle = path.join(f.root, 'Airi', '衣服'); write(bundle, 'Assets/Clothes_Airi.fbx'); write(bundle, 'Textures/colour.png');
  const project = path.join(f.root, '道具', 'Unity Project'); for (const marker of ['Assets','Packages','ProjectSettings']) fs.mkdirSync(path.join(project, marker), {recursive:true}); write(project, 'Library/internal.zip');
  write(f.root, '衣服/Library/cache.fbx'); const outside = path.join(f.area, '链接外部'); write(outside, 'Private.fbx'); fs.symlinkSync(outside, path.join(f.root, '身体', '外部链接'), process.platform === 'win32' ? 'junction' : 'dir');
  const before = snapshot(f.root), external = snapshot(outside); await new Scanner(store).scan(); const rows = store.all();
  for (const expected of [dress,hair,body,prop,japanese,bundle,project]) assert(rows.some(row => row.path === expected), `missing ${expected}`);
  assert.equal(rows.length, 7); assert.equal(rows.find(row => row.path === project).kind, 'unity-project'); assert(rows.find(row => row.path === hair).wrapper); assert(!rows.some(row => /colour\.png|cache\.fbx|internal\.zip|Private\.fbx/.test(row.name))); assert.deepEqual(snapshot(f.root), before); assert.deepEqual(snapshot(outside), external);
});

test('a selected category root and nested avatar categories enumerate products once and preserve unrelated titled bundles', async t => {
  const f = fixture(t), root = path.join(f.root, '衣服'), store = f.open(f.data, [root]); const product = path.join(root, 'Airi', '衣装', 'Cute Dress'); write(product, 'Assets/Dress.fbx'); const archive = write(root, 'Airi/衣装/Other Dress.unitypackage'); const titled = path.join(root, 'Material Girl'); write(titled, 'Hair/Style.fbx'); write(titled, 'Body/Skin.fbx');
  await new Scanner(store).scan(); const rows = store.all(); assert(rows.some(row => row.path === product)); assert(rows.some(row => row.path === archive)); assert(rows.some(row => row.path === titled)); assert.equal(rows.length, 3);
});

test('restored detached children remain unread under an active parent, including wrapper discovery and file listing', async t => {
  const f = fixture(t), branch = path.join(f.root, 'Collection'), detached = path.join(branch, 'Private old source'), active = write(branch, 'Visible_Airi.fbx'), privateFile = write(detached, 'Secret.fbx'), source = f.open();
  source.upsertScan(input(active)); const secret = source.upsertScan(input(privateFile)); source.updateManual([secret.id], {notes:'原私有标注'});
  const backup = path.join(f.area, 'nested-detached.json'); source.exportData(backup); legacyBackup(backup, value => { value.settings.detachedRoots = [detached]; });
  const restored = f.open(path.join(f.area, '带排除的恢复'), []); restored.importData(backup); assert.equal(restored.get(secret.id), null); assert.equal(restored.getRaw(secret.id).manual.notes, '原私有标注');
  const original = fsp.readdir, reads = []; fsp.readdir = async function(directory, ...args) { reads.push(String(directory)); assert(!String(directory).startsWith(detached), 'detached sources must not be enumerated'); return original.call(this, directory, ...args); };
  try {
    const scanner = new Scanner(restored); await scanner.scan(); const parent = restored.all().find(row => row.path === branch); assert(parent); const listing = await scanner.files(parent.id); assert(!listing.entries.some(entry => /Secret|Private old source/.test(entry.name))); assert(!reads.some(directory => directory.startsWith(detached)));
  } finally { fsp.readdir = original; }
  restored.saveSettings({theme:'x-light'}); assert.equal(restored.get(secret.id), null);
  const again = path.join(f.area, 'nested-detached-again.json'); restored.exportData(again); const reopened = f.open(path.join(f.area, '再次恢复'), []); reopened.importData(again); assert.equal(reopened.get(secret.id), null); assert.deepEqual(reopened.settings().detachedRoots, [detached]);
  reopened.saveSettings({roots:[f.root, detached]}); assert.deepEqual(reopened.settings().detachedRoots || [], []); assert.equal(reopened.get(secret.id).manual.notes, '原私有标注');
});

test('legacy category aggregate rows retain annotations in backup while recursive scans show only actual products', async t => {
  const f = fixture(t), shelf = path.join(f.root, '衣服'), product = path.join(shelf, '商品'); write(product, 'Assets/Dress_Airi.fbx'); const store = f.open(), old = store.upsertScan({...input(shelf), kind:'folder'}); store.updateManual([old.id], {notes:'旧容器标注'}); assert.equal(store.list().total, 1);
  await new Scanner(store).scan(); assert.equal(store.list().total, 1); assert.equal(store.get(old.id), null); assert.equal(store.getRaw(old.id).manual.notes, '旧容器标注'); assert.equal(store.list({status:'missing'}).total, 0);
  const backup = path.join(f.area, 'legacy-shelf.json'); store.exportData(backup); const restored = f.open(path.join(f.area, '旧容器恢复'), []); restored.importData(backup); assert.equal(restored.get(old.id), null); assert.equal(restored.getRaw(old.id).manual.notes, '旧容器标注'); assert.equal(restored.list().total, 1);
});

test('root validation and unsafe overlap failures leave source scope and metadata unchanged', t => {
  const f = fixture(t), store = f.open(), item = store.upsertScan(input(write(f.root, 'Protected.fbx'))), before = store.settings();
  for (const roots of [['relative'], [f.area], null]) { assert.throws(() => store.saveSettings({roots}), /根目录|保护/); assert.deepEqual(store.settings(), before); }
  store.removeRoot(f.root); store.saveSettings({detachedRoots:[]}); assert.deepEqual(store.settings().detachedRoots, [f.root]); assert.equal(store.getRaw(item.id).id, item.id); assert.throws(() => store.saveSettings({backupDir:f.root}), /保护/);
});

test('an explicitly reactivated nested root receives a scan pass when an intermediate parent remains detached', async t => {
  const f = fixture(t), detached = path.join(f.root, 'B'), child = path.join(detached, 'C'), visible = write(child, 'Current_Airi.fbx'), retained = write(child, 'Retained_Airi.fbx'); write(detached, 'Private.fbx'); const source = f.open(), item = source.upsertScan(input(retained)), backup = path.join(f.area, 'blocked-ancestor.json'); source.updateManual([item.id], {notes:'嵌套目录原标注'}); source.exportData(backup); legacyBackup(backup, value => { value.settings.detachedRoots = [detached]; });
  const restored = f.open(path.join(f.area, '重新启用孙目录'), []); restored.importData(backup); restored.saveSettings({roots:[f.root, child]}); assert.equal(restored.isPathActive(child), true); assert.equal(restored.isPathActive(detached), false);
  const before = snapshot(f.root);
  const original = fsp.readdir, reads = []; fsp.readdir = async function(directory, ...args) { reads.push(String(directory)); assert.notEqual(String(directory), detached, 'detached intermediate directory must not be traversed'); return original.call(this, directory, ...args); };
  try { const scanner = new Scanner(restored); await scanner.scan(); assert(restored.all().some(row => row.path === visible), 'reactivated child assets must be scanned'); assert(reads.includes(child)); assert.deepEqual(scanner.progress().errors, []); assert(!restored.all().some(row => row.name === 'Private.fbx')); assert.equal(restored.all().find(row => row.path === retained).id, item.id); assert.equal(restored.get(item.id).manual.notes, '嵌套目录原标注'); assert.deepEqual(snapshot(f.root), before); } finally { fsp.readdir = original; }
});

test('merging two valid eleven-root libraries preserves preference updates and root removal after restore', t => {
  const f = fixture(t), left = Array.from({length:11}, (_, index) => path.join(f.root, 'left-'+index)), right = Array.from({length:11}, (_, index) => path.join(f.root, 'right-'+index)), current = f.open(f.data, left), incoming = f.open(path.join(f.area, '十一目录备份库'), right);
  const item = current.upsertScan(input(write(left[0], 'Original_Airi.fbx'))); current.updateManual([item.id], {notes:'原标注'}); const imported = incoming.upsertScan(input(write(right[0], 'Imported_Airi.fbx'))); incoming.updateManual([imported.id], {notes:'导入标注'});
  const backup = path.join(f.area, 'eleven-roots.json'); incoming.exportData(backup); current.importData(backup); assert.equal(current.settings().roots.length, 22);
  current.saveSettings({language:'ja', theme:'x-light', backupDir:path.join(f.area, '用户备份')}); assert.equal(current.settings().language, 'ja'); assert.equal(current.settings().theme, 'x-light'); current.removeRoot(left[0]); assert.equal(current.settings().roots.length, 21); assert.equal(current.get(item.id), null); assert.equal(current.getRaw(item.id).manual.notes, '原标注'); assert.equal(current.get(imported.id).manual.notes, '导入标注');
  current.close(); const reopened = f.open(); assert.equal(reopened.settings().roots.length, 21); reopened.saveSettings({language:'en'}); assert.equal(reopened.settings().language, 'en');
});

test('an oversized merged root scope is rejected before changing settings or retained annotations', t => {
  const f = fixture(t), left = Array.from({length:501}, (_, index) => path.join(f.root, 'large-left-'+index)), right = Array.from({length:500}, (_, index) => path.join(f.root, 'large-right-'+index)), current = f.open(f.data, left), incoming = f.open(path.join(f.area, '大目录备份库'), right), item = current.upsertScan(input(write(left[0], 'Original.fbx'))); current.updateManual([item.id], {notes:'保持原样'});
  const imported = incoming.upsertScan(input(write(right[0], 'Incoming.fbx'))), before = current.settings(), raw = current.getRaw(item.id), backup = path.join(f.area, 'too-many-merged-roots.json'); incoming.exportData(backup); assert.throws(() => current.importData(backup), /根目录/); assert.deepEqual(current.settings(), before); assert.deepEqual(current.getRaw(item.id), raw); assert.equal(current.getRaw(imported.id), null); assert.equal(current.all().length, 1); assert(!fs.existsSync(path.join(f.data, 'cache'))); current.close(); const reopened = f.open(f.data, left); assert.deepEqual(reopened.settings(), before); assert.equal(reopened.getRaw(item.id).path, raw.path); assert.deepEqual(reopened.getRaw(item.id).manual, raw.manual); assert.equal(reopened.getRaw(imported.id), null);
});
