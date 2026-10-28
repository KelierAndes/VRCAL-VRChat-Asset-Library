const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Store } = require('../dist/main/main/store');
const { Scanner } = require('../dist/main/main/scanner');
const { DownloadExtractionJobs } = require('../dist/main/main/download-extraction-jobs');

function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const filename = Buffer.from(name), data = Buffer.from(content), packed = zlib.deflateRawSync(data), crc = zlib.crc32(data);
    const header = Buffer.alloc(30), index = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    index.writeUInt32LE(0x02014b50); index.writeUInt16LE(0x0314, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(0x800, 8); index.writeUInt16LE(8, 10);
    index.writeUInt32LE(crc, 16); index.writeUInt32LE(packed.length, 20); index.writeUInt32LE(data.length, 24); index.writeUInt16LE(filename.length, 28);
    index.writeUInt32LE((0o100644 << 16) >>> 0, 38); index.writeUInt32LE(offset, 42);
    local.push(header, filename, packed); central.push(index, filename); offset += header.length + filename.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file; }
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fixture(t) {
  const workspace = path.resolve(__dirname, '..', '..'), area = fs.mkdtempSync(path.join(workspace, 'extraction-scanner-test-'));
  const dataDir = path.join(area, 'profile'), parent = path.join(area, 'downloads'), input = path.join(area, 'input');
  for (const directory of [dataDir, parent, input]) fs.mkdirSync(directory);
  let store = new Store(dataDir, []), scanner = new Scanner(store);
  const registered = [], trashed = [];
  const jobs = new DownloadExtractionJobs({
    dataDir, roots: () => store.settings().roots, available: () => true, changed() {},
    register: async directory => {
      const result = await scanner.addPaths([directory]);
      assert.deepEqual(result.errors, []); assert.equal(result.cancelled, false); assert.equal(result.ids.length, 1);
      const record = store.all().find(asset => asset.path === directory);
      assert(record, 'the exact extracted root must register as one material');
      registered.push(directory); return { assetId: record.id };
    },
    trash: async file => { trashed.push(file); throw new Error('This fixture must retain every original archive'); },
  });
  t.after(async () => {
    await jobs.shutdown(); store.close();
    const resolved = fs.realpathSync(area), relative = path.relative(workspace, resolved);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(resolved).startsWith('extraction-scanner-test-'));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
  });
  return {
    area, parent, input, jobs, registered, trashed,
    get store() { return store; }, get scanner() { return scanner; },
    restart() { store.close(); store = new Store(dataDir, []); scanner = new Scanner(store); },
    source(name, entries) { const file = write(path.join(input, name), zip(entries)); return { id: crypto.randomUUID(), name, file }; },
  };
}

test('classified model and separate material ZIPs remain one extracted material across refresh and Store restart', async t => {
  const f = fixture(t), sibling = write(path.join(f.parent, 'Existing source', 'Keep.fbx'), 'untouched sibling');
  const model = f.source('Dress.zip', { '衣服/Dress/model.fbx': 'synthetic model' });
  const material = f.source('MAT_TEX_Dress.zip', { 'Materials/Dress.mat': 'synthetic material' });
  const before = [model.file, material.file, sibling].map(hash);
  await f.jobs.extract([model, material], f.parent, 'Dress', false);
  const [job] = f.jobs.state(); assert.equal(job.state, 'completed'); assert.equal(job.files, 2); assert.equal(f.registered.length, 1);
  const record = f.store.getRaw(job.assetId);
  assert.equal(record.path, job.directory); assert.equal(record.kind, 'folder'); assert.equal(f.store.all().length, 1);
  assert.deepEqual(f.store.settings().directSources, [job.directory]);
  const listing = await f.scanner.files(record.id);
  const names = listing.entries.map(entry => entry.name.replaceAll('\\', '/'));
  assert(names.includes('001-Dress/衣服/Dress/model.fbx')); assert(names.includes('002-MAT_TEX_Dress/Materials/Dress.mat'));
  f.store.updateManual([record.id], { title: 'My combined dress', notes: 'retain these annotations', tags: ['Combined'] });
  for (const reopen of [false, true]) {
    if (reopen) f.restart();
    await f.scanner.scan(); assert.deepEqual(f.scanner.progress().errors, []);
    const rows = f.store.all(); assert.equal(rows.length, 1); assert.equal(rows[0].id, record.id); assert.equal(rows[0].path, job.directory);
    assert.equal(rows[0].kind, 'folder'); assert.equal(rows[0].manual.title, 'My combined dress'); assert.equal(rows[0].manual.notes, 'retain these annotations');
    assert.deepEqual(rows[0].manual.tags, ['Combined']); assert.equal(rows[0].missing, false);
  }
  assert.deepEqual([model.file, material.file, sibling].map(hash), before); assert.deepEqual(f.trashed, []);
  assert.deepEqual(fs.readdirSync(path.dirname(sibling)), ['Keep.fbx']);
});

test('ordinary explicitly selected category containers still register their individual products', async t => {
  const f = fixture(t), ordinary = path.join(f.area, 'Ordinary download');
  const dress = path.join(ordinary, '衣服', 'Dress'), hair = path.join(ordinary, '衣服', 'Hair');
  write(path.join(dress, 'model.fbx'), 'dress'); write(path.join(hair, 'model.fbx'), 'hair');
  const result = await f.scanner.addPaths([ordinary]); assert.deepEqual(result.errors, []); assert.equal(result.ids.length, 2);
  assert.deepEqual(f.store.all().map(record => record.path).sort(), [dress, hair].sort());
  await f.scanner.scan(); assert.deepEqual(f.store.all().map(record => record.path).sort(), [dress, hair].sort());
});

test('a matching nested directory name alone does not change a normal scan root into one bundle', async t => {
  const f = fixture(t), root = path.join(f.area, 'Source'), named = path.join(root, 'Dress--vrcal-unpacked-' + crypto.randomUUID());
  const dress = path.join(named, '服装', 'Dress'); write(path.join(dress, 'model.fbx'), 'dress');
  f.store.saveSettings({ roots: [root] });
  await f.scanner.scan(); assert.deepEqual(f.scanner.progress().errors, []);
  assert.deepEqual(f.store.all().map(record => record.path), [dress]); assert.deepEqual(f.store.settings().directSources ?? [], []);
});
