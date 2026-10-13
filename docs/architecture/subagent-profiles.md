# Sub-agent profile customization

> **Status:** Current implementation. Owning contracts and host/UI adapters are authoritative. This document preserves the customization proposal's decisions as the scoped JSON reference; [delegation](conversation-core/delegation.md) describes the unchanged lifecycle.

## Goals

- Manage profiles from Settings without maintaining separate definition and preference files.
- Customize enabled state, model, reasoning, instructions, permission, tools, skills and compaction at user, project and conversation scope.
- Support specialized profiles such as code review and UI development, plus quick conversation-local model changes when usage limits or cost matter.
- Explain unavailable capabilities without losing portable configuration.
- Preserve profiles as creation-time templates: changing a profile never reconfigures an existing sub-agent.

## Storage and ownership

Each writable scope has one versioned JSON document containing all local profile entries, including instructions. There are no Markdown profile files or separate sub-agent directories in this format.

| Scope        | Location                                                     |
| ------------ | ------------------------------------------------------------ |
| Built-in     | Shipped defaults in `contracts/subagents`                    |
| User         | `<NERVE_HOME>/config/subagents.json`                         |
| Project      | `<project>/.nerve/config/subagents.json`                     |
| Conversation | `<NERVE_HOME>/data/conversations/<id>/config/subagents.json` |

Use the existing `subagents.json` filename. Conversation files belong to the conversation and are deleted with it. No new database tables or columns are required.

`contracts/subagents` owns the document, patch, diagnostics and configuration read-model schemas, built-in defaults, and pure resolution rules. `workbench-server` owns filesystem access, trust, availability checks and host integration. Conversation core continues to use `SubagentHost`, without loading profile documents itself. Workbench UI renders the same effective configuration and diagnostics used by the runtime.

The illustrative document below customizes an inherited profile; it is not a complete new-profile definition:

```json
{
  "schemaVersion": 1,
  "profiles": {
    "developer": {
      "enabled": true,
      "model": "lead",
      "thinking": "high",
      "tools": {
        "web_search": false
      }
    },
    "explore": {
      "enabled": false
    }
  }
}
```

Each entry can contain the existing profile fields: label, description, enabled, model, thinking, instructions, permission, tools, skills and compaction. Instructions are a JSON string and can contain Markdown. `permission` accepts only `read_only` or `autonomous`. Tools refer to configurable capability tools, not arbitrary core tools; core-tool access is governed by permission. Skills support inheriting the parent's selection, selecting none, or changing individual skill selections, as in the existing profile semantics.

Built-in `explore` and `developer` keep useful defaults but always use `model: "lead"` and `thinking: "lead"`. They never assume a provider or a specific model.

## Resolution and reset

Resolve entries by name through **built-in → user → project → conversation**. Same-name entries are sparse overrides unless all fields have been explicitly copied into that scope.

- Missing fields inherit from the lower profile layer. A new name must resolve to a valid complete profile before it can be used.
- Scalar fields replace individually; instructions replace the whole instruction string.
- Tool maps and per-skill selection maps merge by name. A skills mode such as `none` replaces the inherited selection mode. Structured compaction settings replace as a whole rather than combining unrelated presets.
- `false` is an explicit disable, not inheritance. Higher scopes can re-enable a profile or selectable capability; these preferences are not security restrictions.
- Reset removes the local field or entry. Mutation patches can use `null` to request removal; persisted documents omit reset fields.
- Explicit values remain pinned even when equal to inherited values. Only a reset returns to inheritance.
- `model: "lead"` and `thinking: "lead"` use the parent's current values at creation. They are distinct from inheriting a lower profile layer's choice.
- “Copy to this scope” materializes all effective profile fields under the same name, shadowing lower settings. Copying under a different name creates an independent profile. Removing the local entry reveals inherited settings.

Return local entries, inherited and effective values, field-level origins, trust and diagnostics to the UI. The `subagents` capability remains the master switch: an enabled profile cannot bypass it or runtime restrictions. With no usable profiles but existing children, prompt follow-ups, status and stop remain available; the prompt schema omits `profile`, and new-child creation fails. With neither usable profiles nor existing children, tools are removed. Turning the master capability off always removes the group.

## Availability and diagnostics

A profile may be portable across installations with different providers, integrations and skills. Separate malformed or forbidden configuration from well-formed references that are currently unavailable.

| Condition                                                                                                       | Presentation and behavior                                                                                                  |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Enabled tool is unknown to this application version, not installed, or lacks required integration configuration | Warning identifying the tool and reason. Preserve the reference, but do not advertise or enable that tool on the child.    |
| Enabled skill is missing or not loadable under existing resource policy                                         | Warning identifying the skill and reason. Preserve the selection, but do not load the skill.                               |
| Explicit model is unavailable or unconfigured                                                                   | Blocking diagnostic. Preserve the choice; do not silently switch models. Creation fails with an actionable message.        |
| Thinking level is incompatible with the selected model                                                          | Blocking diagnostic when incompatibility is known. Prompt the user to choose a supported level; do not silently downgrade. |
| Profile requests a forbidden tool or permission                                                                 | Validation error, not an availability warning. Runtime restrictions always apply.                                          |
| Malformed JSON, unsupported document version, or structurally invalid entry                                     | Visible configuration error. Do not silently treat the document as empty or overwrite it on the next save.                 |

Unavailable references are not removed during save. Disabled references may be shown as unavailable in the editor, but need not generate a prominent warning because they are not requested. Warnings do not alone disable an otherwise usable profile: clearly label it as usable with reduced capabilities. Do not claim that a missing enabled capability will be available to the child.

The editor must retain unknown tool/skill names and show them in a diagnostic list even when they cannot appear in the normal picker. Shape validation accepts portable capability references; semantic validation distinguishes unknown names from known, prohibited tools. One invalid profile entry should not hide unrelated valid entries; a malformed document cannot be partially resolved reliably. Invalid higher-layer entries must not silently reveal a lower profile of the same name.

Profile trust applies to the project `subagents.json` document only. Skill availability does not establish independent trust in skill content: the application resource loader has no separate skill trust system, and this work adds no skill trust feature or database gate. Preserve existing loader security semantics. If a resource-specific trust policy is introduced later, the same diagnostic structure can report its loading restrictions; this is not a claim that current implementation detects found-but-untrusted skills.

Recompute diagnostics when provider, integration or skill availability, or project profile-document trust changes, and recheck at creation. Both advertised profile names and creation consume the same conversation-aware resolver. Unknown references never create tools or bypass capability filtering. The model/provider runtime remains authoritative for failures that cannot be detected in advance.

## Trust and persistence

Reuse scoped configuration patterns: validated reads, serialized mutations, atomic JSON replacement, digest-based optimistic conflict detection, and conversation/project ownership checks. Missing files mean no local overrides; unreadable or malformed files are errors, not missing files.

Project content can inject instructions and grant autonomous permission. Apply project entries only when the exact project document content is trusted. External edits invalidate trust. Editing, toggling or resetting one entry in an untrusted imported project `subagents.json` does not trust the whole document or activate untouched entries; explicit whole-document trust is required. Nerve-authored updates may automatically trust the resulting content only when the document was missing/new or its exact previous content was already trusted. An untrusted project entry remains visible and blocks use of the affected profile rather than silently falling back to lower settings. Conversation enablement cannot bypass that trust gate.

Conversion from legacy Markdown files and the user-global `{ enabled: ... }` document is a storage migration concern. Preserve names, instructions, settings and explicit toggles; do not maintain permanent Markdown/JSON dual loading. Project trust must be reassessed for the new content. Conflicts, malformed documents and incompatible legacy capability shadowing require actionable failure and explicit manual resolution, preserving relevant sources before deletion. Whole-definition legacy tool/skill maps cannot always be represented by sparse merges: extra inherited keys require an explicit capability decision, not guessed enabled state. Home migration covers registered projects only; later-opened unregistered old projects need explicit conversion to canonical `.nerve/config/subagents.json`, with no runtime legacy loader. Extend the existing unreleased migration step rather than adding a second step for the same release. See [storage migrations](migrations.md#step-0001--conversation-core). Development homes that already recorded an earlier draft of step 0001 as applied require a baseline rebuild/copy; extending the step does not rerun it on an applied ledger. This is a dev-only limitation, not an additional released migration path.

## Settings and conversation workflows

Settings at user and project scope expose a full editor: name, description, instructions, enabled state, model, reasoning, permission, tool selections, skill selections and compaction. Include copy-to-scope, duplicate-under-new-name, reset actions, field origins and diagnostic details. Individual project toggles must write project configuration, not user-global preferences.

- **Code review:** create `code-review`, choose a review-oriented model, use `read_only`, and disable unneeded capability tools. The permission choice is what restricts core file mutation and commands.
- **UI development:** create `ui-developer`, choose a UI-oriented model, use `autonomous` when implementation is intended, and enable the agent-browser skill if available. Enabling a skill does not install its external dependencies or override tool permissions.
- **Usage fallback:** in a lead conversation, override a profile's model and reasoning without editing the reusable user/project profile. Newly created children use the replacement; children already created do not change.

The composer’s **Capabilities** popover has **Tools**, **Skills** and **Sub-agents** tabs. The **Sub-agents** tab exposes per-profile enabled state, model and thinking level, distinct from the master delegation capability toggle. Show inherited values, per-field reset, warnings and blocking errors. These profile overrides affect newly created children only; existing children keep their creation-time configuration and any direct edits. The underlying document supports all profile fields without a separate format; full profile instructions/capabilities editing stays in Settings.

## Creation-time snapshot: no live binding

**A profile is a template, not a live reference.** Resolve the effective profile against the lead conversation and current availability once for child creation, then materialize its configuration through the existing mechanisms:

| Resolved field      | Child destination                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Model and thinking  | Child conversation model and reasoning configuration; `lead` becomes concrete parent values |
| Permission          | Child permission rule-set selection                                                         |
| Instructions        | Child conversation instructions                                                             |
| Tools and skills    | Child conversation `config/capabilities.json`                                               |
| Explicit compaction | Child conversation `config/harness.json`                                                    |

Use the same resolved snapshot for child configuration and capability initialization, so a concurrent profile edit cannot produce a mixed child. Preserve existing `inherit` semantics for parent-derived capability/compaction settings; this is not a promise that external providers, resources or all inherited application settings are frozen forever.

After creation, no runtime path re-resolves the child's profile to refresh its settings. Editing, disabling, deleting or overriding that profile at any scope affects **future children only**. A follow-up to an existing named sub-agent uses its current child configuration, including any direct child edits; it does not reapply the profile or create a replacement. Changing the lead's model does not update a child's already-copied model either.

The creating tool call may retain the profile name for provenance and assignment checks. That name is not a live configuration binding. Existing children remain editable through their own supported conversation controls. Availability and security restrictions still apply at runtime regardless of the creation snapshot.

The UI should state: **“Profile changes apply to newly created sub-agents. Existing sub-agents keep their configuration.”** Updating an existing child's model to address usage limits requires changing that child directly, not changing its profile.
