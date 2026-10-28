const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), vm = require('node:vm');
const {DatabaseSync} = require('node:sqlite'), ts = require('typescript');

// Exercise current source without rebuilding dist or starting a desktop session.
const previousLoader = require.extensions['.ts'];
let Store, EnrichmentQueue, normalizeSourceRoots, sourcePathKey, normalizeLanguage, translate;
try {
  require.extensions['.ts'] = (loaded, filename) => loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true},fileName:filename
  }).outputText, filename);
  ({Store} = require('../src/main/store.ts'));
  ({EnrichmentQueue} = require('../src/main/online.ts'));
  ({normalizeSourceRoots,sourcePathKey} = require('../src/main/source-roots.ts'));
  ({normalizeLanguage,translate} = require('../src/shared/i18n.ts'));
} finally {
  if (previousLoader) require.extensions['.ts'] = previousLoader;
  else delete require.extensions['.ts'];
}

function fixture(t) {
  const area = fs.mkdtempSync(path.join(os.tmpdir(), 'vrcal-remove-roots-')), source = path.join(area, '素材 日本語'), data = path.join(area, 'Library'), stores = [];
  fs.mkdirSync(source);
  t.after(() => {
    for (const store of stores) try { store.close(); } catch {}
    const resolved = fs.realpathSync(area), relative = path.relative(os.tmpdir(), resolved);
    assert(relative && !relative.startsWith('..') && path.basename(resolved).startsWith('vrcal-remove-roots-'));
    fs.rmSync(resolved, {recursive:true,force:true,maxRetries:3});
  });
  return {area,source,data,open(roots, directory=data) { const store = new Store(directory, roots); stores.push(store); return store; }};
}
function write(root, relative) { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, 'ORIGINAL SOURCE ' + relative); return file; }
function seed(store, file, name=path.basename(file)) {
  const stat = fs.statSync(file), row = store.upsertScan({path:file,name,kind:'file',group:'Airi',size:stat.size,mtimeMs:stat.mtimeMs,localCategory:'服装',localAvatars:['Airi'],hintUrls:[]});
  store.updateManual([row.id], {title:'私有标题 ' + name,notes:'保留历史标注 日本語',favorite:true,tags:['私有标签']});
  return store.getRaw(row.id);
}
function snapshot(root) {
  const result = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
      const file = path.join(directory, entry.name), stat = fs.lstatSync(file);
      result[path.relative(root, file)] = entry.isDirectory() ? 'DIR' : {size:stat.size,mtimeMs:stat.mtimeMs,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
      if (entry.isDirectory()) visit(file);
    }
  }
  visit(root); return result;
}

test('one batch unregisters selected scopes with one persisted settings update and preserves annotations and source bytes', t => {
  const f = fixture(t), a = path.join(f.source, '衣服'), b = path.join(f.source, '髪型'), c = path.join(f.source, 'Keep'), store = f.open([a,b,c]);
  const removed = [seed(store, write(a, 'Dress_Airi.fbx')),seed(store, write(b, 'Hair_Airi.fbx'))], kept = seed(store, write(c, 'Prop_Airi.fbx'));
  const collection = store.saveCollection({name:'原集合',kind:'manual'}); store.updateCollectionMembers(collection.id, removed.map(row => row.id), 'add');
  store.saveSettings({theme:'x'});
  const before = snapshot(f.source), db = new DatabaseSync(path.join(f.data, 'library.sqlite'));
  db.exec("CREATE TABLE batch_settings_writes(count INTEGER); INSERT INTO batch_settings_writes VALUES(0); CREATE TRIGGER count_batch_settings AFTER UPDATE ON settings WHEN NEW.key='app' BEGIN UPDATE batch_settings_writes SET count=count+1; END;");
  try { store.removeRoots([a,b]); assert.equal(db.prepare('SELECT count FROM batch_settings_writes').get().count, 1); }
  finally { db.close(); }
  assert.deepEqual(store.settings().roots, [c]); assert.deepEqual(new Set(store.settings().detachedRoots), new Set([a,b]));
  for (const row of removed) { assert.equal(store.get(row.id), null); assert.deepEqual(store.getRaw(row.id), row); }
  assert.equal(store.get(kept.id).manual.notes, kept.manual.notes); assert.equal(store.list({collectionId:collection.id}).total, 0); assert.deepEqual(snapshot(f.source), before);
  store.saveSettings({roots:[a,b,c]});
  assert.equal(store.list({collectionId:collection.id}).total, 2); for (const row of removed) assert.deepEqual(store.getRaw(row.id).manual, row.manual);
});

test('batch removal of a parent and child is independent of selection order and retains a reactivated grandchild', async t => {
  const f = fixture(t), parent = path.join(f.source, 'Parent'), child = path.join(parent, 'Child'), grandchild = path.join(child, 'Grandchild'), sibling = path.join(f.source, 'Sibling');
  const direct = write(parent, 'Parent_Airi.fbx'), nested = write(child, 'Child_Airi.fbx'), retained = write(grandchild, 'Grandchild_Airi.fbx'), other = write(sibling, 'Sibling_Airi.fbx'), before = snapshot(f.source);
  const outcomes = [];
  for (const [index, selected] of [[0,[parent,child]],[1,[child,parent]]]) {
    const store = f.open([parent,child,grandchild,sibling], path.join(f.area, 'Order-' + index));
    const rows = [direct,nested,retained,other].map(file => seed(store, file));
    if (index === 0) store.removeRoots(selected);
    else {
      const api = handlers(store); await api.invoke('removeRoots', selected);
      assert.deepEqual(new Set(api.excluded[0]), new Set(rows.slice(0,2).map(row => row.id)));
    }
    outcomes.push({roots:store.settings().roots,detached:[...store.settings().detachedRoots].sort(),active:[direct,nested,retained,other].map(file => store.isPathActive(file))});
    assert.deepEqual(store.settings().roots, [grandchild,sibling]); assert.deepEqual(outcomes[index].active, [false,false,true,true]);
  }
  assert.deepEqual(outcomes[0], outcomes[1]); assert.deepEqual(snapshot(f.source), before);
});

test('removing only a registered child excludes it under its retained parent and filters only removed direct sources', t => {
  const f = fixture(t), parent = path.join(f.source, 'Parent'), child = path.join(parent, 'Child'), direct = write(child, 'Dress_Airi.fbx'), keep = write(parent, 'Hair_Airi.fbx');
  const store = f.open([parent,child,direct,keep]); store.saveSettings({directSources:[direct,keep]});
  const removed = seed(store, direct), kept = seed(store, keep), before = snapshot(f.source);
  store.removeRoots([child,direct]);
  assert.deepEqual(store.settings().roots, [parent,keep]); assert.deepEqual(store.settings().directSources, [keep]);
  assert.equal(store.get(removed.id), null); assert(store.get(kept.id)); assert.equal(store.isPathActive(child), false); assert.deepEqual(snapshot(f.source), before);
});

test('removing every registered root stays empty across preference writes, restart and verified backup restore', t => {
  const f = fixture(t), a = path.join(f.source, 'A'), b = path.join(f.source, 'B'), store = f.open([a,b]);
  const rows = [seed(store, write(a, 'Dress.fbx')),seed(store, write(b, 'Hair.fbx'))], before = snapshot(f.source);
  store.removeRoots([a,b]); store.saveSettings({theme:'x-light'}); assert.deepEqual(store.settings().roots, []); assert.equal(store.all().length, 0);
  const backup = path.join(f.area, 'removed.vrclib.json'); store.exportData(backup); store.close();
  const reopened = f.open([a,b]); assert.deepEqual(reopened.settings().roots, []); assert.equal(reopened.list().total, 0);
  const restored = f.open([], path.join(f.area, 'Restored')); restored.importData(backup); assert.deepEqual(restored.settings().roots, []); assert.equal(restored.all().length, 0);
  for (const row of rows) { assert.deepEqual(reopened.getRaw(row.id).manual, row.manual); assert.deepEqual(restored.getRaw(row.id).manual, row.manual); }
  restored.saveSettings({roots:[a,b]}); for (const row of rows) assert.deepEqual(restored.get(row.id).manual, row.manual);
  assert.deepEqual(snapshot(f.source), before);
});

test('empty, unknown, malformed and mixed invalid batches fail without partial changes or lost source records', t => {
  const f = fixture(t), a = path.join(f.source, 'A'), b = path.join(f.source, 'B'), store = f.open([a,b]);
  const row = seed(store, write(a, 'Dress.fbx')), before = store.settings(), bytes = snapshot(f.source);
  for (const selected of [[],null,undefined,'bad',[path.join(f.source,'unknown')],[a,path.join(f.source,'unknown')],[a,'relative'],[a,1],[a,b + '\0'],Array(1001).fill(a)]) {
    assert.throws(() => store.removeRoots(selected), /目录|路径|选择/);
    assert.deepEqual(store.settings(), before); assert.deepEqual(store.getRaw(row.id), row); assert.deepEqual(snapshot(f.source), bytes);
  }
  store.close(); assert.deepEqual(f.open([a,b]).settings(), before);
});

test('all 1000 supported registered roots can be removed together without duplicate detached-scope overflow', t => {
  const f = fixture(t), roots = Array.from({length:1000}, (_,index) => path.join(f.source, 'Root-' + index)), store = f.open(roots);
  store.removeRoots(roots);
  assert.deepEqual(store.settings().roots, []); assert.equal(store.settings().detachedRoots.length, 1000);
  store.close(); const reopened = f.open(roots); assert.deepEqual(reopened.settings().roots, []); assert.equal(reopened.settings().detachedRoots.length, 1000);
});

test('duplicate equivalent Windows paths count once and the original single-root child-exclusion behavior remains available', t => {
  const f = fixture(t), child = path.join(f.source, 'Child'), other = path.join(f.source, 'Other'), file = write(child, 'Dress.fbx'), keep = write(other, 'Hair.fbx'), store = f.open([f.source]);
  const row = seed(store, file), kept = seed(store, keep), before = snapshot(f.source);
  store.removeRoot(child); assert.deepEqual(store.settings().roots, [f.source]); assert.equal(store.get(row.id), null); assert(store.get(kept.id));
  store.saveSettings({roots:[f.source,child]}); assert.equal(store.get(row.id).manual.notes, row.manual.notes);
  const alias = process.platform === 'win32' ? child.toUpperCase() : path.join(child, '.');
  store.removeRoots([child,alias,child]); assert.deepEqual(store.settings().roots, [f.source]); assert.equal(store.get(row.id), null); assert(store.get(kept.id));
  assert.deepEqual(snapshot(f.source), before);
});

function handlers(store) {
  const filename = path.join(__dirname, '../src/main/main.ts'), source = fs.readFileSync(filename, 'utf8'), parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const declarations = parsed.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(parsed)).join('\n');
  const registered = new Map(), excluded = [], effects = {preview:0,changed:0}, contents = {mainFrame:{}};
  const context = {Error,path,normalizeSourceRoots,sourcePathKey,normalizeLanguage,translate,store,window:{webContents:contents},ipcMain:{handle:(name,callback) => registered.set(name, callback)},migrating:false,baiduDownloads:{processing:false},recycleOperation:undefined,projectImports:{busy:false},pluginInstall:undefined,publicPlugins:{busy:false},scanner:{progress:() => ({running:false})},queue:{exclude:ids => excluded.push(Array.from(ids))},preview:{close:() => effects.preview++}};
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(declarations, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText, context);
  context.changed = () => effects.changed++;
  vm.runInContext('registerHandlers()', context);
  const event = {sender:contents,senderFrame:contents.mainFrame};
  return {context,effects,excluded,registered,event,invoke(name, input, caller=event) { const handler = registered.get('library:' + name); assert(handler, name + ' must be registered'); return handler(caller, input); }};
}

test('the batch IPC validates the full input, deduplicates once and applies queue/preview/change side effects once', async t => {
  const f = fixture(t), a = path.join(f.source, 'A'), b = path.join(f.source, 'B'), c = path.join(f.source, 'C'), store = f.open([a,b,c]);
  const first = seed(store, write(a, 'Dress_Airi.fbx')), second = seed(store, write(b, 'Hair_Airi.fbx')), kept = seed(store, write(c, 'Prop_Airi.fbx')), before = snapshot(f.source), api = handlers(store);
  const alias = process.platform === 'win32' ? a.toUpperCase() : path.join(a, '.');
  assert.equal(await api.invoke('removeRoots', [a,alias,b]), true);
  assert.deepEqual(store.settings().roots, [c]); assert.deepEqual(api.excluded, [[first.id,second.id]]); assert.deepEqual(api.effects, {preview:1,changed:1});
  assert(store.get(kept.id)); assert.equal(store.getRaw(first.id).manual.notes, first.manual.notes); assert.deepEqual(snapshot(f.source), before);
});

test('the batch IPC rejects invalid input, untrusted callers, scanning and every existing remove-root exclusion gate before mutation', async t => {
  const f = fixture(t), root = path.join(f.source, 'A'), store = f.open([root]), row = seed(store, write(root, 'Dress.fbx')), before = store.settings(), api = handlers(store);
  for (const selected of [[],null,[root,'relative'],[root,path.join(f.source,'Unknown')],Array(1001).fill(root)]) await assert.rejects(api.invoke('removeRoots', selected), /目录|路径|选择/);
  await assert.rejects(api.invoke('removeRoots', [root], {sender:{},senderFrame:{}}), /来源/);
  for (const [key,value,pattern] of [['migrating',true,/资料库位置/],['baiduDownloads',{processing:true},/解压/],['recycleOperation',Promise.resolve(),/回收站/],['projectImports',{busy:true},/工程素材导入/],['pluginInstall',Promise.resolve(),/工程素材导入/],['publicPlugins',{busy:true},/工程素材导入/],['scanner',{progress:() => ({running:true})},/停止扫描/]]) {
    const previous = api.context[key]; api.context[key] = value;
    await assert.rejects(api.invoke('removeRoots', [root]), pattern); api.context[key] = previous;
    assert.deepEqual(store.settings(), before); assert.equal(store.get(row.id).manual.notes, row.manual.notes);
  }
  assert.deepEqual(api.excluded, []); assert.deepEqual(api.effects, {preview:0,changed:0});
});

test('the batch IPC accepts the entire 1000-root registration limit and keeps single-root IPC behavior compatible', async t => {
  const f = fixture(t), roots = Array.from({length:1000}, (_,index) => path.join(f.source, 'Root-' + index)), store = f.open(roots), api = handlers(store);
  assert.equal(await api.invoke('removeRoots', roots), true); assert.deepEqual(store.settings().roots, []); assert.deepEqual(api.effects, {preview:1,changed:1});
  store.saveSettings({roots:[roots[0]]}); assert.equal(await api.invoke('removeRoot', roots[0]), true); assert.deepEqual(store.settings().roots, []);
  await assert.rejects(api.invoke('removeRoot', roots[1]), /未登记/);
});

test('the sandbox preload exposes removeRoots as one authenticated IPC request', async t => {
  const f = fixture(t), a = path.join(f.source, 'A'), b = path.join(f.source, 'B'), store = f.open([a,b]), backend = handlers(store), calls = []; let api;
  const source = fs.readFileSync(path.join(__dirname, '../src/main/preload.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText, {exports:{},process:{argv:[]},require:name => {
    assert.equal(name, 'electron'); return {contextBridge:{exposeInMainWorld:(_name, value) => { api = value; }},ipcRenderer:{invoke:async(channel, ...args) => { calls.push({channel,args}); return backend.registered.get(channel)(backend.event, ...args); }}};
  }});
  assert.equal(typeof api.removeRoots, 'function'); assert.equal(await api.removeRoots([a,b]), true);
  assert.deepEqual(calls, [{channel:'library:removeRoots',args:[[a,b]]}]); assert.deepEqual(store.settings().roots, []);
});

test('exceeding the existing detached-scope limit rejects the whole batch without changing persisted scopes or annotations', async t => {
  const f = fixture(t), previous = Array.from({length:1000}, (_,index) => path.join(f.source, 'Old-' + index)), root = path.join(f.source, 'Current'), store = f.open(previous);
  store.removeRoots(previous); store.saveSettings({roots:[root]});
  const row = seed(store, write(root, 'Current_Airi.fbx')), before = store.settings(), bytes = snapshot(f.source), api = handlers(store);
  assert.throws(() => store.removeRoots([root]), /根目录/);
  await assert.rejects(api.invoke('removeRoots', [root]), /根目录/);
  assert.deepEqual(store.settings(), before); assert.deepEqual(store.getRaw(row.id), row); assert.deepEqual(snapshot(f.source), bytes);
  assert.deepEqual(api.excluded, []); assert.deepEqual(api.effects, {preview:0,changed:0});
  store.close(); const reopened = f.open([root]); assert.deepEqual(reopened.settings(), before);
  assert.equal(reopened.getRaw(row.id).id, row.id); assert.equal(reopened.getRaw(row.id).path, row.path); assert.deepEqual(reopened.getRaw(row.id).manual, row.manual);
});

test('a committed batch stays successful and pauses the real queue even when exclude and pause cannot save queue.json', async t => {
  const f = fixture(t), roots = [path.join(f.source, 'A'),path.join(f.source, 'B')], store = f.open(roots);
  const rows = roots.map((root,index) => seed(store, write(root, 'Source-' + index + '.fbx'))), before = snapshot(f.source);
  store.saveSettings({theme:'x'});
  const queueFile = path.join(f.data, 'queue.json'); fs.writeFileSync(queueFile, JSON.stringify({version:2,tasks:rows.map(row => ({id:row.id})),paused:false,completed:0}));
  const queueBefore = fs.readFileSync(queueFile, 'utf8'), queue = new EnrichmentQueue({dataDir:f.data,roots:() => store.settings().roots,all:() => store.all(),get:id => store.get(id),updateOnline:(id,patch) => store.updateOnline(id,patch),fetch:async() => { throw new Error('No network requests are expected'); }});
  assert.equal(queue.progress.running, true);
  const api = handlers(store); api.context.queue = queue;
  const db = new DatabaseSync(path.join(f.data, 'library.sqlite'));
  db.exec("CREATE TABLE committed_batch_writes(count INTEGER); INSERT INTO committed_batch_writes VALUES(0); CREATE TRIGGER count_committed_batch AFTER UPDATE ON settings WHEN NEW.key='app' BEGIN UPDATE committed_batch_writes SET count=count+1; END;");
  const rename = fs.renameSync; let failedQueueSaves = 0;
  fs.renameSync = function(source, destination) {
    if (path.resolve(destination) === queueFile) { failedQueueSaves++; throw Object.assign(new Error('Synthetic queue.json storage failure'), {code:'EACCES'}); }
    return rename.apply(this, arguments);
  };
  try {
    assert.equal(await api.invoke('removeRoots', roots), true);
    assert.equal(db.prepare('SELECT count FROM committed_batch_writes').get().count, 1); assert.deepEqual(store.settings().roots, []);
    assert.equal(failedQueueSaves, 2); assert.equal(queue.progress.paused, true); assert.equal(queue.progress.running, false); assert.equal(queue.progress.pending, 0);
    assert.deepEqual(api.effects, {preview:1,changed:1});
    const warning = '素材位置已移除，但联网补全队列未能保存；已暂停补全，请检查资料库磁盘后重试。';
    assert.deepEqual(store.recoveryWarnings, [warning]); assert.equal(fs.readFileSync(queueFile, 'utf8'), queueBefore);
    for (const row of rows) assert.deepEqual(store.getRaw(row.id), row);
    assert.deepEqual(snapshot(f.source), before);
    store.saveSettings({roots}); assert.equal(await api.invoke('removeRoots', roots), true);
    assert.deepEqual(store.recoveryWarnings, [warning]); assert.deepEqual(api.effects, {preview:2,changed:2}); assert.deepEqual(store.settings().roots, []);
  } finally { fs.renameSync = rename; queue.stop(); db.close(); }
});

test('a preview shutdown failure after the batch commits cannot reject the removal or suppress the change event', async t => {
  const f = fixture(t), root = path.join(f.source, 'A'), store = f.open([root]), row = seed(store, write(root, 'Dress.fbx')), before = snapshot(f.source), api = handlers(store);
  api.context.preview.close = () => { api.effects.preview++; throw new Error('Synthetic preview shutdown failure'); };
  assert.equal(await api.invoke('removeRoots', [root]), true);
  assert.deepEqual(store.settings().roots, []); assert.deepEqual(api.excluded, [[row.id]]); assert.deepEqual(api.effects, {preview:1,changed:1});
  assert.deepEqual(store.getRaw(row.id), row); assert.deepEqual(snapshot(f.source), before);
});

test('a rejected metadata commit leaves roots intact and performs no queue, preview or change maintenance', async t => {
  const f = fixture(t), root = path.join(f.source, 'A'), store = f.open([root]), row = seed(store, write(root, 'Dress.fbx'));
  store.saveSettings({theme:'x'});
  const before = store.settings(), bytes = snapshot(f.source), api = handlers(store), db = new DatabaseSync(path.join(f.data, 'library.sqlite'));
  db.exec("CREATE TRIGGER reject_batch_metadata BEFORE UPDATE ON settings WHEN NEW.key='app' BEGIN SELECT RAISE(ABORT,'Synthetic metadata commit failure'); END;");
  try {
    await assert.rejects(api.invoke('removeRoots', [root]), /Synthetic metadata commit failure/);
    assert.deepEqual(store.settings(), before); assert.deepEqual(store.getRaw(row.id), row); assert.deepEqual(snapshot(f.source), bytes);
    assert.deepEqual(api.excluded, []); assert.deepEqual(api.effects, {preview:0,changed:0}); assert.deepEqual(store.recoveryWarnings, []);
  } finally { db.close(); }
});
