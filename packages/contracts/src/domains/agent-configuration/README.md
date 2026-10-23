# Scoped agent configuration contracts

Import from `@nervekit/contracts/agent-configuration`. These contracts are additive; legacy profile/capability/remember-selection contracts remain untouched.

## Pure API

- `resolveAgentConfiguration(options: ResolutionOptions): ResolutionResult` — resolves layers, per-canonical-JSON-Pointer provenance, and readiness diagnostics. Supply the existing model-catalog `clampThinking(model, level)` and `referenceAvailable(pointer, value)` to perform semantic checks; absent callbacks mean structural resolution only. Diagnostics do not replace runtime authorization. Defaults never select a fabricated model.
- `freezeChildPreferences(options: Omit<ResolutionOptions, "role" | "frozenDefaults" | "conversation">): CompleteChildSettings` — captures preferences **below requirements**. Supply creation-time `eligibleSkills`; omitted sources have no captured eligible identities. Pass the result as `frozenDefaults` on subsequent resolutions. Live preferences/recommendations are then ignored; requirements remain separate. The caller must check the final required configuration before launch.
- `projectChildSettings(settings: LeadSettingsOverrides): ChildSettingsOverrides` — validates lead defaults and removes delegation/plan presentation. Requirements and recommendations are instead rejected if incompatible with the child role.
- `canonicalSettingsEntries(settings): [pointer, value][]` — enumerates atomic/scalar merge units.
- `requirementOverlaps(recommendations?, requirements?): string[]` — conflicting recommendation pointers, including source-default coverage.
- `applySettingsMutation(current, mutation, requirements?, role?): LeadSettingsOverrides` — validates and applies sparse changes/resets without I/O. Pointers begin `/overrides`; atomic descent, required fields, unsupported paths and overlapping operations are rejected. Empty containers are pruned. Store owns revision/digest concurrency, document metadata and transition receipts.
- `configurationJSONSchemas(): Record<string, JSONSchema>` — editor schemas generated directly from Zod input contracts. Zod-only semantic refinements (including overlap and cross-field role checks) still require contract parsing.

Run `pnpm --dir packages/contracts schema:agent-configuration [output-directory]` to write editor JSON files (default: `packages/contracts/dist/json-schema/agent-configuration/`). No generated files need hand maintenance.

## Schemas

`leadSettingsOverridesSchema`, `childSettingsOverridesSchema`, `completeChildSettingsSchema`, `childLaunchOverridesSchema`, `agentPreferencesSchema`, `leadConversationAgentSchema`, `childConversationAgentSchema`, `appliedProfileSchema`, `profileDefinitionSchema`, `conversationDefaultsSchema`, `agentSummarySchema`, `conversationAgentSummariesSchema`, `configurationDiagnosticSchema`, `sha256HexSchema`, `agentMutationSchema`.

Persisted conversation loaders must select `childConversationAgentSchema` or `leadConversationAgentSchema` using trusted conversation ownership, never infer the role from editable JSON or fall back from child validation to the lead schema. The child schema and its generated editor schema require `frozenDefaults`.

Sparse parsers never insert defaults. Complete frozen settings require all non-model baseline fields, including captured skill maps/defaults. Profile label/enabled fallbacks are presentation/catalog resolution concerns, not parser defaults. A valid applied snapshot needs no catalog lookup. Consumers must treat `unsupported-reasoning` as blocking rather than execute unchanged invalid explicit/required choices; `reasoning-adjusted` is explanatory, not an input rewrite.
