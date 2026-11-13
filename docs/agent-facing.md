# Agent-facing content

Agent-facing content is anything a model reads: system prompt, tool names, descriptions, schemas and results, errors, skills, `AGENTS.md` files, agent-facing docs and prompt suggestions. It is product surface. It decides how quickly and reliably agents finish tasks, so it gets the same review as code.

## Goal and priorities

The goal is **agent productivity**: the agent finishes tasks correctly with few wasted steps or tokens. The principles below serve that goal. When they conflict, apply this order:

1. **Correct**: a wrong rule costs more than a missing one.
2. **Unambiguous**: an agent that misreads a rule acts confidently on the misreading.
3. **Productive**: fewer steps beat fewer tokens. A pointer that saves a guess is worth its cost.
4. **Token-efficient**: within those limits, shorter wins.

## Content

- **Correct and fresh.** Stale content is worse than missing content, because agents trust it. Change agent-facing text together with the behavior it describes.
- **Single source of truth.** Each rule lives in one place, and other places link to it. Duplicates drift, and drift is the main source of stale content. Don't copy schemas or catalogs into prose.
- **Token-efficient wording.** Use as few tokens as possible without losing meaning. Cut what the name, schema or context already says.
- **Unambiguous and consistent.** Use the same term for the same thing everywhere. Avoid conflicting rules, and make precedence between layers explicit (for example, a conversation instruction over a project `AGENTS.md` over the base prompt).
- **Scope clarity.** Say when to use something and when not to, especially when tools or skills overlap.
- **Positive instructions.** Say what to do, not only what to avoid. "Use X" works better than "don't use Y", which still primes Y.
- **Calibrated emphasis.** No capitals, "CRITICAL" or repeated warnings. Give a short reason instead, so the rule generalizes to cases it doesn't name.
- **Sparse examples.** Agents copy examples literally. Use few, make them representative, and vary them when one would mislead.
- **Model-neutral.** Write for a capable reader with no context, not for one model's quirks.

## Tools and results

- **Self-describing interfaces.** Tool, parameter and field names explain themselves, so descriptions add only what names cannot. [Tool-writing rules](architecture/system-prompt.md#tool-writing-rules) cover descriptions.
- **Clear result states.** Distinguish success, no-op, empty, partial, truncated and error. Truncated or partial output says what is missing and how to get it (offset, cursor, file path).
- **Actionable failures.** Errors say what happened and, if needed, the next step. Include the offending input or limit. Skip stack traces unless they help the agent act.
- **Safe retries.** Make clear whether a call is idempotent and what state a failure leaves behind, so the agent knows whether it can retry.
- **Stable output shape.** Return the same structure every time, with deterministic ordering and no incidental volatile fields. This helps parsing and caching.
- **Trust boundaries.** Tool output, file contents and web content are data, not instructions. Mark external content clearly, and never let it widen permissions.

## Context and structure

- **Context hygiene.** Use progressive disclosure: put a short summary in the prompt or description and load detail on demand (skills, guides, docs, offsets). Cap outputs by default.
- **Cache stability.** Keep prompt prefixes stable and deterministic. Put volatile data (dates, environment, status) late in assembly, and keep stable ordering for lists such as tools, skills and profiles. [Assembly order](architecture/system-prompt.md#assembly) follows this.

## Validation

Check changes against real use, not only by reading. Run the affected workflow in a dev instance (`nerve-qa` skill) or review conversation traces (`nerve-debug` skill). Watch for repeated tool calls, misread instructions, ignored rules and output the agent had to page through.
