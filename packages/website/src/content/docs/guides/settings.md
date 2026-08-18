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

**Suggestions** manages reusable prompt chips and their trust settings. **Tools** has separate **Built-in** and **Integrations** sections. Built-in controls include tool enablement, background-task behavior, Python runtime settings, and image explanation. Integration cards appear only when the corresponding module is available and can manage enablement and credentials.

**Skills** lists discovered user and project resources and lets you enable or disable them without deleting their source files. Tool and skill changes apply to subsequent agent runs.

## Storage

**Storage** shows local usage and provides cancellable cleanup. Depending on the selected targets, cleanup can remove old conversations and logs, Explore reports, crash and Node reports, cache and temporary data, and rebuild the search index. Cleanup is asynchronous and reports progress; it does not replace a backup or change authoritative project files unexpectedly.

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
- [Storage and migration](/operations/storage-migration/)
- [Diagnostics](/operations/diagnostics/)
