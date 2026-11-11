// The files in fixtures/ are generated from the built-in presets and one heavily edited theme.
// Run `UPDATE_FIXTURES=1 node --test tests/` to rewrite them after a deliberate change.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { decodeDocument, encodeDocument, FILE_EXTENSION, resolvedColors } from '../assets/js/format.js';
import { PRESETS } from '../assets/js/presets.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = join(root, 'fixtures');
const interopDir = join(root, 'tests', 'ios-interop');

const SAMPLE = {
  formatVersion: 1,
  id: 'sample-lantern',
  name: '示例·灯火',
  author: '松烟',
  appearance: 'system',
  skin: {
    formatVersion: 1,
    id: 'sample-lantern',
    name: '示例·灯火',
    variants: {
      light: {
        colors: {
          panel: '#F6E7C8', key: '#FFF8E8', control: '#E8C98F', accent: '#8B1E2D', accentText: '#FFF4E0',
          text: '#3A1F10', secondaryText: '#7A4B2A', selected: '#F2C879', pressed: '#E0A95B', border: '#B98A4A',
        },
        background: { type: 'linearGradient', from: '#FBEFD5', to: '#EBCB93', direction: 'vertical' },
      },
      dark: {
        colors: {
          panel: '#1E1410', key: '#3B2A22', control: '#2A1D17', accent: '#E0A33A', accentText: '#2A1500',
          text: '#F7E6CC', secondaryText: '#C9A57C', selected: '#6B3F1F', pressed: '#58402F', border: '#7A5A3A',
        },
        background: { type: 'linearGradient', from: '#2B1B14', to: '#120B08', direction: 'vertical' },
      },
    },
    typography: { family: 'serif', weight: 'semibold', keySize: 26, secondarySize: 13, candidateSize: 26 },
    keycap: { cornerRadius: 14, borderWidth: 1.5, shadow: 'subtle' },
    spacing: { visualInsetX: 3, visualInsetY: 4 },
  },
  candidateBar: {
    formatVersion: 1,
    id: 'sample-lantern',
    name: '示例·灯火',
    compositionRow: { visible: 'composingWithIdleRaw' },
    collapsed: { height: 52, cellPaddingX: 16, cellSpacing: 6, fillsAvailableWidth: true },
    expanded: { mode: 'list', columns: 3, rowSpacing: 6, columnSpacing: 6, fullRowTextLength: 12 },
    controls: { pagePosition: 'leading', showsExpand: true },
  },
};

const expected = [
  ...PRESETS.map((preset) => preset.document),
  SAMPLE,
].map((document) => ({ file: `${document.id}${FILE_EXTENSION}`, text: encodeDocument(document) }));

test('fixtures match the built-in presets and the edited sample', () => {
  if (process.env.UPDATE_FIXTURES) {
    for (const { file, text } of expected) writeFileSync(join(fixtureDir, file), text);
  }
  const onDisk = readdirSync(fixtureDir).filter((name) => name.endsWith(FILE_EXTENSION)).sort();
  assert.deepEqual(onDisk, expected.map((item) => item.file).sort());
  for (const { file, text } of expected) assert.equal(readFileSync(join(fixtureDir, file), 'utf8'), text, file);
});

test('the presets that exist as iOS samples are identical to them', () => {
  for (const preset of PRESETS) {
    const name = `appearance-${preset.id}${FILE_EXTENSION}`;
    if (!readdirSync(interopDir).includes(name)) continue;
    assert.equal(encodeDocument(preset.document), readFileSync(join(interopDir, name), 'utf8'), name);
  }
});

test('the edited sample survives normalisation untouched', () => {
  const normalised = decodeDocument(encodeDocument(SAMPLE));
  for (const mode of ['light', 'dark']) {
    assert.deepEqual(normalised.skin.variants[mode].colors, SAMPLE.skin.variants[mode].colors);
    assert.deepEqual(resolvedColors(SAMPLE.skin, mode), SAMPLE.skin.variants[mode].colors);
  }
});
