# Appearance file format

`*.songyanappearance.json` is read by Songyan for Android, Songyan for iOS and this editor. All
three decode the same files in `fixtures/` and `tests/`, and those files are the contract: when this
text and a fixture disagree, the fixture wins and this text is fixed.

## Version 1

Defined by the iOS app's `SkinKit`/`AppearanceKit`/`CandidateKit` and mirrored by Android's
`core/appearance` and `core/candidate`. Summary:

- Document: `formatVersion` 1, `id`, `name`, optional `author`, `appearance`
  (`system`/`light`/`dark`), `skin`, `candidateBar`. The document, skin and candidate bar share one
  `id` and `name`.
- Skin: `variants.light` / `variants.dark`, each with `colors` (the ten roles `panel`, `key`,
  `control`, `accent`, `text`, `secondaryText`, `accentText`, `pressed`, `selected`, `border`, as
  `#RRGGBB`) and an optional `background` (`solid` or a vertical `linearGradient`); `typography`,
  `keycap`, `spacing`.
- Strict: unknown fields, other versions and out-of-range values are rejected. Limits: 256 KiB per
  document, 128 KiB per skin or candidate bar.
- On iOS the system draws the keyboard's own surface, so `panel` only decides which candidate text
  colours stay readable there; Android paints it. Neither app paints a version 1 `background`.
- Android takes only the colours and whether `keycap.borderWidth` is above 0 from the skin; key size,
  gaps, corner radius, shadow and typography are its own. iOS applies all of the skin. From the
  candidate bar both apps read `collapsed.height`, `cellPaddingX`, `cellSpacing` and `expanded.mode`,
  `columns`, `rowSpacing`, `columnSpacing`; `compositionRow`, `fillsAvailableWidth`,
  `fullRowTextLength` and `controls` are not read by Android.

## Version 2

Version 2 adds colours with alpha, more gradients and a background image. Everything in version 1
stays valid and keeps its meaning. `fixtures/` and `tests/v2.test.js` are the contract, as for version 1.

### Which version a file has

- A writer emits `formatVersion: 2` only when the skin uses a version 2 feature (below). It then writes
  2 on the document, on the skin and on the candidate bar; the three always agree. Any other file is
  written as version 1, byte for byte as before, so older apps keep opening it.
- A reader accepts 1 and 2. In a document the skin and the candidate bar must carry the document's
  version, otherwise `formatVersion` of the part is rejected. A standalone skin or candidate bar may be
  version 1 or 2.
- The features are version 2 only: a version 1 file that uses one is rejected the way version 1 always
  rejected it (a colour of the wrong shape, an unknown field, an unknown `type`).
- A writer drops an alpha of `FF` (`#RRGGBBFF` is written `#RRGGBB`) and writes a two-colour vertical
  gradient with `from` / `to`, so neither makes a file version 2.
- Decoding stays strict: unknown fields, other versions and out-of-range values are rejected.

### Colours

Every colour in `colors` and in a background may be `#RRGGBBAA`, alpha `00` (clear) to `FF` (opaque).
Text roles are still made readable: the contrast rule of version 1 is applied to the text colour against
the fill it sits on, where a translucent fill is first laid over the panel colour (and a translucent
panel over white in light variants and black in dark variants, because the picture behind it is not
known). Both apps and the editor use this rule.

### Background (Android only)

`variants.<light|dark>.background` is one of:

| Shape | Version |
| --- | --- |
| `{ "type": "solid", "color": "#RRGGBB" }` | 1 |
| `{ "type": "linearGradient", "from": "#RRGGBB", "to": "#RRGGBB", "direction": "vertical" }` | 1 |
| `{ "type": "solid", "color": "#RRGGBBAA" }` | 2 |
| `{ "type": "linearGradient", "colors": [2 to 4 colours], "direction": "vertical" \| "horizontal" \| "diagonal" }` | 2 |
| `{ "type": "image", "image": "data:image/webp;base64,…", "align": "top" \| "center" \| "bottom" }` | 2 |

- `colors` and `from`/`to` exclude each other; `direction` is required. Stops are spread evenly.
  `vertical` runs top to bottom, `horizontal` left to right, `diagonal` from the top left to the bottom
  right. Colours may carry alpha.
- `image` is a `data:` URI of the form `data:image/<webp|jpeg|png>;base64,<canonical base64>`. The
  decoded bytes must start with the magic bytes of the type named in the URI (PNG `89 50 4E 47 0D 0A
  1A 0A`, JPEG `FF D8 FF`, WebP `RIFF`, 4 bytes, `WEBP`); the MIME prefix alone is not trusted. The
  decoded size is at most 1.5 MiB (1572864 bytes) and width and height, read from the file header,
  are each at most 4096 pixels. `align` is required.
- The image covers the keyboard area: it is scaled evenly until it fills the area (by width when the
  image is at least as tall as the area), centred horizontally, and cropped vertically as `align` says:
  `top` keeps the top edge, `bottom` the bottom edge, `center` the middle. Blur, dimming and
  brightening are baked into the image by the editor; the apps only draw a bitmap. The editor crops to
  the keyboard's shape itself and writes `center`.
- The background is drawn over the panel colour and under the keys. Translucent keys show it through.
- A document that contains an image may be 2 MiB (2097152 bytes); without an image the 256 KiB limit of
  version 1 stands. The same image in both variants is written twice, so the editor keeps each image at
  about 700 KiB or less.

### iOS

iOS ignores `background`: the system draws the keyboard's surface there. Translucent key colours are
laid over that surface. Everything else in the file applies as in version 1.
