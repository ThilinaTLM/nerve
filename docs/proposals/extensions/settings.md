# Extension settings

Part of [Extensions](README.md).

## Problem

Integration settings are spread over tool entries and the global settings file:

- **Accounts** (`atlassianProfiles`, `tavilyProfiles` in [`settings.ts`](../../../packages/contracts/src/domains/settings/settings.ts)) are user-level, with secrets saved separately.
- **The active account** is picked per tool: `tools.jira.profileId`, `tools.confluence.profileId`, `tools.quick_script.settings.*.profileId` and `tools.web_search.settings.tavilyProfileId`.
- **Options** sit under tools (`kroki`, `imageGeneration`) or on the account (`defaultProjectKey`, `defaultSpaceKey`), although a project is the natural owner of a default project key.
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
    | { type: "list"; item: "string"; default?: string[] }
  );

type FieldBase = {
  label: string;
  description?: string; // one caption line; longer text goes in an info hint
  section?: string;
  storage?: "agent" | "client"; // default "agent"
  scopes?: ("user" | "project" | "conversation")[]; // agent storage only; default all three
  visibleWhen?: { field: string; equals: string | boolean }; // e.g. backend-specific options
  advanced?: boolean; // collapsed under "Advanced" in the detail view
};
```

- **Discriminated options** (an image backend with its own model list) are a parent `enum` plus fields with `visibleWhen`. Hidden fields keep their stored value but are ignored, so switching back restores them. This keeps the schema flat while covering today's `imageGeneration` union.
- **The field set is deliberately small.** A field type is added only when a built-in extension needs it, because every type needs a control, a validator and provenance display. Arbitrary JSON Schema is not accepted; MCP server input schemas are for SDK types, not settings.
- **Each extension also has an implicit `enabled` boolean** (default from the manifest; built-in extensions default to off except Diagrams, whose default server is public).

## Storage and layering

A field's `storage` decides where its value lives:

| Storage           | Where                                                      | Layers                                                                                    | Use for                                                              |
| ----------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `agent` (default) | Agent configuration documents, key `extensions`            | Built-in default (manifest) → user → project → conversation, with agent profiles as today | Anything that changes what the agent can do or which account it uses |
| `client`          | Browser `localStorage`, key `nerve.extension.<id>.<field>` | Built-in default → this device                                                            | Presentation only: theme choice, panel layout                        |

Agent storage adds one key to the agent settings overrides ([`schemas.ts`](../../../packages/contracts/src/domains/agent-configuration/schemas.ts)), next to `tools` and `skills`, in the shape shared by lead and child settings:

```ts
extensions: {
  atlassian: { enabled: true, settings: { account: "acme-cloud", jira: true, confluence: true, defaultProjectKey: "APP" } },
  web:       { enabled: true, settings: { searchAccount: "tavily-work" } },
  diagram:   { settings: { server: "https://kroki.io/" } },
  imagegen:  { enabled: true, settings: { backend: "openai-codex", model: "gpt-image-2.5-flare", quality: "auto" } },
}
```

- **Resolution is per field**, like tool settings today: the nearest layer that sets a field wins, so a project can override only `account` and `defaultProjectKey` and inherit the rest. The resolved value carries its source, which drives the change indicator in the UI ([settings UI](../../ui/settings.md)).
- **A field's `scopes` limit where it may be set.** A field without `project` is rejected in project files with a diagnostic, and the project UI shows it read-only with its user value.
- **Conversation layer:** the backend resolves and validates it like the others, so a conversation or an agent profile can enable an extension or pick an account. The UI does not expose it in this proposal.
- **MCP servers** have their own `mcpServers` key with the same layering ([mcp.md](mcp.md#enablement-and-per-server-settings)).
- **Agent profiles** can set and lock extension fields as they do tool settings ("Locked by Planning").
- **Sub-agents** inherit extension settings like other child settings. A child profile may narrow them (disable an extension) but cannot select an account its parent's scope does not have.
- **Validation:** each extension's entry is validated by its compiled schema. An entry whose extension is not registered (an installed extension uninstalled) is kept and reported, never dropped, so reinstalling restores it.
- **Client storage stays on the device.** It does not sync between devices or across the daemon's clients, and it never affects the agent. A field that would change agent behaviour must use agent storage.

## Accounts

Accounts hold credentials, so they are user-level and live in the global settings file and the secret store as today. An extension declares the account kinds it defines:

```ts
type AccountKind = {
  kind: string; // "atlassian", "tavily"
  label: string; // "Atlassian account"
  fields: Record<string, SettingField>; // non-secret: name, siteUrl, email
  secret: { label: string; help?: string }; // stored in the secret store, never echoed
  test?: true; // the host can verify the credential ("Test connection")
};
```

- Settings reference accounts by id with an `account` field. **Account ids are local to a home.** A project file naming an account this user does not have leaves the extension unavailable, with a fix that names the extension page. It never falls back to another account silently.
- The account list and its add, edit and test actions appear only in the user-scope detail view of the extension that defines the kind ([ui.md](ui.md)).
- `defaultProjectKey` and `defaultSpaceKey` move from the Atlassian account to Atlassian extension fields, so a project can set them.

## Migration

Moved into `extensions` at every scope:

| From                                                                                 | To                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `tools.jira`, `tools.confluence`, `tools.quick_script.settings.jira` / `.confluence` | `extensions.atlassian` (`enabled`, `account`, `jira`, `confluence`) |
| `tools.quick_script.settings.web`, `tools.web_search.settings.tavilyProfileId`       | `extensions.web` (`searchAccount`)                                  |
| `tools.quick_script.settings.diagram`, Kroki tool settings                           | `extensions.diagram` (`server`)                                     |
| Image generation tool settings                                                       | `extensions.imagegen`                                               |
| `defaultProjectKey`, `defaultSpaceKey` on Atlassian accounts                         | `extensions.atlassian` at user scope                                |

- User and conversation files move in the release's single home migration step. Project files move through their configuration version chain ([project configuration versions](../../architecture/configuration.md#project-configuration-versions)), since home migrations never touch project files.
- When `tools.jira` and `tools.quick_script.settings.jira` disagree, the `quick_script` value wins, because it is the route that remains. Jira and Confluence using different accounts at the same scope cannot be expressed in one Atlassian extension; the migration keeps the Jira account and reports the dropped Confluence choice.
- `tools.quick_script` becomes a plain toggle; `tools.<name>` keeps only enablement and tool-only options (`python_exec`, `bash`).
- All of these are configuration files, so there is no database change.
