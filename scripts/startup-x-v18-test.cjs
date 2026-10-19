// Prepare/run after build: node scripts/startup-x-v18-test.cjs
// Delays only the renderer module, leaving CSS and classic theme bootstrap untouched.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const project = path.resolve(__dirname, '..');
const runDir = fs.mkdtempSync(path.join(path.dirname(project), 'startup-x-v18-'));
const profile = path.join(runDir, 'Library'), source = path.join(runDir, 'SyntheticMaterials');
const localAppData = path.join(runDir, 'LocalAppData');
for (const folder of [profile, source, localAppData]) fs.mkdirSync(folder, { recursive: true });
const checks = [], errors = [], screenshots = [];
let app, page, beforeModule, afterModule, interception;
function pass(label) { checks.push(label); console.log('STARTUP X V18 PASS:', label); }
async function emptyLibraryReady() {
  await page.waitForSelector('.app-shell');
  await page.getByRole('heading', { name: '从你的素材文件夹开始', exact: true }).waitFor();
  const snapshot = await page.evaluate(() => window.library.snapshot());
  assert.equal(snapshot.stats.total, 0); assert.equal(snapshot.settings.theme, 'x');
  assert.deepEqual(snapshot.settings.roots.map(root => path.resolve(root)), [path.resolve(source)]);
  assert.equal(snapshot.scan.running, false); return snapshot;
}
async function capture(name) {
  // Warm the hidden compositor before the saved frame; do not depend on module initialization.
  const data = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/dist/renderer/'));
    await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    return (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  });
  const file = path.join(runDir, `${name}.png`); fs.writeFileSync(file, Buffer.from(data, 'base64')); screenshots.push(file);
  console.log('STARTUP X V18 SCREENSHOT:', file);
}
async function run() {
  app = await _electron.launch({ executablePath: process.env.VRC_UI_EXECUTABLE || require('electron'),
    args: process.env.VRC_UI_EXECUTABLE ? [] : [project],
    env: { ...process.env, LOCALAPPDATA: localAppData, VRC_LIBRARY_DATA_DIR: profile, VRC_LIBRARY_ROOT: source,
      VRC_LIBRARY_LOCATION_FILE: path.join(runDir, 'isolated-location.json'),
      VRC_LIBRARY_NO_NETWORK: '1', VRC_LIBRARY_NO_AUTOSCAN: '1', VRC_LIBRARY_TEST_HIDDEN: '1' } });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(`page: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await emptyLibraryReady();
  pass('Fresh isolated profile initializes an empty synthetic library in X without scanning');
  await page.addInitScript(() => {
    window.__startupCspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.__startupCspViolations.push({
      directive: event.violatedDirective, blocked: event.blockedURI, disposition: event.disposition
    }));
  });
  await app.evaluate(({ BrowserWindow, session, net }) => {
    const gate = { held: [], delegated: [], released: false, resolve: undefined, promise: undefined };
    gate.promise = new Promise(resolve => { gate.resolve = () => { gate.released = true; resolve(); }; });
    globalThis.__startupXGate = gate;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    session.defaultSession.protocol.handle('file', async request => {
      const pathname = decodeURIComponent(new URL(request.url).pathname).replaceAll('\\', '/');
      if (/\/renderer\/assets\/index-[^/]+\.js$/i.test(pathname)) {
        gate.held.push(request.url); await gate.promise;
      } else gate.delegated.push(request.url);
      return net.fetch(request.url, { bypassCustomProtocolHandlers: true });
    });
    const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/dist/renderer/'));
    win.webContents.setBackgroundThrottling(false);
    // Bypass the preceding normal launch's module cache so the gate is exercised.
    win.webContents.reloadIgnoringCache();
  });
  // Observe the gate from the main process. The renderer must never release its own module.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const held = await app.evaluate(() => globalThis.__startupXGate.held.length);
    if (held > 0) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  interception = await app.evaluate(() => ({ held: globalThis.__startupXGate.held, delegated: globalThis.__startupXGate.delegated, released: globalThis.__startupXGate.released }));
  assert(interception.held.length > 0, 'Built renderer module must be intercepted before making any pre-module claim');
  assert.equal(interception.released, false);
  await page.waitForFunction(() => document.body && document.querySelector('#root')?.childElementCount === 0 &&
    document.documentElement.dataset.theme === 'x' && getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)');
  beforeModule = await page.evaluate(() => {
    const scripts = [...document.scripts], bootstrap = scripts.find(script => new URL(script.src || location.href).pathname.endsWith('/theme-init.js'));
    const module = scripts.find(script => script.type === 'module');
    const initial = window.library.initialTheme; let wrote;
    try { wrote = Reflect.set(window.library, 'initialTheme', 'nasa'); } catch { wrote = false; }
    return { theme: document.documentElement.dataset.theme, bodyBackground: getComputedStyle(document.body).backgroundColor,
      rootChildren: document.querySelector('#root').childElementCount, hasReactShell: !!document.querySelector('.app-shell'),
      initialTheme: initial, initialThemeAfter: window.library.initialTheme, wrote, readyState: document.readyState,
      styleSheets: document.styleSheets.length, bootstrap: bootstrap && { src: bootstrap.src, type: bootstrap.type,
        async: bootstrap.async, defer: bootstrap.defer, inHead: bootstrap.parentElement === document.head,
        beforeModule: scripts.indexOf(bootstrap) < scripts.indexOf(module) },
      csp: window.__startupCspViolations ?? [] };
  });
  assert.equal(beforeModule.theme, 'x'); assert.equal(beforeModule.bodyBackground, 'rgb(0, 0, 0)');
  assert.equal(beforeModule.rootChildren, 0); assert.equal(beforeModule.hasReactShell, false);
  assert.equal(beforeModule.initialTheme, 'x'); assert.equal(beforeModule.initialThemeAfter, 'x'); assert.equal(beforeModule.wrote, false);
  assert(beforeModule.styleSheets > 0, 'CSS must flow while renderer module is held');
  assert(beforeModule.bootstrap, 'Built head must reference theme-init.js');
  assert.equal(beforeModule.bootstrap.type, ''); assert.equal(beforeModule.bootstrap.async, false); assert.equal(beforeModule.bootstrap.defer, false);
  assert.equal(beforeModule.bootstrap.inHead, true); assert.equal(beforeModule.bootstrap.beforeModule, true);
  assert.deepEqual(beforeModule.csp, []);
  const nativeBackground = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/dist/renderer/')).getBackgroundColor());
  assert(/^#(?:ff)?000000$/i.test(nativeBackground)); beforeModule.nativeBackground = nativeBackground;
  interception = await app.evaluate(() => ({ held: globalThis.__startupXGate.held, delegated: globalThis.__startupXGate.delegated, released: globalThis.__startupXGate.released }));
  assert.equal(interception.released, false);
  assert(interception.delegated.some(url => new URL(url).pathname.endsWith('/theme-init.js')), 'Classic bootstrap request must pass the file handler');
  assert(interception.delegated.some(url => /\.css$/i.test(new URL(url).pathname)), 'Stylesheet request must pass the file handler');
  pass('Held renderer module leaves #root empty while classic head bootstrap sets X and CSS paints black');
  pass('Readonly preload initialTheme and native window remain X/black before React initializes');
  await capture('x-before-renderer-module');
  await app.evaluate(() => globalThis.__startupXGate.resolve());
  const snapshot = await emptyLibraryReady();
  afterModule = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme,
    bodyBackground: getComputedStyle(document.body).backgroundColor, rootChildren: document.querySelector('#root').childElementCount,
    hasReactShell: !!document.querySelector('.app-shell'), initialTheme: window.library.initialTheme, csp: window.__startupCspViolations ?? [] }));
  assert.equal(afterModule.theme, 'x'); assert.equal(afterModule.bodyBackground, 'rgb(0, 0, 0)');
  assert(afterModule.rootChildren > 0); assert.equal(afterModule.hasReactShell, true); assert.equal(afterModule.initialTheme, 'x');
  assert.equal(snapshot.settings.xThemeIntroduced, true); assert.deepEqual(afterModule.csp, []);
  assert.deepEqual(fs.readdirSync(source), []); assert.deepEqual(errors, []);
  pass('Releasing the module mounts the normal empty library in X, with no CSP/renderer errors or synthetic-root writes');
  await app.evaluate(({ session }) => { session.defaultSession.protocol.unhandle('file'); });
}
function report(ok, error) {
  const file = path.join(runDir, 'report.json');
  fs.writeFileSync(file, JSON.stringify({ ok, checks, errors, error: error?.stack, runDir, profile, source,
    executable: process.env.VRC_UI_EXECUTABLE || 'local electron', beforeModule, afterModule, interception, screenshots,
    isolation: 'Fresh empty private profile and synthetic root; network/autoscan disabled; built files delegated with bypassCustomProtocolHandlers' }, null, 2));
  console.log('STARTUP X V18 REPORT:', file);
}
(async () => {
  try { await run(); report(true); }
  catch (error) {
    if (app && page) try { await capture('failure'); } catch (captureError) { errors.push(`Failure screenshot: ${captureError.message}`); }
    report(false, error); console.error(error); process.exitCode = 1;
  } finally {
    if (app) {
      // Always unblock pending resource requests before closing a failed run.
      try { await app.evaluate(() => globalThis.__startupXGate?.resolve()); } catch {}
      await app.close();
    }
  }
})();
