# Schema contract

This is the normative field contract for changed documents. Implement validators in `packages/contracts`; reuse the existing value validators named below and export generated JSON Schema for editor tooling. Do not maintain a second independently authored validator in this proposal. Existing unchanged domain schemas are referenced in [the registry](domain-inventory.md).

## Common rules

New scoped configuration documents, including profile definition files, use integer `schemaVersion: 1`. The unreleased agent-profile v2, capabilities v3 and harness v4 formats never shipped and are not migration inputs (see [migration](migration-and-recovery.md)). Profile definitions use digest-based editing without a revision field. Other new writable authoritative preference documents use nonnegative integer `revision`, initialized to 0 and incremented on successful application writes. External edits need not increment it; a loaded exact-byte digest is also required for conflict checks. The digest is not stored inside the bytes it hashes.

Objects are strict: unknown properties are diagnostics, not silently stripped. Any added field, even optional, requires a `schemaVersion` increment and a registered converter, so an older application reports an unsupported newer version instead of an unknown-property error. This matters for project files shared through version control. Sparse schemas remove parser defaults from optional input fields; complete-value schemas apply built-in defaults during resolution. Missing optional preference files mean empty overrides. Existing but unreadable files do not mean missing. Metadata is required when a new document exists.

A mutation API accepts `{expectedRevision, expectedDigest, changes, resets}`. Changes contain valid sparse values. Resets are canonical JSON Pointer paths; they delete fields/entries rather than persisting null. Restrict ordinary mutations to editable fields under `overrides` and to their declared merge units. Reject metadata, `appliedProfile`, `frozenDefaults` and `lastTransition` as mutation targets; dedicated profile/repair operations own those. Reject overlapping ancestor/descendant operations. Prune empty merge containers after reset so deleting the final tool/sub-agent field removes the entry; never synthesize an incomplete atomic value. A missing file uses revision 0 and the literal digest sentinel `"missing"`; `expectedDigest` is therefore `Sha256Hex | "missing"`. First created file has revision 1. Repairs use their own preview/confirm contract.

## Named types

- `LeadSettingsOverrides`: the strict sparse setting object in the field table below.
- `ChildSettingsOverrides`: the same object with `subagents`, `tools.subagents` and `tools.plan_present` forbidden; other child-banned core tools have no configurable entry in the first place.
- `RoleSettingsOverrides`: the applicable lead/child type, or their child-compatible intersection for a `both` profile.
- `CompleteChildSettings`: the role-projected resolved underlying settings with concrete reasoning, permission selection, compaction, retry, tool configuration and captured skill decisions; model may be absent until requirements are applied. Existing optional tool reference/path values remain optional. Frozen skill map keys enumerate the creation-time eligible identities; later discovery does not expand that set for the existing child.
- Names, IDs and model/reasoning values reuse their existing contract validation. Digests are lowercase SHA-256 hex strings; revisions are nonnegative safe integers. Transition IDs are opaque unique identifiers validated with the existing ID conventions.

## Agent documents

### User/project `config/agent.json`

```ts
{
  schemaVersion: 1;
  revision: number;
  overrides: LeadSettingsOverrides;
}
```

### Conversation `config/agent.json`

```ts
{
  schemaVersion: 1;
  revision: number;
  overrides: LeadSettingsOverrides | ChildSettingsOverrides;
  appliedProfile: AppliedProfile | null;
  frozenDefaults?: CompleteChildSettings;
  lastTransition?: { id: string; kind: "profile" | "plan-approval" };
}
```

Conversation ownership determines lead/child role; do not trust a role string in editable JSON. New child documents require `frozenDefaults`; lead documents reject it. Child overrides are empty at creation unless separately supported explicit edits are introduced later. The frozen defaults capture resolved defaults, recommendations and launch choices **before requirements**. Existing children resolve captured requirements over this frozen baseline (and any separately supported explicit child edits); never apply recommendations again above launch choices or consult live user/project preferences. Allow the baseline model to be absent if a required model supplies the final valid selection. Project out role-prohibited tools before validating/freezing, without silently dropping contradictory requirements. This is creation-time configuration, not a persisted recovery fallback.

`lastTransition` supports idempotent completion of a profile/plan-approval transition across JSON and lifecycle events; it is not a settings history. See recovery protocol. Ordinary preference writes preserve a committed receipt until its lifecycle transition is reconciled. Uncommitted failed attempts release serialization and do not block repair or ordinary saves.

`appliedProfile: null` means no applied role contribution. A newly created normal conversation applies its selected/default start profile before activation. Missing a required existing conversation document is an unavailable configuration, not permission to silently manufacture defaults.

### Applied profile

```ts
{
  name: string;
  source: "builtin" | "user" | "project";
  sourceDigest: string;
  instructions: string;
  recommendations: RoleSettingsOverrides;
  requirements: RoleSettingsOverrides;
}
```

Migration snapshots the definition produced by the same migration, so every snapshot has a known source digest. Catalog definitions are resolved by stable profile name in the current project; source/digest describe what was captured, not an alternate lookup namespace. Never resolve a mutable definition to interpret a saved snapshot.

## Shared setting values and merge units

Every field below is optional in overrides. Types and bounds reuse the named contracts unless a difference is explicitly stated. Model selection can remain unresolved until the user configures a model; this produces a model-required readiness state, not a fabricated default.

| Field                 | Value contract                                    | Merge/reset unit                                                                               |
| --------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `model`               | `models.modelSelectionSchema`                     | Atomic provider/model pair                                                                     |
| `reasoningLevel`      | `models.thinkingLevelSchema`                      | Scalar, independent of model                                                                   |
| `permissionRuleSetId` | `permissions.permissionRuleSetIdSchema`           | Scalar reference                                                                               |
| `compaction`          | Fields of `settings.autoCompactionSettingsSchema` | `auto`, `profile`, `customTriggerPercent` independently; validate complete resolved result     |
| `retry`               | Existing harness retry fields                     | `enabled: boolean`, `maxRetries: integer >= 0`, `baseDelayMs: positive integer`, independently |
| `tools`               | Typed entries below                               | By tool name and declared settings fields                                                      |
| `skills`              | Boolean enablement contract below                 | Sparse source maps plus per-source default enablement                                          |
| `subagents`           | Lead-only map below                               | By profile name and entry field                                                                |

Do not copy profile locks into `overrides`. Reject changes to currently required effective fields rather than accepting invisible edits underneath. Resetting an editable field removes its choice. The requirement itself can only change through profile switch/reapplication.

Compaction input uses the strict object fields/bounds, not the current legacy preprocessing that silently deletes `customKeepRecentPercent`. Legacy key removal belongs only in registered conversion with a report.

Reasoning compatibility: clamp inherited/recommended reasoning to the resulting model's supported levels using the existing clamp function and show the adjustment without rewriting input. Reject unsupported explicit UI model/reasoning combinations and incompatible required reasoning. Invalid externally loaded explicit combinations require recovery; do not silently change an explicit or required choice.

### Tools

Preserve tool names and value bounds from `capabilityToolPayloadSchemas` and `settings/settings.ts`. All listed payload fields are optional in sparse documents; resolved settings must meet their owning validators.

| Tool                               | Payload fields                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `python_exec`                      | `enabled`; `settings.interpreterPath`                                                                        |
| `web_search`, `jira`, `confluence` | `enabled`; `profileId` referencing a user-owned account                                                      |
| `web_fetch`                        | `enabled`                                                                                                    |
| `plan_present`                     | `enabled`; `settings.approvalProfile`                                                                        |
| `explain_image`                    | `enabled`; `settings.model` (atomic), `settings.thinkingLevel`                                               |
| `generate_image`                   | `enabled`; `settings` is atomic `imageGenerationToolSettingsSchema`, including its discriminator and options |
| `kroki_export`                     | `enabled`; `settings.url` using `krokiToolSettingsSchema` validation                                         |
| `bash`                             | `settings.shellPath`; `settings.autoPromotion` atomic; `settings.maxTimeoutMs`; no `enabled` field           |
| `subagents`                        | Lead-only `enabled` master capability; availability additionally requires an enabled usable profile entry    |

Core tools that have no optional capability entry cannot be disabled. An empty tool entry is invalid; remove it to inherit. A supplied atomic value must be complete. Array-valued settings replace as a whole. References are preserved if unavailable, with dependent execution/feature readiness diagnostics rather than an automatic replacement account/model. Missing catalog profiles block new selections/reapplications/launches, not execution using a valid already-applied snapshot.

Reset of an atomic field removes the whole value. For mergeable tool settings, resets may remove an individual field or the whole tool entry. Current optional-string semantics are retained: omission inherits, not an explicit clear sentinel. A user who needs to clear a lower-level optional path must edit/reset that lower-level choice; this design does not introduce a second null/unset language.

### Skill enablement

```ts
skills: {
  defaults?: { file?: boolean; nerve?: boolean; agentBrowser?: boolean };
  file?: Record<SkillName, boolean>;
  nerve?: Record<SkillName, boolean>;
  agentBrowser?: Record<SkillName, boolean>;
};
```

For each source/name, walk layers in priority order. Within one layer use its named boolean if present, otherwise its source default if present, otherwise continue to the next layer. Requirements therefore can disable even newly discovered skills; recommendations yield to explicit conversation choices. Retain existing name/map bounds and source discovery identities. No per-skill runtime options are introduced.

A source default covers every name in that source: overlap validation rejects a recommendation for any name/default in a source also covered by a required source default, and vice versa. A named exception within the **same** section is permitted and takes precedence over that section’s default. This makes whole-source requirements deliberate rather than accidental generic merging.

`frozenDefaults.skills` retains the creation-time source defaults and discovered name decisions; new skills are not advertised by an existing child until an explicit future supported child update. Child resource discovery uses the captured eligible skill identities, not a fresh expansion of live preferences. Required all-off remains all-off.

### Sub-agent availability

```ts
subagents: Record<
  AgentProfileName,
  {
    enabled?: boolean;
    model?: ModelSelection;
    reasoningLevel?: ThinkingLevel;
  }
>;
```

Names reference the same catalog namespace as profile selection; no nested definition/reference object is needed. Entries without explicit enablement inherit the catalog's existing enabled/usable behavior; the master capability can disable all delegation. Unknown/disabled/untrusted profiles are unavailable with diagnostics, not silently replaced. An entry must contain at least one field. Reject this map and `tools.subagents` in child settings/profile contributions.

## Profile definition files

Keep the unreleased per-file locations (`data/agent-profiles/<name>.json`, `.nerve/agent-profiles/<name>.json`), complete-definition shadowing and applicability. The released v0.37.0 sparse `subagents.json` catalogs convert into this format (see migration):

```ts
{
  schemaVersion: 1;
  name: AgentProfileName;
  label?: string;
  description: string;
  enabled?: boolean;
  usableBy: "lead" | "subagent" | "both";
  instructions: string;
  recommendations?: RoleSettingsOverrides;
  requirements?: RoleSettingsOverrides;
}
```

Preserve existing name/text bounds and default enabled/label rules. Both sections default to empty at resolution. Reject overlap at canonical merge units, including ancestor/descendant overlap involving an atomic value. Recommending an account and requiring tool enablement is legal; specifying the same account in both sections is not. `both` uses the child-compatible intersection, not an unrestricted union. Requirements cannot enable a role-prohibited tool or grant trust.

## Conversation-creation preferences

`config/conversation-defaults.json` at user/project scope:

```ts
{ schemaVersion: 1; revision: number; overrides: {
  defaultAgentProfile?: AgentProfileName;
  scopedModels?: ModelSelection[];
} }
```

These are creation/picker preferences, not active-agent resolution. Scalars inherit; `scopedModels` replaces atomically using existing model-picker semantics. Built-in start profile remains Coding. No conversation-level file.

The released remember-last-selection option is removed with no replacement state file. New conversations start from normal resolution; the composer shows the effective model, reasoning and permission before the first message. Migration folds an enabled remembered selection into `agent.json` defaults once (see migration).

## Disposable conversation-list summaries

`<NERVE_HOME>/cache/conversation-agent-summaries.json`:

```ts
{
  schemaVersion: 1;
  entries: Record<
    ConversationId,
    {
      model?: ModelSelection;
      reasoningLevel?: ThinkingLevel;
      permissionRuleSetId?: PermissionRuleSetId;
      agentProfile?: AgentProfileName;
      observedDigest: string;
    }
  >;
}
```

This file contains last-known display values, not choices or executable configuration. Invalid/missing cache is treated as empty, never a startup/agent failure. List API agent summary fields are optional/unknown when the cache has no entry; update the current required-field contracts instead of fabricating defaults. Lists show unknown values until lazily resolved; they do not load every configuration to fill gaps. Merge with conversation identity/list data in the service, not SQL joins. Coalesce atomic cache writes; cache failure does not fail a successful configuration save. Update on activation and acknowledged changes; remove entries on deletion. SQLite must never fallback as authority or store an alternate summary index.

## Scope and validator tests

Add fixtures for sparse inheritance, false versus omission, atomic model/configuration values, no input-default materialization, required-versus-choice resolution, recommendation overlap, child delegation rejection, unsupported reasoning, missing references, future versions, and cache loss. Golden examples in `examples/` are illustrative valid shapes for the new schemas; they are not new runtime configuration files.
