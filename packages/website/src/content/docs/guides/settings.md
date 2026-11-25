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

| Group           | Pages                                                     | Use them to                                                                                                                                                                                                                     |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Connections** | Providers, Extensions, Accounts                           | Sign in to model providers, set up extensions, and manage the accounts they use, such as Tavily and Atlassian. See [Providers](/models/providers-and-auth/), [Extensions](/integrations/extensions/) and [Accounts](#accounts). |
| **Agent**       | General, Tools, Skills                                    | Set defaults for new conversations, turn tools on or off, and enable skills.                                                                                                                                                    |
| **Catalog**     | Agents, Sub-Agents, Permission rules, Models, Suggestions | Edit agent profiles, choose teammate profiles, define permission rules, limit the models in pickers, and manage prompt chips.                                                                                                   |
| **App**         | Workbench, Notifications, Shortcuts, Voice, Titles        | Pick a theme, set desktop options, tune notifications and sounds, review shortcuts, set up voice input, and enable AI titles.                                                                                                   |
| **System**      | Storage, Background jobs, Devices, System                 | See what Nerve stores, clean up space, check the work Nerve does in the background, manage devices, and change network, diagnostics, and daemon options.                                                                        |

### Workbench

- **Appearance** has the theme picker. See [Themes and appearance](/guides/personalize/).
- **Desktop** has the header style and **Close to system tray**. By default, closing the window quits Nerve and stops running launches and commands. Turn on the tray option to hide Nerve instead.

### Agent

- **General** holds defaults for new conversations: profile, permission level, model, thinking level, and compaction. Projects and conversations can override them.
- **Tools** lists the core tools: Bash (background-command behavior), Python, [Quick script](/guides/quick-script/), Web fetch, Sub-agents, and Plan review. Quick script is on by default and lists the namespaces that are usable. Web search, Jira, Confluence, diagrams, and image generation are set up in their extensions.
- **Skills** lists your, project, built-in, and Agent Browser skills. See [Skills and project resources](/guides/skills-and-resources/).
- **Extensions** lists the five built-in extensions (Web Search, Atlassian, Diagrams, Image generation, Image explanation). Each row shows how it is set up and has its own switch; open one to see a problem and its fix, manage its accounts, change its settings, and see its **Features**, the namespaces and tools it adds. Projects can override an extension; a project's extension file is ignored until you trust it. See [Extensions](/integrations/extensions/).

### Accounts

**Accounts** lists every account that extensions use, whichever extension defines it, with one search box that matches an account's name, kind, platform, extension, level, and state (**Ready**, **Needs sign-in**, **Failed**, **Unavailable**). Add an account, sign in (a browser page or a device code, depending on the service), test it, move it between levels, duplicate it, clear its credentials, or delete it.

- **Level.** A **user** account is available in every project; a **project** account only in one. An account of an extension that lives in a project's repository always belongs to that project. Both are stored on your computer, never in the repository.
- **Duplicating** keeps the credentials. If the service rotates sign-in tokens, the first copy to refresh signs the other out, and Nerve says so before you duplicate a signed-in account.
- **Needs sign-in** appears when a sign-in expired or was revoked, when an extension asks for more permissions than you granted, or when the extension's sign-in code changed since you signed in. Choose **Sign in** on the row. An account whose extension is off or removed shows **Unavailable** and comes back when the extension does.

Extension pages keep only the choice of which account to use, and link here.

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
- **Background jobs** lists work Nerve does on its own while it runs. Today that is **Account credential refresh**, which renews sign-ins that are about to expire so they keep working in the background; it skips accounts you haven't used for 30 days. Each job shows its last run and next run, and **Run now** starts it at once. A job that keeps failing, or an account that needs sign-in, appears in the notification bell. Jobs run only while Nerve runs.
- **System** covers network access, diagnostics, resource limits, the daemon, desktop rendering, and version details. A control that a command-line flag or environment variable owns shows as locked. Some changes need a restart.

## Project files you review

Some project files change how agents behave, so Nerve uses them only after you trust their exact content: the project's `.nerve/config/agent.json`, permission rules, agent and sub-agent profiles, skills, extensions, MCP servers, and suggestion scripts. You decide each one on the page where it is used, and every item is in one of three states:

- **Needs review**: new, or changed since you trusted it. Choose **Review and trust** or **Decline**.
- **Trusted**: Nerve uses it. **Revoke** turns it off again.
- **Declined**: Nerve doesn't use it and stops asking, even if the file changes. Choose **Review and trust** when you change your mind.

Items that need review show a count next to their page in the settings navigation, appear in the notification bell, and are mentioned in one line on the project's start screen.

When the project's `agent.json` needs review, General, Tools, Skills, and MCP servers show a notice with **Review and trust** and **Decline**. Until you trust it, conversations ignore the file and use your user settings. Settings you change through Nerve stay trusted; a file edited elsewhere needs reviewing again.

## Good to know

- UI changes are saved immediately. Manual edits to configuration files need a restart or an explicit Reload to take effect.
- If a configuration file is damaged, review the repair preview before confirming. Damaged files are backed up first.
- Default changes reach existing conversations at their next request; choices made in a conversation and profile requirements take priority.
- Don't put API keys or proxy credentials in shared configuration files.

## Related pages

- [Themes and appearance](/guides/personalize/)
- [Extensions](/integrations/extensions/)
- [Configuration](/operations/configuration/)
- [Diagnostics](/operations/diagnostics/)
- [Select models](/models/selecting-models/)
