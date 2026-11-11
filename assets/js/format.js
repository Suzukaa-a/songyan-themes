// Songyan appearance file codec, format version 1. No DOM, no network.
//
// It mirrors the Android (`AppearanceDocument`, `SkinDefinition`, `CandidateBarDefinition`) and iOS
// (`AppearanceKit`, `SkinKit`, `CandidateKit`) readers: strict unknown-field and version checks,
// the same ranges and enums, the same size limits, and the same normalisation on export.
//
// Everything about a field lives in one table (FIELDS). The reader, the writer and the editor UI all
// walk that table, so a later format version adds rows instead of new code.

export const FORMAT_VERSION = 1;
export const FILE_EXTENSION = '.songyanappearance.json';
export const SYSTEM_DEFAULT_ID = 'system-default';
export const MAX_DOCUMENT_BYTES = 256 * 1024;
export const MAX_PART_BYTES = 128 * 1024;

export const COLOR_NAMES = [
  'panel', 'key', 'control', 'accent', 'text', 'secondaryText', 'accentText', 'pressed', 'selected', 'border',
];
export const MODES = ['light', 'dark'];
export const APPEARANCES = ['system', 'light', 'dark'];
export const BACKGROUND_TYPES = ['solid', 'linearGradient'];

const ID_PATTERN = /^[0-9A-Za-z_-]+$/;
const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

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
  { path: 'spacing.visualInsetX', type: 'number', min: 0, max: 6, step: 0.5, default: 2, section: 'spacing' },
  { path: 'spacing.visualInsetY', type: 'number', min: 0, max: 6, step: 0.5, default: 2, section: 'spacing' },
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

function requireVersion(source, path) {
  // The version must be the number 1; "1" as a string or 1.5 does not count.
  if (typeof source.formatVersion !== 'number' || source.formatVersion !== FORMAT_VERSION) {
    throw new FormatError(ErrorCode.UNSUPPORTED_VERSION, `${path}.formatVersion`);
  }
}

export const isHexColor = (value) => typeof value === 'string' && HEX_PATTERN.test(value);

/** Validates one value against its field row and returns it, or throws with the row's path. */
function checkValue(row, value, path) {
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
      if (!isHexColor(value)) throw invalid(path, 'color');
      return value;
    case 'background':
      return checkBackground(value, path);
    default:
      throw new Error(`unknown field type ${row.type}`);
  }
}

/** A solid colour or a vertical two-stop gradient; exactly one shape is populated. */
function checkBackground(value, path) {
  if (!isObject(value)) throw invalid(path, 'object');
  for (const key of Object.keys(value)) {
    if (!['type', 'color', 'from', 'to', 'direction'].includes(key)) {
      throw new FormatError(ErrorCode.UNKNOWN_FIELD, `${path}.${key}`);
    }
  }
  const present = (key) => value[key] !== undefined && value[key] !== null;
  const color = (key) => {
    if (!present(key)) throw invalid(`${path}.${key}`, 'color');
    if (!isHexColor(value[key])) throw invalid(`${path}.${key}`, 'color');
  };
  const type = value.type ?? 'solid';
  if (type === 'solid') {
    color('color');
    for (const key of ['from', 'to', 'direction']) if (present(key)) throw invalid(path, 'background');
    return { type: 'solid', color: value.color };
  }
  if (type === 'linearGradient') {
    color('from');
    color('to');
    if (value.direction !== 'vertical') throw invalid(`${path}.direction`, 'enum');
    if (present('color')) throw invalid(path, 'background');
    return { type: 'linearGradient', from: value.from, to: value.to, direction: 'vertical' };
  }
  throw invalid(`${path}.type`, 'enum');
}

/**
 * Reads one part (document header, skin or candidate bar): checks every present field, fills the
 * defaults of the omitted ones and leaves optional fields out.
 */
function readRows(source, rows, path, kind) {
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
    setPath(result, row.path, checkValue(row, value, rowPath));
  }
  // Skin and bar identity fields, when read as a part.
  if (kind) result.formatVersion = FORMAT_VERSION;
  return result;
}

function readPart(source, rows, tree, path) {
  if (!isObject(source)) throw invalid(path, 'object');
  rejectUnknown(source, tree, path);
  requireVersion(source, path);
  return readRows(source, rows, path, true);
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
  requireVersion(source, path);
  if (typeof source.id !== 'string' || source.id === '') throw invalid(`${path}.id`, 'id');
  if (typeof source.name !== 'string' || source.name.trim() === '') throw invalid(`${path}.name`, 'name');
  if (!isObject(source.skin)) throw invalid(`${path}.skin`, 'object');
  if (!isObject(source.candidateBar)) throw invalid(`${path}.candidateBar`, 'object');
  const head = readRows(source, DOCUMENT_FIELDS, path, false);
  const skin = readSkin(source.skin, `${path}.skin`);
  const candidateBar = readCandidateBar(source.candidateBar, `${path}.candidateBar`);
  if (skin.id !== head.id) throw new FormatError(ErrorCode.IDENTITY_MISMATCH, `${path}.skin.id`);
  if (candidateBar.id !== head.id) throw new FormatError(ErrorCode.IDENTITY_MISMATCH, `${path}.candidateBar.id`);
  return { formatVersion: FORMAT_VERSION, ...head, skin, candidateBar };
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
  if (contrastRatio(hex, on) >= MINIMUM_CONTRAST) return normalizeHex(hex);
  return contrastRatio('#000000', on) >= contrastRatio('#FFFFFF', on) ? '#000000' : '#FFFFFF';
}

export const normalizeHex = (hex) => hex.toUpperCase();

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
    if (isHexColor(hex)) colors[role] = hex;
  }
  for (const [role, on] of Object.entries(CONTRAST_PAIRS)) {
    colors[role] = contrasting(colors[role], colors[on]);
  }
  for (const role of COLOR_NAMES) colors[role] = normalizeHex(colors[role]);
  return colors;
}

// ---------------------------------------------------------------------------------------------
// Normalisation and encoding

/**
 * The export form: name trimmed, skin and candidate bar re-attached to the document identity, every
 * resolved colour written into both variants.
 */
export function normalizeDocument(document) {
  const result = clone(document);
  result.formatVersion = FORMAT_VERSION;
  result.name = result.name.trim();
  result.skin.id = result.id;
  result.skin.name = result.name;
  result.candidateBar.id = result.id;
  result.candidateBar.name = result.name;
  result.skin.variants ??= {};
  for (const mode of MODES) {
    const variant = (result.skin.variants[mode] ??= {});
    variant.colors = resolvedColors(result.skin, mode);
  }
  return result;
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
  if (byteLength(text) > MAX_DOCUMENT_BYTES) throw new FormatError(ErrorCode.OVERSIZE, '$');
  return text;
}

// ---------------------------------------------------------------------------------------------
// Decoding

function parseObject(text) {
  if (byteLength(text) > MAX_DOCUMENT_BYTES) throw new FormatError(ErrorCode.OVERSIZE, '$');
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
  return normalizeDocument(readDocument(parseObject(text)));
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
  if ('skin' in source || 'candidateBar' in source) {
    return { document: normalizeDocument(readDocument(source)), kind: 'document' };
  }
  const base = systemDefaultDocument();
  const wrap = (id, name, skin, candidateBar) => ({
    formatVersion: FORMAT_VERSION,
    id,
    name,
    appearance: 'system',
    skin: { ...skin, id, name },
    candidateBar: { ...candidateBar, id, name },
  });
  if (['variants', 'typography', 'keycap', 'spacing'].some((key) => key in source)) {
    const skin = readSkin(source);
    const id = skin.id === SYSTEM_DEFAULT_ID ? newId() : skin.id;
    const document = wrap(id, skin.name, skin, base.candidateBar);
    return { document: normalizeDocument(readDocument(document)), kind: 'skin' };
  }
  if (['compositionRow', 'collapsed', 'expanded', 'controls'].some((key) => key in source)) {
    const candidateBar = readCandidateBar(source);
    const id = candidateBar.id === SYSTEM_DEFAULT_ID ? newId() : candidateBar.id;
    const document = wrap(id, candidateBar.name, base.skin, candidateBar);
    return { document: normalizeDocument(readDocument(document)), kind: 'candidateBar' };
  }
  throw new FormatError(ErrorCode.UNRECOGNIZED_DOCUMENT, '$');
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
          panel: '#DFE2E7', key: '#FAFBFC', control: '#CBD0D8', accent: '#CCDBEE', accentText: '#284D7A',
          text: '#252930', secondaryText: '#505863', selected: '#CCDBEE', pressed: '#BEC8D6',
        },
      },
      dark: {
        colors: {
          panel: '#25272C', key: '#44474E', control: '#363940', accent: '#3B536F', accentText: '#F0F5FC',
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
