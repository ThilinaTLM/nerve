# Authoring documents

Prefer Markdown for chat, source repository documentation and workflows that cannot carry HTML assets. Choose richdoc for a browser deliverable whose hierarchy, comparisons or visualizations help a human reader.

## Start small

Choose the questions the document answers, write the summary, then add sections. A report does not need every component. Use a `header` with one `h1`, a TL;DR callout, and `section` elements with `h2` headings. Use `h3` only beneath an `h2`.

Use `rd-cols` for genuinely parallel material, not to split prose into newspaper columns. Cards group content; titles are not a substitute for authored section headings. On narrow screens columns stack automatically.

## Native structures

```html
<dl>
  <dt>Status</dt>
  <dd><rd-badge variant="success">Accepted</rd-badge></dd>
  <dt>Owner</dt>
  <dd>Platform team</dd>
</dl>

<table>
  <caption>
    Options and trade-offs
  </caption>
  <thead>
    <tr>
      <th scope="col">Option</th>
      <th scope="col">Benefit</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">A</th>
      <td>Lower operational cost</td>
    </tr>
  </tbody>
</table>

<details>
  <summary>Open questions</summary>
  <p>What happens when the cache is unavailable?</p>
</details>

<label for="capacity">Storage capacity</label>
<progress id="capacity" value="45" max="100">45%</progress>

<ul>
  <li>
    <label><input type="checkbox" checked /> Confirm requirements</label>
  </li>
  <li>
    <label><input type="checkbox" /> Validate rollback</label>
  </li>
</ul>
```

For pros/cons, use two cards with normal lists. For a decision record, use metadata, a status badge, context, options and a rationale. For chronology, use an ordered list with `time`. For weighted comparisons, compute/check numbers yourself and use a table; there is no scoring engine.

## References and navigation

Link inline citations to explicitly authored IDs, for example `<a href="#ref-1">[1]</a>` and `<li id="ref-1">…</li>` in a reference list. External hyperlinks remain ordinary links; the runtime never fetches them.

`rd-toc` builds single-page navigation from authored `h2`/`h3` headings. It generates collision-safe IDs when absent; if authoring your own fragment links, provide IDs explicitly instead of relying on generated slugs.

## Presentation

`rd-page` supports `theme="editorial-warm|graphite-modern"`, `mode="light|dark|auto"`, `width="narrow|standard|wide|full"`, `toc="auto|left|right|top"`, and `prefs="off"`. Reader controls can override settings for that document; storage is optional. Typography is local: Editorial Warm uses Fraunces/Geist/Fira Code, and Graphite Modern uses Space Grotesk/Inter/JetBrains Mono. No font request leaves the document directory. Native `<header><p>Eyebrow</p><h1>Title</h1><p>Lede</p></header>` supplies the editorial hero; direct `<section><h2>…</h2>…</section>` children supply numbered section headings. Existing document assets can be refreshed with `prepare <directory> --replace-assets` without changing HTML.

Native tables, figures, details, definition lists and progress bars are styled by the same document tokens. Use custom CSS only when a genuinely unsupported need is established; validation warns about inline overrides. There is no arbitrary grid-template attribute or application build system.
