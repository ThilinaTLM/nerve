---
name: richdoc
description: Create polished browser-readable HTML reports, design documents, comparisons, decision memos, runbooks or dashboards for human review. Use when the user requests a rich document or visual HTML deliverable; prefer Markdown for chat, GitHub and plain-text workflows.
---

# Richdoc

Create an HTML document using native semantic HTML and a small set of `rd-*` elements. The bundled CLI and browser assets work offline. Node 24 or newer is required; do not install Python, uv or npm dependencies.

## Workflow

1. Resolve this skill's directory from the loaded `SKILL.md` path. Invoke the script with its **absolute path**, not a path relative to the project. Quote paths containing spaces:
   ```sh
   node "/absolute/path/to/richdoc/scripts/richdoc.mjs" prepare "docs/report" --file report.html --title "Report"
   ```
   Preparation installs local assets and optionally creates one minimal HTML skeleton. Skip skeleton creation when editing an existing document. Repeating preparation is safe; changed assets require explicit `--replace-assets`. This flag never replaces authored HTML.
2. Write the document with the normal file tools. Choose an appropriate structure yourself; start with a heading, concise summary and the reader's most important questions. Use the native HTML structures below rather than inventing tags or adding a build system.
3. Validate before completion:
   ```sh
   node "/absolute/path/to/richdoc/scripts/richdoc.mjs" validate "docs/report/report.html"
   ```
   Correct errors and review warnings. The CLI returns JSON and a nonzero exit status on errors. Validation is an authoring check, not a security sandbox.
4. Deliver the HTML file path with a short summary. Keep its `richdoc-assets/` directory alongside it when sharing. Do not publish it, export formats, or serve it as trusted Nerve app content.

## Authoring contract

- Write a complete HTML5 document: `html lang`, UTF-8 charset, viewport, title, and exactly one `rd-page` directly under `body`.
- Keep the prepared local stylesheet and deferred runtime script links. Do not add inline scripts, event handlers, CDN resources or external renderers.
- **Never self-close custom elements.** Always write their closing tags.
- Use `header`, `section`, one `h1`, ordered `h2`/`h3` headings, paragraphs and lists for structure and prose.
- Use `dl` for metadata, accessible `table` for comparisons/scoring, `details`/`summary` for disclosure, `figure`/`figcaption` for images, labelled `progress`, `ol` for steps and checkbox lists for tasks.
- Cite sources with ordinary links and anchored reference lists. Give authored cross-references explicit IDs. Native cross-page links are fine; there is no book framework.
- Escape `&`, `<` and `>` in code, math, diagram and chart text. Never put nested HTML inside their source blocks.
- Supply image alt text and meaningful chart/diagram descriptions. Prefer restrained layouts, short summaries and readable labels; do not fill a report with decorative metrics or icons.
- Use only documented custom elements/attributes. Avoid custom styles; use the shared document presentation.

## Custom elements

| Element      | Use                                                         |
| ------------ | ----------------------------------------------------------- |
| `rd-page`    | Theme, mode, content width, reader settings                 |
| `rd-cols`    | Responsive parallel cards (`n="2                            | 3   | 4"`) |
| `rd-card`    | Visual grouping, optional title/accent                      |
| `rd-callout` | `info`, `success`, `warning`, `destructive`, `note`, `tldr` |
| `rd-badge`   | Compact status                                              |
| `rd-stat`    | Labelled metric with optional delta                         |
| `rd-code`    | Escaped code, highlighting/copy; `format="diff"` for diffs  |
| `rd-math`    | LaTeX, inline or block                                      |
| `rd-diagram` | Mermaid only, required caption; entirely local              |
| `rd-chart`   | Inline JSON/CSV, required `x`, `y`, `title`                 |
| `rd-toc`     | Single-page navigation from authored `h2`/`h3`              |
| `rd-icon`    | Curated local Lucide icons                                  |

Full attributes: [elements](references/elements.md). Optional targeted lookup:

```sh
node "/absolute/path/to/richdoc/scripts/richdoc.mjs" describe --tag rd-chart
```

## References

- [Authoring guidance](references/authoring.md): native HTML patterns and presentation.
- [Technical blocks](references/technical-blocks.md): code, diagrams, math, charts and icons.
- [Examples](examples/): research, design, comparison, dashboard and specialist showcase. Copy an example into a prepared directory before opening or validating it.

Do not assume upstream richdoc documents are compatible. There are no export commands, weighted-score automation, multi-file book navigation or public diagram endpoints.
