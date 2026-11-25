# Agent-facing content

Agent-facing content is anything a model reads: system prompt, tool names, descriptions, schemas and results, errors, skills, `AGENTS.md` files, agent-facing docs and prompt suggestions. It is product surface. It decides how quickly and reliably agents finish tasks, so it gets the same review as code.

## Principles

The priorities and rules for content, structure, tools, results and errors are in [writing-for-agents.md](../packages/workbench-server/src/builtin-skills/builtin/configure-nerve/reference/writing-for-agents.md). It ships with the built-in `configure-nerve` skill, so agents writing skills and extensions for users follow the same rules. Follow it for Nerve's own content too, and change it there.

## Nerve-specific rules

- **Tool descriptions.** [Tool-writing rules](architecture/system-prompt.md#tool-writing-rules) cover Nerve's built-in tools.
- **Cache stability.** Keep prompt prefixes stable and deterministic. Put volatile data (dates, environment, status) late in assembly, and keep stable ordering for lists such as tools, skills and profiles. [Assembly order](architecture/system-prompt.md#assembly) follows this.
- **Cap outputs by default.** Tool results and injected context start short and load detail on demand (offsets, files, skills).
- **Shipped docs work from npm.** Skills and docs that ship with Nerve or its npm packages (`configure-nerve`, `@nervekit/extension-sdk`) describe the installed layout (`node_modules/@nervekit/...`, the skill's generated `reference/`), never this repository's source, which users don't have. Local linking for development (`NERVE_EXTENSION_SDK_SPEC`, see `scripts/lib.mjs` of the skill) stays in maintainer notes.

## Validation

Check changes against real use, not only by reading. Run the affected workflow in a dev instance (`nerve-qa` skill) or review conversation traces (`nerve-debug` skill). Watch for repeated tool calls, misread instructions, ignored rules, output the agent had to page through, and reads of Nerve's source that a user's installation would not have.
