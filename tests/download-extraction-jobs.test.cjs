const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
let DownloadExtractionJobs;
try { ({ DownloadExtractionJobs } = require('../dist/main/main/download-extraction-jobs')); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

// Real ZIP local records and central directory; only application callbacks are substituted.
function zip(name = '衣服/愛莉.prefab', data = 'asset') {
  const filename = Buffer.from(name), payload = Buffer.from(data), packed = zlib.deflateRawSync(payload);
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22), crc = zlib.crc32(payload);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(payload.length, 22); local.writeUInt16LE(filename.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(payload.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + packed.length, 16);
  return Buffer.concat([local, filename, packed, central, filename, end]);
}

function fixture(t, options = {}) {
  assert.equal(typeof DownloadExtractionJobs, 'function', 'DownloadExtractionJobs must be implemented');
  const workspace = path.resolve(__dirname, '..', '..'), area = fs.mkdtempSync(path.join(workspace, 'extraction-jobs-test-'));
  const dataDir = path.join(area, 'profile'), parent = path.join(area, 'output'), input = path.join(area, 'input'), recycled = path.join(area, 'recycled');
  for (const directory of [dataDir, parent, input, recycled]) fs.mkdirSync(directory);
  const roots = [], registered = [], removed = [], notifications = [], changes = [];
  let available = true, service;
  const deps = {
    dataDir, roots: () => roots, available: () => available,
    changed: () => { changes.push(service?.state()); options.changed?.(service); },
    register: async directory => { registered.push(directory); return options.register ? options.register(directory) : { assetId: 'asset:cloth' }; },
    trash: async file => { if (options.trash) await options.trash(file, removed); fs.renameSync(file, path.join(recycled, path.basename(file))); removed.push(file); },
    onRecycled: source => { notifications.push(source); options.onRecycled?.(source); },
  };
  service = new DownloadExtractionJobs(deps);
  t.after(async () => {
    await service.shutdown();
    const resolved = fs.realpathSync(area), relative = path.relative(workspace, resolved);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { area, dataDir, parent, input, recycled, roots, registered, removed, notifications, changes, deps,
    get jobs() { return service; }, restart() { service = new DownloadExtractionJobs(deps); return service; },
    available(value) { available = value; },
    source(name = '衣服.zip', id = 'task-1', content = zip()) { const file = path.join(input, name); fs.writeFileSync(file, content); return { id, file, name }; },
    journal() { return JSON.parse(fs.readFileSync(path.join(dataDir, 'download-extractions.json'), 'utf8')); },
  };
}

test('extracts real ZIPs locally, registers fresh output and returns detached public state', async t => {
  const f = fixture(t), source = f.source();
  const run = f.jobs.extract([source], f.parent, '衣服', false);
  assert.equal(f.jobs.busy, true);
  await run;
  const [job] = f.jobs.state();
  assert.equal(f.jobs.busy, false); assert.equal(job.state, 'completed'); assert.equal(job.assetId, 'asset:cloth');
  assert.equal(job.files, 1); assert.equal(job.bytes, 5); assert.deepEqual(job.taskIds, ['task-1']);
  assert.equal(f.registered[0], job.directory); assert.equal(path.dirname(job.directory), f.parent);
  assert.equal(fs.existsSync(source.file), true); assert.equal(f.jobs.reveal(job.id), job.directory);
  assert(f.changes.some(state => state?.[0]?.state === 'registering'));
  assert(job.finishedAt); assert.deepEqual(job.recycledNames, []);
  job.taskIds.push('forged'); job.recycledNames.push('forged');
  assert.deepEqual(f.jobs.state()[0].taskIds, ['task-1']); assert.deepEqual(f.jobs.state()[0].recycledNames, []);
  assert.equal(f.journal().schema, 1);
});

test('failed registration retains output and originals; retry imports once and never recycles', async t => {
  let attempts = 0;
  const f = fixture(t, { register: async () => { if (++attempts === 1) throw new Error('数据库暂不可写'); return { assetId: 'asset:retry' }; } }), source = f.source();
  await assert.rejects(f.jobs.extract([source], f.parent, '衣服', true), /数据库/);
  const failed = f.jobs.state()[0];
  assert.equal(failed.state, 'failed'); assert(fs.existsSync(failed.directory)); assert.equal(f.jobs.reveal(failed.id), failed.directory);
  assert(fs.existsSync(source.file)); assert.deepEqual(f.removed, []);
  await f.jobs.retryImport(failed.id);
  const done = f.jobs.state()[0]; assert.equal(done.state, 'completed'); assert.equal(done.assetId, 'asset:retry'); assert.match(done.message, /原压缩包|回收/);
  assert(fs.existsSync(source.file)); assert.deepEqual(f.removed, []);
  await f.jobs.retryImport(failed.id); assert.equal(attempts, 2);
});

test('an invalid registration result fails without recycling any original', async t => {
  const f = fixture(t, { register: async () => ({ assetId: '../arbitrary' }) }), source = f.source();
  await assert.rejects(f.jobs.extract([source], f.parent, '衣服', true), /入库|素材/);
  assert.equal(f.jobs.state()[0].state, 'failed'); assert(fs.existsSync(source.file)); assert.deepEqual(f.removed, []);
});

test('recycles exact originals only after successful registration and allows roots to adopt output', async t => {
  let f;
  f = fixture(t, { register: async directory => { f.roots.push(directory); assert(fs.existsSync(f.one.file)); assert(fs.existsSync(f.two.file)); return { assetId: 'asset:both' }; } });
  f.one = f.source('MODEL.zip', 'task-1'); f.two = f.source('MAT_TEX.zip', 'task-2');
  await f.jobs.extract([f.one, f.two], f.parent, '衣服', true);
  const [job] = f.jobs.state(); assert.equal(job.state, 'completed'); assert.equal(job.files, 2); assert.deepEqual(job.recycledNames, ['MODEL.zip', 'MAT_TEX.zip']);
  assert.deepEqual(f.removed, [f.one.file, f.two.file]); assert.deepEqual(f.notifications.map(source => source.id), ['task-1', 'task-2']);
  assert.equal(f.jobs.reveal(job.id), job.directory);
  await f.jobs.extract([f.two, f.one], f.parent, '衣服', true);
  assert.equal(f.jobs.state().length, 1); assert.equal(f.registered.length, 1); assert.equal(fs.readdirSync(f.parent).length, 1);
});

test('partial recycling failure leaves completed output and reports only successfully recycled originals', async t => {
  const f = fixture(t, { trash: async (_file, removed) => { if (removed.length) throw new Error('回收站拒绝访问'); } });
  const one = f.source('MODEL.zip', 'task-1'), two = f.source('MAT_TEX.zip', 'task-2');
  await f.jobs.extract([one, two], f.parent, '衣服', true);
  const [job] = f.jobs.state(); assert.equal(job.state, 'completed'); assert.match(job.message, /回收/); assert.deepEqual(job.recycledNames, ['MODEL.zip']);
  assert(!fs.existsSync(one.file)); assert(fs.existsSync(two.file)); assert.equal(f.jobs.reveal(job.id), job.directory);
});

test('modified original after registration is preserved with a completed-output warning', async t => {
  let source;
  const f = fixture(t, { register: async () => { fs.appendFileSync(source.file, 'externally changed'); return { assetId: 'asset:changed' }; } });
  source = f.source(); await f.jobs.extract([source], f.parent, '衣服', true);
  assert.equal(f.jobs.state()[0].state, 'completed'); assert.match(f.jobs.state()[0].message, /变化|改变/);
  assert(fs.readFileSync(source.file).includes(Buffer.from('externally changed'))); assert.deepEqual(f.removed, []);
});

test('same-name replacement preserving size and modification time cannot be recycled', async t => {
  let f, source;
  f = fixture(t, { register: async () => {
    const previous = fs.statSync(source.file), bytes = fs.readFileSync(source.file);
    fs.renameSync(source.file, path.join(f.area, 'retained-original.zip'));
    fs.writeFileSync(source.file, bytes); fs.utimesSync(source.file, previous.atime, previous.mtime);
    return { assetId: 'asset:replaced-input' };
  } });
  source = f.source(); await f.jobs.extract([source], f.parent, '衣服', true);
  assert.equal(f.jobs.state()[0].state, 'completed'); assert.match(f.jobs.state()[0].message, /变化|改变/);
  assert(fs.existsSync(source.file)); assert(fs.existsSync(path.join(f.area, 'retained-original.zip'))); assert.deepEqual(f.removed, []);
});

test('remaining input identities are checked again between successful recycle operations', async t => {
  let two;
  const f = fixture(t, { onRecycled: () => fs.appendFileSync(two.file, 'changed between recycle operations') });
  const one = f.source('MODEL.zip', 'task-1'); two = f.source('MAT_TEX.zip', 'task-2');
  await f.jobs.extract([one, two], f.parent, '衣服', true);
  const [job] = f.jobs.state(); assert.equal(job.state, 'completed'); assert.deepEqual(job.recycledNames, ['MODEL.zip']);
  assert.match(job.message, /变化|改变/); assert(fs.existsSync(two.file)); assert.deepEqual(f.removed, [one.file]);
});

test('changed originals during decompression fail before registration or recycling', async t => {
  const f = fixture(t), source = f.source(); let changed = false;
  f.deps.available = () => { if (!changed && fs.readdirSync(f.parent).length) { changed = true; fs.appendFileSync(source.file, 'changed'); } return true; };
  await assert.rejects(f.jobs.extract([source], f.parent, '衣服', true), /变化|改变/);
  assert(changed); assert.equal(f.jobs.state()[0].state, 'failed'); assert.deepEqual(f.registered, []); assert.deepEqual(f.removed, []);
});

test('substituted output after registration is never revealed or used to justify recycling', async t => {
  let f;
  f = fixture(t, { register: async directory => { fs.renameSync(directory, path.join(f.area, 'saved-output')); fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'external.txt'), 'keep'); return { assetId: 'asset:replaced' }; } });
  const source = f.source(); await assert.rejects(f.jobs.extract([source], f.parent, '衣服', true), /变化|改变/);
  const job = f.jobs.state()[0]; assert.equal(job.state, 'failed'); assert.throws(() => f.jobs.reveal(job.id), /变化|改变/);
  assert(fs.existsSync(source.file)); assert.deepEqual(f.removed, []); assert.equal(fs.readFileSync(path.join(job.directory, 'external.txt'), 'utf8'), 'keep');
});

for (const change of ['edit', 'remove']) {
  test(`payload ${change} during registration prevents recycling while the output root is unchanged`, async t => {
    const f = fixture(t, { register: async directory => {
      const file = path.join(directory, fs.readdirSync(directory)[0], '衣服', '愛莉.prefab');
      if (change === 'edit') fs.writeFileSync(file, 'changed asset'); else fs.unlinkSync(file);
      return { assetId: 'asset:changed-payload' };
    } }), source = f.source();
    await assert.rejects(f.jobs.extract([source], f.parent, '衣服', true), /内容|变化|改变/);
    assert(fs.existsSync(source.file)); assert.deepEqual(f.removed, []); assert.equal(f.jobs.state()[0].state, 'failed');
  });
}

test('same selection cannot silently reuse an edited payload from a completed in-memory job', async t => {
  const f = fixture(t), source = f.source(); await f.jobs.extract([source], f.parent, '衣服', false);
  const [job] = f.jobs.state(); fs.writeFileSync(path.join(job.directory, fs.readdirSync(job.directory)[0], '衣服', '愛莉.prefab'), 'user edit');
  await assert.rejects(f.jobs.extract([source], f.parent, '衣服', true), /内容|变化|改变/);
  assert(fs.existsSync(source.file)); assert.equal(f.jobs.state().length, 1); assert.equal(f.registered.length, 1); assert.match(f.jobs.state()[0].message, /重新解压|重解压/);
});

test('local extraction has no network dependency and availability loss aborts safely', async t => {
  const f = fixture(t), source = f.source(); f.available(false);
  await assert.rejects(f.jobs.extract([source], f.parent, '衣服', false), /资料库|不可用|停止/);
  assert.deepEqual(f.registered, []); assert(fs.existsSync(source.file));
  f.available(true); await f.jobs.extract([source], f.parent, '衣服', false);
  assert.equal(f.jobs.state().filter(job => job.state === 'completed').length, 1);
});

test('rejects duplicate IDs, non-ZIPs, linked inputs and protected output without writing output', async t => {
  const f = fixture(t), source = f.source();
  await assert.rejects(f.jobs.extract([source, source], f.parent, '衣服', false));
  const unsupported = f.source('data.rar', 'rar'); await assert.rejects(f.jobs.extract([unsupported], f.parent, '衣服', false), /ZIP|格式/);
  await assert.rejects(f.jobs.extract(Array.from({ length: 101 }, (_, index) => ({ ...source, id: 'task-' + index })), f.parent, '衣服', false));
  const linked = path.join(f.input, 'linked.zip'); fs.linkSync(source.file, linked);
  await assert.rejects(f.jobs.extract([{ id: 'linked', file: linked, name: 'linked.zip' }], f.parent, '衣服', false), /链接|普通文件/);
  fs.unlinkSync(linked);
  f.roots.push(f.parent); await assert.rejects(f.jobs.extract([source], f.parent, '衣服', false), /保护/);
  f.roots.length = 0; await assert.rejects(f.jobs.extract([source], f.dataDir, '衣服', false), /保护|资料库/);
  assert.deepEqual(fs.readdirSync(f.parent), []); assert.deepEqual(f.registered, []);
});

test('restart retains completed safe paths and never extracts or recycles automatically', async t => {
  const f = fixture(t), source = f.source(); await f.jobs.extract([source], f.parent, '衣服', false);
  const [job] = f.jobs.state(); await f.jobs.shutdown(); const restarted = f.restart();
  assert.equal(restarted.state()[0].state, 'completed'); assert.equal(restarted.reveal(job.id), job.directory);
  assert.equal(f.registered.length, 1); assert.deepEqual(f.removed, []);
  await restarted.extract([source], f.parent, '衣服', true);
  assert.equal(restarted.state().length, 1); assert.equal(f.registered.length, 1); assert(fs.existsSync(source.file));
});

test('restart marks interrupted registration failed and retry preserves originals', async t => {
  const f = fixture(t, { register: async () => { throw new Error('import failed'); } }), source = f.source();
  await assert.rejects(f.jobs.extract([source], f.parent, '衣服', true));
  const [failed] = f.jobs.state(), journal = f.journal(); journal.jobs[0].state = 'registering';
  fs.writeFileSync(path.join(f.dataDir, 'download-extractions.json'), JSON.stringify(journal));
  await f.jobs.shutdown(); f.deps.register = async directory => { f.registered.push(directory); return { assetId: 'asset:restart' }; };
  const restarted = f.restart(); assert.equal(restarted.state()[0].state, 'failed'); assert.match(restarted.state()[0].message, /中断|重试/);
  assert.deepEqual(f.removed, []); await restarted.retryImport(failed.id);
  assert.equal(restarted.state()[0].state, 'completed'); assert.deepEqual(f.removed, []); assert(fs.existsSync(source.file));
});

test('journal cannot authorize arbitrary paths and replaced directory identities block restart retry', async t => {
  const f = fixture(t, { register: async () => { throw new Error('import failed'); } }), source = f.source();
  await assert.rejects(f.jobs.extract([source], f.parent, '衣服', false));
  const [failed] = f.jobs.state(), journal = f.journal(), original = structuredClone(journal);
  journal.jobs[0].directory = f.input;
  fs.writeFileSync(path.join(f.dataDir, 'download-extractions.json'), JSON.stringify(journal));
  const forged = f.restart(); assert.throws(() => forged.reveal(failed.id)); await assert.rejects(forged.retryImport(failed.id)); assert.equal(f.registered.length, 1);
  fs.writeFileSync(path.join(f.dataDir, 'download-extractions.json'), JSON.stringify(original));
  fs.renameSync(failed.directory, path.join(f.area, 'moved')); fs.mkdirSync(failed.directory);
  const replaced = f.restart(); assert.throws(() => replaced.reveal(failed.id)); await assert.rejects(replaced.retryImport(failed.id)); assert.equal(f.registered.length, 1);
});

test('linked output ancestors block reveal and retry without touching the linked directory', async t => {
  const f = fixture(t, { register: async () => { throw new Error('import failed'); } }), source = f.source();
  await assert.rejects(f.jobs.extract([source], f.parent, '衣服', false)); const [job] = f.jobs.state();
  const moved = path.join(f.area, 'moved-parent'); fs.renameSync(f.parent, moved); fs.symlinkSync(moved, f.parent, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.jobs.reveal(job.id), /链接|变化/); await assert.rejects(f.jobs.retryImport(job.id)); assert.equal(f.registered.length, 1);
  assert(fs.existsSync(path.join(moved, path.basename(job.directory))));
});

test('shutdown aborts an active real extraction, waits and rejects further work', async t => {
  const f = fixture(t), source = f.source('large.zip', 'large', zip('large.bin', Buffer.alloc(16 * 1024 * 1024, 90)));
  const run = f.jobs.extract([source], f.parent, '衣服', true); const failure = assert.rejects(run, /取消|停止/);
  await f.jobs.shutdown(); await failure;
  assert.equal(f.jobs.busy, false); assert.equal(f.jobs.state()[0].state, 'failed'); assert.deepEqual(f.registered, []); assert.deepEqual(f.removed, []);
  assert(fs.existsSync(source.file)); await assert.rejects(f.jobs.extract([source], f.parent, '衣服', false), /关闭|停止/);
});

test('shutdown during decompression waits for cleanup of its newly created output', async t => {
  const f = fixture(t), source = f.source('large.zip', 'large', zip('large.bin', Buffer.alloc(8 * 1024 * 1024, 90)));
  let stopping;
  f.deps.available = () => { if (!stopping && fs.readdirSync(f.parent).length) stopping = f.jobs.shutdown(); return true; };
  await assert.rejects(f.jobs.extract([source], f.parent, '衣服', true), /取消|停止/);
  assert(stopping); await stopping;
  assert.equal(f.jobs.busy, false); assert.deepEqual(fs.readdirSync(f.parent), []); assert.deepEqual(f.registered, []); assert(fs.existsSync(source.file));
});

test('shutdown waits for an outstanding registration and then preserves originals', async t => {
  let release, entered;
  const registered = new Promise(resolve => { entered = resolve; });
  const f = fixture(t, { register: async () => { entered(); return new Promise(resolve => { release = () => resolve({ assetId: 'asset:finishing' }); }); } }), source = f.source();
  const run = f.jobs.extract([source], f.parent, '衣服', true); const failed = assert.rejects(run, /取消|停止/);
  await registered;
  let stopped = false; const stopping = f.jobs.shutdown().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, false); assert.equal(f.jobs.busy, true);
  release(); await stopping; await failed;
  assert.equal(f.jobs.busy, false); assert(fs.existsSync(source.file)); assert.deepEqual(f.removed, []);
  const [job] = f.jobs.state(); assert.equal(job.state, 'failed'); assert(fs.existsSync(job.directory));
});
