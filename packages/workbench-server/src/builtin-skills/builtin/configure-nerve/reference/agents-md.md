# Project instructions (`AGENTS.md`)

`AGENTS.md` is text added to every agent's instructions in the project. It is the cheapest way to make the agent follow a convention: no trigger, no approval, and other agent tools read the same file.

## Procedure

1. Read the existing `AGENTS.md` files on the path from the project root to where the convention applies.
2. Decide the folder: the project root for a rule of the whole repository, a subfolder for a rule of that part only.
3. Add the rule where a reader would look for it; keep the file short. State what to do and, when it is not obvious, why.
4. Tell the user what you added. It applies from the next agent run; no check or reload is needed.

## What is read

- `<project>/AGENTS.md`, then the `AGENTS.md` of each folder from the project root down to the conversation's working directory. Files above the project and in sibling folders are not read.
- `<project>/.nerve/APPEND_SYSTEM.md`: text appended for Nerve only. Use it when the instruction should not reach other agent tools.
- There is no user-level `AGENTS.md`. For guidance in every project, write a user skill or a user lead profile.

## `AGENTS.md`, a skill or a profile

| Use                                                  | When                                                                                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                          | The rule applies to all work in the project and fits in a few lines: commands to run, conventions, where things live. Every agent pays for every line on every request, so keep it small. |
| A skill (`reference/skills.md`)                      | The guidance is long, or applies to one kind of task. The agent sees only its description until the task matches.                                                                         |
| Profile instructions (`reference/agent-profiles.md`) | The guidance belongs to one way of working or one teammate, not to the project.                                                                                                           |

Move a section out of `AGENTS.md` into a skill when it grows past what every task needs.
