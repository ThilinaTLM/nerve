---
title: Configure Nerve by chat
description: Describe what you want in a Forge conversation and the agent builds extensions, skills, launches, profiles, prompt suggestions, and permission rules, then hands you what only you can approve.
sidebar:
  order: 2
---

You don't have to learn Nerve's configuration files. Start a conversation with the **Forge** profile, say what you want, and the agent writes the configuration for you, checks it, and reloads it. Anything that could widen what agents run or reach waits for your approval in Settings.

<!-- screenshot: forge-build -->

## Start a Forge conversation

- On an empty conversation, choose the **Forge** card. It is one of four starter cards (Coding, Planning, Lead, Forge) shown once a project is open.
- Or select the **Forge** profile in the composer, or type `/profile forge`.

Forge is a built-in lead profile. It requires the built-in **configure-nerve** skill, so the skill is on for that conversation without any change to your skill settings. In another profile, the agent only uses it when you turn it on in **Settings → Skills** and ask to configure or extend Nerve. See [Agent profiles](/reference/agent-profiles/).

## What you can ask for

| You want                                        | The agent builds                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Nerve to follow your conventions                | Project instructions (`AGENTS.md`), a [skill](/guides/skills-and-resources/), or profile instructions |
| Fewer approval prompts for a known-safe command | A [permission rule](/guides/agent-controls/) in an overlay or rule set                                |
| A request you keep retyping                     | A [prompt suggestion](/guides/prompt-suggestions/)                                                    |
| A second opinion, or a different way of working | A sub-agent or lead [profile](/reference/agent-profiles/)                                             |
| Your dev server or watcher one click away       | A [launch](/guides/background-tasks/), written with `launches.*`                                      |
| A service Nerve doesn't cover                   | An [MCP server](/integrations/mcp/) entry, or an [extension](/guides/build-extensions/)               |
| To see or open something inside Nerve           | An extension with a file preview, page tab, dock panel, or theme                                      |

The agent picks the cheapest mechanism that solves the problem. If you describe a goal instead of a precise change ("it keeps forgetting our conventions"), it lays out two or three options with their trade-offs and recommends one before building.

An example that combines several parts: _"Add a side panel that shows whether this project's QA and production environments are up."_ The agent builds an extension with a dock panel and a backend method that checks the two URLs, declares the websites it needs, and tells you to review and allow it. See [Build an extension](/guides/build-extensions/).

<!-- screenshot: extension-panel -->

The agent doesn't configure model providers, accounts, credentials, extension settings, or appearance. It points you to the Settings page instead, and you add secrets there, never in chat.

## Project or user scope

| Scope       | Where it lives                       | Who gets it                                      |
| ----------- | ------------------------------------ | ------------------------------------------------ |
| **Project** | `<project>/.nerve/…` and `AGENTS.md` | Everyone who opens the repository, once reviewed |
| **User**    | Your Nerve home (`~/.nerve`)         | You, in every project                            |

The agent defaults to the project for things a team should share (instructions, prompt suggestions, launches) and mentions user scope when it fits better, such as a personal skill or profile. Say "only for me" or "for the team" to decide. When the same name exists in both, the project definition replaces the user one whole. See [Configuration](/operations/configuration/) for the files.

## What only you can do

The agent can't approve, trust, consent, or add credentials. It writes the files, then tells you where each item waits:

| Item                                             | You approve it in                       |
| ------------------------------------------------ | --------------------------------------- |
| A project skill                                  | **Settings → Skills**                   |
| A project `agent.json`                           | **Settings → General**                  |
| Project permission rules                         | **Settings → Permission rules**         |
| A project agent or sub-agent profile             | **Settings → Agents** or **Sub-Agents** |
| A prompt suggestion's script                     | **Settings → Suggestions**              |
| A new extension, or one that gained a permission | **Settings → Extensions**               |
| An MCP server entry (user or project)            | **Settings → MCP servers**              |

Each item is **Needs review**, **Trusted**, or **Declined**. Changing an approved file, even through the agent, asks again. See [Trust and review](/guides/settings/#project-files-you-review). An entry you save through Nerve's own Settings pages stays trusted; a change made by editing the file asks again.

## Checked before it takes effect

Nerve doesn't watch configuration files. After writing, the agent runs two `quick_script` calls from the `configuration` namespace:

1. `configuration.check(scope)` validates the files on disk and changes nothing. It reports each problem with a message and a pointer.
2. `configuration.reload(scope)` activates them.

A broken edit to a permission file, `agent.json`, conversation defaults, or a profile never replaces the version that is loaded: the previous one stays in use and the reload reports it. The agent fixes the file and reloads again. This protection lasts until Nerve restarts; a file that is invalid at startup fails closed, so the agent doesn't end its turn with an error left behind.

The agent also uses `configuration.describe()`, `configuration.list()`, and `configuration.explain()` to answer questions such as "why was that command allowed?" from what is actually in effect.

## The attention bell

The bell in the header lists configuration that needs you, in two groups:

- **Waiting for your review**: valid items that aren't used until you decide, each with **Review**, which opens the right Settings page.
- **Not working**: items that failed to load, with **Details** (or **Open file**) and **Ask the agent to fix**. For an extension that needs upgrading after a Nerve update, the button reads **Ask the agent to upgrade**.

**Ask the agent to fix** opens a new Forge conversation with a prompt that names the item and its problems. It isn't sent until you send it, and it states that you review approvals yourself. Items waiting for review also add a count beside their Settings page, and the project's start screen says how many project files need your review.

## Next steps

- [Build an extension](/guides/build-extensions/)
- [Connect MCP servers](/integrations/mcp/)
- [Skills and project resources](/guides/skills-and-resources/)
- [Settings at a glance](/guides/settings/)
