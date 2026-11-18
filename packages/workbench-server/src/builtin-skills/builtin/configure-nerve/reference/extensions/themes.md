# Themes

A theme extension has `ui.themes: [{ id, label, file: "themes/<id>.json" }]` and no backend. Themes are data: a JSON file with exactly the tokens below, never CSS. Only **user** extensions contribute themes (a theme is app-wide); a project extension's themes are ignored with a warning. The user picks it in Settings → Theme once the extension is allowed.

```json
{
  "id": "paper",
  "label": "Paper",
  "kind": "light",
  "tokens": { "background": "oklch(0.965 0.012 92)", "...": "all 17 tokens" }
}
```

`id` and `label` must equal the `ui.themes` entry in `defineExtension`. `kind` (`light` or `dark`) is set only in the theme file; the build copies it into the manifest. Other fields and tokens fail validation, as do missing ones. The numeric `--step-*` and `--mix-*` tuning tokens are not settable. Surfaces, borders, muted tones and terminal colors are derived from these 17.

## Tokens

Core colors: `background`, `foreground`, `primary`, `success`, `warning`, `info`, `destructive`, `destructive-solid`.

Syntax roles: `syntax-variable`, `syntax-punctuation`, `syntax-comment`, `syntax-keyword`, `syntax-string`, `syntax-number`, `syntax-function`, `syntax-type`, `syntax-property`.

Values are hex (`#rgb`, `#rrggbb`, with alpha) or `rgb()`, `rgba()`, `hsl()`, `hsla()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()` with plain numbers, at most 100 characters. No `var()`, `calc()`, `url()` or nested functions. Prefer `oklch`: lightness is perceptual, so contrast is easy to steer.

## Readability rules

A theme that fails is not offered and shows as a warning in `extensions.status`; `nerve-ext check` runs the same rules. All must hold:

- Contrast of at least 4.5:1: `foreground` on `background`; each syntax role on `background`; each of `success`, `warning`, `info` and `destructive` on its own 8% tint over `background`.
- `primary` must be an identifiable accent (OKLCH chroma at least 0.09).
- `background` stays subdued: chroma at most 0.03 (light) or 0.05 (dark). A `dark` theme's background is not lighter than its `foreground`, a `light` theme's not darker.
- The roles `syntax-keyword`, `-string`, `-number`, `-function`, `-type`, `-property` and `-comment` differ pairwise by at least 0.08 (distance in OKLab), so they read as different roles.
- `syntax-variable` and `syntax-punctuation` are the most frequent on screen and stay nearly grey (chroma at most 0.04).

Start from `examples/extensions/paper-theme/themes/paper-theme.json` and adjust lightness and hue; run `nerve-ext check` and read each reported pair.
