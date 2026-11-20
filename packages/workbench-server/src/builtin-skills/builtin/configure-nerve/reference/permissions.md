# Permissions

Every tool call is checked against a policy that decides **allow** (run), **prompt** (ask the user) or **deny**. The policy is built from:

- a **rule set**: one complete policy, selected per conversation (the permission picker in the composer, or `permissionRuleSetId` in preferences and profiles);
- **overlays**: extra rules for one specific rule set, at user, project or conversation scope. "Always allow" in an approval prompt writes a rule into an overlay;
- **Baseline**: a built-in rule set always added under lead conversations.

Policy decides which calls run; it is not an operating-system sandbox. A shell command that is allowed can do anything that command can do.

## Choosing the mechanism

| Need                                                                             | Use                                                                   |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Stop being asked for a specific, safe action (one command, one host, one folder) | Overlay on the rule set the user works with                           |
| Guarantee an action is always asked or refused, whatever else allows it          | User overlay rule with `"enforcement": "guardrail"`                   |
| A different overall way of working (for example review-only with Jira reads)     | New user rule set                                                     |
| A teammate that works without approvals but within limits                        | User rule set without `prompt` rules, selected by a sub-agent profile |
| Share a rule with the team                                                       | Project overlay (teammates must trust it)                             |

Prefer the narrowest rule that solves the request.

## Common requests

- **Stop being asked for one command**: add a rule to the overlay of the rule set the user works with, matching `bash` with `primaryArgument` `equals` or `in` and the exact command lines (example under "Overlay files"). To limit it to one folder, see "Working directory".
- **Always ask before something, even under Auto**: a guardrail `prompt` rule in the user overlay of each rule set it should protect (example at the end of "Overlay files").
- **A teammate that runs only certain commands**: a user rule set that allows them and denies the rest (example under "Rule set file"), required by a sub-agent profile (`reference/agent-profiles.md`).

## Built-in rule sets

| Id           | Name      | Behavior                                                                                                                        |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `autonomous` | Auto      | Allows everything. Default for new conversations.                                                                               |
| `supervised` | Supervise | Allows reads and interaction (questions, todos); prompts for everything else.                                                   |
| `read_only`  | Read-only | Allows reads, external reads (web) and sub-agent delegation; denies everything else.                                            |
| `planning`   | Draft     | Allows reads, external reads, delegation and writing plan files; prompts for `bash` and `python_exec`; denies the rest.         |
| `baseline`   | Baseline  | Allows reads and interaction; prompts for everything else. Always included under leads; not selectable as a sub-agent rule set. |

Baseline ranks below the selected rule set, so it decides only calls the selected rule set has no matching rule for. Under `autonomous` everything is allowed unless an overlay rule prompts or denies.

## How a decision is made

Lead conversations combine: Baseline, the selected rule set, then the overlays bound to that rule set from user, project and conversation scope. Every rule whose `when` matches the call is a candidate; the first after sorting wins:

1. Guardrails before ordinary (`overridable`) rules.
2. Higher scope: conversation overlay > project overlay > user overlay > rule set > Baseline.
3. Higher `priority`.

So any matching overlay rule beats the rule set regardless of priority, and a guardrail beats everything. Overlays bound to other rule sets are ignored, so a grant under `supervised` does not leak into `planning`.

Sub-agents use only their selected rule set: no Baseline, no overlays. That rule set must be enabled and contain no enabled `prompt` rule, because sub-agents cannot ask.

## Rule

Exact shapes: `reference/schemas/permission-rule-set.schema.json`, `reference/schemas/permission-overlays.user.schema.json` and `reference/schemas/permission-overlays.project.schema.json`. Rules that span fields (unique ids and priorities, guardrails never allow) are listed below.

```json
{
  "id": "allow-pnpm-test",
  "description": "Running the test suite is safe in this repository.",
  "enabled": true,
  "priority": 10,
  "enforcement": "overridable",
  "when": {
    "toolNames": ["bash"],
    "primaryArgument": {
      "operator": "in",
      "value": ["pnpm test", "pnpm test:unit"]
    }
  },
  "decision": "allow"
}
```

| Field         | Required | Value                                                                                                                  |
| ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `id`          | yes      | Lowercase letters, digits, `.`, `_`, `-`; starts and ends with a letter or digit; at most 128; unique in the document. |
| `description` | no       | 1–1024 characters. Shown to the user as the reason when this rule decides; write it for them.                          |
| `enabled`     | yes      | Boolean.                                                                                                               |
| `priority`    | yes      | Integer −1000 to 1000. Unique per enforcement class within one document.                                               |
| `enforcement` | yes      | `"overridable"`, or `"guardrail"` (user overlays only; never with `allow`).                                            |
| `when`        | yes      | Filter; `{}` matches every call.                                                                                       |
| `decision`    | yes      | `"allow"`, `"prompt"` or `"deny"`.                                                                                     |

## Filter (`when`)

All present fields must match.

| Field             | Matches                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toolNames`       | The tool name is one of these (1–256).                                                                                                                |
| `toolKinds`       | Tool kind: `filesystem`, `command`, `code`, `external_read`, `interaction`, `orchestration`, `deployment`, `integration`, `other`.                    |
| `toolGroups`      | Tool group (any of these). An extension's tool and its SDK operations carry both the extension id and the namespace (`web-search` and `search`).      |
| `baseRisks`       | Risk of the call: `read`, `write`, `external_read`, `external_write`, `secret`, `destructive`, `deployment`, `agent_spawn`, `interaction`, `unknown`. |
| `primaryArgument` | Value matcher on the tool's primary argument (table below).                                                                                           |
| `primaryTarget`   | Target matcher on the call's first target.                                                                                                            |
| `targets`         | `{ "quantifier": "any"                                                                                                                                | "all", "matcher": <target matcher> }` over all targets of the call. |
| `arguments`       | 1–64 value matchers on named arguments, each with `"path": "args.<name>(.<name>)*"`.                                                                  |

Value matcher: `{ "operator": "equals" | "not_equals", "value": <string|number|boolean|array> }`, `{ "operator": "in", "value": [<primitives>] }`, `{ "operator": "glob", "value": "<pattern>" }`, `{ "operator": "exists", "value": true|false }`.

Target matcher: any of `kind` (`path`, `url`, `agent`, `resource`, `whole_tool`), `access` (`read`, `write`), `scope` (`exact`, `tree`; paths only), `root` (`project`, `nerve_home`, `nerve_data`, `plans`; paths only), `pattern` (glob over the path relative to its root, the full URL, the agent id or the resource value). Path patterns are relative POSIX paths: no leading `/`, no `..`, no backslashes.

### Globs

Patterns use POSIX path globbing on the whole value: `*` matches within one `/`-separated segment, `**` matches whole segments, `{a,b}` alternates, `?` one character.

- `src/**` matches everything under `src`; `src/*` only direct children.
- `https://api.github.com/**` matches every URL on that host path.
- For commands, the whole command line is one value, so `pnpm test*` also matches `pnpm test && rm -rf build`. Prefer `equals` or `in` with exact commands. Use a glob only when its wildcard cannot reach a second command, and remember `*` stops at `/`.

### Working directory

A `bash` rule on the command line ignores the folder it runs in: `equals "npm test"` also allows `npm test` with `cwd` set to any folder of the project, which matters in a repository with several packages. To pin the folder, add an `arguments` matcher on `args.cwd`:

- Project root only: `{ "path": "args.cwd", "operator": "exists", "value": false }`.
- One folder: `{ "path": "args.cwd", "operator": "equals", "value": "packages/web" }`.

`args.cwd` is compared as the agent wrote it, so another spelling of the same folder (`./packages/web`, an absolute path) does not match and gets the rule set's normal decision, usually a prompt.

### What each tool exposes

| Tool                           | Kind / group / risk                         | Primary argument                                                                                                | Targets                          |
| ------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `read`                         | filesystem / fileInspection / read          | `path`                                                                                                          | path, read, exact                |
| `find`, `ls`                   | filesystem / fileInspection / read          | `path`                                                                                                          | path, read, tree                 |
| `grep`                         | filesystem / fileInspection / read          | `paths`, else `path`                                                                                            | path, read, tree                 |
| `edit`, `write`                | filesystem / fileEditing / write            | `path`                                                                                                          | path, write, exact               |
| `bash`                         | command / shell / unknown                   | `command`                                                                                                       | whole_tool                       |
| `python_exec`                  | code / python / unknown                     | `code`, else `path`                                                                                             | whole_tool                       |
| `web_fetch`                    | external_read / web / external_read         | `url`                                                                                                           | url, read                        |
| `quick_script` (whole script)  | integration / quickScript / external_read   | `code`                                                                                                          | whole_tool                       |
| `quick_script` (SDK operation) | integration / the namespace / per operation | operation name (`jira.issues.create`)                                                                           | resource (`jira:issue/APP-12`)   |
| `async_bash`                   | orchestration / process / per call          | `action`                                                                                                        | whole_tool                       |
| `launch`                       | orchestration / process / per call          | `[action, name]` (an array) when a name is given, else `action`; match the name with `arguments` on `args.name` | whole_tool                       |
| `subagent_prompt`              | orchestration / subagents / agent_spawn     | `assignments`                                                                                                   | whole_tool                       |
| `subagent_stop`                | orchestration / subagents / agent_spawn     | `names`                                                                                                         | whole_tool                       |
| `subagent_status`              | orchestration / subagents / read            | `name`                                                                                                          | whole_tool                       |
| `ask_user`                     | interaction / input / interaction           | `question`                                                                                                      | whole_tool                       |
| `todos_set`                    | interaction / todos / interaction           | —                                                                                                               | whole_tool                       |
| `todos_get`                    | interaction / todos / read                  | —                                                                                                               | whole_tool                       |
| `plan_present`                 | orchestration / planMode / interaction      | `file_path`                                                                                                     | path, read, exact (root `plans`) |

Paths are resolved to the most specific root: `project` (the project directory), `plans`, `nerve_data`, `nerve_home`. A path outside all roots has no root and matches only matchers without `root` and `pattern`.

`bash` always has risk `unknown` in rules, so `baseRisks: ["read"]` never matches a shell command; match shell commands by `toolNames` plus `primaryArgument`. A quick_script SDK call is checked once per operation it performs; its risk is `read`, `external_read`, `external_write` or `destructive` by method. An extension's direct tool (`web_search`) is admitted by its tool name, and the operation it runs is checked again as a quick_script operation (`search.web`). A group rule (`toolGroups: ["search"]` or `["web-search"]`) covers both routes; `toolNames` names only the tool. Prefer a risk rule, then a group rule for one extension or namespace; use a tool or operation name only for a single call.

### Allow rules and targets

An `allow` rule with `targets.quantifier: "all"` covers a call only when the call has targets, and every target matches. Use `"all"` for allow rules over paths or URLs so a call touching one allowed and one other file is not allowed.

## Rule set file

`<home>/config/rule-sets/<id>.json`; keep the file name equal to `id`. User scope only.

```json
{
  "schemaVersion": 1,
  "id": "review",
  "name": "Review",
  "description": "Reads, research and the test suite run freely; anything else is refused.",
  "source": "user",
  "enabled": true,
  "rules": [
    {
      "id": "allow-interaction",
      "enabled": true,
      "priority": 300,
      "enforcement": "overridable",
      "when": { "baseRisks": ["interaction"] },
      "decision": "allow"
    },
    {
      "id": "allow-read",
      "enabled": true,
      "priority": 200,
      "enforcement": "overridable",
      "when": { "baseRisks": ["read", "external_read"] },
      "decision": "allow"
    },
    {
      "id": "allow-tests",
      "enabled": true,
      "priority": 100,
      "enforcement": "overridable",
      "when": {
        "toolNames": ["bash"],
        "primaryArgument": {
          "operator": "in",
          "value": ["pnpm test", "pnpm lint"]
        }
      },
      "decision": "allow"
    },
    {
      "id": "deny-rest",
      "description": "Review mode changes nothing and runs only the tests.",
      "enabled": true,
      "priority": 0,
      "enforcement": "overridable",
      "when": {},
      "decision": "deny"
    }
  ]
}
```

- `id`: same format as a rule id; must not reuse a built-in id (the built-in wins).
- `name`: 1–128 characters; shown in the permission picker. `description`: optional, 1–1024.
- `source`: `"user"`. `enabled`: a disabled rule set cannot be selected.
- `rules`: 1–256 rules, all `overridable`. End with a catch-all rule (`"when": {}`) so every call gets a deliberate decision.
- For use by sub-agents: no enabled `prompt` rules. A sub-agent requiring this example can run `pnpm test` and `pnpm lint` and is refused everything else that is not a read.

If the selected rule set is missing, disabled or invalid, tool calls are blocked rather than falling back.

## Overlay files

User: `<home>/config/permissions.json`. Project: `<project>/.nerve/config/permissions.json` (needs trust). One document holds overlays for several rule sets:

```json
{
  "schemaVersion": 2,
  "version": 3,
  "overlays": [
    {
      "ruleSetId": "supervised",
      "rules": [
        {
          "id": "allow-tests",
          "description": "Running tests is safe here.",
          "enabled": true,
          "priority": 10,
          "enforcement": "overridable",
          "when": {
            "toolNames": ["bash"],
            "primaryArgument": {
              "operator": "in",
              "value": ["pnpm test", "pnpm lint"]
            }
          },
          "decision": "allow"
        },
        {
          "id": "allow-src-edits",
          "enabled": true,
          "priority": 20,
          "enforcement": "overridable",
          "when": {
            "toolNames": ["edit", "write"],
            "targets": {
              "quantifier": "all",
              "matcher": {
                "kind": "path",
                "root": "project",
                "pattern": "src/**"
              }
            }
          },
          "decision": "allow"
        }
      ]
    }
  ]
}
```

- `"version": 3` only in the project file; the user file has `schemaVersion` and `overlays` only.
- One entry per `ruleSetId`; at most 256 rules in the whole document.
- `guardrail` rules only in the user file.
- A project `allow` rule may not target `nerve_home` or `nerve_data`.
- Rules that name `plan_mode_present` are rejected.

Add rules to an existing overlay entry instead of creating a second entry for the same rule set. Keep existing rules, including ones written by "Always allow".

Example user guardrail, placed in the `autonomous` overlay: always ask before pushing, even under Auto:

```json
{
  "id": "ask-before-push",
  "description": "Pushing is always confirmed.",
  "enabled": true,
  "priority": 0,
  "enforcement": "guardrail",
  "when": {
    "toolNames": ["bash"],
    "primaryArgument": { "operator": "glob", "value": "git push*" }
  },
  "decision": "prompt"
}
```

A guardrail lives in the overlay of one rule set, so add it to each rule set it should protect. Here a glob is the right choice: catching more commands than intended only adds a prompt.

## Explaining a decision

When the user asks why a call was prompted or denied:

1. Find the selected rule set (`permissionRuleSetId`), first found wins: the applied profile's requirements, the conversation's own choice (the composer picker), the profile's recommendations, project `agent.json`, user `agent.json`, otherwise `autonomous`.
2. Read that rule set (built-in table above, or its file) and the overlays for it in the user and project files.
3. Walk the order in "How a decision is made" against the call's tool, arguments and targets, and name the winning rule and where it lives.
4. Offer the narrowest change if the user wants a different outcome.

Approval prompts and tool results also show the deciding rule's description or id and origin; quote them when available.
