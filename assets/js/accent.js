// The page's own accent follows the appearance being edited. Kept pure so it can be tested without a DOM.

import { contrastRatio, isHexColorAlpha, normalizeHex, over } from './format.js';

// The page's neutral colours from style.css. They carry a faint green, the hue of the default accent; for another
// accent they take its hue instead, keeping their lightness and saturation so every contrast stays as designed.
const NEUTRALS = {
  light: {
    '--bg': '#F3F4F2', '--card': '#FFFFFF', '--field': '#FFFFFF', '--text': '#1C211E',
    '--muted': '#5D685F', '--line': '#D5DAD6', '--line-strong': '#B8C0BA',
  },
  dark: {
    '--bg': '#121513', '--card': '#1B1F1C', '--field': '#232825', '--text': '#E4E8E5',
    '--muted': '#97A39A', '--line': '#313832', '--line-strong': '#4A544C',
  },
};
// Below this saturation an accent reads as grey, and so do the neutrals.
const GREY = 0.08;
const CONTROL_CONTRAST = 3;
const TEXT_CONTRAST = 4.5;
const TINT = { light: 0.14, dark: 0.14 };

const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function toHsl([r, g, b]) {
  const [R, G, B] = [r, g, b].map((v) => v / 255);
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  let hue;
  if (max === R) hue = ((G - B) / d) % 6;
  else if (max === G) hue = (B - R) / d + 2;
  else hue = (R - G) / d + 4;
  return [(hue * 60 + 360) % 360, s, l];
}

function fromHsl([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

const mix = (a, b, amount) => toHex(toRgb(a).map((v, i) => v * (1 - amount) + toRgb(b)[i] * amount));

/** The stylesheet neutrals turned to the accent's hue, or to plain grey for a grey accent. */
function neutralsFor(hex, scheme) {
  const [hue, saturation] = toHsl(toRgb(hex));
  const out = {};
  for (const [name, value] of Object.entries(NEUTRALS[scheme])) {
    const [, s, l] = toHsl(toRgb(value));
    out[name] = fromHsl([hue, saturation < GREY ? 0 : s, l]);
  }
  return out;
}

/** Moves lightness away from the page (darker on light, lighter on dark) until the accent is usable as a control colour. */
function visible(hex, scheme, bg, card) {
  const ok = (c) => Math.min(contrastRatio(c, bg), contrastRatio(c, card)) >= CONTROL_CONTRAST;
  if (ok(hex)) return hex;
  const [h, s, l] = toHsl(toRgb(hex));
  const step = scheme === 'light' ? -0.01 : 0.01;
  let candidate = hex;
  for (let next = l + step; next >= 0 && next <= 1; next += step) {
    candidate = fromHsl([h, s, next]);
    if (ok(candidate)) return candidate;
  }
  return candidate;
}

/**
 * The page accent for an appearance and a colour scheme ('light' or 'dark'), with the page neutrals in its hue
 * (`neutrals`, keyed by CSS variable), or null when the appearance sets none (system default, dynamic colour), in
 * which case the stylesheet values stay.
 */
export function pageAccent(doc, scheme) {
  const mode = scheme === 'dark' ? 'dark' : 'light';
  const raw = doc?.skin?.variants?.[mode]?.colors?.accent;
  if (!isHexColorAlpha(raw)) return null;
  const opaque = over(raw, NEUTRALS[mode]['--bg']);
  const neutrals = neutralsFor(opaque, mode);
  const bg = neutrals['--bg'];
  const accent = visible(opaque, mode, bg, neutrals['--card']);
  const dark = contrastRatio('#000000', accent);
  const light = contrastRatio('#FFFFFF', accent);
  const accentText = dark >= light ? '#000000' : '#FFFFFF';
  if (Math.max(dark, light) < TEXT_CONTRAST) return null;
  return { accent: normalizeHex(accent), accentText, accentSoft: mix(bg, accent, TINT[mode]), neutrals };
}
