'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');

// Load the source directly so this focused test does not require or modify dist.
const sourcePath = path.resolve(__dirname, '../src/shared/context-menu.ts');
const subject = (() => {
  if (!fs.existsSync(sourcePath)) return {};
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  loaded._compile(output, sourcePath);
  return loaded.exports;
})();

const defaultOrder = [
  'details', 'model-preview', 'reveal', 'copy-path', 'open-source', 'project-products',
  'project-files', 'import-project', 'favorite', 'tags', 'category',
  'relations', 'project-in-progress', 'project-completed', 'matching-mode',
  'collection', 'remove-tags', 'cover', 'force-rematch', 'hide', 'delete'
];
const defaults = () => ({ order: [...defaultOrder], hidden: [] });
function normalize(...args) {
  assert.equal(typeof subject.normalizeContextMenuPreferences, 'function',
    'context menu preferences must expose a normalizer');
  return subject.normalizeContextMenuPreferences(...args);
}

test('missing preferences show every supported action in default order', () => {
  assert.deepEqual(normalize(undefined), defaults());
});

test('saved order survives unknown actions and duplicates, then receives new actions', () => {
  const actual = normalize({
    order: ['favorite', 'retired-action', 'details', 'favorite'],
    hidden: ['retired-action', 'delete', 'delete', 'tags']
  });
  assert.deepEqual(actual, {
    order: ['favorite', 'details', ...defaultOrder.filter(id => id !== 'favorite' && id !== 'details')],
    hidden: ['delete', 'tags']
  });
});

test('empty saved arrays append supported actions and keep every action visible', () => {
  assert.deepEqual(normalize({ order: [], hidden: [] }), defaults());
});

test('a valid saved permutation and hidden choices are preserved', () => {
  const input = { order: [...defaultOrder].reverse(), hidden: ['hide', 'details'] };
  assert.deepEqual(normalize(input, true), input);
});

const malformed = [
  undefined, null, [], 7, 'preferences', {},
  { order: [], hidden: null },
  { order: 'details', hidden: [] },
  { order: [1], hidden: [] },
  { order: [], hidden: [null] },
  { order: new Array(1), hidden: [] },
  { order: [], hidden: new Array(1) }
];

test('damaged stored records fall back to the complete default instead of partial recovery', () => {
  for (const value of malformed) assert.deepEqual(normalize(value), defaults());
});

test('strict writes reject a malformed record with a readable validation error', () => {
  for (const value of malformed) {
    assert.throws(() => normalize(value, true), {
      name: 'TypeError', message: '右键菜单设置无效。'
    });
  }
});

test('strict writes still discard obsolete string ids and deduplicate valid ids', () => {
  assert.deepEqual(normalize({
    order: ['hide', 'future-action', 'hide'], hidden: ['future-action', 'hide', 'hide']
  }, true), {
    order: ['hide', ...defaultOrder.filter(id => id !== 'hide')], hidden: ['hide']
  });
});

test('normalization never mutates input or shares mutable output arrays', () => {
  const input = { order: ['favorite'], hidden: ['hide'] };
  const first = normalize(input);
  const second = normalize(input);
  assert.notEqual(first, second);
  assert.notEqual(first.order, second.order);
  assert.notEqual(first.hidden, second.hidden);
  first.order.pop();
  first.hidden.push('delete');
  assert.deepEqual(input, { order: ['favorite'], hidden: ['hide'] });
  assert.deepEqual(second.hidden, ['hide']);
  assert.equal(second.order.length, 21);
});

test('default reads return independent arrays and exported defaults cannot be changed', () => {
  const first = normalize(null);
  const second = normalize(null);
  first.order.reverse();
  first.hidden.push('hide');
  assert.deepEqual(second, defaults());
  assert.notEqual(second.order, subject.DEFAULT_CONTEXT_MENU_PREFERENCES.order);
  assert.notEqual(second.hidden, subject.DEFAULT_CONTEXT_MENU_PREFERENCES.hidden);
  assert.throws(() => subject.DEFAULT_CONTEXT_MENU_PREFERENCES.order.push('hide'), TypeError);
  assert.throws(() => subject.DEFAULT_CONTEXT_MENU_PREFERENCES.hidden.push('hide'), TypeError);
  assert.deepEqual(normalize(null), defaults());
});
