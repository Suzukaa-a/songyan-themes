import test from 'node:test';
import assert from 'node:assert/strict';
import { previewMetrics, effectiveBarHeight, IOS_SURFACE, iphoneKeyRects, iphoneToolbarCentres } from '../assets/js/preview.js';
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

test('both platforms show the same gaps for one file', () => {
  for (const doc of [normalizeDocument(systemDefaultDocument()), edited()]) {
    const ios = previewMetrics('iphone', doc);
    const android = previewMetrics('android', doc);
    assert.equal(android.gapX + 2 * android.capInsetX, ios.gapX + 2 * ios.capInsetX);
    assert.equal(android.rowGap + 2 * android.capInsetY, ios.rowGap + 2 * ios.capInsetY);
  }
});

test('Android reads the skin literally, 1 pt = 1 dp', () => {
  const m = previewMetrics('android', edited());
  assert.equal(m.gapX, 10);
  assert.equal(m.capInsetX, 0);
  assert.equal(m.capInsetY, 6);
  assert.equal(m.radius, 14);
  assert.equal(m.border, 1.5);
  assert.equal(m.font.letter, 26);
  assert.equal(m.rowHeight, 60);
});

test('Android draws the Android built-in metrics from the Android built-in numbers', () => {
  const doc = normalizeDocument(systemDefaultDocument());
  doc.skin.keycap = { cornerRadius: 8, borderWidth: 0, shadow: 'none' };
  doc.skin.spacing = { visualInsetX: 0.75, visualInsetY: 2 };
  doc.skin.typography = { ...doc.skin.typography, keySize: 22, secondarySize: 11, candidateSize: 18 };
  doc.candidateBar.collapsed = { ...doc.candidateBar.collapsed, height: 48, cellPaddingX: 10, cellSpacing: 0 };
  const m = previewMetrics('android', doc);
  assert.deepEqual([m.gapX, m.capInsetY, m.radius, m.font.letter], [5.5, 4, 8, 22]);
  assert.deepEqual([m.bar.height, m.bar.chipPad, m.bar.cellSpacing], [48, 10, 0]);
});

test('Android takes the bar numbers as written, topped up for large text', () => {
  const custom = previewMetrics('android', edited()).bar;
  assert.equal(custom.height, 52);
  assert.equal(custom.chipPad, 16);
  assert.equal(custom.cellSpacing, 6);
  const doc = edited();
  doc.skin.typography.candidateSize = 44;
  assert.equal(previewMetrics('android', doc).bar.height, 58);
});

test('iPhone draws the skin: gaps grow with the inset, radius and sizes follow the file', () => {
  const plain = previewMetrics('iphone', normalizeDocument(systemDefaultDocument()));
  const custom = previewMetrics('iphone', edited());
  assert.equal(plain.refWidth, 402);
  assert.equal(plain.capInsetX, 0.75);
  assert.equal(plain.capInsetY, 2.5);
  assert.equal(custom.capInsetX, 3);
  assert.equal(custom.capInsetY, 4);
  assert.equal(custom.radius, 14);
  assert.equal(custom.border, 1.5);
  assert.ok(custom.font.letter > plain.font.letter);
  assert.equal(custom.bar.natural, false);
  assert.equal(plain.bar.natural, true);
  // The default skin's gaps match Android's: 4 + 2 x 0.75 = 5.5 pt across, 4 + 2 x 2.5 = 9 pt down,
  // keys 54 - 5 = 49 pt tall.
  assert.equal(plain.gapX + 2 * plain.capInsetX, 5.5);
  assert.equal(plain.rowGap + 2 * plain.capInsetY, 9);
  assert.equal(plain.rowHeight - 2 * plain.capInsetY, 49);
});

// The key cells were measured in the simulator; each cap sits inside its cell by the skin's inset
// (0.75 across, 2.5 down for the system default), so caps are 1.5 pt narrower and 5 pt shorter.
test('the iPhone preview matches the real keyboard (402 pt, light, system default), measured in the simulator', () => {
  const m = previewMetrics('iphone', normalizeDocument(systemDefaultDocument()));
  const [r1, r2, r3, r4] = iphoneKeyRects(m, 402);
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 0.5, `${label}: ${actual} vs ${expected}`);
  // Keyboard top to first key row: 9 + 40 + 3 + 1.5.
  near(r1[0].y, 54.5, 'row 1 top');
  near(r2[0].y - r1[0].y, 58, 'row pitch');
  near(r3[0].y - r2[0].y, 58, 'row pitch');
  near(r4[0].y - r3[0].y, 58, 'row pitch');
  for (const rect of r1) { near(rect.w, 34.17, 'letter width'); near(rect.h, 49, 'key height'); }
  near(r1[0].x, 4.75, 'left inset');
  near(402 - (r1[9].x + r1[9].w), 4.75, 'right inset');
  near(r1[1].x - (r1[0].x + r1[0].w), 5.5, 'gap across');
  near(r2[0].x, 24.75, 'row 2 indent');
  near(r3[0].w, 54.17, 'shift width');
  near(r3[8].w, 54.17, 'delete width');
  near(r3[1].x, 4 + 55.67 + 4 + 0.75, 'z position');
  [38.5, 38.5, 38.5, 132.5, 38.5, 78.5].forEach((width, index) => near(r4[index].w, width, `bottom key ${index}`));
});

test('the iPhone toolbar has three equal buttons, centred as measured in the simulator', () => {
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 0.5, `${actual} vs ${expected}`);
  const [a, b, c] = iphoneToolbarCentres(402);
  near(a, 73.7); near(b, 201.5); near(c, 328.2);
  const m = previewMetrics('iphone', normalizeDocument(systemDefaultDocument()));
  assert.equal(m.bar.height, 40);
});

test('the candidate bar has the same height and padding on both platforms', () => {
  const doc = normalizeDocument(systemDefaultDocument());
  doc.candidateBar.collapsed.height = 52;
  doc.candidateBar.collapsed.cellPaddingX = 12;
  for (const platform of ['iphone', 'android']) {
    const { bar } = previewMetrics(platform, doc);
    assert.equal(bar.height, 52, platform);
    assert.equal(bar.chipPad, 12, platform);
  }
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
