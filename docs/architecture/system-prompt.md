# System prompt and tool descriptions

The host assembles prompts in [`nerve-system-prompt.ts`](../../packages/workbench-server/src/core-host/nerve-system-prompt.ts). Keep the base prompt small; tool definitions describe capabilities, and [agent profiles](agent-profiles.md) contribute working instructions. [Scoped configuration](configuration.md) owns preferences and applied snapshots, not historical profile-template or mode behavior.

## Prompt assembly

The default prompt contains a short introduction and general guidelines for task completion, skill loading, asynchronous work, response rendering and questions through `ask_user` when available. Avoid duplicating tool-specific instructions or generic advice a capable model already knows.

Normal assembly adds the base prompt, appended project context, captured instructions, applicable project instruction files, available skills, available agent profiles and the environment. Skills are listed only when `read` is available; profiles only when `subagent_prompt` is available. Profile listings include their purpose and permission rule-set display name.

A conversation-local `systemPrompt` overrides normal assembly; captured instructions still contribute. Profile instructions and tool descriptions can reference built-in guide skills with `{{skill:<name>}}`, resolved to skill paths during resource preparation.

## Tool-writing rules

- Describe what the tool does in one sentence, adding only non-obvious behavior: output bounds, background execution, notifications, side effects, external data transfer and when to use another tool.
- Do not repeat parameter names or types in descriptions. Retain units, defaults, indexing, mutually exclusive options and examples where the format is not obvious.
- Omit configuration details the agent cannot act on, such as configured providers or API-key locations; errors should explain those failures.
- Keep explicit user-request restrictions on mutating tools where required.
- Put lengthy workflows in guide skills, but retain everything needed to call a tool correctly and safely in its definition.

Jira and Confluence guide skills live under `packages/skills/src/builtin/guides/`. Their tool descriptions point to the guide; mutating tools retain explicit user-request restrictions. These guides are tool-group resources, not user-toggleable entries in the available-skills list.

Tool definitions and their tests own exact wording and behavior; do not maintain a second catalog of target descriptions in documentation.
