# Agent instruction files

Covers `AGENTS.md`, or the project's existing equivalent (`CLAUDE.md`, `.cursorrules`…): edit that one and add no parallel file. Both exist with overlapping content → ask which is canonical; the other becomes a one-line pointer. Agents load these files on every task, so every line costs tokens every time.

## Layouts

- Single repo: root file at the repo root; `docs/` beside it.
- Multi-repo workspace: a parent directory, possibly not a git repo, holds `docs/` and component repos (`api/`, `web-app/`…). The root file sits in the parent. Each component file is committed in its component repo and read by people who cloned only that repo.

## Placement

- One root file. One file per component (api, web-app, mobile, CLI…) that has its own toolchain, commands or rules; skip components with nothing non-obvious to say.
- Component files add to or override the root file and never repeat it. Mark overrides: "Overrides root: …".
- Only the root file references `docs/`. Component files reference only paths inside their own repo, because outside paths break for anyone who cloned that repo alone.
- Paths: code spans relative to the root of the git repo that contains the file (in a multi-repo workspace, the root file uses paths relative to the workspace root). No `..` and no Markdown links.

## Content

Include only what an agent cannot cheaply discover and would otherwise get wrong:

- exact commands: build, test (single file and focused variants), lint/format/typecheck, what must pass before work counts as done;
- non-obvious conventions, and forbidden or dangerous actions with a short reason;
- gotchas: generated files, required env vars, slow or flaky steps, ports, cross-component contracts;
- where to look for X, when the location is not obvious from names.

Exclude: project descriptions, directory tours `ls` reveals, rules a formatter, linter or CI enforces automatically (keep only the command to run), generic good practice, architecture content (the root file points to `docs/` instead), history and status.

## Form

- Flat imperative bullets. Group related rules with a bold lead-in word; use headings only when a file has several large groups. No intro, outro, emoji or decorative formatting.
- One reading per rule: name the exact command, path or symbol. Add the reason as a short clause when it is not obvious, so the rule generalises.
- Say what to do rather than only what to avoid. No capitals or "CRITICAL"; a reason works better.
- Verify every command, path and name against the repo before writing it; run cheap commands.

## Optimizing existing files

1. Read the root file and every component file together.
2. Rewrite to the rules above: compress wording; remove what is obvious, discoverable or stale; fix wrong commands and paths; move workspace-wide rules to the root file and component-only rules to the component file; move architecture content into `docs/architecture/`.
3. Keep the meaning of every hard rule. Removing, relaxing or changing one → SKILL.md "Asking the user".
4. Report per file: lines before → after, what was removed, moved or corrected.

## Root docs block

At most 6 lines in the root file, adapted to its tone:

```markdown
- Read `docs/architecture/README.md` (principles, change risk) and `docs/architecture/glossary.md` before design changes, then the page for the area you touch.
- Take extra care with high-risk areas: <project's top 1–3, e.g. persisted data and migrations>.
- Put new ideas and unbuilt work in `docs/proposals/`. After implementing a proposal, decommission it into architecture.
- Update affected architecture pages in the same change when behaviour or rules change.
```
