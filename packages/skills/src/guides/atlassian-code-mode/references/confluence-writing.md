# Writing Confluence pages people can read

Pages are storage XHTML built with `storage.*` ([storage.md](storage.md)) and written with `confluence.pages.create/update` ([confluence.d.ts](confluence.d.ts)); Markdown is for prose inside builders. Every write is linted.

## Plan first

Decide the outline first: one-line purpose, 3-7 sections, what goes in tables, Jira macros, diagrams. Gather data (and count empty lists) before assembling `[...parts].join("")`.

## Structure

- The page title is a separate field. Sections start at `storage.h1`, subsections at `h2`/`h3`; never skip a level and do not repeat the title as a first heading.
- Open with a short overview (2-4 lines, or one `info` panel) saying what the page is and its status. Do not add an "Overview" heading that repeats it.
- Pages with 3+ sections or about 600+ words get `storage.toc()` right after the overview.
- Short paragraphs (1-3 sentences). Put raw output, reference material and long tails in `storage.expand`; code in `storage.code` with a language.
- Pluralise in code ("1 issue", "3 issues"), never "issue(s)". Keep inline items (dates, lozenges, links) in one `storage.p(...)`.

## Tables

Use a table for lists with several attributes. Size columns to their content: narrow for key, type, status and date, wide for text. Give widths yourself with `columns: [{ key, title, width }]` (px; the content width is 760, `layout: "wide"` 960), or give none and the linter computes them. A `SCRUM-123` key needs about 100 px. Show statuses with `storage.status`.

## Panels

| Type                    | Colour | Use for                             |
| ----------------------- | ------ | ----------------------------------- |
| `info`                  | blue   | context, the page overview          |
| `success` (alias `tip`) | green  | good news: done, on track           |
| `warning`               | yellow | risks, things to watch              |
| `error`                 | red    | blocking problems and failures only |
| `note`                  | purple | side remarks, definitions           |

Not for neutral information in `warning`/`error`; not directly under a heading with the same title; not stacked; not for long content. One overview panel plus a few others is plenty.

## Jira content

For a list of issues use one `storage.jiraIssues(jql, { columns })` macro (`["key","summary","status","assignee"]`) instead of a `storage.jiraIssue` per row or a heading per issue. Use `storage.jiraIssue(key)` inline for a single reference. A macro whose JQL matches nothing renders a bare header row: count first (reuse search results) and write a sentence ("No open blockers.") for sections that may be empty.

## Images and diagrams

Attach PNG or JPEG files (never SVG/WebP) via `attachments` in `pages.create/update`, then reference them with `storage.image(filename)`; the linter sets the width from the real size, capped at 760 px. Add `alt`/`caption` when the image carries information. Render diagrams with `diagram.render` ([files.md](files.md)) aiming for about 760 px natural width; an image scaled below 80% (a 1100 px diagram shown at 760) gets a warning because its text turns small, so simplify the diagram instead (`flowchart TB`, fewer nodes per row, shorter labels). Use `storage.layout` sparingly (two columns, never nested).

## The linter

`pages.create/update` return `fixes` (applied automatically) and `warnings` (not applied); the tool result prints both for you. Act on warnings: fix the cause and call `pages.update` again.

- **Rejected before any request:** malformed XML, with line and element (`Closing tag </div> at line 2 does not match <p>`). Escape text with `storage.escape`.
- **Fixed automatically:** headings promoted so the top level is H1; a leading H1 equal to the title removed; a TOC inserted for 3+ sections or ~600 words (`toc: false` opts out); column widths computed for tables without them; image width set from the real size; loose inline content under a panel, expand, layout cell or the page root wrapped in `<p>`; Jira list macros given `data-layout="default"` (760 px).
- **Warnings:** an explicit column width too narrow for its longest word (`Column "Key" is 90px; "SCRUM-4" needs about 100px`: widen it or drop the width); images scaled below 80%; skipped heading levels; SVG/WebP images; images of unknown size; a panel repeating the heading above it; a heading that only repeats an embedded issue key; empty sections; a body referencing an attachment you did not pass.

## Worked example

```ts
const issues = await jira.issues.search({
  jql: 'project = APP AND fixVersion = "2.1" ORDER BY status',
  fields: ["summary", "status", "assignee"],
  limit: 200,
});
const open = issues.filter((i) => i.statusCategory !== "Done");
const flow = await diagram.render({
  type: "mermaid",
  source: "flowchart TB\n  A[Freeze] --> B[QA] --> C[Release]",
  name: "release-flow.png",
});
const body = [
  storage.panel(
    "info",
    `${issues.length} issues in 2.1; ${open.length} still open.`,
  ),
  storage.toc(),
  storage.h1("Release flow"),
  storage.image("release-flow.png", { alt: "Release flow" }),
  storage.h1("Open work"),
  open.length
    ? storage.jiraIssues(
        'project = APP AND fixVersion = "2.1" AND statusCategory != Done',
        {
          columns: ["type", "key", "summary", "status", "assignee"],
        },
      )
    : storage.p("Nothing is open."),
  storage.h1("Risks"),
  storage.panel("warning", "QA environment is shared until Friday."),
].join("");
const page = await confluence.pages.create({
  space: "ENG",
  title: "Release 2.1 status",
  body,
  attachments: [flow],
});
return { url: page.url, warnings: page.warnings };
```
