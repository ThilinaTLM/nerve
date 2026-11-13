# Extension settings

Part of [Extensions](README.md).

## Problem

Integration settings are spread over tool entries in `config/agent.json` and the accounts in `config/integrations.json`:

- **Accounts** (`atlassianProfiles`, `tavilyProfiles` in [`settings.ts`](../../../packages/contracts/src/domains/settings/settings.ts)) are user-level, with secrets saved separately.
- **The active account** is picked per tool: `tools.jira.profileId`, `tools.confluence.profileId`, `tools.quick_script.settings.*.profileId` and `tools.web_search.settings.tavilyProfileId`.
- **Options** sit under tools (`kroki`, `imageGeneration`), next to unrelated tool settings.
- **Every page is hand-written**, so an extension that is not compiled into the app cannot have settings at all.

## Schema

An extension declares its settings as a small declarative schema in its manifest. The host compiles it to a validator at registration, and the app renders it generically. Secrets never appear in settings; they belong to accounts.

```ts
type SettingsSchema = {
  sections?: { id: string; title: string; description?: string }[];
  fields: Record<string, SettingField>; // keys: camelCase, stable
};

type SettingField = FieldBase &
  (
    | { type: "boolean"; default: boolean }
    | {
        type: "string";
        default?: string;
        format?: "url" | "text";
        placeholder?: string;
        maxLength?: number;
      }
    | {
        type: "number";
        default?: number;
        min?: number;
        max?: number;
        step?: number;
        unit?: string;
      }
    | {
        type: "enum";
        default: string;
        options: { value: string; label: string; description?: string }[];
      }
    | { type: "account"; kind: string } // id of a user account of this kind
    | { type: "model"; capability?: "image" | "vision" } // ModelPicker selection
  );

type FieldBase = {
  label: string;
  description?: string; // one caption line; longer text goes in an info hint
  section?: string;
  scopes?: ("user" | "project" | "conversation")[]; // default all three
  visibleWhen?: { field: string; equals: string | boolean }; // e.g. backend-specific options
  advanced?: boolean; // collapsed under "Advanced" in the detail view
};
```

- **Discriminated options** (an image backend with its own model list) are a parent `enum` plus fields with `visibleWhen`. Hidden fields keep their stored value but are ignored, so switching back restores them. This keeps the schema flat while covering today's `imageGeneration` union.
- **The field set is deliberately small.** A field type is added only when a built-in extension needs it, because every type needs a control, a validator and provenance display. Arbitrary JSON Schema is not accepted.
- **Deferred until an extension needs them:** a `list` field type, and device-local (`client`) storage for presentation-only fields such as themes.
- **Each extension also has an implicit `enabled` boolean** (default from the manifest; built-in extensions default to off except Diagrams, whose default server is public).

## Storage and layering

Extension settings have their own file at each scope, separate from `config/agent.json`:

| Scope        | File                                                                         |
| ------------ | ---------------------------------------------------------------------------- |
| User         | `config/extensions.json` in the home                                         |
| Project      | `.nerve/extensions.json`                                                     |
| Conversation | `config/extensions.json` in the conversation's data directory (backend only) |

```json
{
  "schemaVersion": 1,
  "revision": 4,
  "extensions": {
    "atlassian": {
      "version": 1,
      "enabled": true,
      "settings": { "account": "acme-cloud", "jira": true, "confluence": true }
    },
    "web": {
      "version": 1,
      "enabled": true,
      "settings": { "searchAccount": "tavily-work" }
    },
    "diagram": { "version": 1, "settings": { "server": "https://kroki.io/" } },
    "imagegen": {
      "version": 1,
      "enabled": true,
      "settings": {
        "backend": "openai-codex",
        "model": "gpt-image-2.5-flare",
        "quality": "auto"
      }
    }
  }
}
```

- **A missing file means inheritance**, like other optional preference files. `revision` gives the same optimistic concurrency as `agent.json`.
- **Resolution is per field:** built-in default (manifest) → user → project → profile → conversation; the nearest layer that sets a field wins, so a project can override only `account` and inherit the rest. A small resolver in `packages/contracts` (`domains/extensions/`) returns each value with its source, which drives the change indicator in the UI ([settings UI](../../ui/settings.md)). It is independent of the agent-configuration resolver.
- **A field's `scopes` limit where it may be set.** A field without `project` is rejected in project files with a diagnostic, and the project UI shows it read-only with its user value.
- **Conversation layer:** the backend resolves and validates it like the others. The UI does not expose it in this proposal.
- **Agent profiles** get an optional `extensions` section in their definitions, with the same entry shape, so a profile can enable or disable an extension, set fields and lock them ("Locked by Planning"). The applied profile snapshot includes it.
- **Sub-agents** inherit the parent's resolved extension settings. A child profile may narrow them (disable an extension) but cannot select an account its parent's scope does not have.
- **Validation:** each entry is validated by its extension's compiled schema. An entry whose extension is not registered is kept and reported, never dropped, so a later registration restores it.
- **Project trust:** `.nerve/extensions.json` changes what the agent may reach (an account choice, a Kroki server URL), so it is trusted by exact content like project permission overlays. An untrusted file is ignored with a notice.

## Versions

Two independent versions:

- **`schemaVersion`** versions the file envelope. Nerve owns it: the release's home migration for user and conversation files, the project configuration version chain for project files. It should rarely change.
- **Per-entry `version`** versions one extension's settings. The manifest declares `settingsVersion` and upgrade functions (`migrations: { 2: (v1) => v2, … }`), so an extension evolves its settings without a Nerve migration step, which installed extensions will need.

Upgrades run **on read**. The upgraded entry is written back only when that scope is next saved, so project files are not rewritten (and do not lose trust) just because an extension upgraded. An entry with a **newer version than the code knows** (after a downgrade) is shown read-only with a diagnostic and never overwritten.

## Accounts

Accounts hold credentials, so they are user-only and live in `config/accounts.json` (renamed from `config/integrations.json`) with secrets in the secret store as today. They stay out of `extensions.json` because they exist only at user scope, change on a different cadence (add, test, rotate), and will be shared with MCP servers. An extension declares the account kinds it defines:

```ts
type AccountKind = {
  kind: string; // "atlassian", "tavily"
  label: string; // "Atlassian account"
  fields: Record<string, SettingField>; // non-secret: name, siteUrl, email, defaultProjectKey, defaultSpaceKey
  secret: { label: string; help?: string }; // stored in the secret store, never echoed
  test?: true; // the host can verify the credential ("Test connection")
};
```

- Settings reference accounts by id with an `account` field. **Account ids are local to a home.** A project file naming an account this user does not have leaves the extension unavailable, with a fix that names the extension page. It never falls back to another account silently.
- **Default project and space keys stay on the Atlassian account**, as today: a key is meaningful only on its site, so switching account switches the defaults. A project-level override can be added later as an optional extension field without a migration.
- The account list and its add, edit and test actions appear only in the user-scope detail view of the extension that defines the kind ([ui.md](ui.md)).

## Migration

Moved from `agent.json` (and profile definitions) into `extensions.json` at the same scope:

| From (`config/agent.json` `overrides`)                                               | To (`extensions.json`)                                   |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `tools.jira`, `tools.confluence`, `tools.quick_script.settings.jira` / `.confluence` | `atlassian` (`enabled`, `account`, `jira`, `confluence`) |
| `tools.quick_script.settings.web`, `tools.web_search.profileId`                      | `web` (`searchAccount`)                                  |
| `tools.quick_script.settings.diagram`, Kroki tool settings                           | `diagram` (`server`)                                     |
| Image generation tool settings                                                       | `imagegen`                                               |

- `config/integrations.json` is renamed to `config/accounts.json`; its content is unchanged.
- User and conversation files move in the release's single home migration step. Project files move through their configuration version chain ([project configuration versions](../../architecture/configuration.md#project-configuration-versions)), since home migrations never touch project files. Creating `.nerve/extensions.json` from approved `agent.json` content is a deterministic conversion, so it keeps trust under the same rule.
- When `tools.jira` and `tools.quick_script.settings.jira` disagree, the `quick_script` value wins, because it is the route that remains. Jira and Confluence using different accounts at the same scope cannot be expressed in one Atlassian extension; the migration keeps the Jira account and reports the dropped Confluence choice.
- `tools.quick_script` becomes a plain toggle; `tools.<name>` keeps only enablement and tool-only options (`python_exec`, `bash`).
- All of these are configuration files, so there is no database change. Old direct-tool calls in conversation history are not migrated; they render as generic tool calls.
