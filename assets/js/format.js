// Songyan appearance file codec, format versions 1 and 2. No DOM, no network.
//
// It mirrors the Android (`AppearanceDocument`, `SkinDefinition`, `CandidateBarDefinition`) and iOS
// (`AppearanceKit`, `SkinKit`, `CandidateKit`) readers: strict unknown-field and version checks,
// the same ranges and enums, the same size limits, and the same normalisation on export.
//
// Everything about a field lives in one table (FIELDS). The reader, the writer and the editor UI all
// walk that table, so a later format version adds rows instead of new code.

export const FORMAT_VERSION = 1;
export const FORMAT_VERSION_2 = 2;
export const SUPPORTED_VERSIONS = [1, 2];
export const FILE_EXTENSION = '.songyanappearance.json';
export const SYSTEM_DEFAULT_ID = 'system-default';
export const MAX_DOCUMENT_BYTES = 256 * 1024;
export const MAX_PART_BYTES = 128 * 1024;
export const MAX_IMAGE_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 1024 * 1024;
export const MAX_IMAGE_PIXELS = 4096;

export const COLOR_NAMES = [
  'panel', 'key', 'control', 'accent', 'text', 'secondaryText', 'accentText', 'pressed', 'selected', 'border',
];
export const MODES = ['light', 'dark'];
export const APPEARANCES = ['system', 'light', 'dark'];
export const BACKGROUND_TYPES = ['solid', 'linearGradient', 'image'];
export const GRADIENT_DIRECTIONS = ['vertical', 'horizontal', 'diagonal'];
export const IMAGE_ALIGNS = ['top', 'center', 'bottom'];
export const GRADIENT_MIN_COLORS = 2;
export const GRADIENT_MAX_COLORS = 4;

const ID_PATTERN = /^[0-9A-Za-z_-]+$/;
const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const HEX_ALPHA_PATTERN = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

// ---------------------------------------------------------------------------------------------
// Errors

export const ErrorCode = Object.freeze({
  MALFORMED_JSON: 'MALFORMED_JSON',
  NOT_AN_OBJECT: 'NOT_AN_OBJECT',
  OVERSIZE: 'OVERSIZE',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  INVALID_VALUE: 'INVALID_VALUE',
  IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
  SNAPSHOT_NOT_IMPORTABLE: 'SNAPSHOT_NOT_IMPORTABLE',
  UNRECOGNIZED_DOCUMENT: 'UNRECOGNIZED_DOCUMENT',
});

/** `reason` refines INVALID_VALUE: type, range, enum, color, id, name, background, object. */
export class FormatError extends Error {
  constructor(code, path, reason = null) {
    super(`${code} at ${path}${reason ? ` (${reason})` : ''}`);
    this.name = 'FormatError';
    this.code = code;
    this.path = path;
    this.reason = reason;
  }
}

const invalid = (path, reason) => new FormatError(ErrorCode.INVALID_VALUE, path, reason);

// ---------------------------------------------------------------------------------------------
// Field table
//
// type: string | id | name | number | int | bool | enum | color | background
// `optional` fields are omitted from the output when unset; the others take `default` when missing.

const colorRows = (mode) =>
  COLOR_NAMES.map((role) => ({
    path: `variants.${mode}.colors.${role}`,
    type: 'color',
    optional: true,
    section: 'colors',
    role,
    mode,
  }));

const SKIN_FIELDS = [
  { path: 'id', type: 'id' },
  { path: 'name', type: 'name' },
  { path: 'author', type: 'string', optional: true },
  ...MODES.flatMap(colorRows),
  ...MODES.map((mode) => ({
    path: `variants.${mode}.background`, type: 'background', optional: true, section: 'background', mode,
  })),
  { path: 'typography.family', type: 'enum', values: ['system', 'rounded', 'serif', 'monospaced'], default: 'system', section: 'typography' },
  { path: 'typography.weight', type: 'enum', values: ['regular', 'medium', 'semibold'], default: 'medium', section: 'typography' },
  { path: 'typography.keySize', type: 'number', min: 16, max: 28, step: 1, default: 22, section: 'typography' },
  { path: 'typography.secondarySize', type: 'number', min: 10, max: 16, step: 1, default: 11, section: 'typography' },
  { path: 'typography.candidateSize', type: 'number', min: 16, max: 30, step: 1, default: 20, section: 'typography' },
  { path: 'keycap.cornerRadius', type: 'number', min: 0, max: 16, step: 0.5, default: 6, section: 'keycap' },
  { path: 'keycap.borderWidth', type: 'number', min: 0, max: 2, step: 0.5, default: 0, section: 'keycap' },
  { path: 'keycap.shadow', type: 'enum', values: ['none', 'subtle'], default: 'subtle', section: 'keycap' },
  { path: 'spacing.visualInsetX', type: 'number', min: 0, max: 6, step: 0.5, default: 2, section: 'keycap' },
  { path: 'spacing.visualInsetY', type: 'number', min: 0, max: 6, step: 0.5, default: 2, section: 'keycap' },
];

const BAR_FIELDS = [
  { path: 'id', type: 'id' },
  { path: 'name', type: 'name' },
  { path: 'author', type: 'string', optional: true },
  { path: 'compositionRow.visible', type: 'enum', values: ['composingOnly', 'composingWithIdleRaw', 'hidden'], default: 'composingOnly', section: 'candidate' },
  { path: 'collapsed.height', type: 'number', min: 36, max: 56, step: 1, default: 44, section: 'candidate' },
  { path: 'collapsed.cellPaddingX', type: 'number', min: 4, max: 24, step: 1, default: 12, section: 'candidate' },
  { path: 'collapsed.cellSpacing', type: 'number', min: 0, max: 16, step: 1, default: 4, section: 'candidate' },
  { path: 'collapsed.fillsAvailableWidth', type: 'bool', optional: true, section: 'candidate' },
  { path: 'expanded.mode', type: 'enum', values: ['adaptive', 'list', 'grid'], default: 'adaptive', section: 'candidate' },
  { path: 'expanded.columns', type: 'int', min: 1, max: 4, step: 1, default: 2, section: 'candidate' },
  { path: 'expanded.rowSpacing', type: 'number', min: 0, max: 16, step: 1, default: 4, section: 'candidate' },
  { path: 'expanded.columnSpacing', type: 'number', min: 0, max: 16, step: 1, default: 4, section: 'candidate' },
  { path: 'expanded.fullRowTextLength', type: 'int', min: 1, max: 40, step: 1, default: 8, section: 'candidate' },
  { path: 'controls.pagePosition', type: 'enum', values: ['both', 'trailing', 'leading'], default: 'both', section: 'candidate' },
  { path: 'controls.showsExpand', type: 'bool', default: true, section: 'candidate' },
];

const DOCUMENT_FIELDS = [
  { path: 'id', type: 'id', section: 'basic' },
  { path: 'name', type: 'name', section: 'basic' },
  { path: 'author', type: 'string', optional: true, section: 'basic' },
  { path: 'appearance', type: 'enum', values: APPEARANCES, default: 'system', section: 'basic' },
];

const prefixed = (prefix, rows) =>
  rows.map((row) => ({ ...row, path: `${prefix}.${row.path}`, relative: row.path }));

/** Every field of an appearance document, in editor order. Skin and bar rows keep their relative path. */
export const FIELDS = [
  ...DOCUMENT_FIELDS,
  ...prefixed('skin', SKIN_FIELDS.filter((row) => !['id', 'name', 'author'].includes(row.path))),
  ...prefixed('candidateBar', BAR_FIELDS.filter((row) => !['id', 'name', 'author'].includes(row.path))),
];

export const fieldByPath = (path) => FIELDS.find((row) => row.path === path);

// ---------------------------------------------------------------------------------------------
// Small helpers

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const byteLength = (text) => new TextEncoder().encode(text).length;
const clone = (value) => JSON.parse(JSON.stringify(value));

export function getPath(object, path) {
  let node = object;
  for (const key of path.split('.')) {
    if (!isObject(node) || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

export function setPath(object, path, value) {
  const keys = path.split('.');
  let node = object;
  for (const key of keys.slice(0, -1)) {
    if (!isObject(node[key])) node[key] = {};
    node = node[key];
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete node[last];
  else node[last] = value;
}

/** The tree of keys a part may carry, built from its field rows. Background rows are leaves. */
function allowedTree(rows, extra) {
  const tree = {};
  for (const key of extra) tree[key] = null;
  for (const row of rows) {
    const keys = row.path.split('.');
    let node = tree;
    keys.forEach((key, index) => {
      if (index === keys.length - 1) node[key] = null;
      else node = node[key] ??= {};
    });
  }
  return tree;
}

function rejectUnknown(value, tree, path) {
  if (!isObject(value) || tree === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (!(key in tree)) throw new FormatError(ErrorCode.UNKNOWN_FIELD, `${path}.${key}`);
    rejectUnknown(child, tree[key], `${path}.${key}`);
  }
}

const BASE_KEYS = ['formatVersion'];
const SKIN_TREE = allowedTree(SKIN_FIELDS, BASE_KEYS);
const BAR_TREE = allowedTree(BAR_FIELDS, BASE_KEYS);
const DOCUMENT_TREE = allowedTree([], [...BASE_KEYS, 'id', 'name', 'author', 'appearance', 'skin', 'candidateBar']);

/** The version must be the number 1 or 2; "1" as a string or 1.5 does not count. Returns it. */
function requireVersion(source, path) {
  const version = source.formatVersion;
  if (typeof version !== 'number' || !SUPPORTED_VERSIONS.includes(version)) {
    throw new FormatError(ErrorCode.UNSUPPORTED_VERSION, `${path}.formatVersion`);
  }
  return version;
}

export const isHexColor = (value) => typeof value === 'string' && HEX_PATTERN.test(value);
/** `#RRGGBB` or, from version 2 on, `#RRGGBBAA`. */
export const isHexColorAlpha = (value) => typeof value === 'string' && HEX_ALPHA_PATTERN.test(value);

/** Validates one value against its field row and returns it, or throws with the row's path. */
function checkValue(row, value, path, version) {
  switch (row.type) {
    case 'string':
      if (typeof value !== 'string') throw invalid(path, 'type');
      return value;
    case 'id':
      if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw invalid(path, 'id');
      return value;
    case 'name':
      if (typeof value !== 'string' || value.trim() === '') throw invalid(path, 'name');
      return value;
    case 'number':
    case 'int':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(path, 'type');
      if (row.type === 'int' && !Number.isInteger(value)) throw invalid(path, 'type');
      if (value < row.min || value > row.max) throw invalid(path, 'range');
      return value;
    case 'bool':
      if (typeof value !== 'boolean') throw invalid(path, 'type');
      return value;
    case 'enum':
      if (typeof value !== 'string') throw invalid(path, 'type');
      if (!row.values.includes(value)) throw invalid(path, 'enum');
      return value;
    case 'color':
      if (typeof value !== 'string') throw invalid(path, 'type');
      if (!(version >= 2 ? isHexColorAlpha(value) : isHexColor(value))) throw invalid(path, 'color');
      return value;
    case 'background':
      return checkBackground(value, path, version);
    default:
      throw new Error(`unknown field type ${row.type}`);
  }
}

/**
 * Version 1: a solid colour or a vertical two-stop gradient (`from`, `to`). Version 2 adds alpha colours,
 * gradients with `colors` (2 to 4 stops) and any direction, and images. Exactly one shape is populated.
 */
function checkBackground(value, path, version) {
  if (!isObject(value)) throw invalid(path, 'object');
  const v2 = version >= 2;
  const allowed = ['type', 'color', 'from', 'to', 'direction', ...(v2 ? ['colors', 'image', 'align'] : [])];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new FormatError(ErrorCode.UNKNOWN_FIELD, `${path}.${key}`);
  }
  const present = (key) => value[key] !== undefined && value[key] !== null;
  const isColor = v2 ? isHexColorAlpha : isHexColor;
  const color = (key) => {
    if (!present(key) || !isColor(value[key])) throw invalid(`${path}.${key}`, 'color');
  };
  const none = (...keys) => { for (const key of keys) if (present(key)) throw invalid(path, 'background'); };
  const type = value.type ?? 'solid';
  if (type === 'solid') {
    color('color');
    none('from', 'to', 'direction', 'colors', 'image', 'align');
    return { type: 'solid', color: value.color };
  }
  if (type === 'linearGradient') {
    none('color', 'image', 'align');
    if (v2 && present('colors')) {
      none('from', 'to');
      const { colors } = value;
      if (!Array.isArray(colors)) throw invalid(`${path}.colors`, 'type');
      if (colors.length < GRADIENT_MIN_COLORS || colors.length > GRADIENT_MAX_COLORS) throw invalid(`${path}.colors`, 'range');
      colors.forEach((stop, index) => {
        if (!isColor(stop)) throw invalid(`${path}.colors.${index}`, 'color');
      });
      if (!GRADIENT_DIRECTIONS.includes(value.direction)) throw invalid(`${path}.direction`, 'enum');
      return { type: 'linearGradient', colors: [...colors], direction: value.direction };
    }
    color('from');
    color('to');
    if (value.direction !== 'vertical') throw invalid(`${path}.direction`, 'enum');
    return { type: 'linearGradient', from: value.from, to: value.to, direction: 'vertical' };
  }
  if (type === 'image' && v2) {
    none('color', 'from', 'to', 'direction', 'colors');
    if (typeof value.image !== 'string') throw invalid(`${path}.image`, 'type');
    inspectImage(value.image, `${path}.image`);
    if (typeof value.align !== 'string') throw invalid(`${path}.align`, 'type');
    if (!IMAGE_ALIGNS.includes(value.align)) throw invalid(`${path}.align`, 'enum');
    return { type: 'image', image: value.image, align: value.align };
  }
  throw invalid(`${path}.type`, 'enum');
}

// ---------------------------------------------------------------------------------------------
// Images: `data:image/<webp|jpeg|png>;base64,…`, checked by magic bytes and header size.

const IMAGE_MIMES = { webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' };
const DATA_PREFIX = /^data:image\/(webp|jpeg|png);base64,/;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));

/** The kind of image the leading bytes say it is, or null. */
export function sniffImage(b) {
  if (b.length >= 8 && u32be(b, 0) === 0x89504e47 && u32be(b, 4) === 0x0d0a1a0a) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  return null;
}

/** Whether the file runs to its own end: PNG chunks reach IEND exactly, JPEG ends with EOI, WebP's RIFF size matches. */
export function isComplete(kind, b) {
  if (kind === 'png') {
    let i = 8;
    while (i + 12 <= b.length) {
      const length = u32be(b, i);
      const end = i + 12 + length;
      if (end > b.length) return false;
      if (ascii(b, i + 4, 4) === 'IEND') return end === b.length;
      i = end;
    }
    return false;
  }
  if (kind === 'jpeg') return b.length >= 4 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
  if (kind === 'webp') return b.length >= 12 && ((b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0) + 8 === b.length;
  return false;
}

/** Pixel size read from the file header, or null when the header is truncated or malformed. */
export function imageSize(kind, b) {
  if (kind === 'png') {
    if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
    return { width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (kind === 'jpeg') {
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (i + 9 > b.length) return null;
        return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
      }
      i += 2 + u16be(b, i + 2);
    }
    return null;
  }
  if (kind === 'webp') {
    if (b.length < 25) return null;
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8 ') {
      if (b.length < 30) return null;
      if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
      return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      if (b[20] !== 0x2f) return null;
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X' && b.length >= 30) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

/**
 * Checks a background image data URI and returns `{ kind, mime, bytes, width, height }`. Throws INVALID_VALUE
 * with reason `image` (not a data URI of a supported type, bad base64, magic bytes disagree with the declared
 * type, header unreadable), `imageSize` (decoded bytes over 1 MiB) or `imagePixels` (a side over 4096).
 */
export function inspectImage(uri, path = '$') {
  const prefix = DATA_PREFIX.exec(uri);
  if (!prefix) throw invalid(path, 'image');
  const body = uri.slice(prefix[0].length);
  if (body.length === 0 || body.length % 4 !== 0 || !BASE64_BODY.test(body)) throw invalid(path, 'image');
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  if ((body.length / 4) * 3 - padding > MAX_IMAGE_BYTES) throw invalid(path, 'imageSize');
  let bytes;
  try {
    const binary = atob(body);
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw invalid(path, 'image');
  }
  const kind = sniffImage(bytes);
  if (kind === null || kind !== prefix[1]) throw invalid(path, 'image');
  if (!isComplete(kind, bytes)) throw invalid(path, 'image');
  const size = imageSize(kind, bytes);
  if (!size || size.width < 1 || size.height < 1) throw invalid(path, 'image');
  if (size.width > MAX_IMAGE_PIXELS || size.height > MAX_IMAGE_PIXELS) throw invalid(path, 'imagePixels');
  return { kind, mime: IMAGE_MIMES[kind], bytes, ...size };
}

/** Builds `data:` text from encoded image bytes. */
export function imageDataUri(mime, bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * Reads one part (document header, skin or candidate bar): checks every present field, fills the
 * defaults of the omitted ones and leaves optional fields out.
 */
function readRows(source, rows, path, kind, version) {
  const result = {};
  for (const row of rows) {
    const keys = row.path.split('.');
    // Every ancestor of a present value must itself be an object.
    let node = source;
    let missing = false;
    for (let index = 0; index < keys.length - 1; index += 1) {
      const next = node[keys[index]];
      if (next === undefined || next === null) { missing = true; break; }
      if (!isObject(next)) throw invalid(`${path}.${keys.slice(0, index + 1).join('.')}`, 'object');
      node = next;
    }
    let value = missing ? undefined : node[keys[keys.length - 1]];
    if (value === null) value = undefined; // an explicit null means "not set" in both apps
    const rowPath = `${path}.${row.path}`;
    if (value === undefined) {
      if (row.default !== undefined) setPath(result, row.path, row.default);
      else if (!row.optional) throw invalid(rowPath, ['name', 'id'].includes(row.type) ? row.type : 'type');
      continue;
    }
    setPath(result, row.path, checkValue(row, value, rowPath, version));
  }
  // Skin and bar identity fields, when read as a part.
  if (kind) result.formatVersion = version;
  return result;
}

function readPart(source, rows, tree, path) {
  if (!isObject(source)) throw invalid(path, 'object');
  rejectUnknown(source, tree, path);
  const version = requireVersion(source, path);
  return readRows(source, rows, path, true, version);
}

// ---------------------------------------------------------------------------------------------
// Public object-level readers (also used to validate editor state)

export function readSkin(source, path = '$') {
  const skin = readPart(source, SKIN_FIELDS, SKIN_TREE, path);
  return withVariants(skin);
}

export function readCandidateBar(source, path = '$') {
  return readPart(source, BAR_FIELDS, BAR_TREE, path);
}

function withVariants(skin) {
  skin.variants ??= {};
  return skin;
}

/** Validates and completes a document object. Does not normalise colours. */
export function readDocument(source, path = '$') {
  if (!isObject(source)) throw invalid(path, 'object');
  rejectUnknown(source, DOCUMENT_TREE, path);
  const version = requireVersion(source, path);
  if (typeof source.id !== 'string' || source.id === '') throw invalid(`${path}.id`, 'id');
  if (typeof source.name !== 'string' || source.name.trim() === '') throw invalid(`${path}.name`, 'name');
  if (!isObject(source.skin)) throw invalid(`${path}.skin`, 'object');
  if (!isObject(source.candidateBar)) throw invalid(`${path}.candidateBar`, 'object');
  const head = readRows(source, DOCUMENT_FIELDS, path, false, version);
  const skin = readSkin(source.skin, `${path}.skin`);
  const candidateBar = readCandidateBar(source.candidateBar, `${path}.candidateBar`);
  // A version 2 document may hold version 1 parts; a version 1 document may not hold a version 2 part.
  if (skin.formatVersion > version) throw new FormatError(ErrorCode.UNSUPPORTED_VERSION, `${path}.skin.formatVersion`);
  if (candidateBar.formatVersion > version) throw new FormatError(ErrorCode.UNSUPPORTED_VERSION, `${path}.candidateBar.formatVersion`);
  if (skin.id !== head.id) throw new FormatError(ErrorCode.IDENTITY_MISMATCH, `${path}.skin.id`);
  if (candidateBar.id !== head.id) throw new FormatError(ErrorCode.IDENTITY_MISMATCH, `${path}.candidateBar.id`);
  return { formatVersion: version, ...head, skin, candidateBar };
}

// ---------------------------------------------------------------------------------------------
// Colours

const channels = (hex) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);

const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function luminance(hex) {
  const [r, g, b] = channels(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const MINIMUM_CONTRAST = 4.5;

/** Keeps the colour when it reads on the background (WCAG AA); otherwise black or white. Same rule on both apps. */
export function contrasting(hex, on) {
  if (contrastRatio(over(hex, on), on) >= MINIMUM_CONTRAST) return normalizeHex(hex);
  return contrastRatio('#000000', on) >= contrastRatio('#FFFFFF', on) ? '#000000' : '#FFFFFF';
}

export const normalizeHex = (hex) => hex.toUpperCase();

/** Alpha of `#RRGGBB` (1) or `#RRGGBBAA`, from 0 to 1. */
export const alphaOf = (hex) => (hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1);

/** `hex` with its alpha replaced; an alpha of 1 gives the plain `#RRGGBB`. */
export function withAlpha(hex, alpha) {
  const rgb = hex.slice(0, 7).toUpperCase();
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return byte === 255 ? rgb : `${rgb}${byte.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** The opaque `#RRGGBB` that `fg` (maybe translucent) shows as when drawn on the opaque colour `bg`. */
export function over(fg, bg) {
  const a = alphaOf(fg);
  if (a === 1) return fg.slice(0, 7).toUpperCase();
  const f = channels(fg);
  const b = channels(bg);
  const mixed = f.map((value, index) => Math.round((value * a + b[index] * (1 - a)) * 255));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** The surface the system draws under every iOS keyboard; a translucent key is measured over it. */
export const SYSTEM_SURFACE = Object.freeze({ light: '#E0E1E8', dark: '#222223' });

/**
 * Reads what a person types into a colour box: `#abc`, `abc`, `#aabbcc`, `aabbcc` or the 8-digit form with
 * alpha, with stray spaces. Returns the upper-case `#RRGGBB` (or `#RRGGBBAA`) form, or null when it is not a colour.
 */
export function parseHexInput(text) {
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(String(text).trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join('') : match[1];
  // An alpha of FF is the plain colour, so it never makes a file version 2.
  const upper = digits.toUpperCase();
  return `#${upper.length === 8 && upper.endsWith('FF') ? upper.slice(0, 6) : upper}`;
}

export const DEFAULT_COLORS = Object.freeze({
  light: Object.freeze(Object.fromEntries(['#D1D3D9', '#FFFFFF', '#ADB2BC', '#145ACC', '#000000', '#333333', '#FFFFFF', '#C2C5CC', '#ADB2BC', '#777777'].map((hex, i) => [COLOR_NAMES[i], hex]))),
  dark: Object.freeze(Object.fromEntries(['#202124', '#38393C', '#55565A', '#286CD8', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#65666A', '#55565A', '#808080'].map((hex, i) => [COLOR_NAMES[i], hex]))),
});

/** Which text roles the contrast rule replaced, so the editor can say so. */
export const CONTRAST_PAIRS = Object.freeze({ text: 'key', secondaryText: 'key', accentText: 'accent' });

/** Every colour role of one variant, with the platform defaults filled in and text forced readable. */
export function resolvedColors(skin, mode) {
  const colors = { ...DEFAULT_COLORS[mode] };
  for (const [role, hex] of Object.entries(skin.variants?.[mode]?.colors ?? {})) {
    if (isHexColorAlpha(hex)) colors[role] = hex;
  }
  // A translucent fill is measured over the system keyboard surface; translucent text over the fill.
  for (const [role, on] of Object.entries(CONTRAST_PAIRS)) {
    colors[role] = contrasting(colors[role], over(colors[on], SYSTEM_SURFACE[mode]));
  }
  for (const role of COLOR_NAMES) colors[role] = normalizeHex(colors[role]);
  return colors;
}

// ---------------------------------------------------------------------------------------------
// Normalisation and encoding

/** Drops an `FF` alpha so a plain colour stays in its version 1 spelling. */
const plain = (hex) => (typeof hex === 'string' && /^#[0-9A-Fa-f]{6}FF$/i.test(hex) ? hex.slice(0, 7) : hex);

/** A gradient that version 1 can say (two opaque stops, vertical) is written the version 1 way. */
function canonicalBackground(background) {
  if (!isObject(background)) return background;
  if (background.type === 'solid') return { ...background, color: plain(background.color) };
  if (background.type !== 'linearGradient') return background;
  const stops = (background.colors ?? [background.from, background.to]).map(plain);
  const v1 = stops.length === 2 && background.direction === 'vertical' && stops.every(isHexColor);
  return v1
    ? { type: 'linearGradient', from: stops[0], to: stops[1], direction: 'vertical' }
    : { type: 'linearGradient', colors: stops, direction: background.direction };
}

/** Whether anything in the skin needs version 2: alpha colours, `colors` gradients, images. */
export function usesVersion2(document) {
  for (const mode of MODES) {
    const variant = document.skin?.variants?.[mode];
    if (!variant) continue;
    if (Object.values(variant.colors ?? {}).some((hex) => typeof hex === 'string' && hex.length === 9)) return true;
    const bg = variant.background;
    if (!isObject(bg)) continue;
    if (bg.type === 'image' || 'colors' in bg) return true;
    if ([bg.color, bg.from, bg.to].some((hex) => typeof hex === 'string' && hex.length === 9)) return true;
  }
  return false;
}

/** Sets the version of the document and both parts from what the skin uses. */
export function stampVersion(document) {
  const version = usesVersion2(document) ? FORMAT_VERSION_2 : FORMAT_VERSION;
  document.formatVersion = version;
  if (isObject(document.skin)) document.skin.formatVersion = version;
  if (isObject(document.candidateBar)) document.candidateBar.formatVersion = version;
  return document;
}

/** A gradient in the oldest shape that can say it: `from`/`to` for two opaque vertical stops, else `colors`. */
export function makeGradient(colors, direction) {
  const stops = colors.map(plain);
  if (stops.length === 2 && direction === 'vertical' && stops.every(isHexColor)) {
    return { type: 'linearGradient', from: stops[0], to: stops[1], direction };
  }
  return { type: 'linearGradient', colors: stops, direction };
}

/** The stops of a gradient background, whichever shape it has. */
export const gradientStops = (background) => background.colors ?? [background.from, background.to];

/** Whether the skin holds a background image, which raises the size limit and rules out sharing by link. */
export const hasImage = (document) => MODES.some((mode) => document.skin?.variants?.[mode]?.background?.type === 'image');

/**
 * The export form: name trimmed, skin and candidate bar re-attached to the document identity, every
 * resolved colour written into both variants, version 2 only where the file needs it.
 */
export function normalizeDocument(document) {
  const result = clone(document);
  result.name = result.name.trim();
  result.skin.id = result.id;
  result.skin.name = result.name;
  result.candidateBar.id = result.id;
  result.candidateBar.name = result.name;
  result.skin.variants ??= {};
  for (const mode of MODES) {
    const variant = (result.skin.variants[mode] ??= {});
    variant.colors = Object.fromEntries(
      Object.entries(resolvedColors(result.skin, mode)).map(([role, hex]) => [role, plain(hex)]));
    if (variant.background) variant.background = canonicalBackground(variant.background);
  }
  return stampVersion(result);
}

const escapeString = (text) => JSON.stringify(text).replaceAll('/', '\\/');

/** Sorted keys, two-space indent, `"key" : value` — the way the iOS encoder writes, so the bytes match. */
export function stringify(value, depth = 0) {
  if (isObject(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    if (keys.length === 0) return '{\n\n' + '  '.repeat(depth) + '}';
    const inner = '  '.repeat(depth + 1);
    const lines = keys.map((key) => `${inner}${escapeString(key)} : ${stringify(value[key], depth + 1)}`);
    return `{\n${lines.join(',\n')}\n${'  '.repeat(depth)}}`;
  }
  if (typeof value === 'string') return escapeString(value);
  return JSON.stringify(value);
}

/** Validates, normalises and writes a document. Throws FormatError for anything the apps would reject. */
export function encodeDocument(document) {
  const normalized = normalizeDocument(readDocument(document));
  const text = stringify(normalized);
  if (byteLength(text) > documentLimit(normalized)) throw new FormatError(ErrorCode.OVERSIZE, '$');
  return text;
}

// ---------------------------------------------------------------------------------------------
// Decoding

/** 256 KiB, or 2 MiB for a document that holds an image. */
export const documentLimit = (document) => (hasImage(document) ? MAX_IMAGE_DOCUMENT_BYTES : MAX_DOCUMENT_BYTES);

function parseObject(text) {
  if (byteLength(text) > MAX_IMAGE_DOCUMENT_BYTES) throw new FormatError(ErrorCode.OVERSIZE, '$');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new FormatError(ErrorCode.MALFORMED_JSON, '$');
  }
  if (!isObject(value)) throw new FormatError(ErrorCode.NOT_AN_OBJECT, '$');
  return value;
}

/** Strict decode of an appearance document. Returns the normalised document. */
export function decodeDocument(text) {
  const document = normalizeDocument(readDocument(parseObject(text)));
  if (byteLength(text) > documentLimit(document)) throw new FormatError(ErrorCode.OVERSIZE, '$');
  return document;
}

export function randomId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().toLowerCase();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The system default skin and candidate bar, the fillers for a standalone bar or skin. */
export function systemDefaultDocument() {
  return clone(SYSTEM_DEFAULT);
}

/**
 * Imports one user file the way both apps do. Returns `{ document, kind }` where kind is
 * `document`, `skin` or `candidateBar`. A standalone skin or bar is wrapped with the system
 * default of the other half; one that carries the system default's identity gets a fresh one.
 */
export function decodeImported(text, newId = randomId) {
  const source = parseObject(text);
  if (['selectedSkinID', 'selectedBarID', 'selectedID'].some((key) => key in source)) {
    throw new FormatError(ErrorCode.SNAPSHOT_NOT_IMPORTABLE, '$');
  }
  const finish = (raw, kind) => {
    const document = normalizeDocument(readDocument(raw));
    if (byteLength(text) > documentLimit(document)) throw new FormatError(ErrorCode.OVERSIZE, '$');
    return { document, kind };
  };
  if ('skin' in source || 'candidateBar' in source) return finish(source, 'document');
  const base = systemDefaultDocument();
  // The filler half takes the version of the half that was read, so the wrapped document is consistent.
  const wrap = (id, name, skin, candidateBar) => {
    const formatVersion = skin.formatVersion === candidateBar.formatVersion ? skin.formatVersion : Math.max(skin.formatVersion, candidateBar.formatVersion);
    return {
      formatVersion,
      id,
      name,
      appearance: 'system',
      skin: { ...skin, id, name, formatVersion },
      candidateBar: { ...candidateBar, id, name, formatVersion },
    };
  };
  if (['variants', 'typography', 'keycap', 'spacing'].some((key) => key in source)) {
    const skin = readSkin(source);
    const id = skin.id === SYSTEM_DEFAULT_ID ? newId() : skin.id;
    return finish(wrap(id, skin.name, skin, base.candidateBar), 'skin');
  }
  if (['compositionRow', 'collapsed', 'expanded', 'controls'].some((key) => key in source)) {
    const candidateBar = readCandidateBar(source);
    const id = candidateBar.id === SYSTEM_DEFAULT_ID ? newId() : candidateBar.id;
    return finish(wrap(id, candidateBar.name, base.skin, candidateBar), 'candidateBar');
  }
  throw new FormatError(ErrorCode.UNRECOGNIZED_DOCUMENT, '$');
}

/** Whether two documents export to the same file; used to tell if a draft has unsaved changes. */
export function sameDocument(a, b) {
  try {
    return stringify(normalizeDocument(a)) === stringify(normalizeDocument(b));
  } catch {
    return false;
  }
}

/** A new draft with its own identity, so it never collides with a built-in on import. */
export function withNewIdentity(document, name, newId = randomId) {
  const result = clone(document);
  result.id = newId();
  if (name !== undefined) result.name = name;
  return normalizeDocument(result);
}

// ---------------------------------------------------------------------------------------------
// The system default (the filler for standalone files); matches the iOS-written sample.

const SYSTEM_DEFAULT = normalizeDocument({
  formatVersion: FORMAT_VERSION,
  id: SYSTEM_DEFAULT_ID,
  name: '系统默认',
  appearance: 'system',
  skin: {
    formatVersion: FORMAT_VERSION,
    id: SYSTEM_DEFAULT_ID,
    name: '系统默认',
    variants: {
      light: {
        colors: {
          panel: '#DFE2E7', key: '#FFFFFF', control: '#CBD0D8', accent: '#44598F', accentText: '#FFFFFF',
          text: '#252930', secondaryText: '#505863', selected: '#CCDBEE', pressed: '#BEC8D6',
        },
      },
      dark: {
        colors: {
          panel: '#25272C', key: '#44474E', control: '#363940', accent: '#4C65A6', accentText: '#F0F5FC',
          text: '#F4F5F7', secondaryText: '#BDC3CD', selected: '#3B536F', pressed: '#5A626F',
        },
      },
    },
    typography: { family: 'system', weight: 'regular', keySize: 22, secondarySize: 10, candidateSize: 21 },
    keycap: { cornerRadius: 6, borderWidth: 0, shadow: 'none' },
    spacing: { visualInsetX: 0, visualInsetY: 1 },
  },
  candidateBar: {
    formatVersion: FORMAT_VERSION,
    id: SYSTEM_DEFAULT_ID,
    name: '系统默认',
    compositionRow: { visible: 'composingOnly' },
    collapsed: { height: 40, cellPaddingX: 7, cellSpacing: 0, fillsAvailableWidth: false },
    expanded: { mode: 'adaptive', columns: 2, rowSpacing: 0, columnSpacing: 0, fullRowTextLength: 8 },
    controls: { pagePosition: 'both', showsExpand: true },
  },
});
