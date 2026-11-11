import test from 'node:test';
import assert from 'node:assert/strict';
import { previewMetrics, effectiveBarHeight, IOS_SURFACE, iphoneKeyRects, androidBar, iphoneToolbarCentres } from '../assets/js/preview.js';
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
  // The default skin gives the measured gaps: 4 pt across, 4 + 2 x 1 = 6 pt down, keys 52 pt tall.
  assert.equal(plain.gapX + 2 * plain.capInsetX, 4);
  assert.equal(plain.rowGap + 2 * plain.capInsetY, 6);
  assert.equal(plain.rowHeight - 2 * plain.capInsetY, 52);
});

test('the iPhone preview matches the real keyboard (402 pt, light, system default), measured in the simulator', () => {
  const m = previewMetrics('iphone', normalizeDocument(systemDefaultDocument()));
  const [r1, r2, r3, r4] = iphoneKeyRects(m, 402);
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 0.5, `${label}: ${actual} vs ${expected}`);
  // Keyboard top to first key row: 9 + 40 + 3 + 1.
  near(r1[0].y, 53, 'row 1 top');
  near(r2[0].y - r1[0].y, 58, 'row pitch');
  near(r3[0].y - r2[0].y, 58, 'row pitch');
  near(r4[0].y - r3[0].y, 58, 'row pitch');
  for (const rect of r1) { near(rect.w, 35.67, 'letter width'); near(rect.h, 52, 'key height'); }
  near(r1[0].x, 4, 'left inset');
  near(402 - (r1[9].x + r1[9].w), 4, 'right inset');
  near(r1[1].x - (r1[0].x + r1[0].w), 4, 'gap across');
  near(r2[0].x, 24, 'row 2 indent');
  near(r3[0].w, 55.67, 'shift width');
  near(r3[8].w, 55.67, 'delete width');
  near(r3[1].x, 4 + 55.67 + 4, 'z position');
  [40, 40, 40, 134, 40, 80].forEach((width, index) => near(r4[index].w, width, `bottom key ${index}`));
});

test('the iPhone toolbar has three equal buttons, centred as measured in the simulator', () => {
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 0.5, `${actual} vs ${expected}`);
  const [a, b, c] = iphoneToolbarCentres(402);
  near(a, 73.7); near(b, 201.5); near(c, 328.2);
  const m = previewMetrics('iphone', normalizeDocument(systemDefaultDocument()));
  assert.equal(m.bar.height, 40);
});

test('the candidate bar draws each platform\'s own height and padding', () => {
  const doc = normalizeDocument(systemDefaultDocument());
  doc.candidateBar.collapsed.height = 52;
  doc.candidateBar.collapsed.cellPaddingX = 12;
  const ios = previewMetrics('iphone', doc);
  const android = previewMetrics('android', doc);
  assert.equal(ios.bar.height, 52);
  assert.equal(ios.bar.chipPad, 12);
  assert.equal(android.bar.height, 60);
  assert.equal(android.bar.chipPad, 15);
  assert.deepEqual(androidBar({ height: 40, cellPaddingX: 7, cellSpacing: 0 }), { height: 48, chipPad: 10, cellSpacing: 0 });
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

test('background CSS: solid, gradients of every direction, images by align', async () => {
  const { backgroundCss } = await import('../assets/js/preview.js');
  assert.equal(backgroundCss(undefined), null);
  assert.equal(backgroundCss({ type: 'solid', color: '#11223380' }), 'linear-gradient(#11223380, #11223380)');
  assert.equal(
    backgroundCss({ type: 'linearGradient', from: '#000000', to: '#FFFFFF', direction: 'vertical' }),
    'linear-gradient(to bottom, #000000, #FFFFFF)');
  assert.equal(
    backgroundCss({ type: 'linearGradient', colors: ['#000000', '#777777', '#FFFFFF'], direction: 'horizontal' }),
    'linear-gradient(to right, #000000, #777777, #FFFFFF)');
  assert.match(backgroundCss({ type: 'linearGradient', colors: ['#000000', '#FFFFFF'], direction: 'diagonal' }), /to bottom right/);
  const image = { type: 'image', image: 'data:image/png;base64,AAAA', align: 'bottom' };
  assert.equal(backgroundCss(image, () => 'blob:x'), 'url("blob:x") center bottom / cover no-repeat');
  assert.equal(backgroundCss(image, () => null), null);
});
