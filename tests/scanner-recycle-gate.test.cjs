const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');

// Load the real scanner and store without emitting dist or launching Electron.
const previousTypeScriptLoader = require.extensions['.ts'];
let Store, Scanner;
try {
  require.extensions['.ts'] = (loaded, filename) => {
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true},fileName:filename
    });
    loaded._compile(compiled.outputText, filename);
  };
  ({Store} = require('../src/main/store.ts'));
  ({Scanner} = require('../src/main/scanner.ts'));
} finally {
  if (previousTypeScriptLoader) require.extensions['.ts'] = previousTypeScriptLoader;
  else delete require.extensions['.ts'];
}

function fixture(t) {
  const area = fs.mkdtempSync(path.join(os.tmpdir(), 'vrcal-scanner-recycle-gate-'));
  const root = path.join(area, 'Synthetic materials'), data = path.join(area, 'Synthetic library'), scanners = [];
  fs.mkdirSync(root);
  const store = new Store(data, [root]);
  const file = path.join(root, 'Hair_Airi.fbx'); fs.writeFileSync(file, 'temporary synthetic source');
  const record = store.upsertScan({path:file,name:path.basename(file),kind:'file',group:'Airi',size:26,mtimeMs:1,localCategory:'头发',localAvatars:['Airi'],hintUrls:[]});
  store.markRecycled([record.id]);
  t.after(async () => {
    for (const scanner of scanners) { scanner.cancel(); await scanner.waitIdle(); }
    store.close();
    const resolved = fs.realpathSync(area), relative = path.relative(os.tmpdir(), resolved);
    assert(relative && !relative.startsWith('..') && path.basename(resolved).startsWith('vrcal-scanner-recycle-gate-'));
    fs.rmSync(resolved, {recursive:true,force:true,maxRetries:3});
  });
  return {area,root,data,store,file,record,scanner(...args) { const scanner = new Scanner(store, ...args); scanners.push(scanner); return scanner; }};
}
function scheduled(action) {
  return new Promise((resolve, reject) => setTimeout(() => {
    try { Promise.resolve(action()).then(resolve, reject); } catch (error) { reject(error); }
  }, 0));
}
const blocked = /正在处理回收站操作，请稍候。/;

test('an already scheduled scan cannot write the store or clear recycled records while the start gate is closed', async t => {
  const f = fixture(t), progress = []; let allowed = true;
  const scanner = f.scanner(value => progress.push(value), () => allowed);
  const records = f.store.recycleRecords(), settings = f.store.settings();
  const pending = scheduled(() => scanner.scan());
  allowed = false;
  await assert.rejects(pending, blocked);
  await scanner.waitIdle();
  assert.deepEqual(f.store.recycleRecords(), records);
  assert.deepEqual(f.store.settings(), settings);
  assert.deepEqual(progress, []);
  assert.equal(scanner.progress().running, false);
  assert.equal(f.store.list().total, 0);
  assert.equal(fs.readFileSync(f.file, 'utf8'), 'temporary synthetic source');
  allowed = true;
  await scanner.scan();
  assert.equal(f.store.getRaw(f.record.id).recycledAt, undefined);
  assert.equal(f.store.list().total, 1);
});

test('an already scheduled manual import cannot register source roots or clear a tombstone until the gate opens', async t => {
  const f = fixture(t), progress = []; let allowed = true;
  const scanner = f.scanner(value => progress.push(value), () => allowed);
  const records = f.store.recycleRecords(), settings = f.store.settings();
  const pending = scheduled(() => scanner.addPaths([f.file]));
  allowed = false;
  await assert.rejects(pending, blocked);
  await scanner.waitIdle();
  assert.deepEqual(f.store.recycleRecords(), records);
  assert.deepEqual(f.store.settings(), settings);
  assert.deepEqual(progress, []);
  assert.equal(f.store.list().total, 0);
  allowed = true;
  const result = await scanner.addPaths([f.file]);
  assert.deepEqual(result.errors, []);
  assert(result.ids.includes(f.record.id));
  assert(f.store.settings().directSources.includes(f.file));
  assert.equal(f.store.getRaw(f.record.id).recycledAt, undefined);
  assert.equal(f.store.list().total, 1);
});

test('the start gate is checked before sharing an active scan or reporting the ordinary manual-import busy error', async t => {
  const f = fixture(t); let allowed = true;
  const scanner = f.scanner(undefined, () => allowed), active = scanner.scan();
  allowed = false;
  await assert.rejects(scanner.scan(), blocked);
  await assert.rejects(scanner.addPaths([f.file]), blocked);
  scanner.cancel(); await active;
});

test('existing Scanner callers keep the default ability to scan and add materials', async t => {
  const f = fixture(t), scanner = f.scanner();
  await scanner.scan();
  assert.equal(f.store.list().total, 1);
  assert.equal(f.store.getRaw(f.record.id).recycledAt, undefined);
  const result = await scanner.addPaths([f.file]);
  assert.deepEqual(result.errors, []);
  assert(result.ids.includes(f.record.id));
});
