// The editor page. The form is built from the field table in format.js. Only settings that both apps read
// are offered (see EDITABLE); every other field stays in the document exactly as it came from the starting
// look or the imported file, so exports never lose anything.

import {
  FIELDS, COLOR_NAMES, MODES, FILE_EXTENSION, MAX_DOCUMENT_BYTES, FormatError, ErrorCode, CONTRAST_PAIRS,
  decodeImported, encodeDocument, normalizeDocument, readDocument, resolvedColors, getPath, setPath,
  withNewIdentity, parseHexInput, sameDocument,
} from './format.js';
import { PRESETS, presetById } from './presets.js';
import { translator, describeError, LANGS } from './i18n.js';
import { renderPreview } from './preview.js';

const DRAFT_KEY = 'songyan-themes.draft.v1';
const BASELINE_KEY = 'songyan-themes.baseline.v1';
const LANG_KEY = 'songyan-themes.lang';
const SECTIONS = ['basic', 'colors', 'keycap', 'candidate'];

/**
 * The fields the editor shows: the ones Android and iPhone both read. Android takes only the skin's colours
 * and whether a key border exists, and from the candidate bar only the height, padding, spacing and the
 * expanded layout; the rest of a file is kept untouched but not offered.
 */
const EDITABLE = new Set([
  'name', 'author', 'appearance',
  'skin.keycap.borderWidth',
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

// ------------------------------------------------------------------ storage (may be blocked on file://)
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode or blocked */ } },
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
  $('#doc-name').textContent = state.doc.name;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(DRAFT_KEY, JSON.stringify(state.doc)), 250);
}

function commit(path, value) {
  const next = structuredClone(state.doc);
  setPath(next, path, value);
  if (path === 'name') {
    next.skin.name = value;
    next.candidateBar.name = value;
  }
  try {
    state.doc = readDocument(next);
  } catch (error) {
    showError($('#messages'), error);
    return false;
  }
  afterChange();
  return true;
}

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
 * A swatch that opens the system colour picker beside a hex box. `onCommit` gets only valid `#RRGGBB`
 * values. The box takes `#abc`, `abc` and `#aabbcc`; it is rewritten to `#RRGGBB` when you leave it, and a
 * value that is not a colour is marked but kept so you can fix it.
 */
function colorCell({ id, label, value, onCommit }) {
  let committed = value.toUpperCase();
  const picker = h('input', { type: 'color', 'aria-label': t('colorPickerLabel', { label }), value: value.toLowerCase() });
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
    picker.value = parsed.toLowerCase();
    if (parsed !== committed) { committed = parsed; onCommit(parsed); }
  };
  picker.addEventListener('input', () => { hex.value = picker.value.toUpperCase(); accept(picker.value.toUpperCase()); });
  hex.addEventListener('input', () => {
    // Only a complete six-digit colour applies while typing; #abc waits for Enter or leaving the box.
    const parsed = /^\s*#?[0-9a-fA-F]{6}\s*$/.test(hex.value) ? parseHexInput(hex.value) : null;
    if (parsed) accept(parsed); else if (box.classList.contains('invalid')) setInvalid(false);
  });
  const finish = () => {
    const parsed = parseHexInput(hex.value);
    if (parsed) { hex.value = parsed; accept(parsed); } else setInvalid(true);
  };
  hex.addEventListener('blur', finish);
  hex.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); finish(); } });
  return h('div', { class: 'color-wrap' }, box, message);
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
  } else {
    // The identifier is internal: it is kept and generated, never shown.
    const rows = FIELDS.filter((row) => row.section === name && row.type !== 'id' && EDITABLE.has(row.path));
    const main = rows.filter((row) => !MORE.has(row.path));
    const more = rows.filter((row) => MORE.has(row.path));
    content = [main.map(simpleField), more.length ? moreBlock(more) : null];
  }
  return h('fieldset', { class: 'card' }, legend, content);
}

function buildForm() {
  hintEls.clear();
  fieldEls.clear();
  $('#form').replaceChildren(...SECTIONS.map(section));
  updateHints();
  updateEnabled();
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

function setBaseline() {
  store.set(BASELINE_KEY, JSON.stringify(state.doc));
}

/** Whether the draft differs from where it started. A missing starting point counts as changed. */
function isDirty() {
  const saved = store.get(BASELINE_KEY);
  if (!saved) return true;
  try {
    return !sameDocument(state.doc, JSON.parse(saved));
  } catch {
    return true;
  }
}

function adopt(document_, message) {
  // A copy of a built-in must not reuse its identity, or importing the export would collide with it.
  state.doc = builtinIds.has(document_.id) ? withNewIdentity(document_) : document_;
  state.expanded = false;
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
  if (file.size > MAX_DOCUMENT_BYTES) { showError($('#messages'), new FormatError(ErrorCode.OVERSIZE, '$')); return; }
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
  window.addEventListener('dragenter', (event) => { if (hasFiles(event)) { depth += 1; document.body.classList.add('dragging'); } });
  window.addEventListener('dragover', (event) => { if (hasFiles(event)) event.preventDefault(); });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (depth === 0) document.body.classList.remove('dragging'); });
  window.addEventListener('drop', async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    await importFile(event.dataTransfer.files[0]);
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
