const nodeTest = require('node:test');
const test = (name, run) => nodeTest(name, {timeout: 5000}, run);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const {EventEmitter} = require('node:events');
const {pathToFileURL} = require('node:url');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const rejected = promise => promise.then(value => ({value}), error => ({error}));
function requireRejection(result, label = 'stale request') {
  assert(result.error instanceof Error, `${label} must reject instead of returning a result`);
}

function fixture(t, {withoutCandidates = false, uuid} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vrc-model-window-'));
  const assets = new Map(), roots = new Map(), handlers = new Map(), windows = [];
  const indexCalls = [], sceneCalls = [], bundleCalls = [], validateCalls = [];
  const indexHooks = new Map(), denied = new Set();
  let sceneHook, available = true;
  class Contents extends EventEmitter {
    constructor() { super(); this.mainFrame = {url: ''}; }
    setWindowOpenHandler(handler) { this.popup = handler; }
    getZoomFactor() { return 1; }
    setZoomFactor() {}
  }
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.contents = new Contents(); this.destroyed = false; windows.push(this); }
    get webContents() { if (this.destroyed) throw new Error('Object has been destroyed'); return this.contents; }
    isDestroyed() { return this.destroyed; }
    async loadFile(file) { this.contents.mainFrame.url = pathToFileURL(file).href; }
    show() { assert(!this.destroyed); }
    showInactive() { this.show(); }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
  }
  const electron = {
    BrowserWindow: Window,
    ipcMain: {
      handle(channel, handler) { assert(!handlers.has(channel)); handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); }
    },
    session: {fromPartition() {
      const partition = new EventEmitter();
      partition.webRequest = {onBeforeRequest() {}};
      partition.setPermissionRequestHandler = () => {};
      partition.setPermissionCheckHandler = () => {};
      return partition;
    }}
  };
  const modelFor = source => {
    const file = /\.(?:obj|zip|unitypackage)$/i.test(source), stat = fs.statSync(source);
    return {source, name: file && /\.obj$/i.test(source) ? path.basename(source) : 'model.obj', key: 'model.obj',
      size: 30, stamp: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`, format: 'obj', label: 'model.obj', scope: file && /\.obj$/i.test(source) ? 'file' : 'container'};
  };
  const bundleFor = model => ({name: model.name, files: [{name: model.name, bytes: Buffer.from(model.source)}], warnings: []});
  const reader = {
    async readModelIndex(source, signal) {
      const call = {source, signal}; indexCalls.push(call);
      return indexHooks.has(source) ? indexHooks.get(source)(call) : {models: [modelFor(source)], warnings: []};
    },
    async readModelBundle(model, signal) {
      bundleCalls.push({model, signal}); throw new Error('A scene must use the atomic scene reader');
    },
    async readModelScene(primary, reference, signal) {
      const call = {primary, reference, signal}; sceneCalls.push(call);
      return sceneHook ? sceneHook(call) : {primary: bundleFor(primary), ...(reference ? {reference: bundleFor(reference)} : {})};
    }
  };
  const entry = require.resolve('../dist/main/main/model-preview-window');
  delete require.cache[entry];
  const originalLoad = Module._load;
  let ModelPreviewWindow;
  Module._load = function(request, parent, isMain) {
    if (request === 'electron') return electron;
    if (request === './model-preview-reader' && parent.filename === entry) return reader;
    if (request === 'node:crypto' && parent.filename === entry && uuid) return {...require('node:crypto'), randomUUID: uuid};
    return originalLoad.call(this, request, parent, isMain);
  };
  try { ({ModelPreviewWindow} = require(entry)); } finally { Module._load = originalLoad; }
  const deps = {
    parent: () => null, theme: () => 'x', available: () => available,
    validate(id) {
      validateCalls.push(id);
      if (denied.has(id) || !assets.has(id)) throw new Error('Asset is no longer authorized');
      return {asset: assets.get(id), roots: roots.get(id) ?? [root]};
    },
    ...(!withoutCandidates ? {candidates: () => [...assets.values()]} : {})
  };
  const preview = new ModelPreviewWindow(deps);
  t.after(() => { preview.close(); fs.rmSync(root, {recursive: true, force: true}); });
  function add(id, patch = {}) {
    const source = path.join(root, id + (patch.kind === 'archive' ? '.zip' : patch.kind === 'unitypackage' ? '.unitypackage' : ''));
    if (/\.(?:zip|unitypackage)$/i.test(source)) fs.writeFileSync(source, 'synthetic container');
    else { fs.mkdirSync(source, {recursive: true}); fs.writeFileSync(path.join(source, 'model.obj'), 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'); }
    const asset = {id, path: source, name: id, kind: 'folder', group: '', size: 30, mtimeMs: 1,
      missing: false, localCategory: '未分类', localAvatars: [], hintUrls: [], manual: {}, online: {status: 'pending'},
      createdAt: '', updatedAt: '', ...patch};
    assets.set(id, asset); return asset;
  }
  async function open(id) {
    await preview.open(id);
    const win = windows.at(-1), channel = win.options.webPreferences.additionalArguments.find(v => v.startsWith('--vrc-model-channel=')).slice('--vrc-model-channel='.length);
    const handler = handlers.get(channel), event = {sender: win.contents, senderFrame: win.contents.mainFrame};
    return {win, channel, handler, event, invoke: (action, arg, ref) => handler(event, action, arg, ref)};
  }
  return {root, assets, roots, handlers, preview, add, open, indexCalls, sceneCalls, bundleCalls, validateCalls, indexHooks, denied,
    modelFor, bundleFor, scene: hook => { sceneHook = hook; }, available: value => { available = value; }};
}

test('reference sources filter unavailable rows, search title/name, prioritize models and never index the library', async t => {
  const f = fixture(t); f.add('primary');
  f.add('ordinary', {name: 'Needle clothes'});
  f.add('avatar', {name: 'Avatar package', localCategory: '模型', manual: {title: 'Needle character'}});
  f.add('online-avatar', {name: 'Needle online', online: {status: 'matched', title: 'Renamed online character', category: '模型'}});
  f.add('manual-avatar', {name: 'Needle manual', localCategory: '衣服', manual: {category: '模型'}});
  f.add('missing', {name: 'Needle missing', missing: true});
  f.add('hidden', {name: 'Needle hidden', manual: {hidden: true}});
  f.add('recycled', {name: 'Needle recycled', recycledAt: '2026-10-24'});
  f.add('cloud', {name: 'Needle cloud', storage: {kind: 'cloud', cloudCount: 1, cloudEntries: []}});
  f.add('both', {name: 'Needle local and cloud', storage: {kind: 'both', cloudCount: 1, cloudEntries: []}});
  const window = await f.open('primary'); await window.invoke('state');
  const before = f.indexCalls.length, sources = await window.invoke('sources', 'nEeDlE');
  assert.deepEqual(new Set(sources.map(row => row.id)), new Set(['ordinary', 'avatar', 'online-avatar', 'manual-avatar', 'both']));
  assert(sources.slice(0, 3).every(row => ['avatar', 'online-avatar', 'manual-avatar'].includes(row.id)));
  assert.equal(sources.find(row => row.id === 'avatar').title, 'Needle character');
  assert(sources.every(row => Object.keys(row).sort().join(',') === 'id,title'), 'source rows must not expose paths or entire records');
  assert.deepEqual((await window.invoke('sources', 'Avatar package')).map(row => row.id), ['avatar'], 'original names remain searchable after a title override');
  assert.equal(f.indexCalls.length, before, 'listing sources must not index any candidate');
  for (let i = 0; i < 115; i++) f.add('bulk-' + i, {name: 'Bulk ' + i});
  f.add('bulk-avatar', {name: 'Bulk avatar added last', localCategory: '模型'});
  const bulk = await window.invoke('sources', 'Bulk');
  assert.equal(bulk.length, 100);
  assert.equal(bulk[0].id, 'bulk-avatar', 'model priority must be applied before the 100-row limit');
  assert.deepEqual(await window.invoke('sources', 'no such candidate'), []);
  assert.equal(f.indexCalls.length, before);
});

test('reference sources are optional and return an empty list without a candidate provider', async t => {
  const f = fixture(t, {withoutCandidates: true}); f.add('primary');
  const window = await f.open('primary'); await window.invoke('state');
  assert.deepEqual(await window.invoke('sources'), []);
});

test('selectReference validates the chosen asset and indexes only that asset, including directory and ZIP sources', async t => {
  const f = fixture(t); f.add('primary');
  const folder = f.add('avatar-folder', {manual: {title: 'Avatar folder'}}), zip = f.add('avatar-zip', {kind: 'archive'});
  f.add('never-index-this');
  const window = await f.open('primary'), primary = await window.invoke('state');
  f.indexCalls.length = 0; f.validateCalls.length = 0;
  f.denied.add(folder.id);
  await assert.rejects(window.invoke('selectReference', folder.id));
  assert(f.validateCalls.includes(folder.id));
  assert.deepEqual(f.indexCalls, [], 'authorization must finish before indexing the reference');
  f.denied.delete(folder.id);
  for (const asset of [folder, zip]) {
    const reference = await window.invoke('selectReference', asset.id);
    assert.equal(reference.title, asset.manual.title ?? asset.name);
    assert.equal(reference.choices.length, 1);
    assert.equal(f.indexCalls.at(-1).source, asset.path);
    assert.deepEqual((await window.invoke('state')).choices, primary.choices, 'selecting a reference must preserve primary choices');
  }
  assert.deepEqual(f.indexCalls.map(call => call.source), [folder.path, zip.path]);
  const cleared = await window.invoke('selectReference', null);
  assert.deepEqual(cleared.choices, []); assert.deepEqual(cleared.warnings, []);
});

test('selectReference rejects missing, hidden, recycled and cloud-only assets even if validate can resolve them', async t => {
  const f = fixture(t); f.add('primary');
  const candidates = [f.add('missing', {missing: true}), f.add('hidden', {manual: {hidden: true}}),
    f.add('recycled', {recycledAt: '2026-10-24'}),
    f.add('cloud', {storage: {kind: 'cloud', cloudCount: 1, cloudEntries: []}})];
  const window = await f.open('primary'); await window.invoke('state'); const before = f.indexCalls.length;
  for (const asset of candidates) await assert.rejects(window.invoke('selectReference', asset.id));
  assert.equal(f.indexCalls.length, before);
});

test('loadScene sends both exact sources to a single scene reader and source-list refresh preserves reference tokens', async t => {
  const f = fixture(t), primaryAsset = f.add('primary'), referenceAsset = f.add('avatar');
  const window = await f.open(primaryAsset.id), primary = await window.invoke('state'), reference = await window.invoke('selectReference', referenceAsset.id);
  await window.invoke('sources', 'something else');
  const result = await window.invoke('loadScene', primary.choices[0].token, reference.choices[0].token);
  assert.equal(f.sceneCalls.length, 1); assert.equal(f.bundleCalls.length, 0);
  assert.deepEqual(f.sceneCalls[0].primary, f.modelFor(primaryAsset.path));
  assert.deepEqual(f.sceneCalls[0].reference, f.modelFor(referenceAsset.path));
  assert(f.sceneCalls[0].signal instanceof AbortSignal);
  assert.equal(Buffer.from(result.primary.files[0].bytes).toString(), primaryAsset.path);
  assert.equal(Buffer.from(result.reference.files[0].bytes).toString(), referenceAsset.path);
  assert.equal(result.primary.name, result.reference.name, 'equal model names in distinct slots are supported');
  const single = await window.invoke('loadScene', primary.choices[0].token);
  assert.equal(single.reference, undefined); assert.equal(f.sceneCalls[1].reference, undefined);
});

test('primary/reference tokens cannot cross slots, reference revisions or reopened windows', async t => {
  const f = fixture(t); f.add('primary'); f.add('avatar-a'); f.add('avatar-b');
  const window = await f.open('primary'), primary = await window.invoke('state'), reference = await window.invoke('selectReference', 'avatar-a');
  const primaryToken = primary.choices[0].token, referenceToken = reference.choices[0].token;
  await assert.rejects(window.invoke('loadScene', referenceToken, referenceToken));
  await assert.rejects(window.invoke('loadScene', primaryToken, primaryToken));
  await assert.rejects(window.invoke('loadScene', 'forged-token', referenceToken));
  await assert.rejects(window.invoke('loadScene', primaryToken, 'forged-token'));
  const nextReference = await window.invoke('selectReference', 'avatar-b');
  await assert.rejects(window.invoke('loadScene', primaryToken, referenceToken));
  await window.invoke('loadScene', primaryToken, nextReference.choices[0].token);
  await window.invoke('selectReference', null);
  await assert.rejects(window.invoke('loadScene', primaryToken, nextReference.choices[0].token));
  const currentReference = await window.invoke('selectReference', 'avatar-a');
  await assert.rejects(window.invoke('loadScene', primaryToken, referenceToken));
  await window.invoke('loadScene', primaryToken, currentReference.choices[0].token);
  const reopened = await f.open('primary'), reopenedPrimary = await reopened.invoke('state'), reopenedReference = await reopened.invoke('selectReference', 'avatar-a');
  await assert.rejects(reopened.invoke('loadScene', primaryToken, reopenedReference.choices[0].token));
  await assert.rejects(reopened.invoke('loadScene', reopenedPrimary.choices[0].token, currentReference.choices[0].token));
  await assert.rejects(window.invoke('loadScene', primaryToken, currentReference.choices[0].token));
  assert.equal(f.sceneCalls.length, 2, 'invalid tokens must be rejected before starting a scene reader');
});

test('all new operations require the owned window, its main frame and its local preview page', async t => {
  const f = fixture(t); f.add('primary'); f.add('avatar');
  const window = await f.open('primary'), primary = await window.invoke('state');
  const before = f.indexCalls.length;
  for (const event of [
    {...window.event, sender: {}},
    {...window.event, senderFrame: {url: window.event.senderFrame.url}},
  ]) for (const [action, arg] of [['sources', ''], ['selectReference', 'avatar'], ['loadScene', primary.choices[0].token]]) {
    await assert.rejects(window.handler(event, action, arg));
  }
  const page = window.win.contents.mainFrame.url;
  window.win.contents.mainFrame.url = 'https://external.invalid/';
  for (const [action, arg] of [['sources', ''], ['selectReference', 'avatar'], ['loadScene', primary.choices[0].token]]) await assert.rejects(window.invoke(action, arg));
  window.win.contents.mainFrame.url = page;
  assert.equal(f.indexCalls.length, before); assert.equal(f.sceneCalls.length, 0);
});

for (const invalidator of ['select', 'clear', 'cancel', 'close']) {
  test(`${invalidator} invalidates an in-flight reference index even if its reader ignores cancellation`, async t => {
    const f = fixture(t); f.add('primary'); const a = f.add('avatar-a'); f.add('avatar-b');
    const window = await f.open('primary'), primary = await window.invoke('state');
    const gate = deferred(), entered = deferred();
    f.indexHooks.set(a.path, call => { entered.resolve(call); return gate.promise; });
    const pending = rejected(window.invoke('selectReference', a.id));
    // Race a rejected action against the reader entry so old builds fail rather than hang.
    const first = await Promise.race([entered.promise.then(call => ({call})), pending]);
    if (!first.call) { requireRejection(first, 'reference selection'); assert.fail('reference indexing never started'); }
    if (invalidator === 'select') await window.invoke('selectReference', 'avatar-b');
    else if (invalidator === 'clear') await window.invoke('selectReference', null);
    else if (invalidator === 'cancel') await window.invoke('cancel');
    else f.preview.close();
    assert.equal(first.call.signal.aborted, true);
    gate.resolve({models: [f.modelFor(a.path)], warnings: ['obsolete index']});
    requireRejection(await pending, 'obsolete reference index');
    if (invalidator !== 'close') {
      const current = await window.invoke('selectReference', 'avatar-b');
      const result = await window.invoke('loadScene', primary.choices[0].token, current.choices[0].token);
      assert.equal(Buffer.from(result.reference.files[0].bytes).toString(), f.assets.get('avatar-b').path);
    }
  });

  test(`${invalidator} invalidates an in-flight atomic scene even if its reader returns late`, async t => {
    const f = fixture(t); f.add('primary'); f.add('avatar-a'); f.add('avatar-b');
    const window = await f.open('primary'), primary = await window.invoke('state'), reference = await window.invoke('selectReference', 'avatar-a');
    const gate = deferred(), entered = deferred();
    f.scene(call => { entered.resolve(call); return gate.promise; });
    const pending = rejected(window.invoke('loadScene', primary.choices[0].token, reference.choices[0].token));
    const first = await Promise.race([entered.promise.then(call => ({call})), pending]);
    if (!first.call) { requireRejection(first, 'scene load'); assert.fail('scene reading never started'); }
    if (invalidator === 'select') await window.invoke('selectReference', 'avatar-b');
    else if (invalidator === 'clear') await window.invoke('selectReference', null);
    else if (invalidator === 'cancel') await window.invoke('cancel');
    else f.preview.close();
    assert.equal(first.call.signal.aborted, true);
    gate.resolve({primary: f.bundleFor(first.call.primary), reference: f.bundleFor(first.call.reference)});
    requireRejection(await pending, 'obsolete scene');
    assert.equal(f.sceneCalls.length, 1); assert.equal(f.bundleCalls.length, 0);
  });
}

test('a newer scene load aborts the older scene and cannot be replaced by its late result', async t => {
  const f = fixture(t); f.add('primary'); f.add('avatar');
  const window = await f.open('primary'), primary = await window.invoke('state'), reference = await window.invoke('selectReference', 'avatar');
  const gate = deferred(), entered = deferred();
  f.scene(call => { entered.resolve(call); return gate.promise; });
  const pending = rejected(window.invoke('loadScene', primary.choices[0].token, reference.choices[0].token));
  const first = await Promise.race([entered.promise.then(call => ({call})), pending]);
  assert(first.call, 'the first scene must start');
  f.scene(undefined);
  const current = await window.invoke('loadScene', primary.choices[0].token, reference.choices[0].token);
  assert.equal(first.call.signal.aborted, true);
  gate.resolve({primary: {...current.primary, name: 'obsolete.obj'}, reference: current.reference});
  requireRejection(await pending, 'superseded scene');
  assert.equal(current.primary.name, 'model.obj');
});

for (const slot of ['primary', 'reference']) {
  for (const change of ['authorization', 'roots', 'path']) {
    test(`loadScene revalidates ${slot} ${change} before any scene read`, async t => {
      const f = fixture(t), primaryAsset = f.add('primary'), referenceAsset = f.add('avatar');
      const window = await f.open('primary'), primary = await window.invoke('state'), reference = await window.invoke('selectReference', 'avatar');
      const asset = slot === 'primary' ? primaryAsset : referenceAsset;
      if (change === 'authorization') f.denied.add(asset.id);
      else if (change === 'roots') {
        const other = path.join(f.root, 'other-authorized-root'); fs.mkdirSync(other); f.roots.set(asset.id, [other]);
      } else {
        const replacement = f.add('replacement'); f.assets.set(asset.id, {...asset, path: replacement.path});
      }
      await assert.rejects(window.invoke('loadScene', primary.choices[0].token, reference.choices[0].token));
      assert.equal(f.sceneCalls.length, 0); assert.equal(f.bundleCalls.length, 0);
      assert(f.validateCalls.filter(id => id === asset.id).length >= 2, `${slot} must be validated again at load time`);
    });
  }
  test(`loadScene rejects a ${slot} directory replaced by a link after indexing`, async t => {
    const f = fixture(t), primaryAsset = f.add('primary'), referenceAsset = f.add('avatar');
    const window = await f.open('primary'), primary = await window.invoke('state'), reference = await window.invoke('selectReference', 'avatar');
    const asset = slot === 'primary' ? primaryAsset : referenceAsset, actual = path.join(f.root, slot + '-moved');
    fs.renameSync(asset.path, actual);
    try { fs.symlinkSync(actual, asset.path, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('symbolic-link creation is unavailable'); return; } throw error; }
    await assert.rejects(window.invoke('loadScene', primary.choices[0].token, reference.choices[0].token));
    assert.equal(f.sceneCalls.length, 0);
  });
}

test('selectReference checks current authorized roots and links before starting its index', async t => {
  const f = fixture(t); f.add('primary'); const outside = f.add('outside'), linked = f.add('linked');
  const window = await f.open('primary'); await window.invoke('state'); const before = f.indexCalls.length;
  f.roots.set(outside.id, [f.assets.get('primary').path]);
  await assert.rejects(window.invoke('selectReference', outside.id));
  assert.equal(f.indexCalls.length, before);
  const actual = path.join(f.root, 'real-avatar'); fs.renameSync(linked.path, actual);
  try { fs.symlinkSync(actual, linked.path, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('symbolic-link creation is unavailable'); return; } throw error; }
  await assert.rejects(window.invoke('selectReference', linked.id));
  assert.equal(f.indexCalls.length, before);
});

for (const slot of ['primary', 'reference']) {
  test(`${slot} indexing caps distinct sources at 16 with a visible warning`, async t => {
    const f = fixture(t), primary = f.add('primary'), reference = f.add('avatar');
    const asset = slot === 'primary' ? primary : reference;
    asset.members = Array.from({length: 20}, (_, i) => {
      const member = f.add('member-' + i); return {id: member.id, path: member.path, name: member.name, kind: member.kind, missing: false};
    });
    const window = await f.open(primary.id);
    let state;
    if (slot === 'primary') state = await window.invoke('state');
    else { await window.invoke('state'); f.indexCalls.length = 0; state = await window.invoke('selectReference', reference.id); }
    assert.equal(f.indexCalls.length, 16); assert.equal(state.choices.length, 16);
    assert(state.warnings.length > 0, 'truncation must be explained to the user');
  });

  test(`${slot} indexing caps model choices at 200 with a visible warning`, async t => {
    const f = fixture(t), primary = f.add('primary'), reference = f.add('avatar');
    const asset = slot === 'primary' ? primary : reference;
    f.indexHooks.set(asset.path, () => ({models: Array.from({length: 205}, (_, i) => ({...f.modelFor(asset.path),
      name: `part-${i}.obj`, key: `part-${i}.obj`, label: `part-${i}.obj`})), warnings: []}));
    const window = await f.open(primary.id);
    const state = slot === 'primary' ? await window.invoke('state') : await window.invoke('selectReference', reference.id);
    assert.equal(state.choices.length, 200);
    assert(state.warnings.length > 0, 'truncation must be explained to the user');
  });

  test(`${slot} indexing has one 45-second deadline across all its source reads`, async t => {
    const f = fixture(t), primary = f.add('primary'), reference = f.add('avatar'), member = f.add('member');
    const asset = slot === 'primary' ? primary : reference;
    asset.members = [{id: member.id, path: member.path, name: member.name, kind: member.kind, missing: false}];
    const first = deferred(), firstEntered = deferred(), secondEntered = deferred();
    f.indexHooks.set(asset.path, call => { firstEntered.resolve(call); return first.promise; });
    f.indexHooks.set(member.path, call => {
      secondEntered.resolve(call);
      return new Promise((_resolve, reject) => {
        if (call.signal.aborted) reject(new Error('deadline aborted model reader'));
        else call.signal.addEventListener('abort', () => reject(new Error('deadline aborted model reader')), {once: true});
      });
    });
    const originalTimer = global.setTimeout, timers = [];
    global.setTimeout = function(callback, delay, ...args) {
      const handle = originalTimer(callback, delay, ...args);
      if (delay === 45000) timers.push({callback, args, handle});
      return handle;
    };
    try {
      const window = await f.open(primary.id);
      if (slot === 'reference') { await window.invoke('state'); timers.length = 0; }
      const pending = rejected(window.invoke(slot === 'primary' ? 'state' : 'selectReference', reference.id));
      const started = await Promise.race([firstEntered.promise.then(call => ({call})), pending]);
      assert(started.call, 'the first source must start');
      assert.equal(timers.length, 1, 'the complete slot index needs a single deadline');
      first.resolve({models: [f.modelFor(asset.path)], warnings: []});
      const second = await Promise.race([secondEntered.promise.then(call => ({call})), pending]);
      assert(second.call, 'the second source must share the same indexing task');
      assert.equal(timers.length, 1, 'moving to another source must not reset the 45-second deadline');
      timers[0].callback(...timers[0].args);
      requireRejection(await pending, 'expired index');
      assert.equal(second.call.signal.aborted, true);
    } finally {
      global.setTimeout = originalTimer;
      for (const timer of timers) clearTimeout(timer.handle);
      first.resolve({models: [], warnings: []});
    }
  });
}

for (const action of ['load', 'loadScene']) {
  test(`cancel invalidates ${action} while it awaits the initial primary index`, async t => {
    // The primary token is deliberately predictable only in this fixture so that
    // a waiting load can become otherwise valid when its initial index completes.
    const token = '11111111-1111-4111-8111-111111111111';
    const f = fixture(t, {uuid: () => token}), primary = f.add('primary'), gate = deferred();
    f.indexHooks.set(primary.path, () => gate.promise);
    const window = await f.open(primary.id);
    const pending = rejected(window.invoke(action, token));
    await window.invoke('cancel');
    gate.resolve({models: [f.modelFor(primary.path)], warnings: []});
    requireRejection(await pending, `${action} cancelled before indexing completed`);
    assert.equal(f.sceneCalls.length, 0); assert.equal(f.bundleCalls.length, 0);
  });
}

test('reference source refresh filters revoked authorization and detached roots without filesystem reads or indexing', async t => {
  const f = fixture(t); f.add('primary');
  const valid = f.add('valid', {name: 'Scope valid'}), denied = f.add('denied', {name: 'Scope denied'}), detached = f.add('detached', {name: 'Scope detached'});
  const window = await f.open('primary'); await window.invoke('state');
  f.denied.add(denied.id); f.roots.set(detached.id, []);
  const before = f.indexCalls.length, fsp = fs.promises, originals = new Map(), reads = [];
  for (const name of ['stat', 'lstat', 'access', 'opendir', 'readdir', 'readFile', 'open', 'realpath']) {
    originals.set(name, fsp[name]);
    fsp[name] = function(...args) { reads.push(name); return originals.get(name).apply(this, args); };
  }
  try {
    assert.deepEqual(await window.invoke('sources', 'Scope'), [{id: valid.id, title: valid.name}]);
    assert(f.validateCalls.includes(denied.id)); assert(f.validateCalls.includes(detached.id));
    assert.deepEqual(reads, [], 'candidate metadata filtering must not inspect candidate files');
    assert.equal(f.indexCalls.length, before);
  } finally { for (const [name, original] of originals) fsp[name] = original; }
});

for (const phase of ['before-read', 'before-return']) {
  test(`loadScene checks both current scopes together ${phase} after asynchronous authorization`, async t => {
    const f = fixture(t), primaryAsset = f.add('primary'), referenceAsset = f.add('avatar');
    const window = await f.open(primaryAsset.id), primary = await window.invoke('state'), reference = await window.invoke('selectReference', referenceAsset.id);
    const gate = deferred(), entered = deferred(), fsp = fs.promises, original = fsp.lstat;
    let paused = false, sceneRead = false;
    f.scene(call => {
      sceneRead = true;
      return {primary: f.bundleFor(call.primary), reference: f.bundleFor(call.reference)};
    });
    fsp.lstat = async function(file, ...args) {
      if (!paused && String(file) === referenceAsset.path && (phase === 'before-read' ? !sceneRead : sceneRead)) {
        paused = true; entered.resolve(); await gate.promise;
      }
      return original.call(this, file, ...args);
    };
    try {
      const pending = rejected(window.invoke('loadScene', primary.choices[0].token, reference.choices[0].token));
      const first = await Promise.race([entered.promise.then(() => ({paused: true})), pending]);
      assert(first.paused, 'the reference authorization must be paused after primary authorization');
      f.roots.set(primaryAsset.id, []);
      gate.resolve();
      requireRejection(await pending, 'primary roots revoked while reference authorization awaited');
      assert.equal(f.sceneCalls.length, phase === 'before-read' ? 0 : 1, 'revoked sources must not be read or returned');
    } finally { gate.resolve(); fsp.lstat = original; }
  });
}

for (const action of ['open', 'selectReference']) {
  test(`${action} rechecks current roots after authorization awaits and before indexing`, async t => {
    const f = fixture(t), primary = f.add('primary'), reference = f.add('avatar');
    const window = action === 'selectReference' ? await f.open(primary.id) : undefined;
    if (window) await window.invoke('state');
    const asset = action === 'open' ? primary : reference, before = f.indexCalls.length;
    const gate = deferred(), entered = deferred(), fsp = fs.promises, original = fsp.lstat;
    let paused = false;
    fsp.lstat = async function(file, ...args) {
      if (!paused && String(file) === asset.path) { paused = true; entered.resolve(); await gate.promise; }
      return original.call(this, file, ...args);
    };
    try {
      const pending = rejected(window ? window.invoke('selectReference', reference.id) : f.preview.open(primary.id));
      const first = await Promise.race([entered.promise.then(() => ({paused: true})), pending]);
      assert(first.paused, 'authorization must pause before index startup');
      f.roots.set(asset.id, []); gate.resolve();
      requireRejection(await pending, 'source authorization revoked during its asynchronous check');
      assert.equal(f.indexCalls.length, before, 'revoked source must never reach the index reader');
    } finally { gate.resolve(); fsp.lstat = original; }
  });
}

test('the 16-source slot budget includes archives already indexed inside an earlier directory', async t => {
  const f = fixture(t), primary = f.add('primary'), member = f.add('member');
  primary.members = [{id: member.id, path: member.path, name: member.name, kind: member.kind, missing: false}];
  f.indexHooks.set(primary.path, () => ({models: [f.modelFor(primary.path)], warnings: [], sourceCount: 16}));
  const window = await f.open(primary.id), state = await window.invoke('state');
  assert.deepEqual(f.indexCalls.map(call => call.source), [primary.path], 'nested archive reads consume the remaining slot budget before the next member');
  assert.equal(state.choices.length, 1);
  assert(state.warnings.length > 0, 'source-budget truncation must be explained to the user');
});
