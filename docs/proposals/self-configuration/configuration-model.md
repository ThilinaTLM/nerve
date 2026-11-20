# Configuration model

Part of [self-configuration](README.md). Current behavior: [scoped configuration](../../architecture/configuration.md), [permissions](../../architecture/permissions.md), [code mode](../../architecture/code-mode.md), [launch catalog](../../architecture/launch-definitions.md).

## Current state

- Diagnostic shapes: `configurationDiagnosticSchema` and `extensionCatalogDiagnosticSchema` and `ExtensionDiagnostic` and `promptSuggestionDiagnosticSchema` in contracts; `SkillDiagnostic` and `PromptTemplateDiagnostic` in harness; `ConfigurationAgentDiagnostic` and `ExtensionAgentDiagnostic` in tools. Severity is `level`, `type: "warning"` or absent.
- [`configuration-agent-port.ts`](../../../packages/workbench-server/src/core-host/configuration/configuration-agent-port.ts) converts agent-configuration diagnostics, and separately reads and parses permission overlays and rule sets itself. [`scoped-permission-source.ts`](../../../packages/workbench-server/src/core-host/permissions/scoped-permission-source.ts) parses the same files to build the policy. They differ: the port reports parse errors of an untrusted project overlay that the policy skips, ignores an unreadable rule-set folder that the policy blocks on, and never sees conversation overlays.
- `reload` on the permission source clears its cache and keeps no previous generation. An invalid file then turns every tool call into a `configuration_blocked` interaction.
- `configuration.status` reads permission files from disk but profiles and preferences from cache; its three descriptions disagree.
- Skills and prompt suggestions have loaders with diagnostics that the agent cannot reach.
- The system prompt gives the agent the date and working directory only. The selected rule set, the applied profile and the conversation id are not available to it.

## Diagnostic

One type in `packages/contracts`, used by every owner:

```ts
type Diagnostic = {
  level: "error" | "warning";
  /** Stable, kebab-case; owners define their own codes. */
  code: string;
  /** What is wrong and what to do, for the agent and the user. */
  message: string;
  /** JSON pointer or line into the file, when known. */
  pointer?: string;
};
```

`error` means the resource does not load. `warning` means it loads and probably does not do what was meant. Where the problem is (scope, file, resource) lives on the resource, not on each diagnostic.

The existing shapes are replaced, not wrapped. Fields the app needs for recovery (`affectedCapability`, `recoveryChoices`) stay on the blocked-policy request where they are used.

## Resource

```ts
type ConfigurationResource = {
  kind:
    | "agent-preferences"
    | "agent-profile"
    | "rule-set"
    | "permission-overlay"
    | "launch-catalog"
    | "skill"
    | "prompt-suggestion"
    | "extension";
  /** Name or id within the kind; the file name for single-file kinds. */
  id: string;
  scope: "builtin" | "user" | "project" | "conversation";
  /** Absent for built-ins. */
  path?: string;
  state:
    | "active"
    | "disabled"
    | "shadowed"
    | "invalid"
    | "incompatible"
    | "needs_approval";
  /** For `needs_approval`: what the user decides and where. */
  approval?: { kind: "trust" | "consent"; where: string };
  /** For `shadowed`: the scope of the resource that wins. */
  shadowedBy?: "user" | "project";
  /** After a reload that kept the previous version of an invalid file. */
  previousVersionActive?: boolean;
  diagnostics: Diagnostic[];
};
```

`extension` keeps its richer status (`extensions.status(id)`: consent detail, switch, recent errors); the resource is its summary.

## Resource providers

Each owner implements one interface; the registry in `workbench-server` holds them and has no knowledge of any kind.

```ts
interface ConfigurationResourceProvider {
  kinds: readonly ConfigurationResource["kind"][];
  /** What is in effect now, from the owner's loaded state. */
  list(context: ResourceContext): Promise<ConfigurationResource[]>;
  /** Validate the files on disk. Changes nothing. */
  check(context: ResourceContext): Promise<ConfigurationResource[]>;
  /** Activate what is valid; keep the previous version of what is not. */
  reload(context: ResourceContext): Promise<ConfigurationResource[]>;
}
```

`ResourceContext` is `{ scope, projectId, conversationId? }`.

| Provider              | Owner today                                   | Notes                                                                                                    |
| --------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Preferences, profiles | `AgentConfigurationService`                   | Already has `health()` and reload                                                                        |
| Rule sets, overlays   | Permission source                             | Gains `check`; the port's own parsing is deleted                                                         |
| Launch catalog        | `LaunchDefinitionService`                     | Read fresh on every use: `reload` equals `check`                                                         |
| Skills                | Resource loader over the harness skill loader | `reload` equals `check`; reports frontmatter errors, shadowed names and project skills awaiting approval |
| Prompt suggestions    | `PromptSuggestionService`                     | Predicate approval maps to `needs_approval`                                                              |
| Extensions            | Extension catalog                             | `reload` by scope calls the catalog's reload for each folder                                             |

A new configurable thing becomes visible to the agent and the user by adding a provider.

## Validate, then activate

- The permission source parses a reloaded file before replacing its cached entry. An invalid file leaves the previous entry in force and returns the diagnostics with `previousVersionActive: true`.
- With no previous valid version (a file that was already invalid at startup), behavior stays as today: blocked, repaired by the user in the app.
- The same rule holds for profiles and preferences, which already retain the previous generation on save.

This is the rule [scoped configuration](../../architecture/configuration.md) states for saves, extended to hand edits.

## Warnings

Checked by the owner, reported with `level: "warning"`:

| Code                       | Condition                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `unknown-tool-name`        | A rule names a tool that is neither built in nor registered by an extension. The message suggests the name that differs only in casing. |
| `unknown-rule-set`         | An overlay entry or a profile names a rule set that does not exist at that scope.                                                       |
| `rule-set-id-mismatch`     | A rule set file's name differs from its `id`.                                                                                           |
| `rule-set-shadows-builtin` | A user rule set reuses a built-in id; the built-in wins.                                                                                |
| `unbounded-allow`          | An `allow` rule on `bash` or `python_exec` with no `primaryArgument`, or with a glob that matches everything.                           |
| `skill-shadowed`           | A skill name is taken by an earlier discovery root.                                                                                     |

Unknown tool names are warnings, not errors, because the extension that owns the tool may be switched off.

## Agent namespace

`configuration` in `quick_script`. All methods are read-only except `reload`, which changes memory only. None can approve trust or consent.

| Method                            | Returns                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `describe()`                      | The conversation's context: project directory, Nerve home, selected rule set and the layer that selected it, applied profile and its requirements, configured provider and model ids. |
| `list({ kind?, scope?, state? })` | Resources after precedence, from the registry.                                                                                                                                        |
| `tools()`                         | Every tool as rules match it: name, kind, groups, base risk, primary argument, target kinds, contributing extension.                                                                  |
| `check(scope)`                    | Validates files on disk; activates nothing.                                                                                                                                           |
| `reload(scope)`                   | Activates valid files and returns every resource with a diagnostic.                                                                                                                   |
| `explain({ tool, args })`         | The decision `evaluatePermissionRequest` gives for that call in this conversation: decision, winning rule, its origin and rule set. Never executes the call.                          |

`status` is removed; `check` and `list` replace its two meanings. `extensions.reload(id)` and `extensions.status(id)` stay, and their diagnostics take the shared shape.

The declarations `sdk.describe` serves for both namespaces are derived from the port types, or pinned to them by a type-level test, so the two cannot drift.

## Launch writes

`LaunchDefinitionService` already has `create`, `update`, `remove`, `createFolder` and `move` with locking and order normalization. Expose them to the agent as a `launches` namespace in `quick_script` with risk `write`. The always-loaded `launch` tool keeps its five actions, so its schema does not grow.

The agent stops writing `createdAt`, `scope`, `parentFolderId` and renumbered `order` values by hand, and stops racing the app's lock. Launches stay project-scoped; a user-scope catalog is not planned.

## Permission groups

The permission model stays as it is. Rules match in two ways, and both are enough:

- **By risk** (`baseRisks`). Every tool and every script operation declares a risk, and four of the five built-in rule sets are written almost entirely in risk terms. A risk rule already treats a direct tool call and the same call from a script alike: `web_search` and `search.web` are both `external_read`.
- **By capability**, when one tool must be singled out: `toolNames` for a tool, `toolGroups` for a family.

The one gap is in the second. A direct extension tool carries the extension id as its group (`web-search`), while the script operation carries the namespace (`search`). A rule that singles out web search therefore needs two entries, one per route.

Proposed: both routes carry both groups. A direct tool bound to a method gets the method's namespace as a second group, and a script operation gets its extension's id. One rule, `toolGroups: ["search"]` or `toolGroups: ["web-search"]`, then covers the capability whichever way the agent calls it.

This changes metadata only. Rule evaluation, the rule schema and the meaning of `toolNames` are untouched, and existing rules keep matching what they match today. Considered and rejected: authorizing a script call as its bound direct tool. It would add a rule about which name applies and make operation rules stop matching once a tool is bound.

The skill's guidance follows from this: reach for a risk rule first, a group rule for one extension or namespace, a tool name or operation name only for a single call.
