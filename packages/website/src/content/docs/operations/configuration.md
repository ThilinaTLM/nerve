---
title: Configuration and ports
description: "Where Nerve reads settings from: the config file, environment variables, and desktop flags, and which changes need a restart."
sidebar:
  order: 4
---

This page covers the files, environment variables, and flags that configure Nerve. For a tour of the Settings pages, see [Settings at a glance](/guides/settings/).

Program-level configuration has one resolution order:

1. command-line option;
2. environment variable;
3. saved value in `<NERVE_HOME>/config.json`;
4. product default.

The effective value and its source are visible under **Settings → System**. A control is disabled when an environment variable or command-line option owns it; unset that override and restart before editing it in the UI. An explicit boolean `0` or `false` overrides a saved `true` just as `1` or `true` overrides `false`.

Defaults are `NERVE_HOME=~/.nerve`, host `127.0.0.1`, HTTP port `3747`, remote access off, and mobile HTTPS port `3748`.

## Saved settings

**Settings → System** and **Settings → Workbench → Desktop** save to `<NERVE_HOME>/config.json`. They cover:

- bind host, HTTP/HTTPS ports, remote access, and mobile HTTPS;
- application logging and performance diagnostics;
- log policy, owned-daemon startup timeout, and heap cap;
- automatic or manually overridden model, tool-batch, and process concurrency;
- Linux Electron Ozone platform and font rendering;
- whether closing the window hides Nerve in the tray (**Close to system tray**) instead of quitting, which is the default.

Enabling **Allow remote connections** also changes a loopback bind host to `0.0.0.0`, so the next daemon launch can accept LAN clients. Disabling it restores `127.0.0.1` when the host is a wildcard. You can still enter a specific interface address in the advanced host field.

Resource concurrency defaults to automatic. At daemon startup, Nerve uses effective CPU capacity and total memory to choose separate limits; normal developer machines with at least 12 GiB RAM admit ten primary model runs, while tool batches, and subprocesses retain independent safety limits. The System page shows detected, recommended, and effective values. GPU capacity is intentionally not treated as generic concurrency because local-model memory requirements are model-specific.

The page distinguishes active and saved values. Network, diagnostics enablement, heap, and resource-limit changes need a daemon restart. Timeout and Electron rendering changes need the desktop app to restart. The page can restart an owned local daemon; browser clients and remote or adopted daemons show manual guidance instead.

## Extension settings and accounts

[Extensions](/integrations/extensions/) keep their configuration apart from agent preferences:

| File                                      | Holds                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `<NERVE_HOME>/config/extensions.json`     | Your extension switches and settings                                  |
| `<project>/.nerve/config/extensions.json` | Project overrides; ignored until you trust the file's exact content   |
| `<NERVE_HOME>/config/accounts.json`       | Accounts by kind (Atlassian, Tavily) without secrets; user scope only |
| `<NERVE_HOME>/secrets`                    | Encrypted API tokens and keys, one per account                        |

Settings choose an account by ID, and each field resolves from the extension's default, then your settings, then the project's, then an applied [profile](/reference/agent-profiles/). Edits in **Settings → Extensions** are trusted automatically; a project file edited elsewhere needs **Trust file** again. Upgrading to 0.41 moves integration accounts and tool options out of `agent.json` into these files and rewrites permission rules that named the removed Jira, Confluence, diagram, and image-generation tools to Quick script operation rules.

## Project trust

Project files that can widen what the agent does or runs apply only after you trust their exact content: `agent.json`, `permissions.json`, `extensions.json`, agent profiles, and prompt-suggestion scripts. Project **General**, **Tools**, and **Skills** settings show **Project agent settings are not trusted** with a **Trust file** button when `agent.json` hasn't been trusted; until then conversations use your user settings. Files Nerve writes are trusted for you, edits made elsewhere need a new review, and **Revoke trust** withdraws it. Trust state lives in `<NERVE_HOME>/data/nerve.sqlite`.

## Desktop flags

```text
--local
--connect <http(s) URL>
--pair-code <CODE>
--token <token>   (deprecated)
--host <host>
--port <1-65535>
--https-port <1-65535>
--allow-remote
--mobile-https
```

Remote URL and pairing code select monitor-only mode (see [Remote daemon](/operations/remote-daemon/)). Local bind flags configure an owned daemon and lock the corresponding Settings controls for that launch.

## Environment

Common overrides include:

- `NERVE_HOME`
- `NERVE_HOST`, `NERVE_PORT`, `NERVE_HTTPS_PORT`
- `NERVE_ALLOW_REMOTE`, `NERVE_MOBILE_HTTPS`
- `NERVE_PUBLIC_URL`, `NERVE_TRUST_PROXY_PEERS`, `NERVE_ALLOWED_HOSTS` (see [Hosted server](/operations/hosted-server/))
- `NERVE_LOGGING_ENABLED`, `NERVE_PERFORMANCE_DIAGNOSTICS`
- `NERVE_DAEMON_STARTUP_TIMEOUT_MS`, `NERVE_DAEMON_MAX_OLD_SPACE_MB`
- `NERVE_MAX_CONCURRENT_MODEL_RUNS`, `NERVE_MAX_PARALLEL_TOOLS_PER_RUN`
- `NERVE_MAX_ACTIVE_PROCESSES`

Owned daemons use a 4096 MB old-space limit by default. Legacy saved values or environment overrides below the supported 512 MB minimum are raised to 512 MB before launch.

- `NERVE_ELECTRON_OZONE_PLATFORM`, `NERVE_ELECTRON_FONT_RENDER_HINTING`
- `NERVE_ELECTRON_REMOTE_DEBUGGING_PORT` (desktop only; opens the Chrome DevTools Protocol on `127.0.0.1` for automation)

`NERVE_HOME`, remote tokens, generated performance session IDs, web asset/build routing, and proxy/toolchain variables are launch context rather than saved UI preferences. Secret values are never returned in the configuration snapshot.

See the [complete CLI/environment reference](/reference/cli-environment/).
