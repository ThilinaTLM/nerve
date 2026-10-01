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
- **Agents → Defaults** sets the default mode, permission, model, thinking level, approval behavior, and whether new agents use the last selections.
- **Agents → Compaction** controls automatic conversation compaction, profile, trigger threshold, and retained recent context.
- **Agents → Explore agent** configures the separate model and thinking level used for read-only Explore work.

Model availability depends on authentication and provider metadata. Changes to defaults affect new agents; changes made during an active run apply to a later provider request where noted by the UI.

## Suggestions, tools, and skills

**Suggestions** manages reusable prompt chips and their trust settings. **Tools** has separate **Core** and **Third party** sections. Controls include tool enablement, background-task behavior, Python runtime settings, image explanation, image generation, and Async Subagents. Image generation settings choose the provider, model, and provider-specific output defaults; agents receive only a prompt argument. Async Subagent settings choose whether new developer teammates inherit the lead model, their thinking level, and their compaction profile. Integration cards appear only when the corresponding module is available and can manage enablement and credentials.

**Skills** lists user, project, Built-in Nerve, and Agent Browser resources. Built-in Nerve and Agent Browser skills are disabled by default; enabling one adds it to subsequent agent runs without modifying its source. User defaults can be refined by trusted project overrides.

### Diagram export (Kroki)

**Settings → Tools → Third party → Diagram export (Kroki)** configures `kroki_export`. It is disabled by default, including after upgrading an existing home. Configure the Kroki URL (default `https://kroki.io/`), then enable the tool separately. Local/self-hosted HTTP(S) servers and reverse-proxy path prefixes are supported; URL credentials, query parameters, and fragments are not.

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

**Storage** shows an ownership and retention breakdown of readable files under `NERVE_HOME` and provides cancellable cleanup. It distinguishes the authoritative database at `data/nerve.sqlite`, the rebuildable query cache at `cache/query-cache.sqlite`, and other disposable cache data. Depending on the selected targets, cleanup can remove old conversations and logs, Explore reports, crash and Node reports, non-query cache and temporary data, or rebuild the query cache from canonical records. Cleanup is asynchronous and reports progress; it never treats the canonical database, migrations, or backups as cleanup targets.

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
