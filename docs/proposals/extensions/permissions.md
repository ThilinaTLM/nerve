# Operation-level rules

Part of [Extensions](README.md). Delivery step 4.

## Problem

Each SDK call is authorized as its equivalent direct tool ([architecture](../../architecture/code-mode.md#permissions)): `jira.issues.create` as `jira_create_issue`, `diagram.render` as `kroki_export`. The broker admits only tool names on its `brokerable()` list ([`quick-script-broker.ts`](../../../packages/workbench-server/src/core-host/quick-script-broker.ts)). Removing the direct tools removes those identities, and later namespaces (MCP, installed extensions) have no direct tool to borrow.

## Nested check

A method's `authorize` returns an operation instead of a direct-tool call:

```ts
// today
type NestedAuthorization = {
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  approvalRequired?: true;
};

// proposed
type NestedAuthorization = {
  operation: string; // "jira.issues.create"; default `<namespace>.<path>`
  targets: OperationTarget[]; // extracted by the method from its arguments
  risk: MethodRisk; // the method's declared risk, or a per-call risk (raw requests)
  summary: string; // short label for the approval and record
};

type OperationTarget = { kind: "resource"; value: string };
// Normalized "<system>:<type>/<id>":
//   jira:project/APP   jira:issue/APP-12   confluence:space/ENG   confluence:page/123
//   jira:request/DELETE /rest/api/3/issue/APP-12   (raw requests: method and path)
```

The broker evaluates a nested check as a request for tool `quick_script` with:

- **`operation`** as the primary argument, so `primaryArgument` matchers apply to it.
- **The namespace as tool group** (`jira`, `confluence`, `diagram`, `imagegen`, `web`), so today's `toolGroups` filters keep matching. `planning.json`'s `allow-network-research` rule needs no change.
- **A base risk from the method risk**, mapped the way direct tools are categorized today: reads to `read`, network reads to `network`, external writes to the category today's Jira and Confluence write tools have, destructive to `destructive`. External writes must never map to `write`, which built-in rule sets allow for workspace files.
- **Targets** as `resource` targets for `targets` / `primaryTarget` matchers.

The broker accepts any operation of a namespace in the registry, which replaces `brokerable()`. Script classification, the person-approval ceiling and "deny always wins" are unchanged.

**Exceptions stay direct.** `web.fetch` and `web.search` keep authorizing as `web_fetch` / `web_search`, and `files.*` as `read` / `write` / `edit`, because those direct tools remain. One rule then governs a URL host or a path whichever route the agent takes.

**Raw requests** become `jira.request` / `confluence.request` operations with a `request/<METHOD> <path>` target. GET is `network`; anything else is `destructive`, as today. The `approvalRequired` special case goes away: a rule that matches the method and path can allow a specific raw write, and an unmatched one prompts as destructive.

## Contract changes

All in [`permission-rule-sets.ts`](../../../packages/contracts/src/domains/permissions/permission-rule-sets.ts) and [`permissions.ts`](../../../packages/contracts/src/domains/permissions/permissions.ts); configuration only, no database change.

- `permissionTargetKindSchema` gains `resource`, and `permissionTargetSchema` gains `{ kind: "resource", value }`. `targetMatcherSchema.pattern` globs over `value`.
- **Permission exceptions** (the Permissions page allow/deny list) accept `tool: "quick_script"` with an operation glob as `rule` (`jira.issues.*`), validated as a dotted path with `*` segments.
- `toolNameSchema` drops the removed tool names in step 5.

A rule that lets an agent create and edit Jira issues in one project only:

```json
{
  "id": "allow-app-issue-writes",
  "enabled": true,
  "priority": 10,
  "enforcement": "overridable",
  "when": {
    "toolNames": ["quick_script"],
    "primaryArgument": {
      "operator": "in",
      "value": [
        "jira.issues.create",
        "jira.issues.update",
        "jira.issues.transition"
      ]
    },
    "targets": {
      "quantifier": "all",
      "matcher": { "kind": "resource", "pattern": "jira:*/APP*" }
    }
  },
  "decision": "allow"
}
```

Both matchers already exist (`valueMatcherSchema`: `equals`, `in`, `glob`); only the `resource` target kind is new.

## Equivalence test

A test runs every built-in rule set over every SDK method (with representative arguments) through the old path (direct-tool identity) and the new path (operation), and asserts identical decisions. It lands in step 4 while both paths exist, and any intended difference is listed in the test with a reason. In step 5 the old path and the test's comparison half are deleted.

## Approval display

The approval and the tool record show operations and targets: "jira.issues.create · jira:project/APP". The record's host-call entry ([`quick-script.ts`](../../../packages/contracts/src/domains/tools/quick-script.ts)) already stores `method` (`jira.issues.search`), which is the default operation, so no field is renamed. `authorizedAs` stays optional and is set only when a call still authorizes as a remaining direct tool (`web.fetch` as `web_fetch`, `files.write` as `write`). Old records parse unchanged.

## Migration

- **Built-in rule sets** are updated in step 4 where the equivalence test requires it.
- **User rules and exceptions** that name a removed tool are rewritten in the draft home migration step (`0005`) (step 5):

  | From                                                   | To                                                                         |
  | ------------------------------------------------------ | -------------------------------------------------------------------------- |
  | `toolNames: ["jira_create_issue"]`                     | `toolNames: ["quick_script"]`, `primaryArgument` glob `jira.issues.create` |
  | `toolGroups: ["jira"]`                                 | unchanged (the namespace is the group)                                     |
  | exception `{ tool: "jira_manage_comment", rule: "*" }` | `{ tool: "quick_script", rule: "jira.comments.*" }`                        |
  | `kroki_export`, `generate_image`                       | `diagram.render`, `imagegen.generate`                                      |

  The tool-to-operation table is generated from [parity.md](parity.md), so one source drives the migration and the docs. A rule that cannot be converted (an argument matcher on a removed tool's schema) is disabled and reported, never dropped.

- **Project overlays** get the same conversion through their configuration version chain. A converted overlay changes bytes, so existing project trust is kept only under the rule in [configuration](../../architecture/configuration.md#project-configuration-versions): a deterministic conversion of approved input.
