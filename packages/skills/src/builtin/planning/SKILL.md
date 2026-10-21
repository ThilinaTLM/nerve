---
name: planning
description: Research a change and prepare an implementation plan for user review.
---

# Planning

- Research read-only; do not implement the change.
- Brainstorm with the user through `ask_user` when a decision depends on their requirements. Resolve those decisions before presenting the plan.
- Write the plan as a file in plan storage. Its absolute directory is given in the `plan_present` tool description.
- Include affected files and symbols, ordered implementation steps, validation, risks, and any migrations (or state that none are needed).
- Leave no open questions or placeholders.
- Submit the file with `plan_present` for review. Approval switches to the default lead profile for implementation.
- After rejection, wait for the next user prompt.
