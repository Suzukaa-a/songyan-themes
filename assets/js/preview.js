// Draws a 26-key pinyin keyboard and its candidate bar from a normalised appearance document.
// Only DOM nodes and CSS variables: no images, no network.

import { resolvedColors } from './format.js';

const FONT_STACKS = {
  system: 'system-ui, -apple-system, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", system-ui, sans-serif',
  serif: '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", Georgia, serif',
  monospaced: 'ui-monospace, "SF Mono", Menlo, Consolas, "Noto Sans Mono CJK SC", monospace',
};
const WEIGHTS = { regular: 400, medium: 500, semibold: 600 };

const CANDIDATES = ['你好', '拟好', '你', '尼', '泥', '呢', '妮', '拟', '逆', '倪', '腻', '匿'];
const LONG_CANDIDATES = ['你好，欢迎使用松烟输入法', '拟好了今天的计划'];
const NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'],
];

/** The collapsed strip's height: the configured value, topped up for large candidate text (same rule as the apps). */
export function effectiveBarHeight(height, candidateSize) {
  const clamped = Math.min(Math.max(height, 36), 56);
  return Math.max(clamped, Math.max(Math.ceil(candidateSize * 1.25 + 3), 36));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function backgroundCss(skin, mode, colors) {
  const background = skin.variants?.[mode]?.background;
  if (!background) return colors.panel;
  if (background.type === 'solid') return background.color;
  return `linear-gradient(to bottom, ${background.from}, ${background.to})`;
}

/**
 * options: { mode: 'light'|'dark', platform: 'android'|'iphone', expanded: bool, t, onToggleExpand }
 * `document` must be normalised.
 */
export function renderPreview(host, doc, options) {
  const { mode, platform, expanded, t, onToggleExpand } = options;
  const { skin, candidateBar: bar } = doc;
  const colors = resolvedColors(skin, mode);
  const type = skin.typography;
  const keycap = skin.keycap;
  const spacing = skin.spacing;

  host.replaceChildren();
  host.dataset.platform = platform;
  host.dataset.mode = mode;
  const stage = el('div', 'pv-stage');
  const keyboard = el('div', 'pv-keyboard');
  const style = keyboard.style;
  for (const [role, hex] of Object.entries(colors)) style.setProperty(`--c-${role}`, hex);
  style.setProperty('--font', FONT_STACKS[type.family]);
  style.setProperty('--weight', WEIGHTS[type.weight]);
  style.setProperty('--key-size', `${type.keySize}px`);
  style.setProperty('--small-size', `${type.secondarySize}px`);
  style.setProperty('--cand-size', `${type.candidateSize}px`);
  style.setProperty('--radius', `${keycap.cornerRadius}px`);
  style.setProperty('--border', `${keycap.borderWidth}px`);
  style.setProperty('--shadow', keycap.shadow === 'subtle' ? '0 1px 0 rgba(0, 0, 0, 0.3)' : 'none');
  style.setProperty('--inset-x', `${spacing.visualInsetX}px`);
  style.setProperty('--inset-y', `${spacing.visualInsetY}px`);
  style.setProperty('--bar-height', `${effectiveBarHeight(bar.collapsed.height, type.candidateSize)}px`);
  style.setProperty('--cell-pad', `${bar.collapsed.cellPaddingX}px`);
  style.setProperty('--cell-gap', `${bar.collapsed.cellSpacing}px`);
  style.setProperty('--row-gap', `${bar.expanded.rowSpacing}px`);
  style.setProperty('--col-gap', `${bar.expanded.columnSpacing}px`);
  style.setProperty('--columns', String(bar.expanded.mode === 'list' ? 1 : bar.expanded.columns));
  // iPhone: the system draws the keyboard background, so the skin's panel colour and background are ignored.
  if (platform === 'android') style.setProperty('--surface', backgroundCss(skin, mode, colors));

  const composition = bar.compositionRow.visible;
  if (composition !== 'hidden') {
    const row = el('div', 'pv-composition');
    row.append(el('span', 'pv-preedit', t('composing')));
    if (composition === 'composingWithIdleRaw') row.dataset.idle = 'true';
    keyboard.append(row);
  }

  keyboard.append(buildStrip(bar, t, expanded, onToggleExpand));
  keyboard.append(expanded ? buildExpanded(bar) : buildKeys(t));
  stage.append(keyboard);
  host.append(stage);
}

function control(label, glyph, className = '') {
  const node = el('span', `pv-control ${className}`.trim(), glyph);
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', label);
  return node;
}

function buildStrip(bar, t, expanded, onToggleExpand) {
  const strip = el('div', 'pv-strip');
  const { pagePosition, showsExpand } = bar.controls;
  const prev = () => control(t('prevPage'), '‹');
  const next = () => control(t('nextPage'), '›');
  if (pagePosition === 'both') strip.append(prev());
  if (pagePosition === 'leading') strip.append(prev(), next());

  const cells = el('div', 'pv-cells');
  if (bar.collapsed.fillsAvailableWidth === false) cells.dataset.natural = 'true';
  CANDIDATES.slice(0, 6).forEach((text, index) => {
    const cell = el('span', 'pv-cell', text);
    if (index === 0) cell.dataset.selected = 'true';
    cells.append(cell);
  });
  strip.append(cells);

  if (pagePosition === 'both') strip.append(next());
  if (pagePosition === 'trailing') strip.append(prev(), next());
  if (showsExpand) {
    const button = el('button', 'pv-control pv-expand', expanded ? '⌃' : '⌄');
    button.type = 'button';
    button.setAttribute('aria-label', expanded ? t('collapseTip') : t('expandTip'));
    button.setAttribute('aria-pressed', String(expanded));
    button.addEventListener('click', onToggleExpand);
    strip.append(button);
  }
  return strip;
}

function buildExpanded(bar) {
  const { mode, fullRowTextLength } = bar.expanded;
  const area = el('div', `pv-expanded pv-${mode}`);
  const items = [...CANDIDATES, ...LONG_CANDIDATES, ...CANDIDATES.slice(2, 8)];
  items.forEach((text, index) => {
    const item = el('span', 'pv-item');
    item.append(el('span', 'pv-item-text', text));
    if (mode === 'list') item.append(el('span', 'pv-item-note', index % 3 === 0 ? 'nǐ hǎo' : ''));
    if ([...text].length > fullRowTextLength) item.dataset.full = 'true';
    if (index === 0) item.dataset.selected = 'true';
    area.append(item);
  });
  return area;
}

function key(label, className = '', small = '') {
  const node = el('button', `pv-key ${className}`.trim());
  node.type = 'button';
  node.tabIndex = -1;
  node.setAttribute('aria-hidden', 'true');
  const face = el('span', 'pv-face');
  face.append(el('span', 'pv-label', label));
  if (small) face.append(el('span', 'pv-small', small));
  node.append(face);
  const press = () => node.classList.add('down');
  const release = () => node.classList.remove('down');
  node.addEventListener('pointerdown', press);
  for (const name of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(name, release);
  return node;
}

function buildKeys(t) {
  const keys = el('div', 'pv-keys');
  ROWS.forEach((letters, rowIndex) => {
    const row = el('div', `pv-row pv-row-${rowIndex}`);
    letters.forEach((letter, index) => {
      const special = letter === '⇧' || letter === '⌫';
      const node = key(special ? letter : letter.toUpperCase(), special ? 'control wide' : '', rowIndex === 0 ? NUMBERS[index] : '');
      row.append(node);
    });
    keys.append(row);
  });
  const bottom = el('div', 'pv-row pv-row-3');
  bottom.append(key('123', 'control wide'), key('，', 'control'), key(t('space'), 'space'), key('。', 'control'), key(t('enter'), 'accent wide'));
  keys.append(bottom);
  return keys;
}
