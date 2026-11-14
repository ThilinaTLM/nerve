---
title: Settings at a glance
description: A tour of the Settings pages and where to find each control.
sidebar:
  order: 14
---

Open **Settings** from the title bar to find every preference in one place. This page is a map; files, environment variables, and flags are in [Configuration](/operations/configuration/).

## User and project scope

Settings has two scopes. **User** settings apply everywhere. **Project** settings apply to the current project and override your user settings; they can be shared with everyone who opens the repository. Anything left unset in a project follows your user settings.

## User pages

| Group           | Pages                                                     | Use them to                                                                                                                                       |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Connections** | Providers, Extensions                                     | Sign in to model providers, and set up extensions and their accounts, such as Tavily and Atlassian. See [Providers](/models/providers-and-auth/). |
| **Agent**       | General, Tools, Skills                                    | Set defaults for new conversations, turn tools on or off, and enable skills.                                                                      |
| **Catalog**     | Agents, Sub-Agents, Permission rules, Models, Suggestions | Edit agent profiles, choose teammate profiles, define permission rules, limit the models in pickers, and manage prompt chips.                     |
| **App**         | Workbench, Notifications, Shortcuts, Voice, Titles        | Pick a theme, set desktop options, tune notifications and sounds, review shortcuts, set up voice input, and enable AI titles.                     |
| **System**      | Storage, System                                           | See what Nerve stores, clean up space, and change network, diagnostics, and daemon options.                                                       |

### Workbench

- **Appearance** has the theme picker. See [Themes and appearance](/guides/personalize/).
- **Desktop** has the header style and **Close to system tray**. By default, closing the window quits Nerve and stops running launches and commands. Turn on the tray option to hide Nerve instead.

### Agent

- **General** holds defaults for new conversations: profile, permission level, model, thinking level, and compaction. Projects and conversations can override them.
- **Tools** lists core and third-party tools. Controls include enablement, background-command behavior, Python, and image explanation. Web search follows the Web extension. Jira, Confluence, diagrams and image generation are reached through Quick script and configured in their extensions.
- **Skills** lists your, project, built-in, and Agent Browser skills. See [Skills and project resources](/guides/skills-and-resources/).
- **Extensions** lists the built-in extensions (Atlassian, Web, Image generation, Diagrams). Each row shows how it is set up and has its own switch; open one to change its settings, manage its accounts, and see what it adds to `quick_script`. Projects can override an extension; a project's extension file is ignored until you trust it.

### Catalog

- **Agents** edits lead profiles such as Coding and Planning, and your own. See [Choose a profile](/guides/agent-controls/).
- **Sub-Agents** edits the teammate profiles the lead can delegate to. See [Sub-agents](/guides/agents-and-delegation/).
- **Models** limits which models the composer offers. An empty list keeps every signed-in model available.
- **Suggestions** manages [prompt suggestions](/guides/prompt-suggestions/).

### Notifications, voice, and titles

- **Notifications** has General and Sounds sections. See [Notifications and activity](/guides/notifications/).
- **Voice** picks the speech-to-text model and context hints. Voice input needs an OpenAI Codex sign-in.
- **Titles** turns on AI titles. Every new conversation gets an instant local title first; the AI title replaces it once in the background and never overrides a name you set.

### Storage and System

- **Storage** shows what Nerve keeps on disk and runs cancellable cleanup. See [Back up, move, and upgrade data](/operations/storage-migration/).
- **System** covers network access, diagnostics, resource limits, the daemon, desktop rendering, and version details. A control that a command-line flag or environment variable owns shows as locked. Some changes need a restart.

## Project pages

Besides the agent and catalog pages above, a project has:

- **Launch** for the project's launch definitions.
- **Instructions files** for `AGENTS.md` files and extra system prompt text.
- **Trust** for project files Nerve reads only after you review them, such as profile files and suggestion scripts.

## Diagram rendering

**Settings → Extensions → Diagrams** sets the Kroki server the agent renders diagrams with (default `https://kroki.io/`). The extension is on by default; the agent uses it through Quick script.

Diagram source is sent to the configured server when a script renders a diagram. Use a trusted self-hosted server for private diagrams. Diagrams render to PNG and appear in the tool call's artifact list.

## Good to know

- UI changes are saved immediately. Manual edits to configuration files need a restart or an explicit Reload to take effect.
- If a configuration file is damaged, review the repair preview before confirming. Damaged files are backed up first.
- Default changes reach existing conversations at their next request; choices made in a conversation and profile requirements take priority.
- Don't put API keys or proxy credentials in shared configuration files.

## Related pages

- [Themes and appearance](/guides/personalize/)
- [Configuration](/operations/configuration/)
- [Diagnostics](/operations/diagnostics/)
- [Select models](/models/selecting-models/)
