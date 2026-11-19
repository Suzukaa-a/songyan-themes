import test from 'node:test';
import assert from 'node:assert/strict';
import { pageAccent } from '../assets/js/accent.js';
import { contrastRatio, systemDefaultDocument } from '../assets/js/format.js';
import { presetById } from '../assets/js/presets.js';

const withAccent = (light, dark) => ({
  skin: { variants: { light: { colors: light ? { accent: light } : {} }, dark: { colors: dark ? { accent: dark } : {} } } },
});

test('the accent of the matching variant is applied', () => {
  const doc = withAccent('#2A593F', '#8FD7AA');
  assert.equal(pageAccent(doc, 'light').accent, '#2A593F');
  assert.equal(pageAccent(doc, 'dark').accent, '#8FD7AA');
});

test('the text colour on the accent reads at 4.5:1', () => {
  for (const hex of ['#2A593F', '#FFD54F', '#E91E63', '#808080', '#0000FF']) {
    for (const scheme of ['light', 'dark']) {
      const result = pageAccent(withAccent(hex, hex), scheme);
      assert.ok(contrastRatio(result.accentText, result.accent) >= 4.5, `${hex} ${scheme}`);
    }
  }
  assert.equal(pageAccent(withAccent('#FFD54F'), 'light').accentText, '#000000');
});

test('no accent falls back to the stylesheet', () => {
  const bare = systemDefaultDocument();
  delete bare.skin.variants.light.colors.accent;
  assert.equal(pageAccent(bare, 'light'), null);
  assert.equal(pageAccent(withAccent(null, '#8FD7AA'), 'light'), null);
  assert.equal(pageAccent({}, 'dark'), null);
});

test('an accent that disappears into the page is moved until controls stay usable', () => {
  const light = pageAccent(withAccent('#F5F5F0'), 'light');
  assert.ok(contrastRatio(light.accent, '#F3F4F2') >= 3);
  assert.ok(contrastRatio(light.accent, '#FFFFFF') >= 3);
  const dark = pageAccent(withAccent(null, '#101410'), 'dark');
  assert.ok(contrastRatio(dark.accent, '#121513') >= 3);
  assert.ok(contrastRatio(dark.accent, '#1B1F1C') >= 3);
});

test('the soft tint is a light tint in light and a dark one in dark', () => {
  const doc = withAccent('#2A593F', '#8FD7AA');
  const light = pageAccent(doc, 'light').accentSoft;
  const dark = pageAccent(doc, 'dark').accentSoft;
  assert.ok(contrastRatio(light, '#F3F4F2') < 1.3);
  assert.ok(contrastRatio(dark, '#121513') < 1.4);
  assert.notEqual(light, dark);
});

test('a built-in preset yields a usable accent in both schemes', () => {
  const doc = presetById('builtin-songyan').document;
  for (const scheme of ['light', 'dark']) assert.ok(pageAccent(doc, scheme));
});
