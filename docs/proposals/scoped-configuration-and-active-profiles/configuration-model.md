# Configuration model and resolution

## Approved decisions

### Configuration roots

| Scope | Root |
| --- | --- |
| User | `<NERVE_HOME>/config/` |
| Project | `<project>/.nerve/config/` |
| Conversation | `<NERVE_HOME>/data/conversations/<id>/config/` |

These roots are agreed. The exact files, subdirectories, allowed scopes and schemas within them must be specified below before implementation. Catalog locations, credentials and runtime artifacts are not implicitly approved by agreement on these roots.

### Document boundaries

Use domain-specific configuration files, not one global `settings.json`. Keep conversation agent choices and the applied profile snapshot together in one atomic agent document. Exact filenames and document envelopes remain to be finalized.

### Sparse overrides

Saved preference documents contain only explicit choices. Missing fields inherit from the preceding applicable layer. Reset removes the override. Explicit false is distinct from omission. Schemas must accept partial documents while validating every supplied value; resolved configurations require a separate complete-value validation step.

Built-in defaults provide the bottom layer. Do not write resolved inherited values back into sparse documents. Define field-level merge rules before implementation rather than assuming arbitrary deep merging works for all data.

### Non-destructive active profiles

Profiles contribute to effective configuration without overwriting stored conversation choices. Required profile settings have highest priority within agent-setting resolution while that profile is active. Application safety restrictions and trust checks remain authoritative.

For example, Planning can require the planning permission ruleset and enable plan presentation. Existing conversation choices remain stored underneath. Switching to Coding removes Planning's enforcement; it does not require a restoration write or cleanup of Planning's values in conversation overrides.

Approved precedence, highest first: profile requirements → explicit conversation choices → profile recommendations → project defaults → user defaults → built-in defaults. Requirements cannot be overridden by conversation choices. They enforce effective values without modifying the stored choices underneath.

Approved profile behaviors replace the existing template modes:

- **Use settings:** the profile contributes nothing for this field. Use the explicit conversation choice if present; otherwise project → user → built-in defaults. It does not mean bypassing conversation choices.
- **Recommend:** use the profile value unless the conversation has an explicit choice. Recommendations override project/user/built-in defaults but never write into those defaults or conversation choices.
- **Require (lock):** use the profile value even when a conversation choice exists. Keep that choice unchanged underneath; disable editing of the effective field while the requirement applies. Switching away removes the enforcement.

Profile JSON uses separate sparse `recommendations` and `requirements` sections. Reject the same setting leaf in both sections; atomic settings such as model selection count as one field. Omission from both sections means Use settings. Legacy Set and Reset-to-settings mutation behavior is not carried forward. Sub-agent inheritance remains open.

**Profile update lifecycle remains open:** the user provisionally favors snapshots but explicitly requests practical trade-offs before finalizing. Do not treat snapshot retention as an unconditional final decision. If snapshots are retained, the proposed storage is an applied-profile section of conversation `config/agent.json`, together with conversation choices, not an additional independently written file. Requirement values in that section are policy contributions, not copies written into conversation overrides. Compare explicit reapplication against automatically resolving changed definitions, including deleted/untrusted profiles, active plan reviews and mid-run changes.

### Agent document and merge boundaries

Use `config/agent.json` at user, project and conversation scopes, with shared settings fields and scope-specific envelopes. Conversation choices and the applied profile snapshot are separate sections in the same atomic file. Include agent compaction and retry preferences in this document. Host/network/process configuration remains separate. Exact schema property names and versions are not yet finalized.

Use field-specific merge rules, not generic recursive merging:

- Model provider and model ID are an atomic selection.
- Tools merge by tool identity and documented configuration fields.
- Skills merge by stable identity.
- Arrays replace unless the owning schema explicitly specifies otherwise.
- Omission inherits; Reset removes a stored field. Null is not a universal stored reset marker; each schema defines whether it is a legitimate value.

## Skills, tools and sub-agent configuration

Clarified requirements:

- Skill selections are enablement booleans; they do not need arbitrary per-skill configuration.
- Tools have enablement and typed, tool-specific configuration, including references to user-owned integration accounts (for example, Jira's Atlassian account).
- Available sub-agent profiles need enablement plus scoped invocation overrides. A project can select a model/reasoning level for Developer, and a lead conversation can override that selection for its own future Developer launches without editing the reusable definition.
- Sub-agents cannot delegate further agents. Child configuration must not recursively contain an available-sub-agent configuration map; this is also a runtime restriction, not merely a hidden editor field.

Approved design:

- Share non-delegation agent-setting schemas, with distinct constrained lead and child schemas. Only lead settings include the available-sub-agent map. Child schemas reject delegation configuration, and runtime independently prohibits it.
- Each available-sub-agent entry references a reusable profile and contains enablement plus optional **model and reasoning overrides only**. Do not add per-invocation instructions, permissions, tools, skills, compaction, retry or nested delegation overrides in this initial design.
- These scoped invocation choices take precedence over the child profile's recommendations, but not its requirements. Project choices can be overridden by the lead conversation without editing the profile definition. Model selection is atomic; reasoning inherits independently when omitted.
- Changes configure **future child launches only**. Existing children retain their captured configuration, including on follow-up. Any future support for editing an existing child must be an explicit separate operation, not implicit propagation from the lead.

Exact JSON property names, profile reference identity, child defaults and the role of Same as parent remain open. Profile catalog applicability (lead/subagent/both) must be reconciled with these constrained schemas before implementation.

