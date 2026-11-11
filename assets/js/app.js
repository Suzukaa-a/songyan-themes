// The editor page. The form is built from the field table in format.js. Only settings that both apps read
// are offered (see EDITABLE); every other field stays in the document exactly as it came from the starting
// look or the imported file, so exports never lose anything.

import {
  FIELDS, COLOR_NAMES, MODES, FILE_EXTENSION, MAX_IMAGE_DOCUMENT_BYTES, MAX_IMAGE_BYTES, FormatError, ErrorCode, CONTRAST_PAIRS,
  GRADIENT_DIRECTIONS, GRADIENT_MAX_COLORS, GRADIENT_MIN_COLORS, DEFAULT_COLORS,
  decodeImported, encodeDocument, normalizeDocument, readDocument, resolvedColors, getPath, setPath,
  withNewIdentity, parseHexInput, sameDocument, stampVersion, makeGradient, gradientStops, alphaOf, withAlpha,
  inspectImage, hasImage,
} from './format.js';
import { loadSource, bakeSource, dropSource } from './imagework.js';
import { DEFAULT_PARAMS, BLUR_MAX, DIM_MAX, BRIGHT_MAX, BAKED_ALIGN, KEYBOARD_AREA, slackAxis } from './image.js';
import { PRESETS, presetById } from './presets.js';
import { translator, describeError, LANGS } from './i18n.js';
import { renderPreview, previewMetrics } from './preview.js';

const DRAFT_KEY = 'songyan-themes.draft.v1';
const BASELINE_KEY = 'songyan-themes.baseline.v1';
const LANG_KEY = 'songyan-themes.lang';
const SECTIONS = ['basic', 'colors', 'background', 'keycap', 'typography', 'candidate'];
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const TRANSLUCENT_ROLES = ['key', 'control'];

/**
 * The fields the editor shows: the ones Android and iPhone both read. The rest of a file (the candidate
 * bar's composition row, page buttons and even split, which Android does not read) is kept untouched but
 * not offered.
 */
const EDITABLE = new Set([
  'name', 'author', 'appearance',
  'skin.variants.light.background', 'skin.variants.dark.background',
  'skin.keycap.cornerRadius', 'skin.keycap.borderWidth', 'skin.keycap.shadow',
  'skin.spacing.visualInsetX', 'skin.spacing.visualInsetY',
  'skin.typography.family', 'skin.typography.weight',
  'skin.typography.keySize', 'skin.typography.secondarySize', 'skin.typography.candidateSize',
  'candidateBar.collapsed.height', 'candidateBar.collapsed.cellPaddingX', 'candidateBar.collapsed.cellSpacing',
  'candidateBar.expanded.mode', 'candidateBar.expanded.columns',
  'candidateBar.expanded.rowSpacing', 'candidateBar.expanded.columnSpacing',
]);
/** Rows tucked under "更多" because they are rarely changed. */
const MORE = new Set([
  'candidateBar.collapsed.cellPaddingX', 'candidateBar.collapsed.cellSpacing',
  'candidateBar.expanded.rowSpacing', 'candidateBar.expanded.columnSpacing',
]);
const COLOR_GROUPS = [
  ['grp_keys', ['panel', 'key', 'control', 'border']],
  ['grp_text', ['text', 'secondaryText']],
  ['grp_state', ['accent', 'accentText', 'pressed', 'selected']],
];
/** Rows that only matter in some situations; the row stays visible but disabled otherwise. */
const ENABLED_WHEN = {
  'candidateBar.expanded.columns': (doc) => doc.candidateBar.expanded.mode === 'grid',
};
const UNITS = { 'candidateBar.expanded.columns': 'unitColumns' };

const state = { lang: 'zh', doc: null, mode: 'light', platform: 'android', top: 'candidates', expanded: false };
const moreOpen = new Set();
const fieldEls = new Map();
let t = translator('zh');
const $ = (selector) => document.querySelector(selector);
const hintEls = new Map();
const colorCells = new Map();

// ------------------------------------------------------------------ storage (may be blocked on file://)
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  /** Returns whether the value was stored: storage may be blocked, or full (about 5 MB, which a picture can reach). */
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
};

// ------------------------------------------------------------------ small DOM helpers
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined));
  return node;
}

let uid = 0;
const nextId = (prefix) => `${prefix}-${(uid += 1)}`;

// ------------------------------------------------------------------ messages
function showMessage(host, text, { error = false, path = null } = {}) {
  host.replaceChildren(h('div', { class: `msg${error ? ' error' : ''}` }, text, path ? h('span', { class: 'path' }, t('errAt', { path })) : null));
}
const clearMessage = (host) => host.replaceChildren();
function showError(host, error) {
  if (error instanceof FormatError) {
    const { message, path } = describeError(state.lang, error);
    showMessage(host, message, { error: true, path });
  } else {
    showMessage(host, t('errGeneric'), { error: true });
  }
}

// ------------------------------------------------------------------ document edits
let saveTimer = 0;
function afterChange() {
  refreshPreview();
  updateHints();
  updateEnabled();
  updateBarHint();
  $('#doc-name').textContent = state.doc.name;
  syncBackgroundInfo();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 250);
}

let draftWarned = false;
/** Keeps the draft in this browser. When a picture does not fit, the draft is saved without it and you are told. */
function saveDraft() {
  if (store.set(DRAFT_KEY, JSON.stringify(state.doc))) { draftWarned = false; return; }
  if (!hasImage(state.doc)) return;
  const bare = structuredClone(state.doc);
  for (const mode of MODES) {
    if (getPath(bare, `skin.variants.${mode}.background.type`) === 'image') setPath(bare, `skin.variants.${mode}.background`, undefined);
  }
  store.set(DRAFT_KEY, JSON.stringify(stampVersion(bare)));
  if (!draftWarned) { draftWarned = true; showMessage($('#messages'), t('draftNoImage')); }
}

/** Applies several edits as one change. Returns false (and shows why) when the result is not a valid document. */
function commitMany(edits) {
  const next = structuredClone(state.doc);
  for (const [path, value] of edits) {
    setPath(next, path, value);
    if (path === 'name') {
      next.skin.name = value;
      next.candidateBar.name = value;
    }
  }
  try {
    state.doc = readDocument(stampVersion(next));
  } catch (error) {
    showError($('#messages'), error);
    return false;
  }
  afterChange();
  return true;
}

const commit = (path, value) => commitMany([[path, value]]);

function refreshPreview() {
  const doc = normalizeDocument(state.doc);
  renderPreview($('#preview'), doc, {
    mode: state.mode,
    platform: state.platform,
    top: state.top,
    expanded: state.expanded,
    t,
    onToggleExpand: () => { state.expanded = !state.expanded; refreshPreview(); },
  });
  const note = $('#preview-note');
  note.replaceChildren(t('previewHint'));
  if (state.platform === 'iphone') note.append(h('br'), t('iphoneNote'));
}

function updateHints() {
  for (const mode of MODES) {
    const resolved = resolvedColors(state.doc.skin, mode);
    for (const role of Object.keys(CONTRAST_PAIRS)) {
      const hint = hintEls.get(`${mode}.${role}`);
      if (!hint) continue;
      const raw = (getPath(state.doc, `skin.variants.${mode}.colors.${role}`) ?? '').toUpperCase();
      hint.textContent = raw && raw !== resolved[role] ? t('contrastFixed', { hex: resolved[role] }) : '';
    }
  }
}

/** Under the bar height: what each app actually draws for it, since neither shows the number literally. */
function updateBarHint() {
  const field = fieldEls.get('candidateBar.collapsed.height');
  if (!field) return;
  let hint = field.querySelector('.bar-hint');
  if (!hint) { hint = h('div', { class: 'hint bar-hint' }); field.append(hint); }
  // Both apps grow the bar to fit large candidate text; say so only when that happens.
  const doc = normalizeDocument(state.doc);
  const drawn = previewMetrics('android', doc).bar.height;
  hint.textContent = drawn !== doc.candidateBar.collapsed.height ? t('barHeightHint', { height: drawn }) : '';
}

function updateEnabled() {
  for (const [path, rule] of Object.entries(ENABLED_WHEN)) {
    const field = fieldEls.get(path);
    if (!field) continue;
    const on = rule(state.doc);
    field.classList.toggle('disabled', !on);
    if (on) field.removeAttribute('title'); else field.title = t('gridOnly');
    for (const control of field.querySelectorAll('input, select')) control.disabled = !on;
  }
}

// ------------------------------------------------------------------ controls
const labelFor = (row) => t(`f.${row.relative ?? row.path}`);
const valueLabel = (row, value) => t(`v.${row.relative ?? row.path}.${value}`);

function numberControl(row, id) {
  const value = getPath(state.doc, row.path);
  const range = h('input', { type: 'range', min: row.min, max: row.max, step: row.step, value, 'aria-label': labelFor(row) });
  const number = h('input', { type: 'number', id, min: row.min, max: row.max, step: row.step, value, inputmode: 'decimal' });
  const snap = (raw) => Math.min(row.max, Math.max(row.min, row.type === 'int' ? Math.round(raw) : raw));
  range.addEventListener('input', () => {
    number.value = range.value;
    number.removeAttribute('aria-invalid');
    commit(row.path, Number(range.value));
  });
  number.addEventListener('input', () => {
    const raw = Number(number.value);
    const ok = number.value.trim() !== '' && Number.isFinite(raw) && raw >= row.min && raw <= row.max && (row.type !== 'int' || Number.isInteger(raw));
    if (ok) number.removeAttribute('aria-invalid'); else number.setAttribute('aria-invalid', 'true');
    if (ok) { range.value = String(raw); commit(row.path, raw); }
  });
  number.addEventListener('change', () => {
    const raw = Number(number.value);
    const fixed = snap(Number.isFinite(raw) && number.value.trim() !== '' ? raw : getPath(state.doc, row.path));
    number.value = String(fixed);
    range.value = String(fixed);
    number.removeAttribute('aria-invalid');
    commit(row.path, fixed);
  });
  // The unit cell is always there so the number boxes line up even for a row without a unit.
  const unit = row.type === 'int' ? (UNITS[row.path] ? t(UNITS[row.path]) : '') : t('unitPt');
  return h('div', { class: 'ctl slider' }, range, number, h('span', { class: 'unit' }, unit));
}

function enumControl(row, id) {
  const current = getPath(state.doc, row.path);
  const select = h('select', { id }, row.values.map((value) => h('option', { value, selected: value === current }, valueLabel(row, value))));
  select.addEventListener('change', () => commit(row.path, select.value));
  return h('div', { class: 'ctl' }, select);
}

function textControl(row, id, maxlength) {
  const input = h('input', { type: 'text', id, maxlength, value: getPath(state.doc, row.path) ?? '', autocomplete: 'off' });
  input.addEventListener('input', () => {
    const value = input.value;
    if (row.type === 'name' && value.trim() === '') {
      input.setAttribute('aria-invalid', 'true');
      showMessage($('#messages'), t('nameEmpty'), { error: true });
      return;
    }
    input.removeAttribute('aria-invalid');
    clearMessage($('#messages'));
    commit(row.path, row.optional && value === '' ? undefined : value);
  });
  input.addEventListener('blur', () => { if (row.type === 'name' && input.value.trim() === '') { input.value = state.doc.name; input.removeAttribute('aria-invalid'); } });
  return h('div', { class: 'ctl' }, input);
}

/**
 * A swatch that opens the system colour picker beside a hex box. `onCommit` gets only valid `#RRGGBB` or
 * `#RRGGBBAA` values. The box takes `#abc`, `abc`, `#aabbcc` and the 8-digit form with alpha; it is rewritten
 * to the full form when you leave it, and a value that is not a colour is marked but kept so you can fix it.
 * The picker has no alpha, so it keeps the alpha the box already has. `update(value)` shows a value set elsewhere.
 */
function colorCell({ id, label, value, onCommit }) {
  let committed = value.toUpperCase();
  const picker = h('input', { type: 'color', 'aria-label': t('colorPickerLabel', { label }), value: committed.slice(0, 7).toLowerCase() });
  const hex = h('input', { type: 'text', id, maxlength: 12, value: committed, spellcheck: 'false', autocomplete: 'off', 'aria-label': t('colorHexLabel', { label }) });
  const message = h('div', { class: 'hint', role: 'alert' });
  const box = h('div', { class: 'color-cell' }, picker, hex);
  const setInvalid = (bad) => {
    box.classList.toggle('invalid', bad);
    if (bad) hex.setAttribute('aria-invalid', 'true'); else hex.removeAttribute('aria-invalid');
    message.textContent = bad ? t('hexInvalid') : '';
  };
  const accept = (parsed) => {
    setInvalid(false);
    picker.value = parsed.slice(0, 7).toLowerCase();
    if (parsed !== committed) { committed = parsed; onCommit(parsed); }
  };
  picker.addEventListener('input', () => {
    const next = picker.value.toUpperCase() + committed.slice(7);
    hex.value = next;
    accept(next);
  });
  hex.addEventListener('input', () => {
    // Only a complete six- or eight-digit colour applies while typing; #abc waits for Enter or leaving the box.
    const parsed = /^\s*#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})\s*$/.test(hex.value) ? parseHexInput(hex.value) : null;
    if (parsed) accept(parsed); else if (box.classList.contains('invalid')) setInvalid(false);
  });
  const finish = () => {
    const parsed = parseHexInput(hex.value);
    if (parsed) { hex.value = parsed; accept(parsed); } else setInvalid(true);
  };
  hex.addEventListener('blur', finish);
  hex.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); finish(); } });
  const wrap = h('div', { class: 'color-wrap' }, box, message);
  wrap.update = (next) => {
    committed = next.toUpperCase();
    setInvalid(false);
    hex.value = committed;
    picker.value = committed.slice(0, 7).toLowerCase();
  };
  return wrap;
}

function fieldRow(row, control, id) {
  const field = h('div', { class: 'field' }, h('label', { for: id }, labelFor(row)), control);
  fieldEls.set(row.path, field);
  return field;
}

function simpleField(row) {
  const id = nextId('f');
  let control;
  if (row.type === 'number' || row.type === 'int') control = numberControl(row, id);
  else if (row.type === 'enum') control = enumControl(row, id);
  else control = textControl(row, id, row.type === 'id' ? 80 : 60);
  return fieldRow(row, control, id);
}

// ------------------------------------------------------------------ sections
function colorsSection() {
  const rows = FIELDS.filter((row) => row.section === 'colors');
  const head = h('div', { class: 'color-head' },
    h('span', { class: 'head-role' }, ''),
    h('span', {}, t('modeLight')),
    h('span', {}, t('modeDark')));
  const groups = COLOR_GROUPS.map(([titleKey, roles]) => h('div', { class: 'color-group' },
    h('h3', {}, t(titleKey)),
    roles.filter((role) => COLOR_NAMES.includes(role)).map((role) => {
      const cells = MODES.map((mode) => {
        const row = rows.find((candidate) => candidate.role === role && candidate.mode === mode);
        const label = `${t(`role.${role}`)}（${t(mode)}）`;
        const cell = colorCell({ id: nextId('c'), label, value: getPath(state.doc, row.path), onCommit: (hex) => commit(row.path, hex) });
        colorCells.set(row.path, cell);
        if (role in CONTRAST_PAIRS) {
          const hint = h('div', { class: 'hint', 'aria-live': 'polite' });
          hintEls.set(`${mode}.${role}`, hint);
          cell.append(hint);
        }
        return cell;
      });
      return h('div', { class: 'color-row' }, h('span', { class: 'role' }, t(`role.${role}`)), ...cells);
    })));
  return [h('p', { class: 'note' }, t('colorsNote')), head, ...groups];
}

// ------------------------------------------------------------------ background
// What the editor knows about a picture it is working on. It lives only in this page: the file holds the
// baked result, not the original, so a reloaded draft can show and remove its picture but not re-crop it.
const pictures = { light: null, dark: null };
const pendingPicture = { light: false, dark: false };
const infoEls = {};
let sizeEl = null;
let opacityEls = null;

const bgPath = (mode) => `skin.variants.${mode}.background`;
const bgOf = (mode) => getPath(state.doc, bgPath(mode));
function bgKind(mode) {
  if (pendingPicture[mode]) return 'image';
  const bg = bgOf(mode);
  if (!bg) return 'none';
  return bg.type === 'linearGradient' ? 'gradient' : bg.type;
}
const rebuildBackground = (focusSelector) => {
  const old = $('#sec-background');
  old.replaceWith(section('background'));
  if (focusSelector) $(focusSelector)?.focus();
};
const formatSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.round(bytes / 1024)} KB`);

/** Forgets the working copy of a slot's picture. `keepSource` leaves the decoded copy in the worker for a new one. */
function releasePicture(mode, keepSource = false) {
  const picture = pictures[mode];
  if (picture?.url) URL.revokeObjectURL(picture.url);
  clearTimeout(picture?.timer);
  if (picture) picture.job += 1;
  pictures[mode] = null;
  pendingPicture[mode] = false;
  if (!keepSource) dropSource(mode);
}
const releaseAllPictures = () => MODES.forEach(releasePicture);

function setKind(mode, kind) {
  const resolved = resolvedColors(state.doc.skin, mode);
  if (kind !== 'image' || bgOf(mode)?.type !== 'image') releasePicture(mode);
  if (kind === 'none') commit(bgPath(mode), undefined);
  else if (kind === 'solid') commit(bgPath(mode), { type: 'solid', color: resolved.panel });
  else if (kind === 'gradient') commit(bgPath(mode), makeGradient([resolved.panel, resolved.control], 'vertical'));
  else if (bgOf(mode)?.type !== 'image') pendingPicture[mode] = true;
  rebuildBackground(`[data-bg-kind="${mode}-${kind}"]`);
}

function segmented(label, options, current, onPick, extra = {}) {
  const group = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const [value, text, id] of options) {
    group.append(h('button', {
      type: 'button', 'aria-pressed': String(value === current), 'data-bg-kind': id, onclick: () => onPick(value),
    }, text));
  }
  return h('div', { class: `ctl ${extra.class ?? ''}` }, group);
}

function sliderRow({ label, min, max, step = 1, value, unit, onInput, id = nextId('f') }) {
  const range = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  const number = h('input', { type: 'number', id, min, max, step, value, inputmode: 'decimal' });
  const snap = (raw) => Math.min(max, Math.max(min, Math.round(raw / step) * step));
  range.addEventListener('input', () => { number.value = range.value; onInput(Number(range.value)); });
  number.addEventListener('change', () => {
    const raw = Number(number.value);
    const fixed = snap(Number.isFinite(raw) && number.value.trim() !== '' ? raw : Number(range.value));
    number.value = String(fixed);
    range.value = String(fixed);
    onInput(fixed);
  });
  const row = h('div', { class: 'field' }, h('label', { for: id }, label), h('div', { class: 'ctl slider' }, range, number, h('span', { class: 'unit' }, unit)));
  row.set = (next) => { range.value = String(next); number.value = String(next); };
  return row;
}

function solidControls(mode) {
  const bg = bgOf(mode);
  const label = `${t('bgColor')}（${t(mode)}）`;
  const id = nextId('c');
  const cell = colorCell({ id, label, value: bg.color, onCommit: (hex) => commit(bgPath(mode), { type: 'solid', color: hex }) });
  return h('div', { class: 'field' }, h('label', { for: id }, t('bgColor')), h('div', { class: 'ctl' }, cell));
}

function gradientControls(mode) {
  const bg = bgOf(mode);
  const stops = gradientStops(bg);
  const write = (nextStops, direction = bg.direction) => commit(bgPath(mode), makeGradient(nextStops, direction));
  const rows = stops.map((stop, index) => {
    const id = nextId('c');
    const label = `${t('bgStop', { n: index + 1 })}（${t(mode)}）`;
    const cell = colorCell({
      id, label, value: stop,
      onCommit: (hex) => write(gradientStops(bgOf(mode)).map((old, at) => (at === index ? hex : old))),
    });
    const remove = h('button', {
      type: 'button', class: 'btn icon', 'aria-label': t('bgRemoveStop', { n: index + 1 }), title: t('bgRemoveStop', { n: index + 1 }),
      disabled: stops.length <= GRADIENT_MIN_COLORS,
      onclick: () => { write(gradientStops(bgOf(mode)).filter((_, at) => at !== index)); rebuildBackground(`#sec-background [data-stop="${mode}"]`); },
    }, '−');
    return h('div', { class: 'field' }, h('label', { for: id }, t('bgStop', { n: index + 1 })), h('div', { class: 'ctl stop' }, cell, remove));
  });
  const add = h('button', {
    type: 'button', class: 'btn', 'data-stop': mode, disabled: stops.length >= GRADIENT_MAX_COLORS,
    onclick: () => { const now = gradientStops(bgOf(mode)); write([...now, now[now.length - 1]]); rebuildBackground(); },
  }, t('bgAddStop'));
  const direction = segmented(t('bgDirection'), GRADIENT_DIRECTIONS.map((value) => [value, t(`bgDir_${value}`), `${mode}-dir-${value}`]), bg.direction,
    (value) => { write(gradientStops(bgOf(mode)), value); rebuildBackground(`[data-bg-kind="${mode}-dir-${value}"]`); });
  return [rows, h('div', { class: 'field' }, h('span', { class: 'label' }, t('bgAddStop')), h('div', { class: 'ctl' }, add)),
    h('div', { class: 'field' }, h('span', { class: 'label' }, t('bgDirection')), direction)];
}

// -- pictures
function readFileAsDataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function setInfo(mode, text, { busy = false, error = false } = {}) {
  const el = infoEls[mode];
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('bad', error);
  el.setAttribute('aria-busy', String(busy));
}

function describePicture(mode) {
  const bg = bgOf(mode);
  if (bg?.type !== 'image') return '';
  const picture = pictures[mode];
  if (picture?.result) {
    const { blob, mime, width, height } = picture.result;
    return t('bgInfo', { size: formatSize(blob.size), type: mime.replace('image/', '').toUpperCase(), w: width, h: height });
  }
  try {
    const info = inspectImage(bg.image);
    return t('bgInfo', { size: formatSize(info.bytes.length), type: info.kind.toUpperCase(), w: info.width, h: info.height });
  } catch {
    return '';
  }
}

/** The line under the pictures: the file's size against its 2 MB limit. */
function syncBackgroundInfo() {
  if (sizeEl) {
    const total = MODES.reduce((sum, mode) => sum + (bgOf(mode)?.type === 'image' ? bgOf(mode).image.length : 0), 0);
    // The rest of a document is a few KB; the limit is on the whole text.
    const bytes = total + 12 * 1024;
    sizeEl.textContent = total === 0 ? '' : (bytes > MAX_IMAGE_DOCUMENT_BYTES ? t('bgTooBig') : t('bgFileSize', { size: formatSize(bytes) }));
    sizeEl.classList.toggle('bad', bytes > MAX_IMAGE_DOCUMENT_BYTES);
  }
  if (opacityEls) {
    const raw = getPath(state.doc, 'skin.variants.light.colors.key') ?? DEFAULT_COLORS.light.key;
    opacityEls.set(Math.round(alphaOf(raw) * 100));
  }
  for (const mode of MODES) {
    const picture = pictures[mode];
    if (!picture?.busy) setInfo(mode, describePicture(mode));
  }
}

function scheduleBake(mode, delay = 150) {
  const picture = pictures[mode];
  if (!picture) return;
  clearTimeout(picture.timer);
  picture.job += 1;
  const job = picture.job;
  picture.busy = true;
  setInfo(mode, t('bgWorking'), { busy: true });
  picture.timer = setTimeout(async () => {
    try {
      const result = await bakeSource(mode, picture.params);
      if (job !== picture.job || pictures[mode] !== picture) return;
      if (result.blob.size > MAX_IMAGE_BYTES) throw new Error('size');
      const image = await readFileAsDataUri(result.blob);
      if (job !== picture.job || pictures[mode] !== picture) return;
      picture.busy = false;
      picture.result = result;
      const first = pendingPicture[mode];
      pendingPicture[mode] = false;
      if (!commit(bgPath(mode), { type: 'image', image, align: BAKED_ALIGN })) setInfo(mode, t('bgErrEncode'), { error: true });
      // The first result makes the picture real: the "use for dark too" link and the remove button depend on it.
      else if (first) rebuildBackground();
    } catch (error) {
      if (job !== picture.job || pictures[mode] !== picture) return;
      picture.busy = false;
      setInfo(mode, error.message === 'size' ? t('bgErrSize') : t('bgErrEncode'), { error: true });
    }
  }, delay);
}

async function chooseImage(mode, file) {
  if (!file) return;
  const host = $('#messages');
  if (!(file.type.startsWith('image/') || /\.(heic|heif|avif|webp|png|jpe?g|gif|bmp)$/i.test(file.name))) { showMessage(host, t('bgErrNotImage'), { error: true }); return; }
  if (file.size > MAX_SOURCE_BYTES) { showMessage(host, t('bgErrHuge'), { error: true }); return; }
  let size;
  try {
    size = await loadSource(mode, file);
  } catch {
    showMessage(host, t('bgErrDecode'), { error: true });
    return;
  }
  clearMessage(host);
  releasePicture(mode, true);
  pictures[mode] = { file, url: URL.createObjectURL(file), width: size.width, height: size.height, params: { ...DEFAULT_PARAMS }, job: 0, timer: 0, busy: false, result: null };
  pendingPicture[mode] = true;
  rebuildBackground();
  scheduleBake(mode, 0);
}

function dropzone(mode) {
  const input = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  input.addEventListener('change', async () => { await chooseImage(mode, input.files[0]); input.value = ''; });
  const zone = h('button', { type: 'button', class: 'bg-drop', 'data-bg-kind': `${mode}-pick`, onclick: () => input.click() },
    imageIcon(), h('span', {}, t('bgChoose')));
  const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
  zone.addEventListener('dragover', (event) => { stop(event); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', async (event) => {
    stop(event);
    zone.classList.remove('over');
    document.body.classList.remove('dragging', 'dragging-image');
    await chooseImage(mode, event.dataTransfer.files[0]);
  });
  return h('div', { class: 'ctl' }, zone, input);
}

function imageIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M5 4.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5z M3.5 16l5-5 4 4 3-3 5 5 M15.5 8.5h.01');
  svg.append(path);
  return svg;
}

/** The picture at the keyboard's shape; dragging along the free axis chooses which part stays. */
function cropFrame(mode, picture) {
  const axis = slackAxis(picture.width, picture.height);
  const frame = h('div', {
    class: 'crop', tabindex: axis ? '0' : '-1', role: axis ? 'slider' : 'img', 'aria-label': axis ? t('bgPosition') : t('bgPreviewAlt'),
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(picture.params.position * 100)),
    style: `aspect-ratio: ${KEYBOARD_AREA.width} / ${KEYBOARD_AREA.height}`,
  });
  const img = h('img', { src: picture.url, alt: '', draggable: 'false' });
  frame.append(img);
  frame.classList.toggle('movable', axis !== null);
  frame.dataset.axis = axis ?? '';
  const place = () => {
    const pct = `${picture.params.position * 100}%`;
    img.style.objectPosition = axis === 'x' ? `${pct} 50%` : `50% ${pct}`;
    frame.setAttribute('aria-valuenow', String(Math.round(picture.params.position * 100)));
    frame.slider?.set(Math.round(picture.params.position * 100));
  };
  const move = (position) => {
    picture.params.position = Math.min(1, Math.max(0, position));
    place();
    scheduleBake(mode);
  };
  frame.move = move;
  if (axis) {
    let drag = null;
    frame.addEventListener('pointerdown', (event) => {
      const box = frame.getBoundingClientRect();
      const scale = Math.max(box.width / picture.width, box.height / picture.height);
      const slack = axis === 'y' ? picture.height * scale - box.height : picture.width * scale - box.width;
      drag = { start: axis === 'y' ? event.clientY : event.clientX, from: picture.params.position, slack };
      frame.setPointerCapture(event.pointerId);
      frame.classList.add('grabbing');
    });
    frame.addEventListener('pointermove', (event) => {
      if (!drag || drag.slack <= 0) return;
      const now = axis === 'y' ? event.clientY : event.clientX;
      move(drag.from - (now - drag.start) / drag.slack);
    });
    const end = () => { drag = null; frame.classList.remove('grabbing'); };
    frame.addEventListener('pointerup', end);
    frame.addEventListener('pointercancel', end);
    frame.addEventListener('keydown', (event) => {
      const step = { ArrowUp: -0.05, ArrowLeft: -0.05, ArrowDown: 0.05, ArrowRight: 0.05, Home: -1, End: 1 }[event.key];
      if (step === undefined) return;
      event.preventDefault();
      move(picture.params.position + step);
    });
  }
  place();
  return frame;
}

function imageControls(mode) {
  const bg = bgOf(mode);
  const picture = pictures[mode];
  const hasPicture = bg?.type === 'image';
  const info = h('p', { class: 'note bg-info', 'aria-live': 'polite', 'data-picture': mode });
  infoEls[mode] = info;
  if (!picture && !hasPicture) return dropzone(mode);
  const parts = [];
  if (picture) {
    const frame = cropFrame(mode, picture);
    const axis = frame.dataset.axis;
    const position = sliderRow({
      label: t('bgPosition'), min: 0, max: 100, value: Math.round(picture.params.position * 100), unit: t('unitPercent'),
      onInput: (value) => frame.move(value / 100),
    });
    frame.slider = position;
    if (!axis) { for (const input of position.querySelectorAll('input')) input.disabled = true; }
    parts.push(
      h('div', { class: 'crop-wrap' }, frame, h('p', { class: 'note' }, axis === 'y' ? t('bgPositionY') : axis === 'x' ? t('bgPositionX') : t('bgPositionFit'))),
      position,
      sliderRow({ label: t('bgBlur'), min: 0, max: BLUR_MAX, value: picture.params.blur, unit: t('unitPt'), onInput: (value) => { picture.params.blur = value; scheduleBake(mode); } }),
      sliderRow({ label: t('bgDim'), min: 0, max: Math.round(DIM_MAX * 100), value: Math.round(picture.params.dim * 100), unit: t('unitPercent'), onInput: (value) => { picture.params.dim = value / 100; scheduleBake(mode); } }),
      sliderRow({ label: t('bgBright'), min: 0, max: Math.round(BRIGHT_MAX * 100), value: Math.round(picture.params.bright * 100), unit: t('unitPercent'), onInput: (value) => { picture.params.bright = value / 100; scheduleBake(mode); } }),
    );
  } else {
    parts.push(
      h('div', { class: 'crop-wrap' }, h('div', { class: 'crop', role: 'img', 'aria-label': t('bgPreviewAlt'), style: `aspect-ratio: ${KEYBOARD_AREA.width} / ${KEYBOARD_AREA.height}` },
        h('img', { src: bg.image, alt: '', draggable: 'false', style: `object-position: 50% ${bg.align === 'top' ? '0%' : bg.align === 'bottom' ? '100%' : '50%'}` })),
      h('p', { class: 'note' }, t('bgNoSource'))),
    );
  }
  const input = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  input.addEventListener('change', async () => { await chooseImage(mode, input.files[0]); input.value = ''; });
  const actions = h('div', { class: 'bg-actions' },
    h('button', { type: 'button', class: 'btn', onclick: () => input.click() }, t('bgChange')),
    h('button', { type: 'button', class: 'btn', onclick: () => { setKind(mode, 'none'); } }, t('bgRemove')),
    input);
  info.textContent = describePicture(mode);
  return h('div', { class: 'bg-image', 'data-picture': mode }, ...parts, info, actions);
}

function modePanel(mode) {
  const kind = bgKind(mode);
  const kinds = ['none', 'solid', 'gradient', 'image'].map((value) => [value, t(`bgType_${value}`), `${mode}-${value}`]);
  const label = t('bgModeLabel', { mode: t(mode) });
  const body = [];
  if (kind === 'solid') body.push(solidControls(mode));
  else if (kind === 'gradient') body.push(...gradientControls(mode));
  else if (kind === 'image') body.push(imageControls(mode));
  const head = h('div', { class: 'bg-head' }, h('h3', {}, t(mode === 'light' ? 'modeLight' : 'modeDark')),
    segmented(label, kinds, kind, (value) => setKind(mode, value)));
  if (mode === 'light' && kind !== 'none' && !(pendingPicture.light && bgOf('light')?.type !== 'image')) {
    head.append(h('button', { type: 'button', class: 'link', onclick: copyToDark }, t('bgSame')));
  }
  return h('div', { class: 'bg-mode' }, head, ...body);
}

async function copyToDark() {
  const light = bgOf('light');
  releasePicture('dark');
  if (!light) commit(bgPath('dark'), undefined);
  else commit(bgPath('dark'), structuredClone(light));
  const picture = pictures.light;
  if (picture && light?.type === 'image') {
    try {
      await loadSource('dark', picture.file);
      pictures.dark = { ...picture, params: { ...picture.params }, url: URL.createObjectURL(picture.file), job: 0, timer: 0, busy: false, result: picture.result };
    } catch { /* the copy in the document still works; only re-editing is lost */ }
  }
  rebuildBackground();
  showMessage($('#messages'), t('bgSameDone'));
}

function applyOpacity(percent) {
  const edits = [];
  for (const mode of MODES) {
    for (const role of TRANSLUCENT_ROLES) {
      const path = `skin.variants.${mode}.colors.${role}`;
      edits.push([path, withAlpha(getPath(state.doc, path) ?? DEFAULT_COLORS[mode][role], percent / 100)]);
    }
  }
  if (!commitMany(edits)) return;
  for (const [path, value] of edits) colorCells.get(path)?.update(value);
}

function backgroundSection() {
  infoEls.light = null;
  infoEls.dark = null;
  sizeEl = h('p', { class: 'note bg-size', 'aria-live': 'polite' });
  const raw = getPath(state.doc, 'skin.variants.light.colors.key') ?? DEFAULT_COLORS.light.key;
  opacityEls = sliderRow({ label: t('keyOpacity'), min: 40, max: 100, value: Math.round(alphaOf(raw) * 100), unit: t('unitPercent'), onInput: applyOpacity });
  const panels = MODES.filter((mode) => EDITABLE.has(`skin.variants.${mode}.background`)).map(modePanel);
  const content = [h('p', { class: 'note' }, t('bgNote')), ...panels, sizeEl, h('div', { class: 'bg-opacity' }, opacityEls, h('p', { class: 'note' }, t('keyOpacityNote')))];
  queueMicrotask(syncBackgroundInfo);
  return content;
}

function moreBlock(rows) {
  const details = h('details', { class: 'more' }, h('summary', {}, t('more')), rows.map(simpleField));
  details.open = moreOpen.has('candidate');
  details.addEventListener('toggle', () => { if (details.open) moreOpen.add('candidate'); else moreOpen.delete('candidate'); });
  return details;
}

function section(name) {
  const legend = h('legend', {}, t(`secTitle_${name}`));
  let content;
  if (name === 'colors') {
    content = colorsSection();
  } else if (name === 'background') {
    content = backgroundSection();
  } else {
    // The identifier is internal: it is kept and generated, never shown.
    const rows = FIELDS.filter((row) => row.section === name && row.type !== 'id' && EDITABLE.has(row.path));
    const main = rows.filter((row) => !MORE.has(row.path));
    const more = rows.filter((row) => MORE.has(row.path));
    content = [main.map(simpleField), more.length ? moreBlock(more) : null];
  }
  return h('fieldset', { class: 'card', id: `sec-${name}` }, legend, content);
}

function buildForm() {
  hintEls.clear();
  fieldEls.clear();
  colorCells.clear();
  $('#form').replaceChildren(...SECTIONS.map(section));
  updateHints();
  updateEnabled();
  updateBarHint();
}

// ------------------------------------------------------------------ chrome (language, presets, toggles)
function applyLanguage() {
  t = translator(state.lang);
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  document.title = t('title');
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-aria]')) node.setAttribute('aria-label', t(node.dataset.i18nAria));
  for (const button of document.querySelectorAll('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === state.lang));
  const select = $('#preset');
  select.replaceChildren(
    h('option', { value: '', disabled: true, selected: true }, t('startMenu')),
    ...PRESETS.map((preset) => h('option', { value: preset.id }, preset.names[state.lang])));
  select.value = '';
  $('#paste-text').setAttribute('placeholder', '{ "formatVersion": 1, … }');
  buildForm();
  refreshPreview();
  $('#doc-name').textContent = state.doc.name;
}

function setToggle(group, attr, value) {
  for (const button of document.querySelectorAll(`${group} button`)) button.setAttribute('aria-pressed', String(button.dataset[attr] === value));
}

// ------------------------------------------------------------------ importing
const builtinIds = new Set(PRESETS.map((preset) => preset.id));

/** The document with each picture replaced by its length and a hash, so the baseline stays small. */
function lightweight(doc) {
  const copy = structuredClone(doc);
  for (const mode of MODES) {
    const bg = getPath(copy, bgPath(mode));
    if (bg?.type !== 'image') continue;
    let hash = 2166136261;
    for (let i = 0; i < bg.image.length; i += 1) hash = Math.imul(hash ^ bg.image.charCodeAt(i), 16777619) >>> 0;
    bg.image = `${bg.image.slice(0, bg.image.indexOf(',') + 1)}${bg.image.length}.${hash}`;
  }
  return copy;
}

function setBaseline() {
  store.set(BASELINE_KEY, JSON.stringify(lightweight(state.doc)));
}

/** Whether the draft differs from where it started. A missing starting point counts as changed. */
function isDirty() {
  const saved = store.get(BASELINE_KEY);
  if (!saved) return true;
  try {
    return !sameDocument(lightweight(state.doc), JSON.parse(saved));
  } catch {
    return true;
  }
}

function adopt(document_, message) {
  // A copy of a built-in must not reuse its identity, or importing the export would collide with it.
  state.doc = builtinIds.has(document_.id) ? withNewIdentity(document_) : document_;
  state.expanded = false;
  releaseAllPictures();
  setBaseline();
  buildForm();
  afterChange();
  if (message) showMessage($('#messages'), message);
}

/** Reads text and makes it the draft. Returns null on success, or the error. */
function tryImport(text) {
  try {
    const { document: imported, kind } = decodeImported(text);
    const key = { document: 'importedDocument', skin: 'importedSkin', candidateBar: 'importedCandidateBar' }[kind];
    adopt(imported, t(key, { name: imported.name }));
    return null;
  } catch (error) {
    return error;
  }
}

async function importFile(file) {
  if (!file) return;
  if (file.size > MAX_IMAGE_DOCUMENT_BYTES) { showError($('#messages'), new FormatError(ErrorCode.OVERSIZE, '$')); return; }
  const error = tryImport(await file.text());
  if (error) showError($('#messages'), error);
}

function startFromPreset(id) {
  const preset = presetById(id);
  if (!preset) return;
  const name = preset.names[state.lang];
  adopt(withNewIdentity(preset.document, `${name}${state.lang === 'zh' ? ' 副本' : ' copy'}`));
  showMessage($('#messages'), t('started', { name }));
}

// ------------------------------------------------------------------ paste dialog
function openPasteDialog() {
  const dialog = $('#paste-dialog');
  $('#paste-error').textContent = '';
  $('#paste-text').removeAttribute('aria-invalid');
  dialog.showModal();
  $('#paste-text').focus();
}

function submitPaste(event) {
  event.preventDefault();
  const area = $('#paste-text');
  const fail = (text) => { $('#paste-error').textContent = text; area.setAttribute('aria-invalid', 'true'); area.focus(); };
  if (area.value.trim() === '') { fail(t('pasteEmpty')); return; }
  const error = tryImport(area.value);
  if (error instanceof FormatError) {
    const { message, path } = describeError(state.lang, error);
    fail(path && path !== '$' ? `${message}（${t('errAt', { path })}）` : message);
  } else if (error) {
    fail(t('errGeneric'));
  } else {
    area.value = '';
    $('#paste-dialog').close();
  }
}

// ------------------------------------------------------------------ export
function currentText() {
  try {
    return encodeDocument(state.doc);
  } catch (error) {
    showError($('#export-messages'), error);
    return null;
  }
}

function fileName() {
  const base = state.doc.name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '') || 'appearance';
  return `${base}${FILE_EXTENSION}`;
}

function download() {
  const text = currentText();
  if (text === null) return;
  const name = fileName();
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = h('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showMessage($('#export-messages'), t('downloaded', { file: name }));
}

async function copyJson() {
  const text = currentText();
  if (text === null) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;opacity:0' }, text);
    document.body.append(area);
    area.select();
    const ok = document.execCommand?.('copy');
    area.remove();
    if (!ok) { showMessage($('#export-messages'), t('copyFailed'), { error: true }); return; }
  }
  showMessage($('#export-messages'), t('copied'));
}

function shareFile() {
  const text = currentText();
  return text === null ? null : new File([text], fileName(), { type: 'application/json' });
}

async function share() {
  const file = shareFile();
  if (!file) return;
  try {
    await navigator.share({ files: [file], title: state.doc.name });
  } catch (error) {
    if (error?.name !== 'AbortError') showMessage($('#export-messages'), t('shareFailed'), { error: true });
  }
}

function canShareFiles() {
  try {
    const probe = new File(['{}'], 'x.songyanappearance.json', { type: 'application/json' });
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ boot
function loadInitialDocument() {
  const saved = store.get(DRAFT_KEY);
  if (saved) {
    try {
      state.doc = readDocument(JSON.parse(saved));
      return true;
    } catch { /* an old or damaged draft is dropped */ }
  }
  state.doc = withNewIdentity(presetById('builtin-songyan').document, '我的键盘外观');
  setBaseline();
  return false;
}

/** On a narrow screen the preview sticks to the top; headings and focused fields must stay below it. */
function trackStickyOffset() {
  const column = $('.preview-col');
  const narrow = window.matchMedia('(max-width: 820px)');
  const update = () => document.documentElement.style.setProperty('--sticky-offset', narrow.matches ? `${column.offsetHeight}px` : '0px');
  new ResizeObserver(update).observe(column);
  narrow.addEventListener('change', update);
  update();
}

function wire() {
  for (const button of document.querySelectorAll('[data-lang]')) {
    button.addEventListener('click', () => { state.lang = button.dataset.lang; store.set(LANG_KEY, state.lang); applyLanguage(); });
  }
  for (const button of document.querySelectorAll('#top-seg button')) {
    button.addEventListener('click', () => { state.top = button.dataset.top; setToggle('#top-seg', 'top', state.top); refreshPreview(); });
  }
  for (const button of document.querySelectorAll('#mode-seg button')) {
    button.addEventListener('click', () => { state.mode = button.dataset.mode; setToggle('#mode-seg', 'mode', state.mode); refreshPreview(); });
  }
  for (const button of document.querySelectorAll('#platform-seg button')) {
    button.addEventListener('click', () => { state.platform = button.dataset.platform; setToggle('#platform-seg', 'platform', state.platform); refreshPreview(); });
  }
  $('#preset').addEventListener('change', (event) => {
    const select = event.target;
    const id = select.value;
    select.value = '';
    if (!id) return;
    if (isDirty() && !window.confirm(t('confirmReplace'))) return;
    startFromPreset(id);
  });
  $('#import-btn').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', async (event) => { await importFile(event.target.files[0]); event.target.value = ''; });
  $('#paste-btn').addEventListener('click', openPasteDialog);
  $('#paste-form').addEventListener('submit', submitPaste);
  $('#paste-cancel').addEventListener('click', () => $('#paste-dialog').close());
  $('#download-btn').addEventListener('click', download);
  $('#copy-btn').addEventListener('click', copyJson);
  $('#share-btn').addEventListener('click', share);
  $('#share-btn').hidden = !canShareFiles();

  let depth = 0;
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  const isPicture = (event) => [...(event.dataTransfer?.items ?? [])].some((item) => item.kind === 'file' && item.type.startsWith('image/'));
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    depth += 1;
    // A picture is for a background picture area, not for importing; those areas light up instead of the page.
    document.body.classList.add(isPicture(event) ? 'dragging-image' : 'dragging');
  });
  window.addEventListener('dragover', (event) => { if (hasFiles(event)) event.preventDefault(); });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (depth === 0) document.body.classList.remove('dragging', 'dragging-image'); });
  window.addEventListener('drop', async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging', 'dragging-image');
    const file = event.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) { showMessage($('#messages'), t('bgDropElsewhere')); return; }
    await importFile(file);
  });
  trackStickyOffset();
}

const savedLang = store.get(LANG_KEY);
if (LANGS.includes(savedLang)) state.lang = savedLang;
const restored = loadInitialDocument();
wire();
applyLanguage();
if (restored) showMessage($('#messages'), t('restored'));
window.__songyanReady = true;
