import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { STRINGS, translator, fieldLabel } from '../assets/js/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('Chinese and English have the same keys', () => {
  assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.zh).sort());
});

test('no string is empty and placeholders match between languages', () => {
  const holes = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(STRINGS.zh)) {
    assert.ok(STRINGS.zh[key].trim() && STRINGS.en[key].trim(), key);
    assert.deepEqual(holes(STRINGS.en[key]), holes(STRINGS.zh[key]), key);
  }
});

test('interface text avoids internal terms', () => {
  const banned = /schema|skin|variant|panel colour|manifest|recipe/i;
  for (const lang of ['zh', 'en']) {
    for (const [key, text] of Object.entries(STRINGS[lang])) assert.ok(!banned.test(text), `${lang}.${key}: ${text}`);
  }
  // JSON is named only where you paste or copy it, or where the file could not be read as such.
  const allowed = new Set(['pasteJson', 'pasteTitle', 'pasteLabel', 'copy', 'errMalformed']);
  for (const lang of ['zh', 'en']) {
    for (const [key, text] of Object.entries(STRINGS[lang])) {
      if (/JSON/.test(text)) assert.ok(allowed.has(key), `${lang}.${key} mentions JSON`);
    }
  }
});

test('Chinese text uses full-width punctuation', () => {
  for (const [key, text] of Object.entries(STRINGS.zh)) {
    const plain = text.replace(/\{\w+\}/g, '').replace(/JSON|Android|iPhone|iOS|GPL-3\.0|#RRGGBBAA|#RRGGBB|#2A593F|ni hao|nǐ hǎo|HEIC|JPEG|PNG|WebP|MB/g, '');
    assert.ok(!/[一-鿿][,.;:!?]|[,.;:!?]$/.test(plain), `${key}: ${text}`);
  }
});

test('error paths of fields that are not shown fall back to a readable name', () => {
  assert.equal(fieldLabel('zh', '$.skin.variants.light.background'), '背景（浅色）');
  assert.equal(fieldLabel('zh', '$.skin.variants.dark.background.image'), '背景（深色）');
  assert.equal(fieldLabel('zh', '$.skin.typography.keySize'), '键盘外观');
  assert.equal(fieldLabel('zh', '$.candidateBar.controls.pagePosition'), '候选栏');
  assert.equal(translator('en')('f.keycap.borderWidth'), 'Border width');
});

test('every data-i18n key used by the page exists', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  for (const [, key] of html.matchAll(/data-i18n(?:-aria)?="(\w+)"/g)) assert.ok(key in STRINGS.zh, key);
});
