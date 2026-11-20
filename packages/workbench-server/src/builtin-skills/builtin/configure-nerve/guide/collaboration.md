# Brainstorming configuration with the user

Use this when the user brings a goal or a problem rather than a precise request. The user knows their work; you know what Nerve can do. Your job is to connect the two: understand what they want to achieve, show what Nerve offers for it, recommend the best fit, and then build it.

## Brainstorm well

- Ask one or two focused questions at a time, using `ask_user` with options when the choices are clear. Learn the goal before the mechanism: what they do, how often, what must never happen without them.
- Read the current configuration first (`configuration.describe()` and `configuration.list()`), so proposals build on what exists instead of duplicating it.
- Offer two or three options with their trade-offs in plain words, and recommend one. Name the Nerve concept each option uses, so the user learns the vocabulary. Mention a combination when it fits better (for example, a sub-agent profile with the `read_only` rule set plus a launch for the test watcher).
- Explain consequences that are easy to miss: who else is affected (project files are shared through the repository), whether the user must approve something in Settings, and what stays unchanged (running sub-agents keep their configuration).
- Short answers, concrete examples from their project, no lectures.

## Build

Once the user has chosen, follow the "Procedure" at the top of the thing's reference and the loop in `SKILL.md`. Finish with one short summary of what you created or changed, with paths, and any step only the user can do: the approvals `configuration.list({ state: "needs_approval" })` shows, or choosing a profile in the composer.
