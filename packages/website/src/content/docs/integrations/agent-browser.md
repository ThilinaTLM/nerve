---
title: Agent Browser skills
description: Load optional browser-workflow guidance discovered from the Agent Browser CLI.
sidebar:
  order: 5
---

Nerve can discover skills by invoking the `agent-browser` CLI installed on the workbench daemon host and reading its skill catalog. Enable selected entries in Settings to append their `SKILL.md` guidance to subsequent agent runs.

Agent Browser entries follow normal skill toggling and cannot override same-named file skills that already won resource precedence.

:::note[Important distinction]
This integration is prompt guidance, not a native Nerve browser automation tool. There is no `agent_browser` entry in the agent tool manifest and no Nerve browser-control executor. Any workflow described by the skill depends on external CLI capabilities and the agent's permitted command execution.
:::

Review imported skill instructions before enabling them, especially when they ask for authentication, downloads, or state-changing browser actions.

## Next steps

- [Skills and resources](/guides/skills-and-resources/)
- [Resource precedence](/reference/resources/)
- [Remote daemon behavior](/operations/remote-daemon/)
