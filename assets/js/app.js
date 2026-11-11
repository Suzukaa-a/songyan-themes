// The editor page. The form is built from the field table in format.js; nothing here knows a field by name
// except where the UI needs a special control (colours, backgrounds, the optional width switch).

import {
  FIELDS, COLOR_NAMES, MODES, FILE_EXTENSION, MAX_DOCUMENT_BYTES, FormatError, ErrorCode, CONTRAST_PAIRS,
  decodeImported, encodeDocument, normalizeDocument, readDocument, resolvedColors, getPath, setPath,
  withNewIdentity, isHexColor,
} from './format.js';
import { PRESETS, presetById } from './presets.js';
import { translator, describeError, LANGS } from './i18n.js';
import { renderPreview } from './preview.js';

const DRAFT_KEY = 'songyan-themes.draft.v1';
const LANG_KEY = 'songyan-themes.lang';
const SECTIONS = ['basic', 'colors', 'background', 'typography', 'keycap', 'spacing', 'candidate'];

const state = { lang: 'zh', doc: null, mode: 'light', platform: 'android', expanded: false };
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
  node.append(...children.flat().filter((child) => child !== null && child !== undefined));
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
  renderPreview($('#preview'), normalizeDocument(state.doc), {
    mode: state.mode,
    platform: state.platform,
    expanded: state.expanded,
    t,
    onToggleExpand: () => { state.expanded = !state.expanded; refreshPreview(); },
  });
  $('#iphone-note').hidden = state.platform !== 'iphone';
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

// ------------------------------------------------------------------ controls
const labelFor = (row) => t(`f.${row.relative ?? row.path}`);
const valueLabel = (row, value) => t(`v.${row.relative ?? row.path}.${value}`);

function numberControl(row, id) {
  const value = getPath(state.doc, row.path);
  const range = h('input', { type: 'range', min: row.min, max: row.max, step: row.step, value, 'aria-label': labelFor(row), tabindex: '-1' });
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
    number.toggleAttribute('aria-invalid', !ok);
    if (number.hasAttribute('aria-invalid')) number.setAttribute('aria-invalid', 'true');
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
  return h('div', { class: 'ctl' }, range, number, row.type === 'int' ? null : h('span', { class: 'unit' }, t('unitPt')));
}

function enumControl(row, id) {
  const current = getPath(state.doc, row.path);
  const select = h('select', { id }, row.values.map((value) => h('option', { value, selected: value === current }, valueLabel(row, value))));
  select.addEventListener('change', () => commit(row.path, select.value));
  return h('div', { class: 'ctl' }, select);
}

function triStateControl(row, id) {
  const current = getPath(state.doc, row.path);
  const key = current === undefined ? 'unset' : String(current);
  const select = h('select', { id }, ['unset', 'true', 'false'].map((value) => h('option', { value, selected: value === key }, t(`v.${row.relative}.${value}`))));
  select.addEventListener('change', () => commit(row.path, select.value === 'unset' ? undefined : select.value === 'true'));
  return h('div', { class: 'ctl' }, select);
}

function boolControl(row, id) {
  const box = h('input', { type: 'checkbox', id, checked: Boolean(getPath(state.doc, row.path)) });
  box.addEventListener('change', () => commit(row.path, box.checked));
  return h('div', { class: 'ctl' }, box);
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

/** A colour picker plus a hex box; `onCommit` gets only valid `#RRGGBB` values. */
function colorCell({ id, label, value, onCommit }) {
  const picker = h('input', { type: 'color', 'aria-label': label, value: value.toLowerCase(), tabindex: '-1' });
  const hex = h('input', { type: 'text', id, maxlength: 7, value: value.toUpperCase(), spellcheck: 'false', autocomplete: 'off', 'aria-label': t('colorHexLabel', { label }) });
  picker.addEventListener('input', () => {
    hex.value = picker.value.toUpperCase();
    hex.removeAttribute('aria-invalid');
    onCommit(hex.value);
  });
  hex.addEventListener('input', () => {
    const text = hex.value.trim();
    const ok = isHexColor(text);
    if (ok) { hex.removeAttribute('aria-invalid'); picker.value = text.toLowerCase(); onCommit(text.toUpperCase()); }
    else hex.setAttribute('aria-invalid', 'true');
  });
  hex.addEventListener('blur', () => {
    if (!isHexColor(hex.value.trim())) { hex.value = picker.value.toUpperCase(); hex.removeAttribute('aria-invalid'); }
  });
  return h('div', { class: 'color-cell' }, picker, hex);
}

function fieldRow(row, control, id) {
  return h('div', { class: 'field' }, h('label', { for: id }, labelFor(row)), control);
}

function simpleField(row) {
  const id = nextId('f');
  let control;
  if (row.type === 'number' || row.type === 'int') control = numberControl(row, id);
  else if (row.type === 'enum') control = enumControl(row, id);
  else if (row.type === 'bool' && row.optional) control = triStateControl(row, id);
  else if (row.type === 'bool') control = boolControl(row, id);
  else control = textControl(row, id, row.type === 'id' ? 80 : 60);
  const field = fieldRow(row, control, id);
  if (row.path === 'candidateBar.expanded.columns') field.append(h('div', { class: 'hint' }, t('gridOnly')));
  return field;
}

// ------------------------------------------------------------------ sections
function colorsSection() {
  const rows = FIELDS.filter((row) => row.section === 'colors');
  const grid = h('div', { class: 'color-grid' },
    h('span', { class: 'head head-role' }, ''),
    h('span', { class: 'head' }, t('modeLight')),
    h('span', { class: 'head' }, t('modeDark')));
  for (const role of COLOR_NAMES) {
    const roleId = nextId('role');
    grid.append(h('span', { class: 'role', id: roleId }, t(`role.${role}`)));
    for (const mode of MODES) {
      const row = rows.find((candidate) => candidate.role === role && candidate.mode === mode);
      const label = `${t(`role.${role}`)}（${t(mode)}）`;
      const cell = colorCell({
        id: nextId('c'), label, value: getPath(state.doc, row.path), onCommit: (hex) => commit(row.path, hex),
      });
      if (role in CONTRAST_PAIRS) {
        const hint = h('div', { class: 'hint', 'aria-live': 'polite' });
        hintEls.set(`${mode}.${role}`, hint);
        const wrap = h('div', {}, cell, hint);
        grid.append(wrap);
      } else {
        grid.append(cell);
      }
    }
  }
  return [h('p', { class: 'note' }, t('colorsNote')), grid];
}

function backgroundBlock(row) {
  const mode = row.mode;
  const base = `skin.variants.${mode}`;
  const selectId = nextId('bg');
  const body = h('div', { class: 'bg-body' });
  const select = h('select', { id: selectId });
  const render = () => {
    const background = getPath(state.doc, row.path);
    const type = background?.type ?? 'none';
    select.replaceChildren(...[['none', 'bgNone'], ['solid', 'bgSolid'], ['linearGradient', 'bgGradient']]
      .map(([value, key]) => h('option', { value, selected: value === type }, t(key))));
    const cells = [];
    const add = (key, labelKey) => {
      const id = nextId('bgc');
      const label = `${t(labelKey)}（${t(mode)}）`;
      cells.push(h('div', { class: 'field' }, h('label', { for: id }, t(labelKey)),
        colorCell({ id, label, value: background[key], onCommit: (hex) => commit(`${row.path}.${key}`, hex) })));
    };
    if (type === 'solid') add('color', 'bgColor');
    if (type === 'linearGradient') { add('from', 'bgFrom'); add('to', 'bgTo'); }
    body.replaceChildren(...cells);
  };
  select.addEventListener('change', () => {
    const panel = getPath(state.doc, `${base}.colors.panel`);
    const control = getPath(state.doc, `${base}.colors.control`);
    const next = {
      none: undefined,
      solid: { type: 'solid', color: panel },
      linearGradient: { type: 'linearGradient', from: panel, to: control, direction: 'vertical' },
    }[select.value];
    commit(row.path, next);
    render();
  });
  render();
  return h('div', { class: 'bg-block' }, h('div', { class: 'field' }, h('label', { for: selectId }, `${t('f.background')}（${t(mode)}）`), h('div', { class: 'ctl' }, select)), body);
}

function section(name) {
  const title = t(`secTitle_${name}`);
  const legend = h('legend', {}, title);
  let content;
  if (name === 'colors') content = colorsSection();
  else if (name === 'background') {
    content = [h('p', { class: 'note' }, t('backgroundAndroidOnly')), ...FIELDS.filter((row) => row.section === 'background').map(backgroundBlock)];
  } else {
    // The identifier is internal: it is kept and generated, never shown.
    content = FIELDS.filter((row) => row.section === name && row.type !== 'id').map(simpleField);
  }
  return h('fieldset', { class: 'card' }, legend, content);
}

function buildForm() {
  hintEls.clear();
  $('#form').replaceChildren(...SECTIONS.map(section));
  updateHints();
}

// ------------------------------------------------------------------ chrome (language, presets, toggles)
function applyLanguage() {
  t = translator(state.lang);
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  document.title = t('title');
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const button of document.querySelectorAll('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === state.lang));
  const select = $('#preset');
  const selected = select.value || PRESETS[1].id;
  select.replaceChildren(...PRESETS.map((preset) => h('option', { value: preset.id, selected: preset.id === selected }, preset.names[state.lang])));
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

function adopt(document_, message) {
  // A copy of a built-in must not reuse its identity, or importing the export would collide with it.
  state.doc = builtinIds.has(document_.id) ? withNewIdentity(document_) : document_;
  state.expanded = false;
  buildForm();
  afterChange();
  if (message) showMessage($('#messages'), message);
}

function importText(text) {
  try {
    const { document: imported, kind } = decodeImported(text);
    const key = { document: 'importedDocument', skin: 'importedSkin', candidateBar: 'importedCandidateBar' }[kind];
    adopt(imported, t(key, { name: imported.name }));
    return true;
  } catch (error) {
    showError($('#messages'), error);
    return false;
  }
}

async function importFile(file) {
  if (!file) return;
  if (file.size > MAX_DOCUMENT_BYTES) { showError($('#messages'), new FormatError(ErrorCode.OVERSIZE, '$')); return; }
  importText(await file.text());
}

function startFromPreset() {
  const preset = presetById($('#preset').value);
  if (!preset) return;
  const name = preset.names[state.lang];
  adopt(withNewIdentity(preset.document, `${name}${state.lang === 'zh' ? ' 副本' : ' copy'}`));
  showMessage($('#messages'), t('started', { name }));
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
  return false;
}

function wire() {
  for (const button of document.querySelectorAll('[data-lang]')) {
    button.addEventListener('click', () => { state.lang = button.dataset.lang; store.set(LANG_KEY, state.lang); applyLanguage(); });
  }
  for (const button of document.querySelectorAll('#mode-seg button')) {
    button.addEventListener('click', () => { state.mode = button.dataset.mode; setToggle('#mode-seg', 'mode', state.mode); refreshPreview(); });
  }
  for (const button of document.querySelectorAll('#platform-seg button')) {
    button.addEventListener('click', () => { state.platform = button.dataset.platform; setToggle('#platform-seg', 'platform', state.platform); refreshPreview(); });
  }
  $('#start-btn').addEventListener('click', startFromPreset);
  $('#import-btn').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', async (event) => { await importFile(event.target.files[0]); event.target.value = ''; });
  $('#paste-btn').addEventListener('click', () => { if (importText($('#paste-text').value)) $('#paste-text').value = ''; });
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
}

const savedLang = store.get(LANG_KEY);
if (LANGS.includes(savedLang)) state.lang = savedLang;
const restored = loadInitialDocument();
wire();
applyLanguage();
if (restored) showMessage($('#messages'), t('restored'));
window.__songyanReady = true;
