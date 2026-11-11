import test from 'node:test';
import assert from 'node:assert/strict';
import { previewMetrics, effectiveBarHeight, IOS_SURFACE } from '../assets/js/preview.js';
import { PRESETS, presetById } from '../assets/js/presets.js';
import { systemDefaultDocument, normalizeDocument } from '../assets/js/format.js';

const edited = () => {
  const doc = systemDefaultDocument();
  doc.skin.keycap.cornerRadius = 14;
  doc.skin.keycap.borderWidth = 1.5;
  doc.skin.spacing = { visualInsetX: 3, visualInsetY: 4 };
  doc.skin.typography.keySize = 26;
  doc.candidateBar.collapsed = { height: 52, cellPaddingX: 16, cellSpacing: 6, fillsAvailableWidth: true };
  return normalizeDocument(doc);
};

test('the iPhone surface is the measured system colour, not the skin panel', () => {
  assert.deepEqual({ ...IOS_SURFACE }, { light: '#E0E1E8', dark: '#222223' });
});

test('Android keeps its own key metrics whatever the skin says', () => {
  const plain = previewMetrics('android', normalizeDocument(systemDefaultDocument()));
  const custom = previewMetrics('android', edited());
  for (const name of ['gapX', 'rowHeight', 'capInsetX', 'capInsetY', 'radius', 'font', 'shadow', 'family']) {
    assert.deepEqual(custom[name], plain[name], name);
  }
  assert.equal(plain.gapX, 5);
  assert.equal(plain.radius, 8);
  assert.equal(plain.font.letter, 22);
});

test('Android reads only whether a key border exists', () => {
  const doc = normalizeDocument(systemDefaultDocument());
  assert.equal(previewMetrics('android', doc).border, 0);
  doc.skin.keycap.borderWidth = 0.5;
  assert.equal(previewMetrics('android', doc).border, 1);
  doc.skin.keycap.borderWidth = 2;
  assert.equal(previewMetrics('android', doc).border, 1);
});

test('Android takes bar values only when they differ from the default bar', () => {
  const plain = previewMetrics('android', normalizeDocument(systemDefaultDocument())).bar;
  assert.equal(plain.height, 48);
  assert.equal(plain.chipPad, 10);
  assert.equal(plain.cellSpacing, 0);
  const custom = previewMetrics('android', edited()).bar;
  assert.equal(custom.height, 60);
  assert.equal(custom.chipPad, 19);
  assert.equal(custom.cellSpacing, 6);
});

test('iPhone draws the skin: gaps grow with the inset, radius and sizes follow the file', () => {
  const plain = previewMetrics('iphone', normalizeDocument(systemDefaultDocument()));
  const custom = previewMetrics('iphone', edited());
  assert.equal(plain.refWidth, 402);
  assert.equal(plain.capInsetX, 0);
  assert.equal(plain.capInsetY, 1);
  assert.equal(custom.capInsetX, 3);
  assert.equal(custom.capInsetY, 4);
  assert.equal(custom.radius, 14);
  assert.equal(custom.border, 1.5);
  assert.ok(custom.font.letter > plain.font.letter);
  assert.equal(custom.bar.natural, false);
  assert.equal(plain.bar.natural, true);
  // The default skin gives the measured gaps: 6 pt across, 9 + 2 x 1 = 11 pt down.
  assert.equal(plain.gapX + 2 * plain.capInsetX, 6);
  assert.equal(plain.rowGap + 2 * plain.capInsetY, 11);
  assert.equal(plain.rowHeight - 2 * plain.capInsetY, 42);
});

test('every preset yields finite metrics on both platforms', () => {
  for (const preset of PRESETS) {
    for (const platform of ['android', 'iphone']) {
      const metrics = previewMetrics(platform, normalizeDocument(preset.document));
      const numbers = [metrics.gapX, metrics.rowHeight, metrics.radius, metrics.bar.height, ...Object.values(metrics.font)];
      assert.ok(numbers.every(Number.isFinite), `${preset.id} ${platform}`);
    }
  }
  assert.ok(presetById('builtin-songyan'));
});

test('the strip height rule matches the apps', () => {
  assert.equal(effectiveBarHeight(40, 20), 40);
  assert.equal(effectiveBarHeight(36, 30), 41);
  assert.equal(effectiveBarHeight(80, 16), 56);
});
