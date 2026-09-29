# Technical blocks

All source blocks contain **escaped text**, never nested HTML. Escape `&`, `<` and `>` when necessary. Assets and renderers are local; no browser renderer posts document content to a server.

## Code and diffs

```html
<rd-code lang="typescript" title="Cache lookup"
  >if (size &lt; limit) { return cache.get(key); }</rd-code
>

<rd-code format="diff" title="Configuration change"
  >-timeout: 10 +timeout: 30</rd-code
>
```

Bundled languages: `javascript`, `typescript`, `json`, `python`, `bash`, `sql`, `html`, `css`, `markdown`, `diff`. Use full names. Unsupported languages warn and render as plain text. Terminal examples are ordinary code blocks, not a separate shell vocabulary. Copying requires browser clipboard permission; otherwise select the code manually.

## Math

```html
<rd-math display="inline">E = mc^2</rd-math>
<rd-math display="block">\sum_{i=1}^{n} x_i</rd-math>
```

KaTeX is bundled with its fonts. Trusted HTML commands and external URLs are disabled. Invalid math falls back to source with a visible error.

## Diagrams

```html
<rd-diagram lang="mermaid" caption="Request flow">
  graph TD Client --> API API --> Database
</rd-diagram>
```

Mermaid is the only supported language. No endpoint attributes or Kroki integration exist. Use ordinary diagram labels, not embedded HTML, external images, click callbacks or external resources. Rendering is strict and SVG is sanitized. A rendered diagram retains its source in a disclosure; unavailable rendering shows readable source.

## Charts

```html
<rd-chart kind="bar" x="name" y="value" title="Deployments by team">
  [{"name":"Platform","value":12},{"name":"Product","value":9}]
</rd-chart>
```

Supported kinds: `bar`, `line`, `area`, `donut`, `scatter`, `heatmap`. Optional `variant="sparkline"`, `series`, `caption`; `format="json|csv"` defaults to JSON. Use inline data only. Every row must contain the declared columns and numeric Y values. Donuts require nonnegative values with a positive total. For a heatmap, `x` selects the horizontal category, `series` selects the vertical category (defaults to `x`), and `y` selects the numeric cell value. CSV accepts quoted fields and embedded newlines.

A chart includes an accessible title and its data table. Without JavaScript its inline data stays readable. Maximum 10,000 rows; prefer a much smaller, purposeful dataset. Code/math/diagram/chart blocks are limited to 256 KiB of source each.

## Icons

`rd-icon` is decorative by default. Supply `label` when the icon conveys information not already present in surrounding text.

```html
<rd-icon name="circle-check" label="Passed"></rd-icon>
```

Bundled names: `arrow-right`, `arrow-left`, `chevron-right`, `chevron-down`, `check`, `x`, `plus`, `minus`, `info`, `triangle-alert`, `circle-check`, `circle-x`, `lightbulb`, `target`, `clock`, `calendar`, `user`, `users`, `file-text`, `code`, `chart-no-axes-combined`, `link`, `external-link`, `copy`. Other names fail validation instead of requesting an icon from a CDN.
