// Draws the keyboard the way the apps do, from a normalised appearance document.
// Only DOM nodes, inline SVG and CSS variables: no images, no network.
//
// Every size is a number in the app's own units (dp on Android, pt on iPhone). CSS turns a number into
// pixels with `--u`, the preview's real width divided by the reference width, so the keyboard keeps its
// proportions at any width.
//
// The two apps do not read the same values:
//  - Android takes only the colours (and whether a key border exists) from the skin. Key size, gaps,
//    corner radius and type are the keyboard's own and the same for every skin. Its candidate row takes
//    the bar's height, padding and spacing only when they differ from the default bar.
//  - iPhone draws the keys from the skin's own numbers on top of the system keyboard surface.

import { resolvedColors, contrasting } from './format.js';

const GRADIENT_ANGLE = { vertical: 'to bottom', horizontal: 'to right', diagonal: 'to bottom right' };

/** Blob URLs for background images, so a big data URI is not parsed again on every redraw. */
const urlCache = new Map();
function imageUrl(dataUri) {
  if (urlCache.has(dataUri)) {
    const url = urlCache.get(dataUri);
    urlCache.delete(dataUri);
    urlCache.set(dataUri, url);
    return url;
  }
  let url;
  try {
    const comma = dataUri.indexOf(',');
    const binary = atob(dataUri.slice(comma + 1));
    const mime = /^data:([^;]+);/.exec(dataUri)?.[1] ?? 'image/png';
    url = URL.createObjectURL(new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type: mime }));
  } catch {
    return null;
  }
  urlCache.set(dataUri, url);
  while (urlCache.size > 4) {
    const [oldest, oldUrl] = urlCache.entries().next().value;
    urlCache.delete(oldest);
    URL.revokeObjectURL(oldUrl);
  }
  return url;
}

/**
 * The CSS background of the Android keyboard: the panel colour, with the skin's background drawn over it. Returns
 * null for none. The image is scaled to cover and centred across, placed up or down by `align`, as in the app.
 */
export function backgroundCss(background, urlFor = imageUrl) {
  if (!background) return null;
  if (background.type === 'solid') return `linear-gradient(${background.color}, ${background.color})`;
  if (background.type === 'linearGradient') {
    const stops = background.colors ?? [background.from, background.to];
    return `linear-gradient(${GRADIENT_ANGLE[background.direction]}, ${stops.join(', ')})`;
  }
  if (background.type === 'image') {
    const url = urlFor(background.image);
    return url ? `url("${url}") center ${background.align} / cover no-repeat` : null;
  }
  return null;
}

const SYSTEM_FONT = 'system-ui, -apple-system, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
const FONT_STACKS = {
  system: SYSTEM_FONT,
  rounded: 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", system-ui, sans-serif',
  serif: '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", Georgia, serif',
  monospaced: 'ui-monospace, "SF Mono", Menlo, Consolas, "Noto Sans Mono CJK SC", monospace',
};
const WEIGHTS = { regular: 400, medium: 500, semibold: 600 };

/** The surface iOS draws under every keyboard (measured in the simulator); the skin's panel colour and background do not reach it. */
export const IOS_SURFACE = Object.freeze({ light: '#E0E1E8', dark: '#222223' });

/** The default candidate bar. Android treats a value equal to it as "not customised". */
const DEFAULT_BAR = Object.freeze({ height: 40, cellPaddingX: 7, cellSpacing: 0 });
const KEY_ROWS = 4;

const CANDIDATES = ['你好', '拟好', '你', '尼', '泥', '呢', '妮', '拟', '逆', '倪', '腻', '匿'];
const LONG_CANDIDATES = ['你好，欢迎使用松烟输入法', '拟好了今天的计划'];
const HINTS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const LETTER_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/** The collapsed strip's height: the configured value, topped up for large candidate text (same rule as the apps). */
export function effectiveBarHeight(height, candidateSize) {
  const clamped = clamp(height, 36, 56);
  return Math.max(clamped, Math.max(Math.ceil(candidateSize * 1.25 + 3), 36));
}

/**
 * What Android draws for the candidate bar's numbers (CandidateBarStyle.of): the platform's 48 dp row, 10 dp
 * cell padding and no gap while a value equals the system default's, otherwise the value plus an offset (8 dp
 * of height with a 48 dp floor, 3 dp of padding). Kept apart so it can follow the app if that changes.
 */
export function androidBar(collapsed) {
  const customHeight = collapsed.height !== DEFAULT_BAR.height;
  const customPadding = collapsed.cellPaddingX !== DEFAULT_BAR.cellPaddingX;
  return {
    height: customHeight ? Math.max(48, clamp(collapsed.height, 36, 56) + 8) : 48,
    chipPad: customPadding ? collapsed.cellPaddingX + 3 : 10,
    cellSpacing: collapsed.cellSpacing !== DEFAULT_BAR.cellSpacing ? collapsed.cellSpacing : 0,
  };
}

/** Everything the drawing needs as plain numbers, so the rules are testable without a DOM. */
export function previewMetrics(platform, doc) {
  const { skin, candidateBar: bar } = doc;
  const type = skin.typography;
  const collapsed = bar.collapsed;
  const expanded = {
    mode: bar.expanded.mode,
    columns: bar.expanded.columns,
    rowGap: bar.expanded.rowSpacing,
    colGap: bar.expanded.columnSpacing,
  };
  if (platform === 'android') {
    return {
      platform,
      refWidth: 411,
      sidePad: 3,
      gapX: 5,
      rowHeight: 60,
      rowGap: 0,
      capInsetX: 0,
      capInsetY: 3.25,
      topPad: 4,
      bottomPad: 4,
      radius: 8,
      border: skin.keycap.borderWidth > 0 ? 1 : 0,
      shadow: false,
      family: 'system',
      weight: 'regular',
      font: { letter: 22, hint: 11, control: 14, space: 16, enter: 15, candidate: 18, comment: 12 },
      bar: {
        ...androidBar(collapsed),
        chipGap: 8,
        chipRadius: 10,
        chipInsetY: 5,
        startPad: 12,
        natural: true,
        reading: 0,
        padTop: 0,
        padBottom: 0,
      },
      expanded: { ...expanded, fullRowLength: 8 },
      showsGlobe: true,
      systemRow: 24,
    };
  }
  const scale = type.keySize / 22;
  // Measured on an iPhone 17 Pro (402 pt wide) and read from the keyboard's layout code: a key cell is 54 pt tall
  // with 4 pt between cells both ways, and the skin's inset is taken off every side of the cell, so the default
  // skin (inset 0 x 1) shows keys 52 pt tall, 4 pt apart across and 6 pt apart down. Rows have 4 pt side padding.
  // Above the keys sit 9 pt, the candidate bar and 3 pt; below them 4 pt, then the globe row.
  return {
    platform,
    refWidth: 402,
    sidePad: 4,
    gapX: 4,
    rowHeight: 54,
    rowGap: 4,
    capInsetX: skin.spacing.visualInsetX,
    capInsetY: skin.spacing.visualInsetY,
    topPad: 0,
    bottomPad: 4,
    radius: skin.keycap.cornerRadius,
    border: skin.keycap.borderWidth,
    shadow: skin.keycap.shadow === 'subtle',
    family: type.family,
    weight: type.weight,
    font: {
      letter: 18 * scale, hint: type.secondarySize, control: 14 * scale, space: 14 * scale, enter: 14 * scale,
      candidate: type.candidateSize, comment: type.secondarySize,
    },
    bar: {
      height: effectiveBarHeight(collapsed.height, type.candidateSize),
      chipPad: collapsed.cellPaddingX,
      chipGap: 0,
      chipRadius: 8,
      chipInsetY: 4,
      cellSpacing: collapsed.cellSpacing,
      startPad: collapsed.cellPaddingX + 4,
      natural: collapsed.fillsAvailableWidth === false,
      reading: bar.compositionRow.visible === 'hidden' ? 0 : 24,
      padTop: 9,
      padBottom: 3,
    },
    expanded: { ...expanded, fullRowLength: bar.expanded.fullRowTextLength },
    showsGlobe: false,
    systemRow: 75,
  };
}

/** Weights of the bottom row on iPhone: 123, 中/英, comma, space, full stop, go. */
export const IPHONE_BOTTOM_WEIGHTS = [1, 1, 1, 3.35, 1, 2];

/**
 * The visible key rectangles (pt, x from the left edge, y from the keyboard's top) of the iPhone preview, worked
 * out the way the stylesheet lays them out: the same arithmetic as the app's rows, so a test can compare them with
 * measurements of the real keyboard. Rows: three letter rows and the bottom row. `composing` adds the reading row above the bar.
 */
export function iphoneKeyRects(m, width = m.refWidth, composing = false) {
  const top = (composing ? m.bar.reading : 0) + m.bar.padTop + m.bar.height + m.bar.padBottom + m.topPad;
  const cellW = (width - 2 * m.sidePad - 9 * m.gapX) / 10;
  const visible = (x, row, w) => ({
    x: x + m.capInsetX,
    y: top + row * (m.rowHeight + m.rowGap) + m.capInsetY,
    w: w - 2 * m.capInsetX,
    h: m.rowHeight - 2 * m.capInsetY,
  });
  const run = (x0, widths, row) => {
    let x = x0;
    return widths.map((w) => { const rect = visible(x, row, w); x += w + m.gapX; return rect; });
  };
  const side = (width - 2 * m.sidePad - 8 * m.gapX - 7 * cellW) / 2;
  const total = IPHONE_BOTTOM_WEIGHTS.reduce((a, b) => a + b, 0);
  const unit = (width - 2 * m.sidePad - 5 * m.gapX) / total;
  return [
    run(m.sidePad, Array(10).fill(cellW), 0),
    run(m.sidePad + (cellW + m.gapX) / 2, Array(9).fill(cellW), 1),
    run(m.sidePad, [side, ...Array(7).fill(cellW), side], 2),
    run(m.sidePad, IPHONE_BOTTOM_WEIGHTS.map((w) => w * unit), 3),
  ];
}

// ---------------------------------------------------------------------------------------------
// Icons: 24 x 24 outlines drawn with the current text colour.

const ICONS = {
  chevronDown: 'M6 9.5l6 6 6-6',
  chevronUp: 'M6 14.5l6-6 6 6',
  backspace: 'M9.2 5.5h9.3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9.2L3.5 12z M12.4 9.4l5 5 M17.4 9.4l-5 5',
  globe: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M3.8 12h16.4 M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5z',
  mic: 'M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3z M5.5 11.5a6.5 6.5 0 0 0 13 0 M12 18v3',
  shift: 'M12 4.5l7.5 8.2h-4.4v6.3H8.9v-6.3H4.5z',
  emoji: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M9 10h.01 M15 10h.01 M8.6 14.2c.9 1.3 2 2 3.4 2s2.5-.7 3.4-2',
  gear: 'M12 8.9a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2z M10.4 3.5h3.2l.4 2.1c.6.2 1.1.5 1.6.9l2-.7 1.6 2.8-1.6 1.4c.1.6.1 1.2 0 2l1.6 1.4-1.6 2.8-2-.7c-.5.4-1 .7-1.6.9l-.4 2.1h-3.2l-.4-2.1c-.6-.2-1.1-.5-1.6-.9l-2 .7-1.6-2.8 1.6-1.4a5.6 5.6 0 0 1 0-2L4.8 8.600l1.6-2.8 2 .7c.5-.4 1-.7 1.6-.9z',
  clipboard: 'M9.5 3h5a1 1 0 0 1 1 1v1.5h-7V4a1 1 0 0 1 1-1z M8.5 4.5H7A1.5 1.5 0 0 0 5.5 6v13A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 17 4.5h-1.5',
  keyboard: 'M4 6.5h16a1.5 1.5 0 0 1 1.5 1.500v8a1.5 1.5 0 0 1-1.5 1.500H4A1.5 1.5 0 0 1 2.5 16V8A1.5 1.5 0 0 1 4 6.500z M6.5 10h.01 M10 10h.01 M14 10h.01 M17.5 10h.01 M8 14h8',
  edit: 'M4.5 19.500l4-1 10.2-10.200a2 2 0 0 0-2.8-2.800L5.7 15.700z M14.5 7.500l2.8 2.8',
  oneHand: 'M7 4.500h10A1.5 1.5 0 0 1 18.5 6v12a1.5 1.5 0 0 1-1.5 1.500H7A1.5 1.5 0 0 1 5.5 18V6A1.5 1.5 0 0 1 7 4.500z M9 12h6 M12.5 9.500L15 12l-2.5 2.5',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'pv-icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * options: { mode: 'light'|'dark', platform: 'android'|'iphone', top: 'candidates'|'toolbar', expanded: bool, t, onToggleExpand }
 * `doc` must be normalised.
 */
export function renderPreview(host, doc, options) {
  const { mode, platform, top, t, onToggleExpand } = options;
  const typing = top !== 'toolbar';
  const expanded = typing && options.expanded;
  const colors = resolvedColors(doc.skin, mode);
  const m = previewMetrics(platform, doc);
  const android = platform === 'android';

  host.replaceChildren();
  host.dataset.platform = platform;
  host.dataset.mode = mode;

  const screen = el('div', 'pv-screen');
  const app = el('div', 'pv-app');
  app.append(el('span', typing ? 'pv-app-text' : 'pv-app-text idle', typing ? t('composing') : ''));
  const keyboard = el('div', 'pv-kb');
  screen.append(app, keyboard);
  host.append(screen);

  const set = (name, value) => screen.style.setProperty(`--${name}`, typeof value === 'number' ? String(Number(value.toFixed(3))) : value);
  set('ref', m.refWidth);
  for (const [role, hex] of Object.entries(colors)) set(`c-${role}`, hex);
  // Android reads the skin's text colour as is; on iPhone candidate text is made readable on the skin's panel colour.
  set('c-cand', android ? colors.text : contrasting(colors.text, colors.panel));
  set('c-candSecondary', android ? colors.secondaryText : contrasting(colors.secondaryText, colors.panel));
  set('c-candSelected', contrasting(colors.text, colors.selected));
  set('font', FONT_STACKS[m.family]);
  set('weight', WEIGHTS[m.weight]);
  // Android paints the panel colour and the skin's background over it; iPhone's surface belongs to the system.
  set('surface', android ? colors.panel : IOS_SURFACE[mode]);
  const background = android ? backgroundCss(doc.skin.variants?.[mode]?.background) : null;
  keyboard.style.background = background ? `${background}, ${colors.panel}` : '';
  set('side', m.sidePad);
  set('gx', m.gapX);
  set('row-h', m.rowHeight);
  set('row-gap', m.rowGap);
  set('inset-x', m.capInsetX);
  set('inset-y', m.capInsetY);
  set('top', m.topPad);
  set('bottom', m.bottomPad);
  set('radius', m.radius);
  set('border', m.border);
  set('shadow', m.shadow ? '0 calc(1 * var(--u)) 0 rgba(0, 0, 0, 0.18)' : 'none');
  set('f-letter', m.font.letter);
  set('f-hint', m.font.hint);
  set('f-control', m.font.control);
  set('f-space', m.font.space);
  set('f-enter', m.font.enter);
  set('f-cand', m.font.candidate);
  set('f-comment', m.font.comment);
  set('bar-h', m.bar.height);
  set('bar-pt', m.bar.padTop);
  set('bar-pb', m.bar.padBottom);
  set('chip-pad', m.bar.chipPad);
  set('chip-gap', m.bar.chipGap);
  set('chip-radius', m.bar.chipRadius);
  set('chip-y', m.bar.chipInsetY);
  set('cell-gap', m.bar.cellSpacing);
  set('start', m.bar.startPad);
  set('reading-h', m.bar.reading);
  set('sys-h', m.systemRow);
  set('icon', android ? 22 : Math.min(20, doc.skin.typography.keySize));
  set('exp-row-gap', m.expanded.rowGap);
  set('exp-col-gap', m.expanded.colGap);
  set('exp-columns', m.expanded.mode === 'list' ? 1 : m.expanded.columns);
  set('keys-h', m.topPad + KEY_ROWS * m.rowHeight + (KEY_ROWS - 1) * m.rowGap + m.bottomPad);
  set('hint-alpha', android ? 1 : 0.6);

  if (typing && m.bar.reading > 0) {
    const reading = el('div', 'pv-reading');
    reading.append(el('span', 'pv-reading-text', t('composing')));
    keyboard.append(reading);
  }
  keyboard.append(typing ? buildStrip(t, expanded, onToggleExpand) : buildToolbar(m, t));
  keyboard.append(expanded ? buildExpanded(m) : buildKeys(m, t));
  keyboard.append(buildSystemRow(m, t));
}

function buildStrip(t, expanded, onToggleExpand) {
  const strip = el('div', 'pv-strip');
  const cells = el('div', 'pv-cells');
  CANDIDATES.slice(0, 8).forEach((text, index) => {
    const cell = el('span', 'pv-cell', text);
    if (index === 0) cell.dataset.selected = 'true';
    cells.append(cell);
  });
  strip.append(cells);
  const button = el('button', 'pv-expand');
  button.type = 'button';
  button.append(icon(expanded ? 'chevronUp' : 'chevronDown'));
  const label = expanded ? t('collapseTip') : t('expandTip');
  button.setAttribute('aria-label', label);
  button.title = label;
  button.setAttribute('aria-pressed', String(expanded));
  button.addEventListener('click', onToggleExpand);
  strip.append(button);
  return strip;
}

function buildToolbar(m, t) {
  const bar = el('div', 'pv-toolbar');
  // Android spreads its shortcuts over the row; iPhone shows the emoji and settings shortcuts.
  const items = m.platform === 'android'
    ? [['clipboard', 'tbClipboard'], ['keyboard', 'tbKeyboards'], ['emoji', 'tbEmoji'], ['edit', 'tbEdit'], ['oneHand', 'tbOneHand'], ['gear', 'tbSettings']]
    : [['emoji', 'tbEmoji'], ['gear', 'tbSettings']];
  for (const [name, label] of items) {
    const item = el('span', 'pv-tool');
    item.append(icon(name));
    item.setAttribute('role', 'img');
    item.setAttribute('aria-label', t(label));
    bar.append(item);
  }
  return bar;
}

function buildExpanded(m) {
  const { mode, fullRowLength } = m.expanded;
  const area = el('div', `pv-expanded pv-${mode}`);
  const items = [...CANDIDATES, ...LONG_CANDIDATES, ...CANDIDATES.slice(2, 8), ...CANDIDATES];
  items.forEach((text, index) => {
    const item = el('span', 'pv-item');
    item.append(el('span', 'pv-item-text', text));
    if (mode === 'list') item.append(el('span', 'pv-item-note', index % 3 === 0 ? 'nǐ hǎo' : ''));
    if ([...text].length > fullRowLength) item.dataset.full = 'true';
    if (index === 0) item.dataset.selected = 'true';
    area.append(item);
  });
  return area;
}

function key(content, className, grow) {
  const node = el('button', `pv-key ${className}`.trim());
  node.type = 'button';
  node.tabIndex = -1;
  node.setAttribute('aria-hidden', 'true');
  if (grow) node.style.flexGrow = String(grow);
  const face = el('span', 'pv-face');
  face.append(...[content].flat());
  node.append(face);
  const press = () => node.classList.add('down');
  const release = () => node.classList.remove('down');
  node.addEventListener('pointerdown', press);
  for (const name of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(name, release);
  return node;
}

/** The letters of one row; the top row carries the digit hints. */
function letterKeys(letters, rowIndex) {
  return [...letters].map((letter, index) => {
    const face = [el('span', 'pv-label', letter)];
    if (rowIndex === 0) face.push(el('span', 'pv-hint', HINTS[index]));
    return key(face, 'letter');
  });
}

function buildKeys(m, t) {
  const keys = el('div', 'pv-keys');
  LETTER_ROWS.forEach((letters, index) => {
    const row = el('div', 'pv-row pv-letters');
    row.style.setProperty('--count', String(letters.length));
    if (index === 2) {
      // Shift and delete share what the seven letters leave over, as the apps solve a row with outlying controls.
      row.classList.add('pv-outlying');
      row.append(key(icon('shift'), 'control side'), ...letterKeys(letters, index), key(icon('backspace'), 'control side'));
    } else {
      row.append(...letterKeys(letters, index));
    }
    keys.append(row);
  });
  const bottom = el('div', 'pv-row pv-bottom');
  if (m.platform === 'iphone') {
    // 123, 中/英, comma, space, full stop, go: widths 40 / 40 / 40 / 134 / 40 / 80 pt on a 402 pt screen.
    const weights = IPHONE_BOTTOM_WEIGHTS;
    bottom.append(key(el('span', 'pv-label pv-control-text', t('numbersKey')), 'control', weights[0]));
    bottom.append(key(el('span', 'pv-label pv-control-text', t('languageKey')), 'control', weights[1]));
    bottom.append(key(el('span', 'pv-label', '，'), 'letter', weights[2]));
    bottom.append(key(el('span', 'pv-label pv-space-text', t('space')), 'space', weights[3]));
    bottom.append(key(el('span', 'pv-label', '。'), 'letter', weights[4]));
    bottom.append(key(el('span', 'pv-label pv-enter-text', t('enter')), 'accent', weights[5]));
    keys.append(bottom);
    return keys;
  }
  bottom.append(key(el('span', 'pv-label pv-control-text', t('numbersKey')), 'control', 1.4));
  bottom.append(key(el('span', 'pv-label pv-control-text', t('languageKey')), 'control', 1.2));
  if (m.showsGlobe) bottom.append(key(icon('globe'), 'control', 1));
  bottom.append(key(el('span', 'pv-label pv-space-text', t('space')), 'space', 4.8));
  bottom.append(key(el('span', 'pv-label', '，'), 'control', 1));
  bottom.append(key(el('span', 'pv-label pv-enter-text', t('enter')), 'accent', 1.6));
  keys.append(bottom);
  return keys;
}

function buildSystemRow(m, t) {
  const row = el('div', 'pv-sys');
  if (m.platform === 'iphone') {
    for (const [name, label] of [['globe', 'switchInputMethod'], ['mic', 'dictation']]) {
      const holder = el('span', 'pv-sys-icon');
      holder.append(icon(name));
      holder.setAttribute('role', 'img');
      holder.setAttribute('aria-label', t(label));
      row.append(holder);
    }
  }
  row.append(el('span', 'pv-pill'));
  return row;
}
