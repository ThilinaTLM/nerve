# Permissions

Every tool call is checked against a policy that decides **allow** (run), **prompt** (ask the user) or **deny**. The policy is built from:

- a **rule set**: one complete policy, selected per conversation (the permission picker in the composer, or `permissionRuleSetId` in preferences and profiles);
- **overlays**: extra rules for one specific rule set, at user, project or conversation scope. "Always allow" in an approval prompt writes a rule into an overlay;
- **Baseline**: a built-in rule set always added under lead conversations.

Policy decides which calls run; it is not an operating-system sandbox. A shell command that is allowed can do anything that command can do.

## Procedure

1. `configuration.describe()`: the rule set this conversation uses (`ruleSet.id`) and what selected it. Overlay rules apply only under the rule set they name. `configuration.explain` the call: if it is already allowed under the rule set in use, say so and ask which rule set the user means before writing anything. Otherwise write for the rule set in use, and ask whether the rule should also apply under others.
2. Identify the exact calls: tool, command, path, URL or operation. For a prompt the user saw, `configuration.explain({ tool, args })` names the rule that decided.
3. Pick the mechanism below and the scope: user overlay for a personal rule, project overlay for a team rule. Both wait for the user's approval in Settings → Permissions; until then the version the user last approved stays in effect (after a restart without one, calls under that rule set are blocked). A new rule set is not selectable until approved.
4. Write the narrowest rule. Take tool names and groups from `configuration.tools.list()`; they are case-sensitive. Matchers: `reference/permission-matchers.md`.
5. `configuration.check`, `configuration.reload`, then `configuration.explain` with the call again to confirm the new decision.

For a new rule set: agree per category (reads, edits, shell, web, integrations, delegation) what is allowed, asked and refused; start from the closest built-in (`configuration.list({ kind: "rule-set" })`), end with a catch-all rule, write `<home>/config/rule-sets/<id>.json`, then tell the user to select it in the composer's permission picker or as `permissionRuleSetId` in a profile.

## Choosing the mechanism

| Need                                                                             | Use                                                                   |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Stop being asked for a specific, safe action (one command, one host, one folder) | Overlay on the rule set the user works with                           |
| Guarantee an action is always asked or refused, whatever else allows it          | User overlay rule with `"enforcement": "guardrail"`                   |
| A different overall way of working (for example review-only with Jira reads)     | New user rule set                                                     |
| A teammate that works without approvals but within limits                        | User rule set without `prompt` rules, selected by a sub-agent profile |
| Share a rule with the team                                                       | Project overlay (teammates must trust it)                             |

Prefer the narrowest rule that solves the request, and prefer a risk rule (`baseRisks`), then a group rule (`toolGroups`) for one extension or namespace; name a tool or operation only for a single call.

## Common requests

- **Stop being asked for one command**: add a rule to the overlay of the rule set the user works with, matching `bash` with `primaryArgument` `equals` or `in` and the exact command lines (example under "Overlay files"). To limit it to one folder, see "Working directory" in `reference/permission-matchers.md`.
- **Always ask before something, even under Auto**: a guardrail `prompt` rule in the user overlay of each rule set it should protect (example at the end of "Overlay files").
- **A teammate that runs only certain commands**: a user rule set that allows them and denies the rest (example under "Rule set file"), required by a sub-agent profile (`reference/agent-profiles.md`).

## Rule sets

Five are built in: `autonomous` (Auto, allows everything, the default), `supervised` (Supervise, allows reads and interaction, prompts for the rest), `read_only`, `planning` (Draft) and `baseline`. `configuration.list({ kind: "rule-set" })` lists them with the user's own.

Baseline is always added under lead conversations and ranks below the selected rule set, so it decides only calls the selected rule set has no matching rule for. It is not selectable for sub-agents. Under `autonomous` everything is allowed unless an overlay rule prompts or denies.

## How a decision is made

Lead conversations combine: Baseline, the selected rule set, then the overlays bound to that rule set from user, project and conversation scope. Every rule whose `when` matches the call is a candidate; the first after sorting wins:

1. Guardrails before ordinary (`overridable`) rules.
2. Higher scope: conversation overlay > project overlay > user overlay > rule set > Baseline.
3. Higher `priority`.

So any matching overlay rule beats the rule set regardless of priority, and a guardrail beats everything. Overlays bound to other rule sets are ignored, so a grant under `supervised` does not leak into `planning`.

Sub-agents use only their selected rule set: no Baseline, no overlays. That rule set must be enabled and contain no enabled `prompt` rule, because sub-agents cannot ask.

## Rule

The filter (`when`), value and target matchers and globs are in `reference/permission-matchers.md`.

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

## Rule set file

`<home>/config/rule-sets/<id>.json`; keep the file name equal to `id`. User scope only. The user approves each rule set file in Settings → Permissions; until then it is not selectable, and a profile that requires it is unavailable.

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

When the user asks why a call was prompted or denied, call `configuration.explain({ tool, args })` with the call as it was made. It returns the decision, the rule that decided with where it lives, and the rule set. Answer the question first; offer the narrowest change only if the user wants a different outcome. Approval prompts and tool results also show the deciding rule's description or id; quote them when available.
