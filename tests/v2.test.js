import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  decodeDocument, decodeImported, encodeDocument, FormatError, ErrorCode, systemDefaultDocument,
  inspectImage, imageDataUri, resolvedColors, withAlpha, over, normalizeDocument, parseHexInput,
  MAX_IMAGE_BYTES, MAX_IMAGE_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES,
} from '../assets/js/format.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, 'ios-interop', name), 'utf8');
const paper = () => JSON.parse(read('appearance-builtin-paper.songyanappearance.json'));

// ---- tiny images built from bytes ------------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const u32 = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([u32(data.length), body, u32(crc(body))]);
};
/** A real, decodable greyscale PNG. */
function png(width, height) {
  const header = Buffer.concat([u32(width), u32(height), Buffer.from([8, 0, 0, 0, 0])]);
  const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(width, 128)])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** The leading bytes of a baseline JPEG: SOI, APP0, SOF0 with the size, EOI. Enough for a header check. */
function jpeg(width, height) {
  const sof = Buffer.from([0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]), sof, Buffer.from([0xff, 0xd9])]);
}
const le = (n, bytes) => Buffer.from(Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 255));
/** WebP files with a lossy (VP8), lossless (VP8L) or extended (VP8X) header. */
function webp(width, height, form = 'VP8L') {
  let payload;
  if (form === 'VP8 ') payload = Buffer.concat([Buffer.from([0x10, 0, 0, 0x9d, 0x01, 0x2a]), le(width, 2), le(height, 2), Buffer.alloc(4)]);
  else if (form === 'VP8L') payload = Buffer.concat([Buffer.from([0x2f]), le((width - 1) | ((height - 1) << 14), 4), Buffer.alloc(4)]);
  else payload = Buffer.concat([Buffer.alloc(4), le(width - 1, 3), le(height - 1, 3)]);
  const body = Buffer.concat([Buffer.from(form, 'latin1'), le(payload.length, 4), payload]);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), le(body.length + 4, 4), Buffer.from('WEBP', 'latin1'), body]);
}
const uri = (mime, bytes) => imageDataUri(mime, bytes);

const withBackground = (background, change) => {
  const document = paper();
  document.skin.variants.light.background = background;
  document.formatVersion = 2;
  document.skin.formatVersion = 2;
  document.candidateBar.formatVersion = 2;
  change?.(document);
  return JSON.stringify(document);
};
const imageBackground = (image, align = 'center') => ({ type: 'image', image, align });

const rejects = (fn, code, path, reason) => {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof FormatError, String(error));
    assert.equal(error.code, code, error.message);
    if (path) assert.equal(error.path, path, error.message);
    if (reason) assert.equal(error.reason, reason, error.message);
    return true;
  });
};
const BG = '$.skin.variants.light.background';

// ---- version selection and v1 byte identity --------------------------------------------------
test('files without a version 2 feature are written as version 1, byte for byte', () => {
  const dir = join(here, 'ios-interop');
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.songyanappearance.json'))) {
    const text = read(name);
    assert.equal(encodeDocument(decodeDocument(text)), text, name);
    assert.equal(JSON.parse(text).formatVersion, 1);
  }
  const fixtures = join(here, '..', 'fixtures');
  for (const name of readdirSync(fixtures)) {
    const text = readFileSync(join(fixtures, name), 'utf8');
    assert.equal(JSON.parse(encodeDocument(decodeDocument(text))).formatVersion, 1, name);
    assert.equal(encodeDocument(decodeDocument(text)), text, name);
  }
});

test('a vertical two-colour gradient stays version 1, even when written the version 2 way', () => {
  const v2 = withBackground({ type: 'linearGradient', colors: ['#112233', '#445566'], direction: 'vertical' });
  const out = JSON.parse(encodeDocument(decodeDocument(v2)));
  assert.equal(out.formatVersion, 1);
  assert.equal(out.skin.formatVersion, 1);
  assert.equal(out.candidateBar.formatVersion, 1);
  assert.deepEqual(out.skin.variants.light.background, { type: 'linearGradient', from: '#112233', to: '#445566', direction: 'vertical' });
});

test('every version 2 feature turns the document, skin and candidate bar into version 2', () => {
  const cases = {
    alpha: (d) => { d.skin.variants.dark.colors.key = '#11223380'; },
    solidAlpha: (d) => { d.skin.variants.light.background = { type: 'solid', color: '#11223380' }; },
    three: (d) => { d.skin.variants.light.background = { type: 'linearGradient', colors: ['#000000', '#111111', '#222222'], direction: 'vertical' }; },
    horizontal: (d) => { d.skin.variants.light.background = { type: 'linearGradient', colors: ['#000000', '#222222'], direction: 'horizontal' }; },
    diagonal: (d) => { d.skin.variants.light.background = { type: 'linearGradient', colors: ['#000000', '#222222'], direction: 'diagonal' }; },
    gradientAlpha: (d) => { d.skin.variants.light.background = { type: 'linearGradient', from: '#00000080', to: '#222222', direction: 'vertical' }; },
    image: (d) => { d.skin.variants.light.background = imageBackground(uri('image/png', png(2, 2))); },
  };
  for (const [name, change] of Object.entries(cases)) {
    const out = JSON.parse(encodeDocument(decodeDocument(withBackground({ type: 'solid', color: '#000000' }, change))));
    assert.deepEqual([out.formatVersion, out.skin.formatVersion, out.candidateBar.formatVersion], [2, 2, 2], name);
  }
});

test('an alpha of FF is the plain colour and keeps the file at version 1', () => {
  const text = withBackground({ type: 'solid', color: '#112233FF' }, (d) => { d.skin.variants.light.colors.key = '#ABCDEFff'; });
  const out = JSON.parse(encodeDocument(decodeDocument(text)));
  assert.equal(out.formatVersion, 1);
  assert.equal(out.skin.variants.light.colors.key, '#ABCDEF');
  assert.equal(out.skin.variants.light.background.color, '#112233');
});

test('version 2 documents round trip', () => {
  const text = withBackground({ type: 'linearGradient', colors: ['#000000', '#111111', '#222222', '#333333'], direction: 'diagonal' },
    (d) => { d.skin.variants.dark.colors.key = '#38393CCC'; });
  const first = decodeDocument(text);
  const encoded = encodeDocument(first);
  assert.deepEqual(decodeDocument(encoded), first);
  assert.equal(encodeDocument(decodeDocument(encoded)), encoded);
});

// ---- the version gate ------------------------------------------------------------------------
test('version 1 documents do not accept version 2 features', () => {
  const v1 = (change) => JSON.stringify((() => { const d = paper(); change(d); return d; })());
  rejects(() => decodeDocument(v1((d) => { d.skin.variants.light.colors.key = '#11223380'; })), ErrorCode.INVALID_VALUE, '$.skin.variants.light.colors.key', 'color');
  rejects(() => decodeDocument(v1((d) => { d.skin.variants.light.background = { type: 'linearGradient', colors: ['#000000', '#111111'], direction: 'vertical' }; })), ErrorCode.UNKNOWN_FIELD, `${BG}.colors`);
  rejects(() => decodeDocument(v1((d) => { d.skin.variants.light.background = imageBackground(uri('image/png', png(2, 2))); })), ErrorCode.UNKNOWN_FIELD, `${BG}.image`);
  rejects(() => decodeDocument(v1((d) => { d.skin.variants.light.background = { type: 'linearGradient', from: '#000000', to: '#111111', direction: 'horizontal' }; })), ErrorCode.INVALID_VALUE, `${BG}.direction`, 'enum');
});

test('parts of a document share its version', () => {
  const text = withBackground({ type: 'solid', color: '#000000' }, (d) => { d.candidateBar.formatVersion = 1; });
  rejects(() => decodeDocument(text), ErrorCode.UNSUPPORTED_VERSION, '$.candidateBar.formatVersion');
});

test('a standalone version 2 skin is wrapped into a version 2 document', () => {
  const skin = paper().skin;
  skin.formatVersion = 2;
  skin.variants.light.colors.key = '#FFFFFF99';
  const { document, kind } = decodeImported(JSON.stringify(skin));
  assert.equal(kind, 'skin');
  assert.equal(document.formatVersion, 2);
  assert.equal(document.candidateBar.formatVersion, 2);
  assert.equal(document.skin.variants.light.colors.key, '#FFFFFF99');
});

// ---- gradients -------------------------------------------------------------------------------
test('gradients take 2 to 4 colours and a known direction', () => {
  const grad = (colors, direction = 'vertical') => withBackground({ type: 'linearGradient', colors, direction });
  for (const n of [2, 3, 4]) {
    const colors = Array.from({ length: n }, (_, i) => `#0${i}0000`);
    assert.doesNotThrow(() => decodeDocument(grad(colors, 'horizontal')));
  }
  rejects(() => decodeDocument(grad(['#000000'])), ErrorCode.INVALID_VALUE, `${BG}.colors`, 'range');
  rejects(() => decodeDocument(grad(['#000000', '#111111', '#222222', '#333333', '#444444'])), ErrorCode.INVALID_VALUE, `${BG}.colors`, 'range');
  rejects(() => decodeDocument(grad(['#000000', 'red'])), ErrorCode.INVALID_VALUE, `${BG}.colors.1`, 'color');
  rejects(() => decodeDocument(grad(['#000000', '#111111'], 'sideways')), ErrorCode.INVALID_VALUE, `${BG}.direction`, 'enum');
  rejects(() => decodeDocument(withBackground({ type: 'linearGradient', colors: '#000000', direction: 'vertical' })), ErrorCode.INVALID_VALUE, `${BG}.colors`, 'type');
  rejects(() => decodeDocument(withBackground({ type: 'linearGradient', colors: ['#000000', '#111111'] })), ErrorCode.INVALID_VALUE, `${BG}.direction`, 'enum');
  rejects(() => decodeDocument(withBackground({ type: 'linearGradient', colors: ['#000000', '#111111'], from: '#000000', direction: 'vertical' })), ErrorCode.INVALID_VALUE, BG, 'background');
  rejects(() => decodeDocument(withBackground({ type: 'linearGradient', from: '#000000', to: '#111111', direction: 'diagonal' })), ErrorCode.INVALID_VALUE, `${BG}.direction`, 'enum');
});

// ---- images ----------------------------------------------------------------------------------
test('PNG, JPEG and WebP images are accepted and keep their bytes', () => {
  const samples = [
    ['image/png', png(3, 5), 3, 5],
    ['image/jpeg', jpeg(640, 480), 640, 480],
    ['image/webp', webp(1600, 1200, 'VP8L'), 1600, 1200],
    ['image/webp', webp(4096, 2, 'VP8 '), 4096, 2],
    ['image/webp', webp(400, 4096, 'VP8X'), 400, 4096],
  ];
  for (const [mime, bytes, width, height] of samples) {
    const image = uri(mime, bytes);
    const info = inspectImage(image);
    assert.deepEqual([info.mime, info.width, info.height], [mime, width, height]);
    const out = JSON.parse(encodeDocument(decodeDocument(withBackground(imageBackground(image, 'bottom')))));
    assert.deepEqual(out.skin.variants.light.background, { type: 'image', image, align: 'bottom' });
    assert.equal(out.formatVersion, 2);
  }
});

test('image checks go by magic bytes, not the MIME prefix', () => {
  const bad = (image, reason = 'image') => rejects(() => decodeDocument(withBackground(imageBackground(image))), ErrorCode.INVALID_VALUE, `${BG}.image`, reason);
  bad(uri('image/webp', png(2, 2)));
  bad(uri('image/png', jpeg(2, 2)));
  bad(uri('image/jpeg', webp(2, 2)));
  bad(uri('image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')));
  bad(uri('image/png', Buffer.alloc(0)));
  bad('data:image/gif;base64,R0lGODlhAQABAAAAACw=');
  bad('data:image/svg+xml;base64,PHN2Zy8+');
  bad('data:image/png,abc');
  bad('https://example.com/a.png');
  bad(`data:image/png;base64,${png(2, 2).toString('base64')}!`);
  bad(`data:image/png;base64,${png(2, 2).toString('base64').slice(0, -1)}`);
  bad(uri('image/png', png(2, 2).subarray(0, 20)));
  bad(uri('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9])));
  bad(uri('image/webp', Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPJUNK', 'latin1'), Buffer.alloc(20)])));
  rejects(() => decodeDocument(withBackground({ type: 'image', image: 5, align: 'center' })), ErrorCode.INVALID_VALUE, `${BG}.image`, 'type');
});

test('image size limits: 1.5 MiB decoded, 4096 pixels per side', () => {
  const pixels = (mime, bytes) => rejects(() => decodeDocument(withBackground(imageBackground(uri(mime, bytes)))), ErrorCode.INVALID_VALUE, `${BG}.image`, 'imagePixels');
  pixels('image/webp', webp(4097, 10));
  pixels('image/webp', webp(10, 4097, 'VP8X'));
  pixels('image/jpeg', jpeg(5000, 10));
  pixels('image/png', png(4097, 1));
  rejects(() => decodeDocument(withBackground(imageBackground(uri('image/jpeg', jpeg(10, 10))), (d) => { d.skin.variants.light.background.image = d.skin.variants.light.background.image.replace('image/jpeg', 'image/png'); })), ErrorCode.INVALID_VALUE, `${BG}.image`, 'image');
  // Exactly the limit passes the image check; one byte more does not.
  const pad = (total) => Buffer.concat([webp(8, 8), Buffer.alloc(total - webp(8, 8).length)]);
  assert.doesNotThrow(() => inspectImage(uri('image/webp', pad(MAX_IMAGE_BYTES))));
  assert.throws(() => inspectImage(uri('image/webp', pad(MAX_IMAGE_BYTES + 1))), (e) => e.reason === 'imageSize');
});

test('align is required and one of top, center, bottom', () => {
  const image = uri('image/png', png(2, 2));
  for (const align of ['top', 'center', 'bottom']) assert.doesNotThrow(() => decodeDocument(withBackground(imageBackground(image, align))));
  rejects(() => decodeDocument(withBackground(imageBackground(image, 'middle'))), ErrorCode.INVALID_VALUE, `${BG}.align`, 'enum');
  rejects(() => decodeDocument(withBackground({ type: 'image', image })), ErrorCode.INVALID_VALUE, `${BG}.align`, 'type');
  rejects(() => decodeDocument(withBackground({ type: 'image', image, align: 'top', color: '#000000' })), ErrorCode.INVALID_VALUE, BG, 'background');
  rejects(() => decodeDocument(withBackground({ type: 'image', image, align: 'top', extra: 1 })), ErrorCode.UNKNOWN_FIELD, `${BG}.extra`);
  rejects(() => decodeDocument(withBackground({ type: 'solid', color: '#000000', align: 'top' })), ErrorCode.INVALID_VALUE, BG, 'background');
});

test('a document with an image may be up to 2 MiB; without one the 256 KiB limit stands', () => {
  // A valid image padded to about 900 KiB, used in both modes: ~2.4 MB of JSON would be over, ~1.9 MB is not.
  const pad = (bytes) => Buffer.concat([webp(8, 8), Buffer.alloc(bytes - webp(8, 8).length)]);
  const document = JSON.parse(withBackground(imageBackground(uri('image/webp', pad(700 * 1024)))));
  document.skin.variants.dark.background = document.skin.variants.light.background;
  const text = encodeDocument(decodeDocument(JSON.stringify(document)));
  assert.ok(text.length > MAX_DOCUMENT_BYTES && text.length < MAX_IMAGE_DOCUMENT_BYTES, String(text.length));
  assert.doesNotThrow(() => decodeDocument(text));
  const big = JSON.parse(withBackground(imageBackground(uri('image/webp', pad(1100 * 1024)))));
  big.skin.variants.dark.background = big.skin.variants.light.background;
  rejects(() => encodeDocument(decodeDocument(JSON.stringify(big))), ErrorCode.OVERSIZE, '$');
  // No image: a long author pushes a document past 256 KiB and is refused, as in version 1.
  const long = paper();
  long.author = 'x'.repeat(MAX_DOCUMENT_BYTES);
  rejects(() => decodeDocument(JSON.stringify(long)), ErrorCode.OVERSIZE, '$');
  rejects(() => decodeImported(JSON.stringify(long)), ErrorCode.OVERSIZE, '$');
});

// ---- colours with alpha ----------------------------------------------------------------------
test('alpha helpers', () => {
  assert.equal(withAlpha('#112233', 1), '#112233');
  assert.equal(withAlpha('#112233', 0.5), '#11223380');
  assert.equal(withAlpha('#112233CC', 1), '#112233');
  assert.equal(over('#FFFFFF80', '#000000'), '#808080');
  assert.equal(over('#123456', '#000000'), '#123456');
  assert.equal(parseHexInput('#11223380'), '#11223380');
});

test('text stays readable against a translucent key laid over the panel', () => {
  const doc = decodeDocument(withBackground({ type: 'solid', color: '#000000' }, (d) => {
    const light = d.skin.variants.light.colors;
    light.panel = '#000000';
    light.key = '#FFFFFF1A'; // nearly clear, so the key looks black
    light.text = '#1A1A1A';
  }));
  assert.equal(resolvedColors(doc.skin, 'light').text, '#FFFFFF');
  doc.skin.variants.light.colors.key = '#FFFFFF';
  assert.equal(resolvedColors(doc.skin, 'light').text, '#000000');
});

test('translucent colours survive normalisation and opaque documents are unchanged', () => {
  const doc = decodeDocument(withBackground({ type: 'solid', color: '#000000' }, (d) => { d.skin.variants.dark.colors.control = '#55565aaa'; }));
  assert.equal(doc.skin.variants.dark.colors.control, '#55565AAA'.toUpperCase());
  const plain = normalizeDocument(systemDefaultDocument());
  assert.equal(plain.formatVersion, 1);
});
