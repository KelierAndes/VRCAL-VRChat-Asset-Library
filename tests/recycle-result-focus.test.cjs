'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { load } = require('cheerio');

// Render the real source component and i18n modules without a build or DOM mock.
const priorExtensions = new Map(['.ts', '.tsx', '.css'].map(extension => [extension, require.extensions[extension]]));
let RecycleResult;
try {
  for (const extension of ['.ts', '.tsx']) {
    require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
      }, fileName: filename
    }).outputText, filename);
  }
  require.extensions['.css'] = module => { module.exports = {}; };
  ({ RecycleResult } = require(path.resolve(__dirname, '../src/renderer/recycle-result.tsx')));
} finally {
  for (const [extension, handler] of priorExtensions) {
    if (handler) require.extensions[extension] = handler;
    else delete require.extensions[extension];
  }
}

test('rendered recycle results expose a named keyboard focus stop between the close and done controls', () => {
  const file = 'E:\\素材 日本語\\long-folder\\avatar.unitypackage';
  const result = {
    cancelled: false,
    results: [{ path: file, assetIds: ['failed-asset'], status: 'failed', error: 'OS recycle bin unavailable' }]
  };
  const $ = load(renderToStaticMarkup(React.createElement(RecycleResult, { result, onClose() {} })));
  const dialog = $('[role="dialog"]');
  const keyboardStops = dialog.find('button:not(:disabled), [tabindex="0"]');
  assert.equal(keyboardStops.length, 3,
    'the result content needs its own focus stop so keyboard users can scroll it');
  const region = keyboardStops.eq(1);
  assert.equal(region.attr('role'), 'region');
  assert.ok(region.attr('aria-label'), 'the scroll region needs an accessible name');
  assert.equal(region.find('[data-recycle-status="failed"]').length, 1);
  assert.ok(region.text().includes(file), 'the focusable region must contain the actual result paths');
});
