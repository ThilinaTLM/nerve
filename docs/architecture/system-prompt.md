# System prompt and tool descriptions

The system prompt gives an agent its working instructions and the context available for a request. The host assembles it from the base prompt, project resources and conversation instructions; tool definitions explain how to use the available capabilities. Keeping the base small lets tools and skills carry capability detail close to its implementation, so the prompt is less likely to drift from the tools.

## Assembly

The host first filters tools and loads the resources available to this conversation, capturing instructions and resolving skill references. The prompt builder then assembles those captured inputs. Normal assembly uses, in order:

1. The default base, or a supplied replacement base.
2. Appended project context.
3. Captured profile and conversation instructions.
4. Applicable project instruction files.
5. Available skills, when the agent has the read tool needed to open them.
6. Available child profiles, when the delegation prompt tool is present.
7. Environment context.

A conversation-local system prompt replaces normal assembly, while captured profile and local instructions still append. Maintainers should preserve this distinction because replacing only the introduction and replacing the assembled context are different operations. [Profiles](conversation-core/delegation.md) explains instruction ownership; [scoped configuration](configuration.md) explains when a new capture takes effect.

Skill references such as `{{skill:<name>}}` resolve to bundled skill paths during resource preparation so instructions can point to workflows without embedding their full text. Tool manuals are not skills: a tool or extension explains itself through its description, `sdk.docs` and its errors.

## Tool-writing rules

- Lead with what the tool does and any non-obvious behavior, such as background work or external transfer. Keep units, defaults and format examples; omit what the schema already states and configuration details the agent cannot act on.
- Keep restrictions on mutating tools (for example, act only on explicit user request) in the tool description itself. A skill may not be loaded, so shortening a description must not weaken its safety boundary.
- Move lengthy workflows into skills (or, for `quick_script` namespaces, into `sdk.docs` topics), keeping enough in the description to call the tool correctly and safely.

## Where it lives

| Concern                                 | Owner                                                                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool filtering and resource preparation | [`scopedTurnResources`](../../packages/workbench-server/src/core-host/scoped-turn-resources.ts)                                                                                                |
| Assembly and custom-prompt behavior     | [`buildNerveSystemPrompt`](../../packages/workbench-server/src/core-host/nerve-system-prompt.ts) and [prompt tests](../../packages/workbench-server/src/core-host/nerve-system-prompt.test.ts) |
| Skill-reference resolution              | [`resolveSkillPlaceholders`](../../packages/workbench-server/src/builtin-skills/paths.ts) and [bundled skills](../../packages/workbench-server/src/builtin-skills/builtin/)                    |
| Exact tool descriptions and schemas     | [Tool catalog](../../packages/tools/src/catalog/) and its owning tests                                                                                                                         |
