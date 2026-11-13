# Settings pages

Part of [Extensions](README.md). Delivery step 3 (Tools page trim in step 5). Wireframe: the local design-lab prototype `extensions-settings` (see [Wireframe](#wireframe)). Pages follow the [settings UI patterns](../../ui/settings.md), including the `SettingsItem` row anatomy, and [styling](../../ui/styling.md).

## Navigation

| Scope   | Today                                                                | Proposed                                                               |
| ------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| User    | Connections: Providers, Integrations · Agent: General, Tools, Skills | Connections: Providers, **Extensions** · Agent: General, Tools, Skills |
| Project | Agent: General, Tools, Skills                                        | Agent: General, Tools, Skills, **Extensions**                          |

Extensions sits under Connections for the user because accounts are managed there. In a project it sits with the other agent settings it overrides. The MCP servers page comes with the MCP proposal ([mcp.md](mcp.md)).

## Extensions page

- **Grouped by source:** one **Built-in** `SettingsSection` with a `SettingsList` of `SettingsItem` rows. An Installed group comes with installable extensions.
- **One `SettingsItem` per extension:**
  - icon and name;
  - summary from the resolved settings ("acme-cloud · Jira, Confluence"), never "On" or "Off";
  - when enabled but unavailable, the problem line replaces the summary, with the same text the agent gets and a fix action ("Add account");
  - the change indicator when the value differs from the inherited one;
  - the enable switch, and the chevron.
- **The row opens the detail view.** The switch toggles without leaving the page. There is no Configure button.
- **Project scope** shows the same rows; the page header summarises differences ("2 differ · Reset all").
- No search field: four extensions do not need one.

## Extension detail view

A drill-in view inside the settings pane (`Extensions › Atlassian`), not a dialog: account lists are too long for a dialog, and accounts need their own add and edit dialogs, which would nest.

- **Header:** back link, icon, name, description, the enable switch, and an availability callout when enabled but unavailable.
- **Settings:** generated from the schema. One `SettingsSection` per schema section, one `SettingsRow` per field, controls from the field type (Switch, Input, Select, account Select, `ModelPicker`), each with the change indicator and reset. `visibleWhen` fields appear and disappear in place; `advanced` fields collapse under an Advanced disclosure. Fields not settable in the current scope show read-only with their inherited value.
- **Accounts** (user scope, extensions that define an account kind): the existing accounts list, moved from the Integrations page. Rows are `SettingsItem`s that open the edit dialog, with Test and Delete icon actions and an Add account button. In project scope this is one line pointing at user settings.
- **Contributes:** read-only list of what the extension adds: `quick_script` namespaces with their availability, direct tools (link to Tools) and skills (link to Skills). This tells the user what the agent will see.

## Nested settings route

Detail views are a new registry concept, built once so the MCP server detail can reuse it:

- **Registry:** a page entry may declare `detail: { param: "extension" }`. The detail is a child of the page: the nav highlights the parent, the header shows a breadcrumb (`Extensions › Atlassian`) with a back link, and Escape or back returns to the list with its scroll position.
- **Deep links:** `openSettingsPane(pageId, sectionId)` becomes `openSettingsPane(pageId, { item?, section? })`, so `openSettingsPane("extensions", { item: "atlassian", section: "accounts" })` opens the detail and scrolls to a section. Existing callers pass `{ section }`.
- **Scope switch** (user ↔ project) keeps the open detail.
- **Unknown item** (an extension id not registered) falls back to the list with a toast.
- **Old links:** `openSettingsPane("integrations", …)` targets map to the matching extension detail, so the "fix" links in existing availability messages keep working.

## Tools page

The Tools page keeps only direct tools, in the `SettingsItem` pattern already used there:

- **Step 3:** Jira and Confluence account pickers and the Quick script configure dialog move to the Atlassian, Web and Diagrams extensions. Web search's account picker moves to the Web extension; its row summary shows the source ("Web extension · Tavily work").
- **Step 5:** the Jira, Confluence, Image generation and Diagram export rows are removed.
- **Web search and Web fetch** stay. When the Web extension is off, both rows are disabled, and the problem line links to the extension.
- **Quick script** keeps only its switch. Its summary lists the active namespaces ("files, image, jira, confluence, web, diagram"); a namespace that is enabled but unavailable turns the summary into the problem line, with a link to fix it.
- Bash, Python, Image explanation, Plan review and Sub-agents are unchanged.

## Wireframe

`packages/workbench-app/src/lib/app/design-lab/wireframes/extensions-settings.svelte`, served at `/dev/wireframes/extensions-settings` by `pnpm dev:ui`. It uses the real `SettingsShell` and settings components with mock data, and switches between user and project scope. Design-lab wireframes are local and gitignored ([design lab](../../../packages/workbench-app/src/lib/app/design-lab/README.md)), so this proposal describes the pages in prose and the prototype is shared separately. It predates `SettingsItem` and is updated during step 3.
