// Built-in appearances, as shipped on Android and in the interop samples.
// The stored names are Chinese (the apps write them into files); `names` is for the picker.

import { SYSTEM_DEFAULT_ID, normalizeDocument, systemDefaultDocument } from './format.js';

const ROLES = ['panel', 'key', 'control', 'accent', 'accentText', 'text', 'secondaryText', 'selected', 'pressed', 'border'];
const colors = (list) => Object.fromEntries(list.split(' ').map((hex, index) => [ROLES[index], `#${hex}`]));

const SPECS = [
  {
    id: 'builtin-songyan', zh: '松烟墨韵', en: 'Pine Ink', borderWidth: 1,
    light: 'ECEFEA FFFFFF DDE3DA 2A593F FFFFFF 191D1A 586159 D8E6DB D2DDD3 D5DDD4',
    dark: '121513 454D47 383E3A 8FD7AA 003820 E2E5E0 B4BEB5 1C3426 57635A 272C28',
  },
  {
    id: 'builtin-ink', zh: '墨夜', en: 'Ink Night',
    light: 'E5E7EB FFFFFF D1D5DB 2B2D33 FFFFFF 111827 4B5563 D1D5DB 9CA3AF 777777',
    dark: '141518 43464F 353841 3A6EA5 FFFFFF F2F3F5 FFFFFF 3A6EA5 555A65 808080',
  },
  {
    id: 'builtin-bamboo', zh: '青竹', en: 'Bamboo',
    light: 'DDE8E0 FFFFFF C3D6C8 2E7D5B FFFFFF 1E2A23 4C5E53 BFDCCB B3CBBB 777777',
    dark: '1B2520 3F5348 33433A 368461 FFFFFF EEF5F0 FFFFFF 2F5F48 52695B 808080',
  },
  {
    id: 'builtin-paper', zh: '暖纸', en: 'Warm Paper',
    light: 'EDE6DA FFFCF6 DCD1BF B0622A FFFFFF 2E261D 6A5C4B EAD3BC D6C9B4 777777',
    dark: '2A2520 524940 433B33 AA6531 FFFFFF F6EFE6 C9BBAA 6A4A30 685D53 808080',
  },
  {
    id: 'builtin-galaxy', zh: '星河', en: 'Galaxy',
    light: 'DCE4EC FFFFFF C5D3E3 1A56DB FFFFFF 0F1E36 465975 C7D8ED B5C8DE 777777',
    dark: '111827 394659 2E3748 3472D8 FFFFFF F3F4F6 A9BAD3 28436B 495972 808080',
  },
  {
    id: 'builtin-twilight', zh: '薄暮', en: 'Dusk',
    light: 'E8E3EE FFFFFF D5CDDE 7E3AF2 FFFFFF 261A35 635570 DDD4E8 C5BDD0 777777',
    dark: '1A1625 4C3E60 3A314C 9B4EE3 FFFFFF F3EEF9 BDB2CC 4E3A63 625575 808080',
  },
];

function build(spec) {
  const document = systemDefaultDocument();
  document.id = spec.id;
  document.name = spec.zh;
  document.skin.variants.light.colors = colors(spec.light);
  document.skin.variants.dark.colors = colors(spec.dark);
  document.skin.keycap.borderWidth = spec.borderWidth ?? 0;
  return normalizeDocument(document);
}

export const PRESETS = [
  { id: SYSTEM_DEFAULT_ID, names: { zh: '系统默认', en: 'System default' }, document: systemDefaultDocument() },
  ...SPECS.map((spec) => ({ id: spec.id, names: { zh: spec.zh, en: spec.en }, document: build(spec) })),
];

export const presetById = (id) => PRESETS.find((preset) => preset.id === id);
