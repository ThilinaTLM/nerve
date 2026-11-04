# Files panel improvements

> **Status:** Proposal. Follows the Files panel review and bug-fix pass (expand/collapse monitor demand, live-update and Git status warnings, directory change badges, header count removal).

## Problem

The Files panel is a solid read-mostly tree. It loads folders only when opened, renders long lists virtually, updates live through the native watcher, and decorates files with Git status. Editing and navigation features that users expect from an explorer are still missing:

- **Noise.** Ignored trees (`node_modules`, `dist`, `target`, caches) look like source folders. Dotfiles are always shown. `includeIgnored` is never requested, so ignored entries are not dimmed even though `file-git-status.ts` can render them.
- **Navigation.** No filter, no quick open, no typeahead, no collapse all, and the active editor file is highlighted only when its folder is already expanded.
- **Editing.** Create (through a dialog) and desktop-only trash exist. Rename, move, duplicate, multi-select and drop-into-tree do not. Web clients cannot delete.
- **Scale and freshness.** The server re-reads and re-classifies the whole directory for every 500-entry page (`filesystem.service.ts`, `projectDirectoryEntries`). Folders are watched one by one, non-recursively, so collapsed folders are refreshed only when reopened or manually. Git status is refetched for the whole repository on every refresh instead of following `git.repository.invalidated`.

## Goals

- Make the tree calm by default: ignored and hidden entries are visually secondary or hidden, by user choice.
- Reach any file in a few keystrokes (quick open, filter, typeahead, reveal).
- Support everyday file operations in the tree: rename, move, duplicate, multi-select, drag and drop.
- Keep large repositories fast by moving listing, ignore evaluation and path indexing to `nerve-native`.

## Non-goals

- Content search (grep) in the first phases. It is listed under phase 4 for scoping only.
- A general file manager (permissions, archives, properties dialogs).
- Any database schema change. Panel preferences are client UI preferences; indexes live in memory.

## Phase 1: calm, navigable tree (client-first)

| Feature | Notes |
|---|---|
| Dim ignored entries | Request file status with `includeIgnored: true` (add the parameter to `getProjectGitFileStatus`) and use the existing neutral decoration. Measure the cost on this repository first: gix walks ignored directories, so prefer collapsed ignored directories (directory-level `!` entries) over per-file emission. |
| Hide ignored / hide dotfiles toggles | Header overflow menu. Per-project UI preference. Hidden entries are filtered client-side in `buildFileExplorerTree`; `.git` stays hidden when dotfiles are hidden. |
| Reveal active file | On active tab change (and an explicit "Reveal in Files" action), expand ancestors, load missing pages, then scroll the row into view. Requires a `PanelTree` scroll-to-item API. Opt-out preference ("Auto reveal"). |
| Collapse all | Header button; clears expanded IDs and syncs monitor demand. |
| Typeahead | Typing a prefix moves focus to the next visible matching row. Implement in `PanelTree` so every tree gets it. |
| Filter box | Header toggle that filters loaded entries by name and keeps ancestors of matches visible. Phase 3 makes it whole-project via the native index. |
| Inline create | Replace `CreateProjectEntryDialog` with an editable row under the target folder (Enter commits, Esc cancels, validation inline). Also used by rename. |
| Mention in conversation | Context-menu item that reuses the drag-to-composer path reference. |

## Phase 2: file operations

New operations in `packages/contracts/src/domains/filesystem/operations.ts`, implemented in `filesystem.service.ts`, all confined to the project root and refusing to follow symlinks out of it:

- `filesystem.project.entries.move` `{ projectId, from, to, overwrite?: false }` covers rename and move. Fails if the target exists. After success the client rewrites open file tabs under `from` (as trash already closes them) and refreshes both parent directories.
- `filesystem.project.entries.copy` `{ projectId, from, to }` for duplicate and paste, recursive for directories.
- `filesystem.project.entries.delete` `{ projectId, paths }` for clients without the desktop trash bridge. Behind a confirmation that states the deletion is permanent; desktop keeps OS trash.

Client features built on them:

| Feature | Notes |
|---|---|
| Rename (F2, context menu) | Inline row editor; selects the base name without extension. |
| Multi-select | Ctrl/Cmd-click toggles, Shift-click selects a range over visible rows. Selection is separate from the active-file highlight. Bulk actions: trash/delete, copy paths, mention in conversation, drag. |
| Drag and drop | Moving within the tree (drop on a folder, auto-expand on hover, Alt/Option to copy), and dropping OS files into a folder (upload via the existing attachment path or a new write operation; decide in review). Dragging to the composer keeps working. |
| Cut / copy / paste, duplicate | Keyboard shortcuts scoped to the focused tree. |
| Undo last operation | Optional: a toast with Undo for move/rename (inverse move). Not for delete. |

## Phase 3: native-backed listing and quick open

Native work lives in `packages/native/native` (napi-rs). The panel uses only the watcher and gix status today; the tree is listed with Node `fs`.

1. **Native directory listing.** `listDirectory(root, path, { cursor, limit, includeHidden })` that reads once, classifies entries (including symlink targets) and returns sorted pages plus an `ignored` flag per entry. Cache the sorted listing per directory, keyed by the watcher generation, so later pages do not re-read the directory. Ignore evaluation: gix's ignore stack for repositories (no new dependency); for non-Git projects decide between adding the `ignore` crate or leaving them unignored. The server keeps the Node implementation only as the fallback when native is unavailable.
2. **Path index for quick open.** Reuse the native fuzzy search index (`src/search/`, already used by completions) with a path-document type, fed by a gitignore-aware walk and updated incrementally from watcher events. Replace the `git ls-files`/`fdir` walk and its 20,000-entry cap in `file-completion-candidates.ts`, so `@` mentions and quick open share one index. Respect the existing search budget/admission limits.
3. **Quick open (Ctrl/Cmd+P).** Command-palette dialog backed by the index: fuzzy match with highlighted segments, recent files first, Enter opens, Alt+Enter reveals in the tree, `:line` suffix opens at a line (`filesystem.file` GET already supports `line`). The Phase 1 filter box switches to the same index.
4. **Git status from invalidation.** Subscribe the panel to `git.repository.invalidated` and share the Git panel's status read/cache instead of refetching on every directory refresh.

## Phase 4: freshness and search (later)

- **Recursive, ignore-filtered watching.** Watch the project recursively but skip ignored trees, so collapsed folders stay current and inotify limits are respected on Linux. Removes most of the need for manual refresh and the 512-directory demand cap.
- **Content search.** A "Search in files" view using `grep-searcher`/`grep-regex` plus the same ignore rules (new crates), streaming results grouped by file, opening at line. Scope and UI to be proposed separately.

## Validation

- Unit tests for tree filtering, selection ranges, reveal path expansion, and move/copy path rewriting of open tabs.
- Server tests for the new operations: root confinement, symlink escape, existing targets, directory moves into themselves.
- Native: Rust tests for listing order, ignore flags and index updates; a benchmark on this repository (`node_modules`, `target`) comparing Node and native listing and the cost of `includeIgnored`.
- Browser test for keyboard flows: typeahead, F2 rename, multi-select, quick open.

## Open questions

- Should ignored entries be hidden or only dimmed by default?
- Should auto reveal be on by default (VS Code: yes, Zed: configurable)?
- OS file drop into the tree: reuse attachment upload or add a dedicated write operation?
- Non-Git projects: add the `ignore` crate, or treat them as having no ignore rules?
- Where should quick open live: a dedicated dialog, or a mode of an existing command palette?
