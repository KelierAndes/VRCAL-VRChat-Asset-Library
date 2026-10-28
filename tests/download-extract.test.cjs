const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { extractDownloadArchives, supportsDownloadExtraction } = require('../dist/main/main/download-extract');

// Real ZIP records, including intentionally malformed metadata; no archive-library mocks.
function zip(entries) {
  let offset = 0;
  const local = [], central = [];
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.data ?? ''), method = entry.store ? 0 : 8;
    const packed = method === 0 ? data : zlib.deflateRawSync(data);
    const crc = entry.crc ?? zlib.crc32(data), size = entry.size ?? data.length;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(method, 8); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(size, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, packed);
    const index = Buffer.alloc(46);
    index.writeUInt32LE(0x02014b50); index.writeUInt16LE(0x0314, 4); index.writeUInt16LE(20, 6);
    index.writeUInt16LE(0x800, 8); index.writeUInt16LE(method, 10); index.writeUInt32LE(crc, 16);
    index.writeUInt32LE(packed.length, 20); index.writeUInt32LE(size, 24); index.writeUInt16LE(name.length, 28);
    index.writeUInt32LE(((entry.mode ?? (entry.name.endsWith('/') ? 0o40755 : 0o100644)) << 16) >>> 0, 38);
    index.writeUInt32LE(offset, 42); central.push(index, name);
    offset += header.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function setup(t) {
  const workspace = path.resolve(__dirname, '..', '..');
  const area = fs.mkdtempSync(path.join(workspace, 'download-extract-test-'));
  const parent = path.join(area, 'output'), input = path.join(area, 'input');
  fs.mkdirSync(parent); fs.mkdirSync(input);
  t.after(() => {
    const resolved = fs.realpathSync(area), relative = path.relative(workspace, resolved);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { area, parent, input, source(name, entries) { const file = path.join(input, name); fs.writeFileSync(file, zip(entries)); return file; } };
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function filesBelow(root, prefix = '') {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? filesBelow(path.join(root, entry.name), name + '/') : [name];
  }).sort();
}

test('ZIP downloads extract together in separate subtrees and preserve Unicode, bytes and originals', async t => {
  const { parent, source } = setup(t);
  const model = source('衣服 日本語 🎀.zip', [{ name: '衣服/', data: '' }, { name: '衣服/愛莉.prefab', data: 'model' }, { name: 'shared.txt', data: 'model shared' }]);
  const mat = source('MAT_TEX.zip', [{ name: 'shared.txt', data: 'materials' }]);
  const before = [hash(model), hash(mat)];
  const result = await extractDownloadArchives([model, mat], parent, '衣服');
  assert.equal(path.dirname(result.directory), parent);
  assert.match(path.basename(result.directory), /^衣服--vrcal-unpacked-[a-f0-9-]+$/);
  const children = fs.readdirSync(result.directory);
  assert.equal(children.length, 2);
  const extracted = filesBelow(result.directory);
  assert.equal(extracted.length, 3);
  assert(extracted.some(name => name.endsWith('/衣服/愛莉.prefab')));
  assert.deepEqual(extracted.map(name => fs.readFileSync(path.join(result.directory, name), 'utf8')).sort(), ['materials', 'model', 'model shared']);
  assert.equal(result.files, 3); assert.equal(result.bytes, 26);
  assert.deepEqual([hash(model), hash(mat)], before);
  const again = await extractDownloadArchives([model, mat], parent, '衣服');
  assert.notEqual(again.directory, result.directory);
  assert.deepEqual(fs.readdirSync(again.directory), children);
  assert.deepEqual(extracted.map(name => fs.readFileSync(path.join(result.directory, name), 'utf8')).sort(), ['materials', 'model', 'model shared']);
});

test('only ZIP is advertised and unsupported packages leave no output', async t => {
  const { parent, source } = setup(t);
  assert.equal(supportsDownloadExtraction('CLOTH.ZIP'), true);
  for (const name of ['asset.unitypackage', 'asset.rar', 'asset.7z', 'asset.zip.exe']) {
    assert.equal(supportsDownloadExtraction(name), false);
    const file = source(name, [{ name: 'a', data: 'a' }]), before = hash(file);
    await assert.rejects(extractDownloadArchives([file], parent, 'asset'), /ZIP|格式|支持/);
    assert.equal(hash(file), before); assert.deepEqual(fs.readdirSync(parent), []);
  }
});

for (const [name, entries] of [
  ['parent traversal', [{ name: '../escape', data: 'bad' }]],
  ['absolute path', [{ name: '/escape', data: 'bad' }]],
  ['backslash traversal', [{ name: '..\\escape', data: 'bad' }]],
  ['alternate stream', [{ name: 'asset:secret', data: 'bad' }]],
  ['Windows device', [{ name: 'CON.txt', data: 'bad' }]],
  ['superscript device', [{ name: 'COM¹.txt', data: 'bad' }]],
  ['trailing dot', [{ name: 'folder./bad', data: 'bad' }]],
  ['trailing space', [{ name: 'folder /bad', data: 'bad' }]],
  ['symlink', [{ name: 'link', data: '../outside', mode: 0o120777 }]],
  ['case alias', [{ name: 'A.txt', data: 'first' }, { name: 'a.txt', data: 'second' }]],
  ['directory case alias', [{ name: 'Dir/A', data: 'first' }, { name: 'dir/B', data: 'second' }]],
  ['file directory collision', [{ name: 'a', data: 'first' }, { name: 'a/b', data: 'second' }]],
  ['Unicode alias', [{ name: 'é.txt', data: 'first' }, { name: 'e\u0301.txt', data: 'second' }]],
  ['Unicode uppercase alias', [{ name: 'ſ.txt', data: 'first' }, { name: 'S.txt', data: 'second' }]],
  ['CRC mismatch', [{ name: 'a', data: 'hello', crc: 0 }]],
  ['false uncompressed size', [{ name: 'a', data: 'hello'.repeat(100), size: 1 }]],
  ['hidden directory payload', [{ name: 'dir/', data: 'hidden payload', size: 0, crc: 0 }]],
]) {
  test(`rejects ${name} and cleans only its own output`, async t => {
    const { parent, source, area } = setup(t), file = source('unsafe.zip', entries), before = hash(file);
    fs.writeFileSync(path.join(parent, 'keep.txt'), 'keep');
    await assert.rejects(extractDownloadArchives([file], parent, 'asset'));
    assert.equal(hash(file), before); assert.deepEqual(fs.readdirSync(parent), ['keep.txt']);
    assert.equal(fs.existsSync(path.join(area, 'escape')), false);
  });
}

test('truncated ZIP never leaves a partial result or changes its input', async t => {
  const { parent, source } = setup(t), file = source('truncated.zip', [{ name: 'a', data: 'hello' }]);
  fs.truncateSync(file, fs.statSync(file).size - 10);
  const before = hash(file);
  await assert.rejects(extractDownloadArchives([file], parent, 'asset'), /解压|ZIP|损坏/);
  assert.equal(hash(file), before); assert.deepEqual(fs.readdirSync(parent), []);
});

test('entry and total expanded-byte budgets abort a whole group including previously extracted archives', async t => {
  const { parent, source } = setup(t);
  const first = source('first.zip', [{ name: 'a', data: '123' }]);
  const second = source('second.zip', [{ name: 'b', data: '456' }]);
  await assert.rejects(extractDownloadArchives([first, second], parent, 'asset', { maxFiles: 1 }), /数量|上限/);
  assert.deepEqual(fs.readdirSync(parent), []);
  await assert.rejects(extractDownloadArchives([first, second], parent, 'asset', { maxBytes: 5 }), /体积|大小|上限/);
  assert.deepEqual(fs.readdirSync(parent), []);
  const dirs = source('dirs.zip', [{ name: 'a/' }, { name: 'b/' }]);
  await assert.rejects(extractDownloadArchives([dirs], parent, 'asset', { maxFiles: 1 }), /数量|上限/);
  assert.deepEqual(fs.readdirSync(parent), []);
});

test('cancellation works before and during decompression and permits a subsequent extraction', async t => {
  const { parent, source } = setup(t), file = source('large.zip', [{ name: 'large.bin', data: Buffer.alloc(8 * 1024 * 1024, 90) }]);
  const before = hash(file), controller = new AbortController(); controller.abort();
  await assert.rejects(extractDownloadArchives([file], parent, 'asset', { signal: controller.signal }), /取消/);
  const active = new AbortController();
  await assert.rejects(extractDownloadArchives([file], parent, 'asset', {
    signal: active.signal,
    assertAvailable() { if (filesBelow(parent).length) active.abort(); },
  }), /取消/);
  assert.deepEqual(fs.readdirSync(parent), []); assert.equal(hash(file), before);
  const next = await extractDownloadArchives([file], parent, 'asset');
  assert.equal(next.bytes, 8 * 1024 * 1024);
});

test('deadline and unavailable library abort without leaving output', async t => {
  const { parent, source } = setup(t), file = source('small.zip', [{ name: 'a', data: 'a' }]);
  const start = Date.now();
  await assert.rejects(extractDownloadArchives([file], parent, 'asset', {
    maxTimeMs: 1,
    assertAvailable() { while (Date.now() - start < 5) {} },
  }), /超时/);
  await assert.rejects(extractDownloadArchives([file], parent, 'asset', { assertAvailable() { throw new Error('资料库已切换'); } }), /资料库已切换/);
  assert.deepEqual(fs.readdirSync(parent), []);
});

test('hard-linked sources and linked ancestors or destinations are rejected', async t => {
  const { parent, input, area, source } = setup(t), file = source('source.zip', [{ name: 'a', data: 'a' }]);
  const hardlink = path.join(input, 'linked.zip'); fs.linkSync(file, hardlink);
  await assert.rejects(extractDownloadArchives([hardlink], parent, 'asset'), /链接|普通文件/);
  fs.unlinkSync(hardlink);
  const alias = path.join(area, 'alias'); fs.symlinkSync(input, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(extractDownloadArchives([path.join(alias, 'source.zip')], parent, 'asset'), /链接|目录/);
  await assert.rejects(extractDownloadArchives([file], alias, 'asset'), /链接|目录/);
  assert.deepEqual(fs.readdirSync(parent), []);
});

test('source changes during extraction fail and preserve the externally changed file', async t => {
  const { parent, source } = setup(t), file = source('source.zip', [{ name: 'a', data: 'hello' }]);
  let changed = false;
  await assert.rejects(extractDownloadArchives([file], parent, 'asset', {
    assertAvailable() {
      if (!changed && filesBelow(parent).length) { changed = true; fs.appendFileSync(file, 'changed'); }
    },
  }), /变化|改变/);
  assert(changed); assert.equal(fs.readFileSync(file).subarray(-7).toString(), 'changed');
  assert.deepEqual(fs.readdirSync(parent), []);
});

test('replaced output directories are never recursively deleted on failure', async t => {
  const { parent, area, source } = setup(t), file = source('source.zip', [{ name: 'a', data: 'hello' }]);
  let replacement, moved;
  await assert.rejects(extractDownloadArchives([file], parent, 'asset', {
    assertAvailable() {
      const child = fs.readdirSync(parent)[0];
      if (!replacement && child) {
        replacement = path.join(parent, child); moved = path.join(area, 'moved-output');
        fs.renameSync(replacement, moved); fs.mkdirSync(replacement);
        fs.writeFileSync(path.join(replacement, 'keep.txt'), 'external replacement');
      }
    },
  }), /变化|改变/);
  assert(replacement); assert.equal(fs.readFileSync(path.join(replacement, 'keep.txt'), 'utf8'), 'external replacement');
  assert(fs.existsSync(moved));
});

test('implicit nested directories cannot bypass the file-count budget', async t => {
  const { parent, source } = setup(t), file = source('nested.zip', [{ name: 'a/b/c/d/file', data: 'a' }]);
  await assert.rejects(extractDownloadArchives([file], parent, 'asset', { maxFiles: 3 }), /数量|上限/);
  assert.deepEqual(fs.readdirSync(parent), []);
});

test('an existing file inserted into the output is not overwritten or removed', async t => {
  const { parent, source } = setup(t), file = source('source.zip', [{ name: 'keep.txt', data: 'archive' }]);
  let inserted;
  await assert.rejects(extractDownloadArchives([file], parent, 'asset', {
    assertAvailable() {
      if (inserted) return;
      const root = fs.readdirSync(parent)[0];
      if (!root) return;
      const child = fs.readdirSync(path.join(parent, root))[0];
      if (!child) return;
      inserted = path.join(parent, root, child, 'keep.txt');
      fs.writeFileSync(inserted, 'external file', { flag: 'wx' });
    },
  }));
  assert(inserted); assert.equal(fs.readFileSync(inserted, 'utf8'), 'external file');
});

test('replaced output files are left intact when streaming stops', async t => {
  const { parent, area, source } = setup(t), file = source('source.zip', [{ name: 'keep.txt', data: 'archive' }]);
  let replacement;
  await assert.rejects(extractDownloadArchives([file], parent, 'asset', {
    assertAvailable() {
      if (replacement) return;
      const found = filesBelow(parent)[0];
      if (!found) return;
      replacement = path.join(parent, found);
      fs.renameSync(replacement, path.join(area, 'moved-file'));
      fs.writeFileSync(replacement, 'external replacement', { flag: 'wx' });
    },
  }), /变化|改变/);
  assert(replacement); assert.equal(fs.readFileSync(replacement, 'utf8'), 'external replacement');
});
