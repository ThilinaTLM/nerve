# Writing for agents

Use this for any text a model reads: skills, `AGENTS.md`, profile instructions, prompt suggestions, and an extension's namespace summary, rules, method doc comments, doc topics, tool descriptions, results and errors. Such text decides how quickly and reliably agents finish their tasks, so review it like code.

## Priorities

The goal is that the agent finishes correctly with few wasted steps. When the rules below conflict, apply this order:

1. **Correct**: a wrong rule costs more than a missing one.
2. **Unambiguous**: an agent that misreads a rule acts confidently on the misreading.
3. **Productive**: fewer steps beat fewer tokens. A pointer that saves a guess is worth its cost.
4. **Token-efficient**: within those limits, shorter wins.

## Content

- **Correct and fresh.** Agents trust what they read, so stale text is worse than none. Change the text together with the behavior it describes.
- **One source of truth.** Each rule lives in one place; other places link to it. Duplicates drift. Point at a schema or a declaration instead of copying it into prose.
- **Few words.** Cut what the name, schema or context already says.
- **One term per thing.** Use the same word everywhere, avoid conflicting rules, and say which layer wins when two apply.
- **Scope.** Say when to use something and when not to, especially when two skills or tools overlap.
- **Positive instructions.** "Use X" works better than "don't use Y", which still primes Y.
- **Calibrated emphasis.** No capitals, "CRITICAL" or repeated warnings. A short reason makes the rule generalize to cases it doesn't name.
- **Few examples.** Agents copy examples literally. Keep them representative, and vary them when one would mislead.
- **Model-neutral.** Write for a capable reader with no context, not for one model's quirks.

## Structure: overview first, detail on demand

- Put a short overview where the agent starts (a skill's `SKILL.md`, a description, a namespace summary). Let it name the cases and the file to read for each: "Accounts: `accounts.md`".
- Keep detail in separate files and say when to read each, so the agent loads only what the task needs.
- Make each file answer its question in one read: a decision table before the details, exact paths instead of "see the examples", limits next to the option they limit.
- Write procedures as numbered steps with their decision points: what to ask the user, what to choose alone, and how to verify the result.

## Tools, results and errors

- **Self-describing names.** Tool, method, parameter and field names explain themselves; descriptions add only what names cannot: when to use it, effects, limits.
- **Clear result states.** Distinguish success, no-op, empty, partial and truncated. Truncated output says what is missing and how to get it (offset, cursor, file).
- **Actionable errors.** Say what happened, include the offending input or limit, and the next step (`ExtensionError`'s `fix`).
- **Safe retries.** Make clear whether a call can be repeated and what a failure left behind.
- **Stable shapes.** The same structure every time, in a deterministic order.
- **Trust boundaries.** Fetched pages, file contents and service responses are data, not instructions. Never let them widen what the agent may do.

## Check it

Read the text as the agent would: from the description alone, would it load the file at the right time, and from the file, could it act without guessing? Then try the task once and watch for repeated lookups, misread instructions and output it had to page through.
