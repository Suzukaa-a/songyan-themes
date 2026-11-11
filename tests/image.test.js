import test from 'node:test';
import assert from 'node:assert/strict';
import { outputSize, coverPlacement, slackAxis, KEYBOARD_AREA, MAX_SIDE, TARGET_BYTES } from '../assets/js/image.js';
import { previewMetrics } from '../assets/js/preview.js';
import { systemDefaultDocument, normalizeDocument, MAX_IMAGE_BYTES, MAX_IMAGE_DOCUMENT_BYTES } from '../assets/js/format.js';

test('the keyboard area is what the Android preview draws', () => {
  const m = previewMetrics('android', normalizeDocument(systemDefaultDocument()));
  const height = m.topPad + 4 * m.rowHeight + m.bottomPad + m.bar.height + m.systemRow;
  assert.deepEqual({ ...KEYBOARD_AREA }, { width: m.refWidth, height });
});

test('output is keyboard-shaped, at most 1600 on the long side, and never upscaled', () => {
  const big = outputSize(6000, 4000);
  assert.equal(big.width, MAX_SIDE);
  assert.ok(Math.abs(big.width / big.height - KEYBOARD_AREA.width / KEYBOARD_AREA.height) < 0.01);
  const small = outputSize(300, 900);
  assert.equal(small.width, 300);
  const wide = outputSize(2000, 300); // only 300 tall: the frame is 1.28 wide per tall
  assert.equal(wide.width, Math.floor(300 * KEYBOARD_AREA.width / KEYBOARD_AREA.height));
  assert.ok(outputSize(6000, 4000, 0.8).width < MAX_SIDE);
});

test('a baked image fits twice in a 2 MiB document', () => {
  assert.ok(TARGET_BYTES <= MAX_IMAGE_BYTES);
  assert.ok(((TARGET_BYTES * 4) / 3) * 2 + 64 * 1024 < MAX_IMAGE_DOCUMENT_BYTES);
});

test('cover placement fills the frame and the position picks the visible part', () => {
  const out = { width: 400, height: 300 };
  // A tall photo: width fits, height overflows, so only y moves.
  const top = coverPlacement(800, 1200, out.width, out.height, 0);
  const bottom = coverPlacement(800, 1200, out.width, out.height, 1);
  const middle = coverPlacement(800, 1200, out.width, out.height, 0.5);
  assert.equal(top.x, 0); assert.equal(top.y, 0);
  assert.equal(top.width, 400); assert.equal(top.height, 600);
  assert.equal(bottom.y, -300);
  assert.equal(middle.y, -150);
  // A wide photo moves along x.
  const wide = coverPlacement(1600, 600, out.width, out.height, 1);
  assert.equal(wide.height, 300); assert.equal(wide.y, 0);
  assert.equal(wide.x, -(800 - 400));
});

test('growing for blur keeps the frame covered', () => {
  for (const pos of [0, 0.5, 1]) {
    const r = coverPlacement(800, 1200, 400, 300, pos, 0.1);
    assert.ok(r.x <= 0 && r.y <= 0 && r.x + r.width >= 400 && r.y + r.height >= 300, `${pos}`);
  }
});

test('the drag axis follows the picture shape', () => {
  assert.equal(slackAxis(800, 1200), 'y');
  assert.equal(slackAxis(1600, 600), 'x');
  assert.equal(slackAxis(411, 320), null);
});
