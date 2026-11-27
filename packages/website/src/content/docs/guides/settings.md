---
title: Settings at a glance
description: A tour of the Settings pages and where to find each control.
sidebar:
  order: 14
---

Open **Settings** from the title bar to find every preference in one place. This page is a map; files, environment variables, and flags are in [Configuration](/operations/configuration/).

## One surface, two layers

Settings is one page, opened from the title bar. When a project is open, the pages that can differ per project (**General**, **Tools**, **Skills**, **Extensions**, **MCP servers**) show a **User** column and a column named after the project. The User switch applies in every project; the project switch applies there only and can be shared through the repository. Setting a project switch back to the User value clears the override, and anything left unset follows your user settings. Lists are grouped Project, then User, then other sources such as Agent Browser and extensions, then Built-in. Built-in items can be switched at both levels; items a project defines have only the project switch.

Without an open project the page shows only the User column. Phones show a small subset; see [Phone and remote access](/operations/lan-mobile/#what-the-phone-shows).

<!-- screenshot: settings-layers -->

## Pages

| Group            | Pages                                                            | Use them to                                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent**        | General, Agents, Sub-agents, Permissions                         | Set defaults for new conversations, edit agent and teammate profiles, and define permission rules.                                                             |
| **Capabilities** | Tools, Skills, MCP servers, Extensions, Accounts                 | Turn tools and skills on or off, set up [MCP servers](/integrations/mcp/) and [extensions](/integrations/extensions/), and manage the accounts extensions use. |
| **AI**           | Providers, Models                                                | Sign in to model providers and limit the models in pickers. See [Providers](/models/providers-and-auth/).                                                      |
| **App**          | Appearance, Notifications, Shortcuts, Voice, Titles, Suggestions | Pick a theme, set desktop options, tune notifications and sounds, review shortcuts, set up voice input, enable AI titles, and manage prompt chips.             |
| **Access**       | Remote, Devices                                                  | Set up [private access and same-network access](/operations/lan-mobile/) and manage paired devices.                                                            |
| **System**       | Storage, Jobs, Advanced, About                                   | See what Nerve stores, check background work, change diagnostics and daemon options, and check the version.                                                    |

There are no separate Trust, Launch, or Instructions files pages. Review decisions are made on the page where an item is used (see [Items you review](#items-you-review)), launches are managed in the Launches panel, and project instructions are the repository's `AGENTS.md` files.

### Agent

- **General** holds defaults for new conversations: profile, permission level, model, thinking level, and compaction. Projects and conversations can override them.
- **Agents** edits lead profiles such as Coding and Planning, and your own. See [Choose a profile](/guides/agent-controls/).
- **Sub-agents** edits the teammate profiles the lead can delegate to. See [Sub-agents](/guides/agents-and-delegation/).
- **Permissions** manages rule sets and overlays; a project's rules apply once you trust them.

### Capabilities

- **Tools** lists the core tools: Bash (background-command behavior), Python, [Quick script](/guides/quick-script/), Web fetch, Sub-agents, and Plan review. Quick script is on by default and lists the namespaces that are usable. Web search, Jira, Confluence, diagrams, and image generation are set up in their extensions.
- **Skills** lists your, project, built-in, and Agent Browser skills. See [Skills and project resources](/guides/skills-and-resources/).
- **MCP servers** lists the servers in your `mcp.json` and the project's. **Add MCP server** offers a form or pasted JSON, and each server shows its tools after a connection test. See [MCP servers](/integrations/mcp/).
- **Extensions** lists the five built-in extensions (Web Search, Atlassian, Diagrams, Image generation, Image explanation) and the extensions you installed. Each row has User and project switches; open one to see a problem and its fix, add accounts, change its settings, see its **Features**, and review or revoke consent. The page re-reads extension folders when you open it, and **Reload** does so again. A project's extension file is ignored until you trust it. See [Extensions](/integrations/extensions/).

#### Accounts

**Accounts** lists every account that extensions use, whichever extension defines it, with one search box that matches an account's name, kind, platform, extension, level, and state (**Ready**, **Needs sign-in**, **Failed**, **Unavailable**). Add an account, sign in (a browser page or a device code, depending on the service), test it, move it between levels, duplicate it, clear its credentials, or delete it.

- **Level.** A **user** account is available in every project; a **project** account only in one. An account of an extension that lives in a project's repository always belongs to that project. Both are stored on your computer, never in the repository.
- **Duplicating** keeps the credentials. If the service rotates sign-in tokens, the first copy to refresh signs the other out, and Nerve says so before you duplicate a signed-in account.
- **Needs sign-in** appears when a sign-in expired or was revoked, when an extension asks for more permissions than you granted, or when the extension's sign-in code changed since you signed in. Choose **Sign in** on the row. An account whose extension is off or removed shows **Unavailable** and comes back when the extension does.

Extension pages keep only the choice of which account to use, and link here.

### AI

- **Providers** signs in to subscriptions, adds API keys, and defines custom providers and models. See [Providers](/models/providers-and-auth/).
- **Models** limits which models the composer offers. An empty list keeps every signed-in model available.

### App

- **Appearance** has the theme picker and desktop options. See [Themes and appearance](/guides/personalize/). Its **Desktop** section has the header style and **Close to system tray**. By default, closing the window quits Nerve and stops running launches and commands. Turn on the tray option to hide Nerve instead.
- **Notifications** has General and Sounds sections. See [Notifications and activity](/guides/notifications/).
- **Voice** picks the speech-to-text model and context hints. Voice input needs an OpenAI Codex sign-in.
- **Titles** turns on AI titles. Every new conversation gets an instant local title first; the AI title replaces it once in the background and never overrides a name you set.
- **Suggestions** manages [prompt suggestions](/guides/prompt-suggestions/).

### Access

- **Remote** turns on private access with Tailscale (**Anywhere, with Tailscale**) or access from the same network, and pairs devices. See [Phone and remote access](/operations/lan-mobile/).
- **Devices** lists paired phones and browsers, passkeys, and recent activity.

### System

- **Storage** shows what Nerve keeps on disk and runs cancellable cleanup. See [Back up, move, and upgrade data](/operations/storage-migration/).
- **Jobs** lists work Nerve does on its own while it runs. Today that is **Account credential refresh**, which renews sign-ins that are about to expire so they keep working in the background; it skips accounts you haven't used for 30 days. Each job shows its last run and next run, and **Run now** starts it at once. A job that keeps failing, or an account that needs sign-in, appears in the notification bell. Jobs run only while Nerve runs.
- **Advanced** covers network listener settings, diagnostics, resource limits, the daemon, desktop rendering, and daemon options. A control that a command-line flag or environment variable owns shows as locked. Some changes need a restart.
- **About** shows the version you run and whether a newer stable release exists, with the commands to run it, the Apache License 2.0, and links to the website, documentation, source code, releases and issue tracker. The title bar shows the version only as an **Update** button while a newer release exists; otherwise the version is in the daemon status popover.

## Items you review

Some configuration changes how agents behave, so Nerve uses it only after you trust its exact content. This covers your own settings as well as the project's: skills, agent and sub-agent profiles, permission rule sets and your permission overlay, `agent.json`, prompt suggestions, extensions, and MCP servers. Built-in items need no approval. You decide each item on the page where it is used, and every item is in one of three states:

- **Needs review**: new, or changed since you trusted it. Choose **Review** to open the review dialog, then **Trust** or **Decline**.
- **Trusted**: Nerve uses it. **Revoke** turns it off again.
- **Declined**: Nerve doesn't use it and stops asking, even if the file changes. Choose **Trust** when you change your mind.

All kinds open the same review dialog. **What it can do** lists the effect in plain words, broad items first and anything new since your last approval marked **New**. **Source** lists the files with an **Open** button. **Not now** leaves the item waiting, **Decline** and **Trust** decide it, and **Details** opens its page. See [Configure Nerve by chat](/guides/configure-by-chat/#the-review-dialog).

Items that need review show a count next to their page in the settings navigation, appear in the bell's **Needs your review** list and the marker at the top of each conversation, and the project's start screen mentions project items in one line. Items that fail to load appear under **Not working**, with an **Ask the agent to fix** button; see [Configure Nerve by chat](/guides/configure-by-chat/#the-attention-bell). Nerve never lets the agent approve an item for you.

When an `agent.json` needs review, General, Tools, Skills, and MCP servers show a notice with the same actions. Until you trust a project's `agent.json`, conversations ignore it and use your user settings; until you trust a changed user `agent.json` or permission file, Nerve keeps using the last version you trusted. Settings you change through Nerve stay trusted; a file edited elsewhere, by the agent, a script or `git pull`, needs reviewing again. Items that exist when you upgrade to this version are trusted as they are.

## Good to know

- UI changes are saved immediately. Manual edits to configuration files need a restart or an explicit Reload to take effect.
- If a configuration file is damaged, review the repair preview before confirming. Damaged files are backed up first.
- Default changes reach existing conversations at their next request; choices made in a conversation and profile requirements take priority.
- Don't put API keys or proxy credentials in shared configuration files.

## Related pages

- [Themes and appearance](/guides/personalize/)
- [Configure Nerve by chat](/guides/configure-by-chat/)
- [Extensions](/integrations/extensions/)
- [MCP servers](/integrations/mcp/)
- [Configuration](/operations/configuration/)
- [Diagnostics](/operations/diagnostics/)
- [Select models](/models/selecting-models/)
