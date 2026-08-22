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

## Resource containment

Managed commands always have wall-time, bounded-output, process-admission, and tree-termination controls. Linux desktop additionally runs the daemon in a delegated cgroup v2 scope and applies aggregate CPU, memory, and process/thread limits to each execution tree. Windows 11 uses Job Objects with equivalent job-level limits. macOS has no direct equivalent, so hard tree-wide CPU, memory, and process-count limits are reported unsupported.

Resource containment protects daemon availability; it is not a security sandbox. Commands still run as the same user and retain filesystem, network, credential, and same-user process access. On Linux, `NERVE_ALLOW_UNCONTAINED_PROCESSES=1` explicitly disables the default delegated-scope requirement for compatibility and should be used only when that weaker behavior is understood.

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
