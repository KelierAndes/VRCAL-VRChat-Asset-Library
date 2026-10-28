'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

// Execute the actual settings callback. The application's run helper catches
// exceptions, so forwarding its boolean incorrectly could discard a retry.
function settingsCallback(name, context) {
  const filename = path.resolve(__dirname, '../src/renderer/main.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let component;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'SourceLocations') component = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert(component, 'settings must mount the interactive source locations component');
  const attribute = component.attributes.properties.find(item => item.name?.getText(source) === name);
  assert(attribute?.initializer?.expression, `settings must provide ${name}`);
  const expression = attribute.initializer.expression.getText(source);
  return new Function(...Object.keys(context), `return (${expression})`)(...Object.values(context));
}
function setup(remove) {
  const busy = [], calls = [];
  const api = { removeRoots: async roots => { calls.push([...roots]); return remove(); } };
  const run = async action => { try { await action(); return true; } catch { return false; } };
  return { busy, calls, callback: settingsCallback('onRemove', { api, run, setBusy: value => busy.push(value) }) };
}

test('settings forwards one batch and returns the backend success with busy reset', async () => {
  const h = setup(() => true);
  assert.equal(await h.callback(['E:/fixture/A', 'E:/fixture/B']), true);
  assert.deepEqual(h.calls, [['E:/fixture/A', 'E:/fixture/B']]);
  assert.deepEqual(h.busy, [true, false]);
});

test('settings does not turn a backend false into successful selection clearing', async () => {
  const h = setup(() => false);
  assert.equal(await h.callback(['E:/fixture/A']), false);
  assert.deepEqual(h.busy, [true, false]);
});

test('a removal exception caught by run still returns false and unlocks settings', async () => {
  const h = setup(() => { throw new Error('fixture denied'); });
  assert.equal(await h.callback(['E:/fixture/A']), false);
  assert.deepEqual(h.busy, [true, false]);
});

test('the existing add action calls the picker and releases outer busy state', async () => {
  const busy = []; let chosen = 0;
  const callback = settingsCallback('onAdd', { api: { chooseRoot: async () => { chosen++; } }, run: async action => { await action(); return true; }, setBusy: value => busy.push(value) });
  await callback();
  assert.equal(chosen, 1);
  assert.deepEqual(busy, [true, false]);
});
