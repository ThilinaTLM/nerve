---
title: Configure Settings
description: Manage Workbench behavior, models, agents, tools, storage, and system controls.
sidebar:
  order: 14
---

Open **Settings** from the title bar. Settings is organized into focused areas and saves changes through the application state. Some controls are supplied by the daemon or launch environment; those controls show their effective source and can be locked when a CLI flag or environment variable takes precedence.

## Workbench, notifications, and transcription

**Workbench** contains Appearance and Desktop options, including theme and desktop-specific behavior. **Notifications** separates general notification delivery from sounds. **Shortcuts** shows the current fixed keyboard bindings; bindings are not currently remappable.

**Transcription** configures the speech-to-text model and context used by voice input. Voice transcription still requires an OpenAI Codex OAuth subscription connection. The default `gpt-4o-transcribe` model preserves the existing behavior; `gpt-transcribe` and `gpt-4o-mini-transcribe` are also selectable. Nerve sends expected languages and custom vocabulary as structured hints for `gpt-transcribe`, and as prompt context for the GPT-4o transcription models.

Nerve accesses transcription through ChatGPT's subscription endpoint rather than the public OpenAI Audio API. That endpoint is undocumented, so model availability can depend on the connected account. Vocabulary is advisory and may bias a transcript; include only relevant names, acronyms, and preferred spellings.

## Models and agents

- **Scoped Models** controls the models shown in conversation pickers. An empty scope keeps all authenticated models available.
- **Agents → Defaults** sets the default agent profile, permission, model, thinking level, approval behavior, and whether new agents use the last model/thinking/permission selections. The default lead profile (`defaultAgentProfile`) is editable at user and project scope; last selections do not override it.
- **Agents → Compaction** controls automatic conversation compaction, profile, and trigger threshold. Every profile retains about 10,000 recent tokens.

Model availability depends on authentication and provider metadata. Changes to defaults affect new agents; changes made during an active run apply to a later provider request where noted by the UI.

## Suggestions, tools, and skills

**Suggestions** manages reusable prompt chips and their trust settings. **Tools** has separate **Core** and **Third party** sections. Controls include tool enablement, Bash auto-promotion and background-command behavior, Python runtime settings, image explanation, and image generation. Image generation settings choose the provider, model, and provider-specific output defaults; agents receive only a prompt argument. **Agent profiles** manages profiles, usability, and Inherit/Set/Lock settings in user and project scope (see the [profile format](/reference/agent-profiles/)). Profiles are grouped by where they were created: your own or the project's, then those inherited from User and Built-in. Each row has an on/off switch, and **Customized here** marks profiles this scope changes. Open a profile to edit its model, thinking level, permission, tools, skills, instructions, and compaction. Each field shows where its value comes from (**From Built-in**, **Changed here · Revert**), and **Where values come from** compares inherited, local, and resulting values. Built-in profiles can be customized and turned off, but not deleted; **Reset customizations** removes a scope's changes, and **Delete profile** removes profiles created in that scope. Project edits write `.nerve/config/agent-profiles.json`, which must be reviewed and trusted before its instructions and permissions apply. Integration cards appear only when the corresponding module is available and can manage enablement and credentials.

**Skills** lists user, project, Built-in Nerve, and Agent Browser resources. Built-in Nerve and Agent Browser skills are disabled by default; enabling one adds it to subsequent agent runs without modifying its source. User defaults can be refined by trusted project overrides.

### Diagram export

**Settings → Tools → Third party → Diagram export** configures `kroki_export`, which renders diagrams through a Kroki server. It is disabled by default, including after upgrading an existing home. Configure the Kroki URL (default `https://kroki.io/`), then enable the tool separately. The summary row marks the public `kroki.io` service with a warning while the tool is enabled, because diagram source leaves your machine. Local/self-hosted HTTP(S) servers and reverse-proxy path prefixes are supported; URL credentials, query parameters, and fragments are not. The agent reads diagram source from a file (`source_path`, preferred) or inline, and writes to a chosen `output_path` or to a managed tool-call artifact; both paths are subject to the active permission rules.

```json
{
  "diagram_type": "mermaid",
  "source": "graph TD; A-->B",
  "output_format": "svg"
}
```

SVG is the default; PNG is also supported. Available engines and formats depend on your Kroki deployment. Exports are retained under the tool call’s managed artifact directory and linked from its normal transcript card. Click the path to preview the image in a file tab; saving into the project is a separate filesystem action. PDF, renderer options, custom authentication, and dedicated browser downloads are not currently supported. Diagram source is limited to 128 KiB, output to 5 MiB, and requests to 60 seconds.

**Privacy:** diagram source is sent to the configured server when the tool runs. Use a trusted self-hosted instance for private diagrams, with updated Kroki and secure renderer safe modes. Nerve does not contact Kroki while configuring the URL or while the tool is disabled, and it does not follow redirects when exporting. Project capability overrides can refine enablement; the execution endpoint remains the user-configured URL.

## Storage

**Storage** shows an ownership and retention breakdown of readable files under `NERVE_HOME` and provides cancellable cleanup. The authoritative database is `data/nerve.sqlite`; cache and temporary files are separate disposable data. Depending on the selected targets, cleanup can remove old inactive conversations, dated and rotated logs, crash and Node reports, cache, and temporary data. Cleanup is asynchronous and reports progress; it never treats the canonical database, migrations, or backups as disposable cache targets. The current runtime does not use a separate query-cache database or offer a query-cache rebuild.

## System

**System** groups:

- **Network** — remote connections, bind host, daemon ports, and Mobile HTTPS.
- **Diagnostics** — application logging, performance sampling, log level, retention, and buffered records.
- **Daemon** — server lifecycle and capability-related controls.
- **Desktop rendering** — desktop rendering behavior.
- **Launch context** — information about how the application was started.
- **System information** — versions and runtime details.

Network, daemon, and diagnostic changes may require a restart. CLI and environment settings take precedence over saved Settings values, and Nerve marks those effective values as locked. Do not put API keys or proxy credentials in shared configuration files.

## Related pages

- [Personalize Nerve](/guides/personalize/)
- [Select models](/models/selecting-models/)
- [Configure agent controls](/guides/agent-controls/)
- [Manage skills and resources](/guides/skills-and-resources/)
- [Work with agents and delegation](/guides/agents-and-delegation/)
- [Storage and migration](/operations/storage-migration/)
- [Diagnostics](/operations/diagnostics/)
