// Run after build: node_modules/.bin/electron scripts/native-x-v18-test.cjs
// Both remote views use private HTTPS protocol responses; no live/network/account/Store access.
'use strict';
const { app, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.resolve(__dirname, '../../native-x-v18-'));
fs.mkdirSync(path.join(profile, 'session'), { recursive: true });
app.setPath('userData', profile); app.setPath('sessionData', path.join(profile, 'session'));
process.env.VRC_LIBRARY_TEST_HIDDEN = '1';
app.on('window-all-closed', () => {});
const checks = [], errors = [], facts = [], screenshots = [], intercepted = [];
let workspace, preview, currentTheme = 'x';
const FIXTURE_HTML = '<!doctype html><html><head><meta charset="UTF-8"><title>Private X toolbar fixture</title></head><body style="margin:0;background:#ffffff;color:#000000;font-family:Arial,sans-serif"><main id="private-fixture" style="padding:30px"><h1>本地离线商品验收页</h1><p>白色商品内容保持原样。Private protocol response only.</p><div style="display:flex;gap:12px"><i style="width:90px;height:90px;background:#ff4488"></i><i style="width:90px;height:90px;background:#22bbdd"></i><i style="width:90px;height:90px;background:#ffbb33"></i></div></main></body></html>';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function pass(label) { checks.push(label); console.log('NATIVE X V18 PASS:', label); }
async function wait(predicate, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error(`Native X fixture timed out: ${label}`);
}
function response(request) {
  intercepted.push(request.url);
  // Fail closed: even an unexpected navigation is served locally and reported.
  const url = new URL(request.url);
  assert.equal(url.hostname, 'booth.pm', 'Fixture must never visit an account/third-party host');
  assert.equal(request.method, 'GET');
  return new Response(FIXTURE_HTML, { headers: { 'content-type': 'text/html;charset=utf-8' } });
}
app.on('web-contents-created', (_event, contents) => {
  contents.setBackgroundThrottling(false);
  contents.on('preload-error', (_event, file, error) => errors.push({ type: 'preload', file, error: error.message }));
  contents.on('render-process-gone', (_event, details) => errors.push({ type: 'renderer-gone', reason: details.reason }));
});
function entries() { return [['booth', workspace?.entry, 'boothWorkspace'], ['preview', preview?.active, 'productPreview']].filter(([, entry]) => entry && !entry.closed); }
async function remoteFacts(entry) {
  return entry.view.webContents.executeJavaScript(`({
    background:getComputedStyle(document.body).backgroundColor,
    color:getComputedStyle(document.body).color,
    theme:document.documentElement.dataset.theme??null,
    html:document.documentElement.outerHTML,
    bridges:[typeof window.boothWorkspace,typeof window.productPreview,typeof window.library],
    requireType:typeof require,processType:typeof process,
    filter:getComputedStyle(document.body).filter
  })`);
}
async function chromeFacts(entry, bridge) {
  return entry.window.webContents.executeJavaScript(`(async()=>{
    await document.fonts.ready;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const api=window[${JSON.stringify(bridge)}],initial=api?.initialTheme;
    let wrote;try{wrote=Reflect.set(api,'initialTheme','nasa')}catch{wrote=false}
    const visible=[...document.querySelectorAll('header button,header input,header nav,header form,header .line')].filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0});
    return {
      theme:document.documentElement.dataset.theme,initial,initialAfter:api.initialTheme,wrote,
      bodyBackground:getComputedStyle(document.body).backgroundColor,
      headerBackground:getComputedStyle(document.querySelector('header')).backgroundColor,
      weight:getComputedStyle(document.querySelector('h1')).fontWeight,
      fontFamily:getComputedStyle(document.querySelector('h1')).fontFamily,
      regularAvailable:(await document.fonts.load('400 14px Inter')).length>0,
      boldAvailable:(await document.fonts.load('700 14px Inter')).length>0,
      width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      overflow:document.documentElement.scrollWidth>innerWidth,
      overflowingControls:visible.flatMap(node=>{const r=node.getBoundingClientRect();return r.left<-.5||r.right>innerWidth+.5?[{tag:node.tagName,id:node.id,left:r.left,right:r.right}]:[]}),
      requireType:typeof require,processType:typeof process,
      otherBridge:typeof window[${JSON.stringify(bridge === 'boothWorkspace' ? 'productPreview' : 'boothWorkspace')}],
      stateTheme:(await api.state()).theme
    }
  })()`);
}
async function capture(kind, entry, failure = false) {
  if (entry.window.isDestroyed()) return;
  if (!failure) await entry.window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await entry.window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
  await new Promise(resolve => setTimeout(resolve, 100));
  const shot = await entry.window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
  const file = path.join(profile, `${failure ? 'failure' : 'x'}-${kind}.png`);
  fs.writeFileSync(file, shot.toPNG()); screenshots.push(file); console.log('NATIVE X V18 SCREENSHOT:', file);
}
function validateIsolation(entry, kind) {
  const chrome = entry.window.webContents.getLastWebPreferences(), remote = entry.view.webContents.getLastWebPreferences();
  for (const [area, preferences] of [['chrome', chrome], ['remote', remote]]) {
    assert.equal(preferences.contextIsolation, true, `${kind} ${area} contextIsolation`);
    assert.equal(preferences.nodeIntegration, false, `${kind} ${area} nodeIntegration`);
    assert.equal(preferences.sandbox, true, `${kind} ${area} sandbox`);
    assert.equal(preferences.webSecurity, true, `${kind} ${area} webSecurity`);
    assert.equal(preferences.webviewTag, false, `${kind} ${area} webviewTag`);
  }
  assert(!remote.preload, `${kind}: remote must not inherit trusted preload`);
  assert.notEqual(entry.window.webContents.session, entry.view.webContents.session, `${kind}: separate trusted/remote sessions`);
}
async function run() {
  const codeRoot = process.env.VRC_NATIVE_ASAR || path.resolve(__dirname, '..');
  const { BoothWorkspace } = require(path.join(codeRoot, 'dist/main/main/booth-workspace'));
  const { ProductPreview } = require(path.join(codeRoot, 'dist/main/main/preview'));
  workspace = new BoothWorkspace({ parent: () => null, getTheme: () => currentTheme, dataDir: profile,
    roots: () => [path.join(profile, 'ProtectedSyntheticRoot')], getDownloadDir: () => undefined,
    canNetwork: () => true, validateAsset: () => ({ title: 'X 主题原生工具栏 · 本地素材验收' }),
    applyProduct: async () => { throw new Error('Fixture must not apply a product'); }, onChanged() {},
    onDownloaded: async () => { throw new Error('Fixture must not download/import'); } });
  // Override only DNS resolution; the production navigation/IPC isolation code remains active.
  workspace.publicHost = async host => assert.equal(host, 'booth.pm');
  await workspace.initialize(); workspace.remoteSession.protocol.handle('https', response);
  const originalPartition = session.fromPartition.bind(session);
  session.fromPartition = (partition, options) => {
    const selected = originalPartition(partition, options);
    if (partition.startsWith('vrc-product-preview-')) selected.protocol.handle('https', response);
    return selected;
  };
  preview = new ProductPreview({ parent: () => null, getTheme: () => currentTheme,
    validate: () => ({ title: 'X 主题商品预览 · 本地离线验收', canConfirm: true }),
    accept: async () => { throw new Error('Fixture must not confirm a product'); } });
  preview.publicHost = async (_entry, raw) => assert.equal(new URL(raw).hostname, 'booth.pm');
  await workspace.open({ tab: 'search', query: '9801000', assetId: 'synthetic-fixture' });
  await preview.open('synthetic-fixture', 'https://booth.pm/ja/items/9801000');
  await wait(() => workspace.entry?.loaded && preview.active?.loaded, 'both private remote documents');
  const baseline = new Map();
  for (const [kind, entry, bridge] of entries()) {
    entry.window.setSize(980, 720);
    validateIsolation(entry, kind);
    const initial = await chromeFacts(entry, bridge);
    assert.equal(initial.theme, 'x'); assert.equal(initial.initial, 'x'); assert.equal(initial.initialAfter, 'x'); assert.equal(initial.wrote, false);
    assert.equal(initial.bodyBackground, 'rgb(0, 0, 0)'); assert(/^#(?:ff)?000000$/i.test(entry.window.getBackgroundColor()));
    assert.equal(initial.requireType, 'undefined'); assert.equal(initial.processType, 'undefined'); assert.equal(initial.otherBridge, 'undefined');
    const remote = await remoteFacts(entry);
    assert.equal(remote.background, 'rgb(255, 255, 255)'); assert.equal(remote.color, 'rgb(0, 0, 0)');
    assert.equal(remote.theme, null); assert.equal(remote.filter, 'none'); assert.deepEqual(remote.bridges, ['undefined', 'undefined', 'undefined']);
    assert.equal(remote.requireType, 'undefined'); assert.equal(remote.processType, 'undefined');
    baseline.set(kind, digest(remote.html));
    pass(`${kind}: X initial theme, black native/trusted background, readonly initialTheme, isolated sandbox and white private remote page`);
  }
  const backgrounds = { x: 'rgb(0, 0, 0)', nasa: 'rgb(236, 229, 214)', swiss: 'rgb(245, 241, 232)' };
  for (const skin of ['x', 'nasa', 'swiss', 'x']) {
    currentTheme = skin; workspace.refreshTheme(); preview.refreshTheme();
    for (const [kind, entry, bridge] of entries()) {
      await wait(() => entry.window.webContents.executeJavaScript('document.documentElement.dataset.theme').then(value => value === skin), `${kind} live ${skin}`);
      const chrome = await chromeFacts(entry, bridge); facts.push({ kind, phase: skin, ...chrome });
      assert.equal(chrome.theme, skin); assert.equal(chrome.stateTheme, skin); assert.equal(chrome.initial, 'x'); assert.equal(chrome.initialAfter, 'x'); assert.equal(chrome.wrote, false);
      assert.equal(chrome.bodyBackground, backgrounds[skin]); assert.equal(chrome.weight, '700');
      assert.equal(chrome.regularAvailable, true); assert.equal(chrome.boldAvailable, true);
      if (skin !== 'nasa') assert(chrome.fontFamily.includes('Inter'));
      assert.equal(chrome.overflow, false); assert.deepEqual(chrome.overflowingControls, []);
      assert(chrome.width <= 980 && chrome.width >= 900, 'Test must remain at a 980px native window');
      const remote = await remoteFacts(entry); assert.equal(digest(remote.html), baseline.get(kind));
      assert.equal(remote.background, 'rgb(255, 255, 255)'); assert.equal(remote.color, 'rgb(0, 0, 0)'); assert.equal(remote.theme, null);
      assert.deepEqual(remote.bridges, ['undefined', 'undefined', 'undefined']);
      pass(`${kind}: ${skin} live theme/state, regular/bold fonts, no 980px toolbar overflow, remote markup/color unchanged`);
    }
  }
  for (const [kind, entry] of entries()) await capture(kind, entry);
  assert.equal(intercepted.length, 2); assert(intercepted.every(raw => new URL(raw).hostname === 'booth.pm'));
  pass('Exactly two private protocol document responses; no account, download/import or live network flow');
  assert.deepEqual(errors, []); pass('No preload errors or renderer process failures');
}
function report(ok, error) {
  const file = path.join(profile, 'report.json');
  fs.writeFileSync(file, JSON.stringify({ ok, checks, errors, error: error?.stack, profile, facts, screenshots,
    intercepted, codeRoot: process.env.VRC_NATIVE_ASAR || 'local build', noLiveNetwork: true, remoteHtmlSha256: digest(FIXTURE_HTML), noDatabaseAccess: true }, null, 2));
  console.log('NATIVE X V18 REPORT:', file);
}
app.whenReady().then(async () => {
  try { await run(); report(true); }
  catch (error) {
    for (const [kind, entry] of entries()) try { await capture(kind, entry, true); } catch (captureError) { errors.push({ type: 'capture', error: captureError.message }); }
    report(false, error); console.error(error); process.exitCode = 1;
  } finally {
    preview?.close(); try { await workspace?.shutdown(); } catch (error) { console.error('Fixture shutdown:', error); process.exitCode = 1; }
    app.exit(process.exitCode || 0);
  }
});
