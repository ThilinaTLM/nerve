---
title: Configure Nerve by chat
description: Describe what you want in a Forge conversation and the agent builds extensions, skills, launches, profiles, prompt suggestions, and permission rules, then hands you what only you can approve.
sidebar:
  order: 2
---

You don't have to learn Nerve's configuration files. Start a conversation with the **Forge** profile, say what you want, and the agent writes the configuration for you, checks it, and reloads it. Anything that could widen what agents run or reach, in your user settings or in the project, waits for your approval.

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

The agent can't approve, trust, consent, or add credentials. It writes the files, then tells you where each item waits. This holds for your user settings as much as for the project: a skill, profile, permission rule set, `agent.json`, prompt suggestion, extension or MCP server entry the agent writes in your Nerve home isn't used until you approve it. Built-in items ship with Nerve and need no approval.

| Item                                             | You approve it in                       |
| ------------------------------------------------ | --------------------------------------- |
| A skill (user or project)                        | **Settings → Skills**                   |
| An `agent.json` (user or project)                | **Settings → General**                  |
| Permission rule sets and your permission overlay | **Settings → Permissions**              |
| An agent or sub-agent profile (user or project)  | **Settings → Agents** or **Sub-agents** |
| A prompt suggestions file (user or project)      | **Settings → Suggestions**              |
| A new extension, or one that gained a permission | **Settings → Extensions**               |
| An MCP server entry (user or project)            | **Settings → MCP servers**              |

Each item is **Needs review**, **Trusted**, or **Declined**. Changing an approved item outside Nerve's Settings pages, whether the agent, a script, `git pull` or your own editor does it, asks again. An entry you save through Nerve's own Settings pages, or with **Always allow** on an approval, stays trusted. While a changed item waits, Nerve keeps using the version you last trusted where one exists (permission files and a project's version of a user item); otherwise the item isn't used. See [Trust and review](/guides/settings/#items-you-review).

### The review dialog

Every kind of item opens the same dialog, from **Review** on a notification or on the item's page:

- **What it can do** lists the item's effect in plain words, with anything broad first (for example "Runs without asking" or "Can run scripts"). When a trusted item changed, what is new comes first and is marked **New**.
- **Source** lists the files it comes from, with their paths and an **Open** button. Nerve doesn't show the source inside the dialog.
- **Not now** moves to the next item and leaves this one waiting. **Decline** stops Nerve using it and asking again. **Trust** approves exactly what you reviewed, so a later change asks again. **Details** opens the item's Settings page.
- A trusted item offers **Revoke** on its page, which returns it to declined.

If the file changed while the dialog was open, the dialog shows the new review instead of deciding on the old one.

## Checked before it takes effect

Nerve doesn't watch configuration files. After writing, the agent runs two `quick_script` calls from the `configuration` namespace:

1. `configuration.check(scope)` validates the files on disk and changes nothing. It reports each problem with a message and a pointer.
2. `configuration.reload(scope)` activates them.

A broken edit to a permission file, `agent.json`, conversation defaults, or a profile never replaces the version that is loaded: the previous one stays in use and the reload reports it. The agent fixes the file and reloads again. This protection lasts until Nerve restarts; a file that is invalid at startup fails closed, so the agent doesn't end its turn with an error left behind.

The agent also uses `configuration.describe()`, `configuration.list()`, and `configuration.explain()` to answer questions such as "why was that command allowed?" from what is actually in effect.

## The attention bell

While something waits for you, the bell in the title bar becomes a small **island**. It shows each new item for a few seconds, then settles to the bell with a count, and expands into two lists:

- **Needs your review**: items that aren't used until you decide, each with **Review**, which opens the review dialog. This level comes first and is tinted as a warning.
- **Conversations waiting**: conversations that need an answer.

While configuration waits, a **Needs your review** marker also sits at the top of every conversation, so you notice it where you work. It opens the island; on a phone it opens the review queue. **Later** hides the island and the marker until a new item needs review in this session; the bell keeps counting. See [Notifications and activity](/guides/notifications/).

Items that failed to load appear in the bell's notifications under **Not working**, with **Details** (or **Open file**) and **Ask the agent to fix**. For an extension that needs upgrading after a Nerve update, the button reads **Ask the agent to upgrade**.

**Ask the agent to fix** opens a new Forge conversation with a prompt that names the item and its problems. It isn't sent until you send it, and it states that you review approvals yourself. Items waiting for review also add a count beside their Settings page, and the project's start screen says how many project files need your review.

## Next steps

- [Build an extension](/guides/build-extensions/)
- [Connect MCP servers](/integrations/mcp/)
- [Skills and project resources](/guides/skills-and-resources/)
- [Settings at a glance](/guides/settings/)
