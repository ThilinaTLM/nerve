---
title: Troubleshooting Nerve
description: Start with the symptom, collect safe diagnostics, and follow focused recovery steps.
sidebar:
  order: 1
---

Start with the narrowest symptom:

- Desktop will not install or Electron is missing → [Install and proxy](/troubleshooting/install-and-proxy/)
- Daemon will not connect, port is busy, token fails, or mobile certificate fails → [Connectivity](/troubleshooting/connectivity/)
- OAuth/API key fails, a model is absent, or voice is unavailable → [Providers](/troubleshooting/providers/)
- Linux copy/drag freezes or platform process behavior differs → [Platform](/troubleshooting/platform/)
- A server/watcher did not recover → [Tasks and recovery](/troubleshooting/tasks-and-recovery/)
- Startup reports incompatible state or migration did not bring history → [Storage and migration](/troubleshooting/storage-and-migration/)

## Collect safe context

Before changing state, note:

1. Nerve version and launch method;
2. OS/version and Node version;
3. local-owned, existing-local, or remote daemon mode;
4. exact timestamp and concise reproduction;
5. a redacted log excerpt from `<NERVE_HOME>/logs`.

Do not publish provider credentials, OAuth codes, daemon tokens, token-bearing LAN URLs, private project content, or unreviewed crash reports.

## Prefer recovery over deletion

Stop Nerve before manual storage changes. Copy or rename a complete `NERVE_HOME` instead of deleting individual state files. Unknown/future version errors are intentional protection against silent downgrade.

For suspected vulnerabilities, use the private [security reporting process](https://github.com/ThilinaTLM/nerve/blob/main/SECURITY.md), not a public issue.
