// The page's own accent follows the appearance being edited. Kept pure so it can be tested without a DOM.

import { contrastRatio, isHexColorAlpha, normalizeHex, over } from './format.js';

// The page surfaces from style.css; the accent has to stay visible on all of them.
const SURFACES = {
  light: { bg: '#F3F4F2', card: '#FFFFFF' },
  dark: { bg: '#121513', card: '#1B1F1C' },
};
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

/** Moves lightness away from the page (darker on light, lighter on dark) until the accent is usable as a control colour. */
function visible(hex, scheme) {
  const { bg, card } = SURFACES[scheme];
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
 * The page accent for an appearance and a colour scheme ('light' or 'dark'), or null when the appearance sets
 * none (system default, dynamic colour), in which case the stylesheet values stay.
 */
export function pageAccent(doc, scheme) {
  const mode = scheme === 'dark' ? 'dark' : 'light';
  const raw = doc?.skin?.variants?.[mode]?.colors?.accent;
  if (!isHexColorAlpha(raw)) return null;
  const { bg } = SURFACES[mode];
  const accent = visible(over(raw, bg), mode);
  const dark = contrastRatio('#000000', accent);
  const light = contrastRatio('#FFFFFF', accent);
  const accentText = dark >= light ? '#000000' : '#FFFFFF';
  if (Math.max(dark, light) < TEXT_CONTRAST) return null;
  return { accent: normalizeHex(accent), accentText, accentSoft: mix(bg, accent, TINT[mode]) };
}
