# Try-out findings (steps 7 + QA)

Built with the skill's `create-extension.mjs` (local SDK tarballs via `NERVE_EXTENSION_SDK_SPEC` / `NERVE_EXTENSION_NPM_OVERRIDES`): `weather-kit` (integration: account kind, namespace `weatherKit`, direct tool, Open-Meteo), `counter-page` (page, viewState), `sunset-theme` (theme) in `data/storage-2/agent/extensions/`; `csv-table` (preview, `edit: "custom"`) and `notes-panel` (panel with backend method, menu/confirm/notify) in `Random/.nerve/extensions/`. All pass `nerve-ext check`. Severity: **C**ritical, **H**igh, **M**edium, **L**ow. "Fixed" = fixed in this branch with a unit test.

## Bugs

- **C, fixed.** `quick_script` ignored the project/user registry: the tool was created once with the built-ins and `executeQuickScript` used it, so an installed namespace was `ReferenceError: weatherKit is not defined` even though `extensions.status` said `enabled`. Fix: the tool uses `context.registry` (`packages/tools/src/quick-script/tool.ts`).
- **C, fixed.** Calling an installed extension's direct tool failed with `Unknown tool` (also seen when a script calls it): `quickScriptToolRisk` looked the tool up without the project scope. Fix: pass the scope (`script-risk.ts`, `create-conversation-core.ts`).
- **H, fixed.** Scaffolds for page, panel, theme and preview used icons (`layout-dashboard`, `list-checks`, `palette`, `table`) that the extension's top-level `icon` rejects (only `blocks, eye, globe, image-plus, layers, workflow` or `icon.svg`), so a freshly scaffolded extension that passed `nerve-ext check` was `invalid` in Settings with a diagnostic hidden from the author. Fix: templates and examples use allowed icons; `nerve-ext build` now fails with the allowed list; `manifest.md` states it. (Page/panel `icon` fields accept any name; unknown ones show a puzzle piece.)
- **M, fixed.** The panel template used `<form onsubmit>`; frames are sandboxed with `allow-scripts` only, so submit never fires (Enter in the field did nothing). Fix: template uses `onclick`/`onkeydown`; `ui.md` says so.

## Friction and gaps

- **M, fixed.** `ui.md` had an empty ` ```svelte ` block under "Previews"; it now has a short custom-edit example (`$mode`, `host.file.write`, dirty state).
- **M** Nothing says an icon in a page/panel may differ from the extension icon, or where the full icon list lives. Suggest one table in `manifest.md` and a build warning for unmapped page/panel icons.
- **M** New or changed folders are picked up only after Settings → Reload (or `extensions.reload`); no watcher. Say so in SKILL step 6/7 (the agent can call reload; the user's page needs a click).
- **M** The agent-facing flow gives no way to test the UI in the app: the author cannot see the frame without the user's consent. Suggest `nerve-ext dev` serving frames against the fake bridge in a browser.
- **M** Account kind `test` hook can only be exercised after the user adds an account in Settings; the skill's integration template has no account kind, so `accounts` / `auth` / `origins` / `test` are only in `manifest.md` prose. Add an `--with-account` template or a worked example.
- **L** `create-extension.mjs` takes about a minute (two npm installs) and prints npm `install-scripts` warnings for esbuild; the output should say that is expected. The integration scaffold also creates `fixtures/` that is unused once the namespace changes.
- **L** `parse` must accept both the script form (`["Oslo"]`) and the direct-tool form (`[{ place }]`); the template comment says so but `backend.md` only shows the script form.
- **L** `host.ui.notify` toast: not captured in screenshots taken ~0.4 s after the click (toast host in Root); worth a second look (see "Not verified").
- **L** `extensions.status` has no `project`/`scope` field, so the agent cannot tell which project's folder a status belongs to when ids collide.
- **L (QA only)** Slot OAuth tokens expire mid-session; `copy-secrets` then needs a stopped slot.

## Verified in the real desktop (slot 2)

Settings grouping Built-in/User/Project, consent review text per kind (network, account, tools, namespace, page, panel, theme, "can change the file you open it with"), Allow, per-extension switch, Reload, project re-consent after a UI-file change (user extension kept consent after a code-only change), `quick_script` into `weatherKit` (Haiku, after fix), direct tool `weather_kit_current`, permission prompt under Supervise, `extensions.reload/status`, Diagrams `diagram.render` still works, CSV preview + Edit + Save (file written), page viewState restored after app reload, panel `host.call`, host-drawn menu and confirm dialog, theme selection applies (stored in `localStorage`, `data-theme` and tokens persist after reload).
