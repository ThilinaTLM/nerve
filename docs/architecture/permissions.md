# Permissions

> **Status:** Implemented. Contracts, the evaluator and its tests are authoritative; the public [Tools and approval policy](https://nerve.tlmtech.dev/developers/tools-policy/) page describes user-facing behavior.

Every tool call is checked by one generic evaluator before it runs. The result is `allow`, `prompt` (ask the user) or `deny`. Product modes such as Read only, Supervised, Autonomous and Planning are rule sets the evaluator reads, not special cases inside it.

## Ownership

- Contracts: [`permission-rule-sets.ts`](../../packages/contracts/src/domains/permissions/permission-rule-sets.ts)
- Pure composition and evaluation: [`permission-policy.ts`](../../packages/tools/src/policy/permission-policy.ts)
- Loading rule sets and overlays, project trust, writing "always allow" rules: [`permission.adapter.ts`](../../packages/workbench-server/src/core-host/permission.adapter.ts)
- Supervision state of a call: the conversation core's [tool-call lifecycle](conversation-core/tool-call-lifecycle.md)

## Concepts

| Concept   | Meaning                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule      | Filters plus one decision: `allow`, `prompt` or `deny`.                                                                                                                                           |
| Rule set  | Named, ordered list of rules. Built-in sets (Baseline, Read only, Supervised, Autonomous, Planning) ship with the app and cannot be edited; custom sets are JSON files under `config/rule-sets/`. |
| Overlay   | Extra rules for one rule set, owned by the user, a project or a conversation.                                                                                                                     |
| Guardrail | A rule that can only prompt or deny, and that later layers cannot override.                                                                                                                       |
| Target    | The normalized resource a call affects: a path, command, URL or the whole tool.                                                                                                                   |

The tool catalog owns tool names, groups, risk and how targets are extracted from arguments. Policy files never copy the catalog.

## Selection

A conversation's configuration holds one permission rule set. In planning mode the core evaluates with the built-in Planning set instead, and the configured set applies again when the conversation returns to coding.

## Evaluation

1. Validate the arguments and normalize every target (paths, URLs, command segments). Rules never match raw argument text when a normalized form exists.
2. Compose the policy: Baseline, then the selected rule set, then the user, project and conversation overlays bound to that rule set. An overlay applies only to its own rule set, so planning and coding grants stay separate.
3. Match rules on tool name or group, risk, target kind and access, path glob, command prefix, URL host or primary argument.
4. A call with several targets is allowed automatically only when every target is allowed.

The evaluator fails closed: invalid arguments, a target that cannot be normalized, an unknown, disabled or malformed rule set, a malformed overlay file, or an unknown matcher never become an automatic allow.

The decision, matched rule, reason, suggested rules and the authority it was made under are stored on the call's `TOOL_CALL` row and kept in its `tool_call_response` event, so a later policy edit does not change why a call ran or stopped.

## Overlay files

| Owner        | File                                                           |
| ------------ | -------------------------------------------------------------- |
| User         | `<NERVE_HOME>/config/permissions.json`                         |
| Project      | `<project>/.nerve/config/permissions.json`                     |
| Conversation | `<NERVE_HOME>/data/conversations/<id>/config/permissions.json` |

Each file holds `overlays: [{ ruleSetId, rules }]`. A project file applies only while the user trusts its exact content (a `TRUSTED_RESOURCE` row with the file's digest); any edit requires trust again. "Always allow" in an approval writes a rule into the overlay the user picks; there is no grant table. Rules never contain secrets.

## Non-goals

- Operating-system sandboxing.
- Judging shell or Python safety from source text.
- Overlays that bypass guardrails, planning restrictions or secret boundaries.
