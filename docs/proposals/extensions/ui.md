# Settings pages

Part of [Extensions](README.md). Wireframe: the local design-lab prototype `extensions-settings` (see [Wireframe](#wireframe)). Pages follow the [settings UI patterns](../../ui/settings.md) and [styling](../../ui/styling.md).

## Navigation

| Scope   | Today                                                                | Proposed                                                                                |
| ------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| User    | Connections: Providers, Integrations · Agent: General, Tools, Skills | Connections: Providers, **Extensions** · Agent: General, Tools, Skills, **MCP servers** |
| Project | Agent: General, Tools, Skills                                        | Agent: General, Tools, Skills, **MCP servers**, **Extensions**                          |

Extensions sits under Connections for the user because accounts are managed there. In a project it sits with the other agent settings it overrides. MCP servers sits next to Skills in both scopes because it is the same kind of resource: a catalog from several sources, switched on and off per scope.

## Extensions page

- **Grouped by source:** **Built-in**, later **Installed**. Each group is a `SettingsSection` with `divided` rows.
- **One row per extension:** icon and name, a summary line built from the resolved settings ("acme-cloud · Jira, Confluence"), the change indicator when the value differs from the inherited one, a warning hint when enabled but unavailable (same text the agent gets), and in the control column a Configure button and the enable switch.
- **Configure opens the detail view.** The switch toggles without leaving the page.
- **Project scope** shows the same rows; the page header summarises differences ("2 differ · Reset all").
- A search field appears once there are more than about ten extensions.

## Extension detail view

A drill-in view inside the settings pane (`Extensions › Atlassian`), not a dialog: account lists and contribution lists are too long for a dialog, and accounts need their own add and edit dialogs, which would nest.

- **Header:** back link, icon, name, source badge, version for installed extensions, description, the enable switch, and an availability callout when enabled but unavailable.
- **Settings:** generated from the schema. One `SettingsSection` per schema section, one row per field, controls from the field type (Switch, Input, Select, account Select, `ModelPicker`), each with the change indicator and reset. `visibleWhen` fields appear and disappear in place; `advanced` fields collapse under an Advanced disclosure.
- **Accounts** (user scope, extensions that define an account kind): a `SettingsList` of accounts with Test, Edit and Delete icon actions and an Add account button. In project scope this is one line pointing at user settings.
- **Contributes:** read-only list of what the extension adds: `quick_script` namespaces with their availability, direct tools (link to Tools), skills (link to Skills), MCP servers (link to MCP servers). This tells the user what the agent will see.
- **Client-stored fields** are marked "This device", because they neither sync nor reach the agent.

## MCP servers page

Modelled on the Skills page:

- **Toolbar:** search, "N of M enabled", and Add server (user scope adds to the user file, project scope to `.nerve/mcp-servers.json`).
- **Sections by source:** Yours, This project, From extensions. Rows are `SettingsDisclosureItem`s: name, transport and command or URL as detail, status badge (Connected · 41 tools, Not started, Failed), change indicator, enable switch. Extension rows name their extension and have no edit action.
- **Project servers need trust.** An untrusted project file shows the standard project trust notice; its servers are listed but cannot be enabled until trusted.
- **Server detail view** (same drill-in pattern): connection (status, last error, Restart), definition (transport, command or URL, env; read-only for extension servers), account, trust annotations switch, and a searchable tool list with each tool's risk and an override Select. The namespace name (`mcp.github`) is shown so the user can recognise it in approvals.
- **Unused entries:** settings for servers that no longer exist, with Remove, as on the Skills page.

## Tools page

The Tools page keeps only direct tools, in the existing row pattern:

- **Removed rows:** Jira, Confluence, Image generation, Diagram export. Their capabilities move to extensions.
- **Web search and Web fetch** stay. Their caption names the source ("From the Web extension"), and the search account is chosen on the Web extension. When the Web extension is off, both rows are disabled with a hint linking to it.
- **Quick script** loses its configure dialog. It shows its namespaces as chips; a namespace that is enabled but unavailable is flagged with its reason, and a popover lists them all grouped by origin (runtime, extension, MCP server) with links to fix.
- Bash, Python, Image explanation, Plan review and Sub-agents are unchanged.

## Wireframe

`packages/workbench-app/src/lib/app/design-lab/wireframes/extensions-settings.svelte`, served at `/dev/wireframes/extensions-settings` by `pnpm dev:ui`. It uses the real `SettingsShell` and settings components with mock data, and switches between user and project scope. Design-lab wireframes are local and gitignored ([design lab](../../../packages/workbench-app/src/lib/app/design-lab/README.md)), so this proposal describes the pages in prose and the prototype is shared separately.

## Open questions

- **Nested settings routes:** the settings registry has flat pages with sections. Detail views need a nested route and a back link; this is new to the registry and to deep links (`openSettingsPane`).
- **Account kinds shared by several extensions or MCP servers:** if one appears, the account list could move to its own Accounts page under Connections.
