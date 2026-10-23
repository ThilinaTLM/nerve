# Domain inventory and storage boundaries

## Current implementation baseline

- User configuration has `daemon.json`, `harness.json`, `ui.json`, `permissions.json`, `providers.json` and `integrations.json`, plus separately owned documents such as `prompt-suggestions.json`.
- Project harness preferences live in `.nerve/config/harness.json`. Project/conversation capabilities use `capabilities.json`; user tools and skills are in the harness document.
- Conversation scalar configuration is in SQLite `conversation_config`; tools/skills, compaction and applied profile policy are split across JSON files.
- Permission ruleset selection is separate from ruleset definitions and scoped permission overlays. Policy composition is not ordinary settings merging.
- Suggestions have separate definitions, enablement preferences and trust state.
- User/project profile catalogs and applied conversation snapshots have different lifecycles.
- Browser-local workspace state and remembered selections are not the same as durable defaults.
- Application startup options may be overridden by environment or command-line arguments and may require restart.

Relevant implementation owners: `packages/contracts/src/domains/settings/`, `packages/workbench-server/src/infrastructure/configuration/`, `packages/workbench-server/src/core-host/`, and the agent-profile, prompt-suggestion, launch-definition and authentication domains.

## Domain decision matrix — to complete

For every domain specify: allowed scopes; exact relative path; schema/version; sparse and resolved shapes; merge and reset rules; source attribution; trust requirements; activation timing; write concurrency; consumers; migration.

| Domain | Decisions still required |
| --- | --- |
| Agent settings | Model/reasoning/permission selection, tools and configuration, skills, allowed sub-agent profiles; atomic conversation envelope |
| Profiles | Catalog paths and ownership, references, recommendations/requirements, snapshot lifecycle, editing and reapplication |
| Harness | Compaction, retry and execution behavior; which settings belong in agent settings versus a separate domain |
| Permissions | Ruleset catalogs, overlay schema and scopes, precedence, remembered approvals and sub-agent restrictions |
| Suggestions | Definition locations, enablement scopes, merge rules, trust and execution behavior |
| Providers/integrations | User-owned catalogs, scoped selection references and credential boundaries |
| Application/UI | User-only preferences, device-specific state, startup overrides and restart requirements |
| Launch definitions | Project ownership, locations, trust and separation from launch runtime state |
| Runtime state | Remembered selections, browser state, trust records, approvals, execution history; explicitly separate from preferences |

