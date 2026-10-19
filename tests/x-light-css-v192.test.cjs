const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');

const read = file => postcss.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
const renderer = () => read('src/renderer/themes/x.css');
function palette(root, theme) {
  const values = {};
  root.walkRules(rule => {
    if (new RegExp(`^html\\[data-theme=['\"]?${theme}['\"]?\\]$`).test(rule.selector))
      rule.walkDecls(decl => { values[decl.prop] = decl.value; });
  });
  return values;
}
function luminance(hex) {
  const rgb = hex.replace('#', '').match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test('X light has readable text, muted labels, links, primary actions and error states on both surfaces', () => {
  const light = palette(renderer(), 'x-light');
  assert.equal(light['color-scheme'], 'light');
  assert.equal(light['--bg']?.toUpperCase(), '#FFFFFF');
  for (const token of ['--ink', '--muted', '--accent', '--x-danger']) {
    for (const surface of ['--bg', '--panel'])
      assert(contrast(light[token], light[surface]) >= 4.5, `${token} must have 4.5:1 contrast on ${surface}`);
  }
  assert(contrast(light['--accent-contrast'], light['--accent']) >= 4.5, 'primary action text');
  assert(contrast(light['--x-selection-ink'], light['--accent']) >= 4.5, 'selected text');
  assert(contrast(light['--x-control-line'], light['--bg']) >= 3, 'input boundaries');
});

test('the full X layout and responsive rules apply to both X variants without recolouring artwork', () => {
  const css = renderer();
  const shared = [];
  css.walkRules(rule => {
    if (rule.selector.includes("[data-theme='x']") && rule.selector !== "html[data-theme='x']") {
      assert(rule.selector.includes("[data-theme='x-light']"), `dark-only layout: ${rule.selector}`);
      shared.push(rule.selector);
    }
    rule.walkDecls(decl => {
      assert(!['filter', '-webkit-filter'].includes(decl.prop), `artwork colour filter: ${rule.selector}`);
    });
  });
  for (const surface of ['.asset-card', '.view-list', '.detail-panel', '.modal', '.context-menu', '.hover-preview',
    '.theme-option', '.review-candidate', '.project-material-card', '.network-panel', '.booth-download-row', '.empty-state'])
    assert(shared.some(selector => selector.includes(surface)), `missing shared feature surface ${surface}`);
  for (const breakpoint of ['1100px', '800px', '600px', '560px']) {
    const block = css.nodes.find(node => node.type === 'atrule' && node.name === 'media' && node.params.includes(breakpoint));
    assert(block?.nodes.some(rule => rule.selector?.includes("[data-theme='x-light']")), `missing responsive breakpoint ${breakpoint}`);
  }
});

test('shared overlays use semantic colours and every light override is scoped to X light or its settings preview', () => {
  renderer().walkRules(rule => {
    if (rule.selector.includes("html:is([data-theme='x'],[data-theme='x-light'])")) {
      rule.walkDecls(decl => {
        if (/(?:background|color|shadow|fill|stroke)/.test(decl.prop))
          assert(!/#[\da-f]{3,8}\b/i.test(decl.value), `fixed dark colour in shared layout: ${rule.selector}`);
      });
    }
    assert(rule.selector.startsWith('html'), `unscoped theme rule: ${rule.selector}`);
  });
  const previews = [];
  renderer().walkRules(rule => {
    if (rule.selector.includes('.theme-preview-x-light')) previews.push(rule);
  });
  assert(previews.length > 0, 'light preview must be visible from every theme');
  assert(previews.every(rule => rule.selector.startsWith('html[data-theme]')));
});

test('local BOOTH/preview chrome share the readable light palette and native input scheme', () => {
  const light = palette(renderer(), 'x-light');
  for (const file of ['assets/window-themes.css']) {
    const css = read(file), chrome = palette(css, 'x-light');
    assert.equal(chrome['color-scheme'], 'light', file);
    for (const [native, app] of [['--paper', '--bg'], ['--panel', '--panel'], ['--ink', '--ink'], ['--muted', '--muted'], ['--line', '--line']])
      assert.equal(chrome[native]?.toUpperCase(), light[app]?.toUpperCase(), `${file} ${native}`);
    assert(contrast(chrome['--red'] || chrome['--accent'], chrome['--paper']) >= 4.5, `${file} primary action`);
    css.walkDecls('filter', decl => assert.fail(`local chrome must preserve cover colours: ${decl.value}`));
  }
});

test('every legacy feature colour has a semantic bridge so light mode cannot inherit an old dark panel', () => {
  const selectors = value => value.split(/,(?![^()]*\))/).map(value => value.trim());
  const bridge = new Map();
  read('src/renderer/themes/base.css').walkRules(rule => {
    for (const selector of selectors(rule.selector).map(value => value.replace(/^html\[data-theme\] /, ''))) {
      if (!bridge.has(selector)) bridge.set(selector, new Set());
      rule.walkDecls(decl => bridge.get(selector).add(decl.prop));
    }
  });
  read('src/renderer/style.css').walkRules(rule => {
    rule.walkDecls(decl => {
      if (!/#[\da-f]{3}/i.test(decl.value) || !/(?:color|background|shadow|border|fill|stroke)/.test(decl.prop)) return;
      for (const selector of selectors(rule.selector)) {
        if (selector === ':root') continue; // Every theme replaces the legacy root palette.
        assert(bridge.get(selector)?.has(decl.prop), `unbridged legacy colour: ${selector} ${decl.prop}`);
      }
    });
  });
});
