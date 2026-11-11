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

import { resolvedColors, contrasting, luminance, SYSTEM_SURFACE } from './format.js';

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
/**
 * Android's own faces first (Roboto, Noto Serif, Droid Sans Mono), then the nearest a desktop has. Stock
 * Android ships no rounded face, so "rounded" draws the platform sans (KeyboardTypefaces).
 */
const ANDROID_FONT_STACKS = {
  system: `Roboto, ${SYSTEM_FONT}`,
  rounded: `Roboto, ${SYSTEM_FONT}`,
  serif: '"Noto Serif", "PT Serif", Georgia, "Noto Serif CJK SC", "Songti SC", "Source Han Serif SC", "SimSun", serif',
  monospaced: '"Droid Sans Mono", "Roboto Mono", "Noto Sans Mono", Menlo, Consolas, "Noto Sans Mono CJK SC", monospace',
};
const FONT_STACKS = {
  system: SYSTEM_FONT,
  rounded: 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", system-ui, sans-serif',
  serif: '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", Georgia, serif',
  monospaced: 'ui-monospace, "SF Mono", Menlo, Consolas, "Noto Sans Mono CJK SC", monospace',
};
const WEIGHTS = { regular: 400, medium: 500, semibold: 600 };

/** The surface iOS draws under every keyboard (measured in the simulator); the skin's panel colour and background do not reach it. */
export const IOS_SURFACE = SYSTEM_SURFACE;

/** CSS radius per pt of the skin's corner radius for iPhone keys (squircle corners). */
export const IOS_CORNER_SCALE = 1.75;

const SQUIRCLE = typeof CSS !== 'undefined' && CSS.supports('corner-shape', 'squircle');

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
    // Android takes the skin literally, 1 pt = 1 dp (ImePalettes.tokensOf): keys sit 4 dp apart as iPhone key
    // cells do, less the inset on every side, so rows tile with 4 + 2 x inset between keys across and each cap
    // gives up half the row gap top and bottom. Row height, side padding and control labels stay Android's.
    return {
      platform,
      refWidth: 411,
      sidePad: 3,
      gapX: 4 + 2 * skin.spacing.visualInsetX,
      rowHeight: 60,
      rowGap: 0,
      capInsetX: 0,
      capInsetY: 2 + skin.spacing.visualInsetY,
      topPad: 4,
      bottomPad: 4,
      radius: skin.keycap.cornerRadius,
      border: skin.keycap.borderWidth,
      shadow: skin.keycap.shadow === 'subtle',
      family: type.family,
      weight: type.weight,
      font: {
        letter: type.keySize, hint: type.secondarySize, control: 14, space: 16, enter: 15,
        candidate: type.candidateSize, comment: 12,
      },
      bar: {
        height: effectiveBarHeight(collapsed.height, type.candidateSize),
        chipPad: collapsed.cellPaddingX,
        cellSpacing: collapsed.cellSpacing,
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
      // Gesture navigation shows the system's own keyboard switcher, so the footer has no globe key.
      showsGlobe: false,
      systemRow: 48,
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

/** The iPhone toolbar: three buttons share the width equally between side padding, with a gap (measured on the simulator: centres 73.7 / 201.5 / 328.2 pt on 402 pt). */
export const IPHONE_TOOLBAR = Object.freeze({ pad: 12.4, gap: 4, count: 3 });

/** Centres (pt) of the iPhone toolbar buttons. */
export function iphoneToolbarCentres(width, { pad, gap, count } = IPHONE_TOOLBAR) {
  const each = (width - 2 * pad - (count - 1) * gap) / count;
  return Array.from({ length: count }, (_, index) => pad + each / 2 + index * (each + gap));
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
  hand: 'M8 11V6.2a1.2 1.2 0 0 1 2.4 0V10 M10.4 9.5V4.7a1.2 1.2 0 0 1 2.4 0V10 M12.8 9.6V5.6a1.2 1.2 0 0 1 2.4 0V11 M15.2 8.6a1.2 1.2 0 0 1 2.4 0V14c0 3.6-2.2 6-5.4 6-2.5 0-4-1-5.3-3L4.800 13.200a1.300 1.300 0 0 1 2-1.500L8 13.200',
  oneHand: 'M7 4.500h10A1.5 1.5 0 0 1 18.5 6v12a1.5 1.5 0 0 1-1.5 1.500H7A1.5 1.5 0 0 1 5.5 18V6A1.5 1.5 0 0 1 7 4.500z M9 12h6 M12.5 9.500L15 12l-2.5 2.5',
};

/** Android's own toolbar drawables (ime/src/main/res/drawable/ic_toolbar_*.xml, ic_qs_one_hand_off.xml): filled 24 x 24 Material glyphs. */
const ANDROID_ICONS = {
  clipboard: 'M19,2h-4.18C14.4,0.84 13.3,0 12,0c-1.3,0 -2.4,0.84 -2.82,2L5,2c-1.1,0 -2,0.9 -2,2v16c0,1.1 0.9,2 2,2h14c1.1,0 2,-0.9 2,-2L21,4c0,-1.1 -0.9,-2 -2,-2zM12,2c0.55,0 1,0.45 1,1s-0.45,1 -1,1 -1,-0.45 -1,-1 0.45,-1 1,-1zM19,20L5,20L5,4h2v3h10L17,4h2v16z',
  keyboard: 'M20,5L4,5c-1.1,0 -1.99,0.9 -1.99,2L2,17c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2L22,7c0,-1.1 -0.9,-2 -2,-2zM11,8h2v2h-2L11,8zM11,11h2v2h-2v-2zM8,8h2v2L8,10L8,8zM8,11h2v2L8,13v-2zM7,13L5,13v-2h2v2zM7,10L5,10L5,8h2v2zM16,17L8,17v-2h8v2zM16,13h-2v-2h2v2zM16,10h-2L14,8h2v2zM19,13h-2v-2h2v2zM19,10h-2L17,8h2v2z',
  emoji: 'M11.99,2C6.47,2 2,6.48 2,12s4.47,10 9.99,10C17.52,22 22,17.52 22,12S17.52,2 11.99,2zM12,20c-4.42,0 -8,-3.58 -8,-8s3.58,-8 8,-8 8,3.58 8,8 -3.58,8 -8,8zM15.5,11c0.83,0 1.5,-0.67 1.5,-1.5S16.33,8 15.5,8 14,8.67 14,9.5s0.67,1.5 1.5,1.5zM8.5,11c0.83,0 1.5,-0.67 1.5,-1.5S9.33,8 8.5,8 7,8.67 7,9.5 7.67,11 8.5,11zM12,17.5c2.33,0 4.31,-1.46 5.11,-3.5H6.89c0.8,2.04 2.78,3.5 5.11,3.5z',
  edit: 'M3,17.25V21h3.75L17.81,9.94l-3.75,-3.75L3,17.25zM20.71,7.04c0.39,-0.39 0.39,-1.02 0,-1.41l-2.34,-2.34c-0.39,-0.39 -1.02,-0.39 -1.41,0l-1.83,1.83 3.75,3.75 1.83,-1.83z',
  oneHand: 'M7,2h10c1.1,0 2,0.9 2,2v16c0,1.1 -0.9,2 -2,2H7c-1.1,0 -2,-0.9 -2,-2V4c0,-1.1 0.9,-2 2,-2zM7,4v16h10V4H7z M8,12h8v7H8z',
  gear: 'M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z',
  hide: 'M7.41,8.59L12,13.17l4.59,-4.58L18,10l-6,6 -6,-6 1.41,-1.41z',
  language: 'M11.99,2C6.47,2 2,6.48 2,12s4.47,10 9.99,10C17.52,22 22,17.52 22,12S17.52,2 11.99,2zM18.92,8h-2.95c-0.32,-1.25 -0.78,-2.45 -1.38,-3.56 1.84,0.63 3.37,1.91 4.33,3.56zM12,4.04c0.83,1.2 1.48,2.53 1.91,3.96h-3.82c0.43,-1.43 1.08,-2.76 1.91,-3.96zM4.26,14C4.1,13.36 4,12.69 4,12s0.1,-1.36 0.26,-2h3.38c-0.08,0.66 -0.14,1.32 -0.14,2 0,0.68 0.06,1.34 0.14,2L4.26,14zM5.08,16h2.95c0.32,1.25 0.78,2.45 1.38,3.56 -1.84,-0.63 -3.37,-1.9 -4.33,-3.56zM8.03,8L5.08,8c0.96,-1.66 2.49,-2.93 4.33,-3.56C8.81,5.55 8.35,6.75 8.03,8zM12,19.96c-0.83,-1.2 -1.48,-2.53 -1.91,-3.96h3.82c-0.43,1.43 -1.08,2.76 -1.91,3.96zM14.34,14L9.66,14c-0.09,-0.66 -0.16,-1.32 -0.16,-2 0,-0.68 0.07,-1.35 0.16,-2h4.68c0.09,0.65 0.16,1.32 0.16,2 0,0.68 -0.07,1.34 -0.16,2zM14.59,19.56c0.6,-1.11 1.06,-2.31 1.38,-3.56h2.95c-0.96,1.65 -2.49,2.93 -4.33,3.56zM16.36,14c0.08,-0.66 0.14,-1.32 0.14,-2 0,-0.68 -0.06,-1.34 -0.14,-2h3.38c0.16,0.64 0.26,1.31 0.26,2s-0.1,1.36 -0.26,2h-3.38z',
};

/** Android's expand control: three columns by two rows of dots, the whole candidate page (drawPanelIcon). */
function panelDots() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 22 22');
  svg.setAttribute('class', 'pv-icon pv-filled');
  svg.setAttribute('aria-hidden', 'true');
  for (const y of [8.75, 13.25]) {
    for (const x of [6.5, 11, 15.5]) {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(x));
      dot.setAttribute('cy', String(y));
      dot.setAttribute('r', '1.5');
      svg.append(dot);
    }
  }
  return svg;
}

function androidIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'pv-icon pv-filled');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ANDROID_ICONS[name]);
  svg.append(path);
  return svg;
}

/** A glyph whose ink is not centred in its 24 x 24 box gets its own view box so it lands where the real symbol does. */
const VIEW_BOXES = { hand: '-1.33 -0.25 24 24' };

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', VIEW_BOXES[name] ?? '0 0 24 24');
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
  set('font', (android ? ANDROID_FONT_STACKS : FONT_STACKS)[m.family]);
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
  // CSS's squircle corner reads tighter than the system's continuous corner of the same radius; 1.75 x matches the simulator
  // within 1 px. Browsers without corner-shape draw a plain round corner, which already matches at 1 x.
  set('radius', android || !SQUIRCLE ? m.radius : m.radius * IOS_CORNER_SCALE);
  set('border', m.border);
  // Both apps outline the function keys of a dark, borderless skin in its border colour, 1 pt wide;
  // letters, marks and the space bar stay unoutlined.
  const opaque = (hex) => hex.length === 7 || hex.slice(7).toUpperCase() === 'FF';
  screen.classList.toggle(
    'pv-fn-outline',
    m.border === 0 && luminance(colors.panel.slice(0, 7)) < 0.2 && opaque(colors.control),
  );
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
  set('tool-pad', IPHONE_TOOLBAR.pad);
  set('tool-gap', IPHONE_TOOLBAR.gap);

  if (typing && m.bar.reading > 0) {
    const reading = el('div', 'pv-reading');
    reading.append(el('span', 'pv-reading-text', t('composing')));
    keyboard.append(reading);
  }
  keyboard.append(typing ? buildStrip(t, expanded, onToggleExpand, android) : buildToolbar(m, t));
  keyboard.append(expanded ? buildExpanded(m) : buildKeys(m, t));
  keyboard.append(buildSystemRow(m, t));
  if (android && !expanded) fitAndroidLabels(host, keyboard, m.refWidth);
}

function buildStrip(t, expanded, onToggleExpand, android) {
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
  button.append(android && !expanded ? panelDots() : icon(expanded ? 'chevronUp' : 'chevronDown'));
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
  // Android splits the row into equal slots for its default shortcuts plus the collapse button (ToolbarView);
  // iPhone shows emoji, one-handed mode and settings.
  const android = m.platform === 'android';
  const items = android
    ? [['clipboard', 'tbClipboard'], ['keyboard', 'tbKeyboards'], ['emoji', 'tbEmoji'], ['edit', 'tbEdit'], ['oneHand', 'tbOneHand'], ['gear', 'tbSettings'], ['hide', 'tbHide']]
    : [['emoji', 'tbEmoji'], ['hand', 'tbOneHand'], ['gear', 'tbSettings']];
  for (const [name, label] of items) {
    const item = el('span', 'pv-tool');
    item.append(android ? androidIcon(name) : icon(name));
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

/** Android also marks the up-flick symbol of the lower rows (AlternateKeyPolicy, flick hint "up" by default). */
const ANDROID_ROW_HINTS = [HINTS, ['，', '。', '？', '！', '、', '：', '；', '（', '）'], ['@', '-', '“', '‘', '【', '】', '/']];

/** The letters of one row; the top row carries the digit hints, and on Android every row its symbols. */
function letterKeys(letters, rowIndex, android) {
  const hints = android ? ANDROID_ROW_HINTS[rowIndex] : rowIndex === 0 ? HINTS : [];
  return [...letters].map((letter, index) => {
    const face = [el('span', 'pv-label', letter)];
    if (hints[index]) face.push(el('span', 'pv-hint', hints[index]));
    return key(face, 'letter');
  });
}

/**
 * Android shrinks a key label that is wider than its cap less 10 dp, in 0.5 sp steps down to 9 sp
 * (KeyboardView.fitLabels). Text width grows with its size, so one measurement per label is enough.
 */
function fitAndroidLabels(host, keyboard, ref) {
  const unit = host.clientWidth / ref;
  if (!(unit > 0)) return;
  for (const label of keyboard.querySelectorAll('.pv-key .pv-label')) {
    const face = label.closest('.pv-face');
    const room = face.getBoundingClientRect().width / unit - 10;
    const width = label.getBoundingClientRect().width / unit;
    const base = parseFloat(getComputedStyle(label).fontSize) / unit;
    if (width > room && base > 0) {
      let size = base;
      while (size > 9 && (width * size) / base > room) size -= 0.5;
      label.style.fontSize = `calc(${size} * var(--u))`;
    }
    if (FULL_WIDTH_MARK.test(label.textContent)) centreInk(label, unit);
  }
}

/** One full-width punctuation mark, whose ink does not fill its em box (FullWidthMark). */
const FULL_WIDTH_MARK = /^[\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65\u2026\u2014]$/u;
let inkCanvas = null;

/** Android draws a full-width mark with its ink, not its em box, at the cap's centre. */
function centreInk(label, unit) {
  inkCanvas ??= document.createElement('canvas').getContext('2d');
  if (!inkCanvas) return;
  const style = getComputedStyle(label);
  inkCanvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const ink = inkCanvas.measureText(label.textContent);
  const size = parseFloat(style.fontSize);
  const dx = ink.width / 2 - (ink.actualBoundingBoxRight - ink.actualBoundingBoxLeft) / 2;
  const baseline = (size - (ink.fontBoundingBoxAscent + ink.fontBoundingBoxDescent)) / 2 + ink.fontBoundingBoxAscent;
  const dy = size / 2 - (baseline + (ink.actualBoundingBoxDescent - ink.actualBoundingBoxAscent) / 2);
  label.style.transform = `translate(calc(${(dx / unit).toFixed(2)} * var(--u)), calc(${(dy / unit).toFixed(2)} * var(--u)))`;
}

function buildKeys(m, t) {
  const keys = el('div', 'pv-keys');
  LETTER_ROWS.forEach((letters, index) => {
    const row = el('div', 'pv-row pv-letters');
    row.style.setProperty('--count', String(letters.length));
    if (index === 2) {
      // Shift and delete share what the seven letters leave over, as the apps solve a row with outlying controls.
      row.classList.add('pv-outlying');
      row.append(key(icon('shift'), 'control side'), ...letterKeys(letters, index, m.platform === 'android'), key(icon('backspace'), 'control side'));
    } else {
      row.append(...letterKeys(letters, index, m.platform === 'android'));
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
  // Android's letters footer (KeyboardPages.lettersFooter): [globe] 123 | 中/英 | ，| space | 。| return. The globe
  // takes its share from the space bar; return is widened by one mark so the space bar stays centred.
  if (m.showsGlobe) bottom.append(key(icon('globe'), 'control', 1));
  bottom.append(key(el('span', 'pv-label pv-control-text', t('numbersKey')), 'control', 1.4));
  // Both names, the current side in the text colour and the other at 60% (drawLanguageLabel).
  const [current, other] = t('languageKey').split('/');
  const language = el('span', 'pv-label pv-control-text', current);
  language.append(el('span', 'pv-dim', `/${other}`));
  bottom.append(key(language, 'control', 1.2));
  bottom.append(key(el('span', 'pv-label', '，'), 'letter', 1));
  bottom.append(key(el('span', 'pv-label pv-space-text', t('space')), 'space', m.showsGlobe ? 3.8 : 4.8));
  bottom.append(key(el('span', 'pv-label', '。'), 'letter', 1));
  bottom.append(key(el('span', 'pv-label pv-enter-text', t('enter')), 'accent', 2.6));
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
  } else {
    for (const [name, cls] of [['hide', 'pv-sys-back'], ['language', 'pv-sys-switch']]) {
      const holder = el('span', `pv-sys-icon ${cls}`);
      holder.append(androidIcon(name));
      row.append(holder);
    }
  }
  row.append(el('span', 'pv-pill'));
  return row;
}
