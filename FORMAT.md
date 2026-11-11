# Appearance file format

`*.songyanappearance.json` is read by Songyan for Android, Songyan for iOS and this editor. All
three decode the same files in `fixtures/` and `tests/`, and those files are the contract: when this
text and a fixture disagree, the fixture wins and this text is fixed.

## Version 1 (current)

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
- On iOS the system draws the keyboard's own surface, so `panel` and `background` only take effect
  on Android.

## Version 2 (proposal, not implemented)

Everything in version 1 stays valid. A writer emits version 2 only when a file uses something below,
so files without new features keep opening in older apps.

### Colours

- Any colour may carry alpha: `#RRGGBBAA`. Text roles are still made readable against their fill,
  measured over the panel colour when the fill is translucent.
- New optional roles. A missing role is derived the way the apps derive it today; the writer never
  fills in missing roles, so a file only holds what its author chose.

| Role | Meaning | When missing |
| --- | --- | --- |
| `controlText` | glyphs on function keys | `text` |
| `space` | space bar fill | `key` |
| `candidateText` | candidates | `text` |
| `candidateHighlight` | fill behind the highlighted candidate | `selected` |
| `candidateHighlightText` | the highlighted candidate | `candidateText` |
| `commentText` | comments and readings next to candidates | `secondaryText` |
| `preeditText` | the spelling being typed | `secondaryText` |
| `popup` | key preview and long-press list fill | `key` |
| `popupText` | text in the preview and list | `text` |
| `popupSelected` | chosen item in the long-press list | `accent` |
| `divider` | separators in the candidate bar and panels | derived from `border` |
| `keyShadow` | keycap shadow | black at 20 % |

### Background (Android only)

`variants.<mode>.background.type` adds:

- `linearGradient` with `direction` `vertical`, `horizontal` or `diagonal`.
- `image`: `{ "type": "image", "image": "data:image/webp;base64,…", "align": "center" }`. The image
  is WebP, JPEG or PNG, at most 1.5 MiB, and covers the keyboard (`align`: `top`, `center` or
  `bottom` picks the part that stays visible when the keyboard is shorter than the image). Blur and
  dimming are baked into the image by the editor, so the keyboard only draws a bitmap. The app keeps
  the decoded image in its own file and never decodes it while the keyboard is showing.

With an image the document limit is 2 MiB.

### Keys

- `keycap.cornerRadius` up to 24, `keycap.borderWidth` up to 3.
- `keycap.shadow` adds `raised`: a sharper shadow under the key, like the system keyboards.
- Translucent `key`, `control` and `space` fills let a background image show through.

### iOS

iOS ignores `panel`, `background` and the `appearance` choice of a custom file: the keyboard's
surface belongs to the system, so the keys follow the system's light or dark surface and use the
matching variant. Everything else in the file applies.
