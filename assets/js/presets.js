// Built-in appearances, as shipped on Android and in the interop samples.
// The stored names are Chinese (the apps write them into files); `names` is for the picker.

import { SYSTEM_DEFAULT_ID, normalizeDocument, systemDefaultDocument } from './format.js';

const ROLES = ['panel', 'key', 'control', 'accent', 'accentText', 'text', 'secondaryText', 'selected', 'pressed', 'border'];
const colors = (list) => Object.fromEntries(list.split(' ').map((hex, index) => [ROLES[index], `#${hex}`]));

const SPECS = [
  {
    id: 'builtin-songyan', zh: '松烟墨韵', en: 'Pine Ink', borderWidth: 1,
    light: 'ECEFEA FFFFFF DDE3DA 2A593F FFFFFF 191D1A 586159 D8E6DB D2DDD3 D5DDD4',
    dark: '121513 232724 1B1E1C 8FD7AA 003820 E2E5E0 959F96 1C3426 3B433D 272C28',
  },
  {
    id: 'builtin-ink', zh: '墨夜', en: 'Ink Night',
    light: 'E5E7EB FFFFFF D1D5DB 2B2D33 FFFFFF 111827 4B5563 D1D5DB 9CA3AF',
    dark: '141518 2B2D33 1F2126 3A6EA5 FFFFFF F2F3F5 A7ADB8 3A6EA5 454952',
  },
  {
    id: 'builtin-bamboo', zh: '青竹', en: 'Bamboo',
    light: 'DDE8E0 FBFDFB C3D6C8 2E7D5B FFFFFF 1E2A23 4C5E53 BFDCCB B3CBBB',
    dark: '1B2520 34443B 27342D 3F9A71 FFFFFF EEF5F0 AFC2B6 2F5F48 4A5E52',
  },
  {
    id: 'builtin-paper', zh: '暖纸', en: 'Warm Paper',
    light: 'EDE6DA FFFCF6 DCD1BF B5652B FFFFFF 2E261D 6A5C4B EAD3BC D6C9B4',
    dark: '2A2520 4A423A 3A332C C8773A FFFFFF F6EFE6 C9BBAA 6A4A30 5C534A',
  },
  {
    id: 'builtin-galaxy', zh: '星河', en: 'Galaxy',
    light: 'DCE4EC FFFFFF C5D3E3 1A56DB FFFFFF 0F1E36 465975 C7D8ED B5C8DE',
    dark: '111827 1F2937 182234 3B82F6 FFFFFF F3F4F6 8FA3BF 28436B 364761',
  },
  {
    id: 'builtin-twilight', zh: '薄暮', en: 'Dusk',
    light: 'E8E3EE FFFFFF D5CDDE 7E3AF2 FFFFFF 261A35 635570 DDD4E8 C5BDD0',
    dark: '1A1625 2D243A 221C2E A855F7 FFFFFF F3EEF9 AFA3BF 4E3A63 493F59',
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
