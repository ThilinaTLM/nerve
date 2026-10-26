# Agent profiles

Agent profiles contribute instructions, recommendations and requirements to scoped agent preferences. Contracts in `@nervekit/contracts/agent-profiles` own schemas and pure resolution; host services own files, trust and publication; conversation core owns execution lifecycle. See the [normative specification](../proposals/scoped-configuration-and-active-profiles/README.md) and [user reference](../../packages/website/src/content/docs/reference/agent-profiles.md).

## Definitions and applied snapshots

Complete `schemaVersion: 1` definitions live at:

- User: `<NERVE_HOME>/data/agent-profiles/<name>.json`
- Project: `<project>/.nerve/agent-profiles/<name>.json`

A same-name project definition shadows the whole user/built-in definition; fields do not merge between catalog definitions. Editing an inherited definition creates a complete local copy. Deleting that copy exposes the lower definition for future applications. Project profiles require exact-byte trust; edits invalidate it. Profile trust does not grant independent trust to skill content.

Applying a profile captures its name, source, digest, instructions, recommendations and requirements in conversation `config/agent.json.appliedProfile`. Catalog edits, disablement or deletion do not rewrite valid applied snapshots. **Apply updated profile** explicitly replaces the contribution while preserving conversation overrides and prompt context. New applications require current validity, applicability, enablement and trust.

## Preferences and switching

The editor has three behaviors:

- **Use settings:** no profile contribution.
- **Recommend:** provide a value unless the conversation explicitly chooses another.
- **Require:** temporarily control a value and disable its effective control without changing the underlying choice.

Resolution is requirement → conversation choice → recommendation → process default → project → user → built-in. Switching profiles preserves explicit choices; removing a requirement reveals the underlying choice/default. Reset removes an editable override and inherits; it does not write a default or remove a requirement. Effective source labels distinguish defaults, conversation choices, recommendations, requirements and frozen child choices; requirements identify their profile.

## Lead lifecycle and planning

The composer selects lead/both profiles; `/profile <name>` switches and `/plan` selects Planning. Agents cannot switch profiles. Creation defaults (`defaultAgentProfile`, `scopedModels`) live in user/project `config/conversation-defaults.json`, not the effective-agent ladder. There is no remember-last-selection option.

Coding contributes instructions and otherwise uses settings. Planning requires the planning permission ruleset and `plan_present` enablement. Leaving Planning reveals underlying choices; Coding does not grant write permission or force Plan Present off. There is no planning/coding mode flag.

Plan review captures the target profile name/digest, previews requirements and rejects incompatible implementation model/reasoning choices. Changed or unavailable targets require refreshed confirmation. Accepted choices and the applied profile commit in one conversation document revision before implementation begins; failed validation/persistence preserves the previous state and pending review.

## Child agents

Explore and Developer are built-in child profiles. Child preferences resolve independently from built-in/user/project/process defaults and their own profile, never by copying the lead's effective configuration. Available-sub-agent settings support enablement and model/reasoning launch overrides only. Launch choices beat recommendations but not requirements.

Creation captures complete underlying preferences in `frozenDefaults` plus the applied profile in the child's `agent.json`. Follow-ups retain them despite later default, catalog or launch-selection edits. Child profile switching/reapplication is unsupported. Current authorization and credentials remain live; frozen preferences do not freeze security policy. Role projection and execution guards prohibit child delegation, user questions and plan presentation.

## Activation, health and migration

Validated UI saves publish directly; no filesystem watchers exist. Manual edits need restart for guaranteed activation or an explicit Reload/Retry re-read. New requests capture settings; tool execution rechecks current authorization, including after approval waits. Invalid required/security configuration waits **configuration-blocked** with Retry/Cancel, never an approval bypass. Health diagnostics and confirmed, previewed repairs preserve damaged sources; dismissal is not repair.

Released v0.37.0 readers remain frozen only in migration step `0002-agent-profiles`. Runtime has no legacy file/SQLite fallback. See [configuration](configuration.md), [storage](storage.md) and [migrations](migrations.md).
