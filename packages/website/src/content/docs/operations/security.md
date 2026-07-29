---
title: Security model
description: Understand local-first boundaries, tokens, permissions, credentials, and network risks.
sidebar:
  order: 6
---

Nerve is a powerful local coding harness, not a sandbox. It can read and write source, execute local processes, use configured credentials, and contact providers or integrations.

## Default boundary

The desktop-owned daemon binds to loopback by default and requires a local token for API and WebSocket access. Electron uses context isolation, disables Node integration, enables renderer sandboxing, and restricts navigation to the selected daemon origin or safe external HTTP(S) handling.

Application data travels directly between the renderer and daemon over HTTP/Nerve Protocol, not through broad Electron IPC.

## Permission policy

Read-only, supervised, and autonomous levels govern agent tool dispatch. Planning adds its own restrictions. These reduce authority and create review points; they do not isolate commands or Python from the operating system.

Direct user-initiated Git/PR/editor actions have their own UI confirmations and are not agent tool approvals.

## Credentials and external data

Provider, Tavily, Atlassian, and other secrets use encrypted storage where implemented. At execution time, the selected service or child process necessarily receives credentials. Logs, artifacts, prompts, imported project instructions, and external tool output can still expose sensitive information.

Network-capable paths include model calls, OAuth, Git remotes, web tools, Jira/Confluence, voice transcription, and commands/Python. Local-first is not offline-only.

## Remote access

Non-loopback binding requires explicit opt-in. Share URLs contain a password-like token. Self-signed mobile HTTPS protects transport on a trusted LAN but is not an Internet-exposure solution.

## Project trust

`AGENTS.md`, `SYSTEM.md`, skills, prompt-suggestion JavaScript, and other repository content can influence behavior. Review unfamiliar projects before enabling executable predicates or broad permissions.

:::danger[Beta]
Use recoverable Git workspaces, least authority, and trusted networks. Report vulnerabilities privately through the repository [security policy](https://github.com/ThilinaTLM/nerve/blob/main/SECURITY.md).
:::

## Next steps

- [Agent controls](/guides/agent-controls/)
- [LAN/mobile access](/operations/lan-mobile/)
- [Persistence and security architecture](/developers/persistence-security/)
