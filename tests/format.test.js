import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  decodeDocument, decodeImported, encodeDocument, FormatError, ErrorCode, resolvedColors,
  contrasting, systemDefaultDocument, MAX_DOCUMENT_BYTES, readDocument,
} from '../assets/js/format.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'ios-interop');
const files = (suffix) => readdirSync(dir).filter((name) => name.endsWith(suffix)).sort();
const read = (name) => readFileSync(join(dir, name), 'utf8');

const rejects = (fn, code, path) => {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof FormatError, String(error));
    assert.equal(error.code, code, error.message);
    if (path) assert.equal(error.path, path, error.message);
    return true;
  });
};

const sample = () => JSON.parse(read('appearance-builtin-paper.songyanappearance.json'));
const mutate = (change) => {
  const document = sample();
  change(document);
  return JSON.stringify(document);
};

test('the interop folder holds the iOS samples', () => {
  assert.ok(files('.songyanappearance.json').length >= 7);
});

for (const name of files('.songyanappearance.json')) {
  test(`round trip ${name}`, () => {
    const text = read(name);
    const first = decodeDocument(text);
    const second = decodeDocument(encodeDocument(first));
    assert.deepEqual(second, first);
    assert.deepEqual(JSON.parse(encodeDocument(first)), JSON.parse(text));
  });

  test(`encoder matches the iOS bytes for ${name}`, () => {
    assert.equal(encodeDocument(decodeDocument(read(name))), read(name));
  });

  test(`decodeImported reads ${name} as a document`, () => {
    assert.equal(decodeImported(read(name)).kind, 'document');
  });
}

test('a standalone skin is wrapped with the system default bar', () => {
  const { document, kind } = decodeImported(read('skin-builtin-paper.songyanskin.json'));
  const paper = decodeDocument(read('appearance-builtin-paper.songyanappearance.json'));
  assert.equal(kind, 'skin');
  assert.deepEqual(document.skin, paper.skin);
  assert.deepEqual(document.candidateBar, paper.candidateBar);
});

test('a standalone candidate bar is wrapped with the system default skin', () => {
  const { document, kind } = decodeImported(read('candidate-grid-bar.songyancand.json'));
  assert.equal(kind, 'candidateBar');
  assert.equal(document.id, 'grid-bar');
  assert.equal(document.skin.id, 'grid-bar');
  assert.equal(document.candidateBar.expanded.mode, 'grid');
  assert.equal(document.skin.variants.light.colors.panel, '#DFE2E7');
  decodeDocument(encodeDocument(document));
});

test('a standalone file with the system default identity gets a fresh one', () => {
  const skin = JSON.parse(read('skin-builtin-paper.songyanskin.json'));
  skin.id = 'system-default';
  const { document } = decodeImported(JSON.stringify(skin), () => 'fresh-id');
  assert.equal(document.id, 'fresh-id');
  assert.equal(document.skin.id, 'fresh-id');
  assert.equal(document.candidateBar.id, 'fresh-id');
});

test('omitted fields take the format defaults', () => {
  const { document } = decodeImported(JSON.stringify({ formatVersion: 1, id: 'a', name: 'A', typography: {} }));
  assert.equal(document.skin.typography.weight, 'medium');
  assert.equal(document.skin.typography.keySize, 22);
  assert.equal(document.skin.keycap.shadow, 'subtle');
  assert.equal(document.skin.spacing.visualInsetX, 2);
  assert.deepEqual(document.skin.variants.light.colors, resolvedColors({}, 'light'));
  const bar = decodeImported(JSON.stringify({ formatVersion: 1, id: 'b', name: 'B', collapsed: {} })).document;
  assert.equal(bar.candidateBar.collapsed.height, 44);
  assert.equal('fillsAvailableWidth' in bar.candidateBar.collapsed, false);
});

test('every resolved colour is written into both variants', () => {
  const document = decodeDocument(mutate((d) => { delete d.skin.variants.dark.colors.border; delete d.skin.variants.light; }));
  assert.equal(Object.keys(document.skin.variants.light.colors).length, 10);
  assert.equal(document.skin.variants.dark.colors.border, '#808080');
  assert.equal(document.skin.variants.light.colors.panel, '#D1D3D9');
});

test('text colours are forced readable like resolvedColors does', () => {
  assert.equal(contrasting('#EEEEEE', '#FFFFFF'), '#000000');
  assert.equal(contrasting('#111111', '#101010'), '#FFFFFF');
  assert.equal(contrasting('#252930', '#FAFBFC'), '#252930');
  const document = decodeDocument(mutate((d) => {
    d.skin.variants.light.colors.text = '#FEFEFE';
    d.skin.variants.light.colors.accent = '#FFEE00';
    d.skin.variants.light.colors.accentText = '#FFFFFF';
  }));
  assert.equal(document.skin.variants.light.colors.text, '#000000');
  assert.equal(document.skin.variants.light.colors.accentText, '#000000');
});

test('lower-case colours are written in upper case', () => {
  const document = decodeDocument(mutate((d) => { d.skin.variants.light.colors.panel = '#abcdef'; }));
  assert.equal(document.skin.variants.light.colors.panel, '#ABCDEF');
});

test('identities move together and the name is trimmed', () => {
  const document = decodeDocument(mutate((d) => { d.name = '  新名字 '; d.skin.name = 'x'; d.candidateBar.name = 'y'; }));
  assert.equal(document.name, '新名字');
  assert.equal(document.skin.name, '新名字');
  assert.equal(document.candidateBar.name, '新名字');
  const edited = { ...document, id: 'moved' };
  assert.equal(JSON.parse(encodeDocument({ ...edited, skin: { ...edited.skin, id: 'moved' }, candidateBar: { ...edited.candidateBar, id: 'moved' } })).skin.id, 'moved');
});

test('background shapes decode and encode', () => {
  const solid = decodeDocument(mutate((d) => { d.skin.variants.light.background = { type: 'solid', color: '#112233' }; }));
  assert.deepEqual(solid.skin.variants.light.background, { type: 'solid', color: '#112233' });
  const gradient = decodeDocument(mutate((d) => {
    d.skin.variants.dark.background = { type: 'linearGradient', from: '#000000', to: '#333333', direction: 'vertical' };
  }));
  assert.deepEqual(JSON.parse(encodeDocument(gradient)).skin.variants.dark.background, {
    type: 'linearGradient', from: '#000000', to: '#333333', direction: 'vertical',
  });
});

// Rejections -------------------------------------------------------------------------------

test('rejects unknown fields at every level', () => {
  rejects(() => decodeDocument(mutate((d) => { d.extra = 1; })), ErrorCode.UNKNOWN_FIELD, '$.extra');
  rejects(() => decodeDocument(mutate((d) => { d.skin.glow = 1; })), ErrorCode.UNKNOWN_FIELD, '$.skin.glow');
  rejects(() => decodeDocument(mutate((d) => { d.skin.keycap.depth = 1; })), ErrorCode.UNKNOWN_FIELD, '$.skin.keycap.depth');
  rejects(() => decodeDocument(mutate((d) => { d.skin.variants.light.colors.hover = '#000000'; })), ErrorCode.UNKNOWN_FIELD, '$.skin.variants.light.colors.hover');
  rejects(() => decodeDocument(mutate((d) => { d.candidateBar.expanded.rows = 1; })), ErrorCode.UNKNOWN_FIELD, '$.candidateBar.expanded.rows');
  rejects(() => decodeImported(JSON.stringify({ formatVersion: 1, id: 'a', name: 'A', typography: {}, bogus: 1 })), ErrorCode.UNKNOWN_FIELD, '$.bogus');
});

test('rejects other versions', () => {
  rejects(() => decodeDocument(mutate((d) => { d.formatVersion = 2; })), ErrorCode.UNSUPPORTED_VERSION, '$.formatVersion');
  rejects(() => decodeDocument(mutate((d) => { d.formatVersion = '1'; })), ErrorCode.UNSUPPORTED_VERSION, '$.formatVersion');
  rejects(() => decodeDocument(mutate((d) => { delete d.formatVersion; })), ErrorCode.UNSUPPORTED_VERSION, '$.formatVersion');
  rejects(() => decodeDocument(mutate((d) => { d.skin.formatVersion = 2; })), ErrorCode.UNSUPPORTED_VERSION, '$.skin.formatVersion');
  rejects(() => decodeDocument(mutate((d) => { d.candidateBar.formatVersion = 2; })), ErrorCode.UNSUPPORTED_VERSION, '$.candidateBar.formatVersion');
});

test('rejects bad colours', () => {
  for (const bad of ['red', '#FFF', '#GGGGGG', 'FFFFFF', '#FFFFFFFF', '#+FFFFF', 12]) {
    rejects(() => decodeDocument(mutate((d) => { d.skin.variants.light.colors.key = bad; })), ErrorCode.INVALID_VALUE, '$.skin.variants.light.colors.key');
  }
  rejects(() => decodeDocument(mutate((d) => { d.skin.variants.dark.background = { type: 'solid', color: 'nope' }; })), ErrorCode.INVALID_VALUE, '$.skin.variants.dark.background.color');
});

test('rejects bad backgrounds', () => {
  const bad = (background) => rejects(
    () => decodeDocument(mutate((d) => { d.skin.variants.light.background = background; })), ErrorCode.INVALID_VALUE);
  bad({ type: 'solid' });
  bad({ type: 'solid', color: '#000000', from: '#000000' });
  bad({ type: 'linearGradient', from: '#000000', to: '#111111', direction: 'horizontal' });
  bad({ type: 'linearGradient', from: '#000000', to: '#111111' });
  bad({ type: 'linearGradient', from: '#000000', to: '#111111', direction: 'vertical', color: '#000000' });
  bad({ type: 'radial', color: '#000000' });
});

test('rejects out-of-range numbers and bad enums', () => {
  const cases = [
    ['skin.typography.keySize', 29], ['skin.typography.keySize', 15.9], ['skin.typography.secondarySize', 9],
    ['skin.typography.candidateSize', 31], ['skin.keycap.cornerRadius', 17], ['skin.keycap.borderWidth', 2.5],
    ['skin.keycap.borderWidth', -1], ['skin.spacing.visualInsetX', 7], ['skin.spacing.visualInsetY', -0.5],
    ['candidateBar.collapsed.height', 35], ['candidateBar.collapsed.height', 57],
    ['candidateBar.collapsed.cellPaddingX', 3], ['candidateBar.collapsed.cellSpacing', 17],
    ['candidateBar.expanded.columns', 5], ['candidateBar.expanded.columns', 2.5], ['candidateBar.expanded.fullRowTextLength', 0],
    ['candidateBar.expanded.rowSpacing', 17], ['candidateBar.expanded.columnSpacing', -1],
    ['skin.typography.family', 'comic'], ['skin.typography.weight', 'bold'], ['skin.keycap.shadow', 'deep'],
    ['candidateBar.expanded.mode', 'cloud'], ['candidateBar.controls.pagePosition', 'center'],
    ['candidateBar.compositionRow.visible', 'always'], ['candidateBar.controls.showsExpand', 'yes'],
    ['skin.typography.keySize', '22'],
  ];
  for (const [path, value] of cases) {
    const keys = path.split('.');
    rejects(() => decodeDocument(mutate((d) => {
      let node = d;
      for (const key of keys.slice(0, -1)) node = node[key];
      node[keys.at(-1)] = value;
    })), ErrorCode.INVALID_VALUE, `$.${path}`);
  }
  rejects(() => decodeDocument(mutate((d) => { d.appearance = 'auto'; })), ErrorCode.INVALID_VALUE, '$.appearance');
  rejects(() => decodeDocument(mutate((d) => { d.author = 5; })), ErrorCode.INVALID_VALUE, '$.author');
});

test('accepts the range limits', () => {
  const document = decodeDocument(mutate((d) => {
    Object.assign(d.skin.typography, { keySize: 16, secondarySize: 16, candidateSize: 30 });
    Object.assign(d.skin.keycap, { cornerRadius: 16, borderWidth: 2 });
    Object.assign(d.skin.spacing, { visualInsetX: 6, visualInsetY: 0 });
    Object.assign(d.candidateBar.collapsed, { height: 56, cellPaddingX: 4, cellSpacing: 16 });
    Object.assign(d.candidateBar.expanded, { columns: 4, fullRowTextLength: 40 });
  }));
  assert.equal(document.skin.typography.keySize, 16);
});

test('rejects identity problems', () => {
  rejects(() => decodeDocument(mutate((d) => { d.skin.id = 'other'; })), ErrorCode.IDENTITY_MISMATCH, '$.skin.id');
  rejects(() => decodeDocument(mutate((d) => { d.candidateBar.id = 'other'; })), ErrorCode.IDENTITY_MISMATCH, '$.candidateBar.id');
  rejects(() => decodeDocument(mutate((d) => { d.id = 'bad id!'; d.skin.id = d.id; d.candidateBar.id = d.id; })), ErrorCode.INVALID_VALUE, '$.id');
  rejects(() => decodeDocument(mutate((d) => { d.id = ''; })), ErrorCode.INVALID_VALUE, '$.id');
  rejects(() => decodeDocument(mutate((d) => { d.name = '   '; })), ErrorCode.INVALID_VALUE, '$.name');
});

test('rejects structural problems', () => {
  rejects(() => decodeDocument('{nope'), ErrorCode.MALFORMED_JSON, '$');
  rejects(() => decodeDocument('[]'), ErrorCode.NOT_AN_OBJECT, '$');
  rejects(() => decodeDocument(mutate((d) => { delete d.skin; })), ErrorCode.INVALID_VALUE, '$.skin');
  rejects(() => decodeDocument(mutate((d) => { d.candidateBar = 3; })), ErrorCode.INVALID_VALUE, '$.candidateBar');
  rejects(() => decodeDocument(mutate((d) => { d.skin.keycap = 3; })), ErrorCode.INVALID_VALUE, '$.skin.keycap');
  rejects(() => decodeImported(JSON.stringify({ selectedSkinID: 'a', skin: {} })), ErrorCode.SNAPSHOT_NOT_IMPORTABLE, '$');
  rejects(() => decodeImported('{"hello": 1}'), ErrorCode.UNRECOGNIZED_DOCUMENT, '$');
});

test('enforces the size limits', () => {
  const padded = mutate((d) => { d.author = 'x'.repeat(MAX_DOCUMENT_BYTES); });
  rejects(() => decodeDocument(padded), ErrorCode.OVERSIZE, '$');
  rejects(() => decodeImported(padded), ErrorCode.OVERSIZE, '$');
  const document = decodeDocument(read('appearance-builtin-paper.songyanappearance.json'));
  document.author = '长'.repeat(100000);
  rejects(() => encodeDocument(document), ErrorCode.OVERSIZE, '$');
});

test('encode refuses an invalid or mismatched draft', () => {
  const document = systemDefaultDocument();
  document.skin.typography.keySize = 40;
  rejects(() => encodeDocument(document), ErrorCode.INVALID_VALUE, '$.skin.typography.keySize');
  const mixed = systemDefaultDocument();
  mixed.skin.id = 'else';
  rejects(() => encodeDocument(mixed), ErrorCode.IDENTITY_MISMATCH, '$.skin.id');
  rejects(() => readDocument({ ...systemDefaultDocument(), extra: true }), ErrorCode.UNKNOWN_FIELD, '$.extra');
});
