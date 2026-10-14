# Sub-agent profiles redesign study

Open `index.html` directly in a browser. The study is self-contained, works offline and uses mock data. Each page has a state switcher above the wireframe, and numbered notes explain the decisions.

| Page                | Covers                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.html`        | Problems today, principles, layer model, example resolution, actions per layer, vocabulary                                                             |
| `settings.html`     | Settings › Sub-agents for User and Project: grouped list, row ⋯ menu, New profile dialog, delegation off, problems, trust review, reset, empty project |
| `editor.html`       | Full-page editor: customize a built-in in Project, create in User, name clash, “Where values come from”, field ⋯ menu, file-changed conflict           |
| `conversation.html` | Capabilities › Sub-agents: list, quick edit, model picker, save as default, undo toast, delegation off, unavailable profile                            |

## Core decisions

1. **One name, many layers.** Built-in, User and Project each _create_ a profile or _customize_ one. A layer never makes a second copy with the same name. A name clash in the editor links to the existing profile instead of failing on save.
2. **Provenance on the field.** Each field shows “From Built-in / From User”, or “Changed here · Revert”, and the help text names the value Revert restores. This replaces the separate “Scope overrides” list of Pin/Reset buttons. Pin becomes “Keep this value here” in the field’s ⋯ menu.
3. **A fixed colour for each layer** (Built-in grey, User blue, Project green, Conversation orange), used only for small dots, the B/U/P strip and the layers table.
4. **Settings list grouped by origin** (created here / From User / Built-in). Each row has a switch, a plain-language summary showing only differences from the lead, and a ⋯ menu with only the actions that apply. The five unlabeled icons go away.
5. **Separate actions for separate meanings:** _Revert_ (one field), _Reset customizations_ (this layer’s whole entry, with a before/after confirmation), _Delete profile_ (only profiles created here; never built-ins).
6. **Full-page editor** with breadcrumb, a URL, explicit Save and an unsaved-change guard. The “Where values come from” tab shows the field × layer table. There is no side summary panel; provenance on each field is enough.
7. **Safe creation:** start from Blank, a Copy of an existing profile, or a template. New profiles default to read-only and “Same as lead” for everything else. The description is required, with copy explaining that the lead chooses profiles by it.
8. **Conversation is quick and temporary:** one-line rows like the Tools tab, quick edit limited to on/off, model and thinking, and _Save as default…_ to promote a change to Project or User (the conversation change is then removed, with Undo). Conversations can’t create profiles.
9. **Trust in plain language:** one banner says what is ignored right now and why. _Review…_ lists entries with risky fields flagged (Autonomous, instructions, extra tools) and trusts that exact version.

## Mapping to the current implementation

No storage or DB schema change is needed. The current contracts already provide everything the UI needs:

- Sparse per-layer entries, `local` / `inherited` / `effective`, and per-field `origins` → field provenance, Revert, the layers table and the result panel.
- `subagentProfiles.update` with null-deletes → Revert; `subagentProfiles.reset` without `field` → Reset customizations / Delete profile; with `field` → per-field revert.
- Pin = writing a field equal to the inherited value (already supported: “presence pins a value”).
- `expectedDigest` → the file-changed conflict banner. `subagentProfiles.trust` with the document digest → Review dialog.
- `diagnostics` → row problems and fix actions (move JSON payloads into “Technical details”).
- Save as default = `update` at project/user scope, followed by `reset` of the same fields at conversation scope.

New UI-only pieces:

- A settings sub-route for the editor (replaces `SubagentProfileDialog`).
- A per-profile tool-settings override panel (the schema already allows object values per tool).
- Template definitions. These can live with `builtInSubagentProfiles` in contracts as static drafts, or ship later.
- “Recently used for sub-agents” models (derivable from existing profile values; can be omitted at first).

## Open questions

1. **Explicit Save vs. autosave in the editor.** Settings autosaves elsewhere. The study proposes explicit Save here because of multi-field validation and the shared project file. The alternative is per-field autosave with undo toasts.
2. **Appending to inherited instructions.** Today a layer can only replace instructions. “Add to the built-in text” would let users keep built-in updates, but needs a schema addition (e.g. `instructionsAppend`). Not proposed without approval.
3. **Personal project overrides.** Project changes are shared via the repo file. A private per-project layer (not committed) may be wanted later. Out of scope here.
4. **Templates:** ship a small set now, or start with only Blank and Copy of….
5. **Conversation quick edit scope:** should Permission (Read-only ↔ Autonomous) also be switchable per conversation, or stay in Settings to keep safety-relevant changes deliberate? The study keeps it in Settings.
6. **Delegation per project:** today this is the separate `capabilities.json` toggle with its own trust. The study shows it in place with an origin and Revert, but the two trust flows could be merged into one Review.
