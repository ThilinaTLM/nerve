# Writing Confluence pages people can read

A page body is RichText (`sdk.docs("storage/builders")`): Markdown for prose, `storage.*` builders for structure, arrays to combine. Write with `confluence.pages.create/update`. Every write is linted.

## Editing an existing page

`const page = await confluence.pages.get({ id, body: "storage" })` (the default Markdown body is a read-only view), then pass `version: page.version` to `pages.update`.

| Change                   | How                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Append / prepend         | `body: [page.body, "## New\n\ntext"]`                                                                                                                                    |
| Rewrite one section      | `body: storage.replaceSection(page.body, "Risks", "- new risk")`                                                                                                         |
| Larger or surgical edits | `const d = await confluence.pages.download({ id })`, edit `d.file` with the Edit tool or `files.edit`, then `pages.update({ id, version: d.version, bodyFile: d.file })` |

`body` and `bodyFile` are exclusive. Rewrites that drop macros, layouts, images or mentions throw unless `allowRemoving: true`; add-on macros (drawio, gliffy, ...) survive only if their storage stays in the body. Never rebuild a page from the Markdown view; use an array, not `page.body + "..."`.

## Plan first

Outline first: one-line purpose, 3-7 sections, what goes in tables, Jira macros, diagrams. Gather data (and count empty lists) before assembling the parts array.

## Structure

- The page title is a separate field. Sections start at `#` (H1), subsections at `##`/`###`; never skip a level and do not repeat the title as a first heading.
- Open with a 2-4 line overview (or one `info` panel) on what the page is and its status, without an "Overview" heading.
- Only long pages (about 600+ words or 6+ sections) get `storage.toc()` right after the overview; short pages get none.
- Short paragraphs (1-3 sentences). Put raw output, reference material and long tails in `storage.expand`; code in `storage.code` with a language.
- Pluralise in code ("1 issue", "3 issues"), never "issue(s)". Keep inline items (dates, lozenges, links) in one `storage.p([...])` array: `storage.p(["Due ", storage.date(d), " ", storage.status("Open")])`.

## Tables

Use a table (Markdown for plain text cells, `storage.table` for lozenges, links, widths or merged cells) for lists with several attributes. Narrow columns for key, type, status and date, wide for text. Set `columns: [{ key, title, width }]` yourself (px; content width 760, `layout: "wide"` 960) or let the linter compute them; a `SCRUM-123` key needs about 100 px. Show statuses with `storage.status`.

## Panels

| Type                    | Colour | Use for                             |
| ----------------------- | ------ | ----------------------------------- |
| `info`                  | blue   | context, the page overview          |
| `success` (alias `tip`) | green  | good news: done, on track           |
| `warning`               | yellow | risks, things to watch              |
| `error`                 | red    | blocking problems and failures only |
| `note`                  | purple | side remarks, definitions           |

No neutral information in `warning`/`error`; none directly under a same-titled heading, stacked, or holding long content. An overview panel plus a few others is plenty.

## Jira content

For a list of issues use one `storage.jiraIssues(jql, { columns })` macro (`["key","summary","status","assignee"]`) instead of a `storage.jiraIssue` per row or a heading per issue. Use `storage.jiraIssue(key)` inline for a single reference. A macro whose JQL matches nothing renders a bare header row: count first (reuse search results) and write a sentence ("No open blockers.") for sections that may be empty.

## Images and diagrams

Attach PNG or JPEG files via `attachments` (GIF/WebP are converted to PNG, SVG is rejected), then reference them with `storage.image(filename)`; the linter sets the width from the real size, capped at 760 px, so aim for about 760 px natural width. Add `alt`/`caption` when the image carries information. An image scaled below 80% (a 1100 px diagram shown at 760) gets a warning because its text turns small: shrink or simplify the source instead (diagrams: `sdk.docs("diagram/render")`). Use `storage.layout` sparingly (two columns, never nested).

## The linter

`pages.create/update` return `fixes` (applied) and `warnings` (not applied); the result footer prints both. Fix the cause of warnings with `pages.update`.

- **Rejected before any request:** malformed XML, with line and element (`Closing tag </div> at line 2 does not match <p>`). Plain strings are Markdown or literal text; use `storage.escape` only inside `storage.raw`.
- **Fixed automatically:** headings promoted so the top level is H1; a leading H1 equal to the title removed; a TOC for long pages (`toc: false` opts out); computed column widths and image widths; loose inline content under a panel, expand, layout cell or the page root wrapped in `<p>`; Jira list macros given `data-layout="default"` (760 px).
- **Warnings:** an explicit column width too narrow for its longest word (`Column "Key" is 90px; "SCRUM-4" needs about 100px`: widen it or drop the width); images scaled below 80%; skipped heading levels; SVG/WebP images; images of unknown size; a panel repeating the heading above it; a heading that only repeats an embedded issue key; empty sections; a body referencing an attachment that is neither passed in `attachments` nor already on the page (existing attachments keep their real size).

## Worked example

```ts
const issues = await jira.issues.search({
  jql: 'project = APP AND fixVersion = "2.1" ORDER BY status',
  fields: ["summary", "status", "assignee"],
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
  "# Release flow",
  storage.image("release-flow.png", { alt: "Release flow" }),
  "# Open work",
  open.length
    ? storage.jiraIssues(
        'project = APP AND fixVersion = "2.1" AND statusCategory != Done',
        {
          columns: ["type", "key", "summary", "status", "assignee"],
        },
      )
    : "Nothing is open.",
  "# Risks",
  storage.panel("warning", "QA environment is shared until Friday."),
];
const page = await confluence.pages.create({
  space: "ENG",
  title: "Release 2.1 status",
  body,
  attachments: [flow],
});
return { url: page.url, warnings: page.warnings };
```
