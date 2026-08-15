---
title: CLI and environment reference
description: Desktop and daemon flags, environment variables, defaults, and precedence.
sidebar:
  order: 1
---

## Desktop CLI

| Option                   | Meaning                                        |
| ------------------------ | ---------------------------------------------- |
| `--local`                | Run/select an owned local daemon; default mode |
| `--connect <url>`        | Connect to an existing HTTP(S) daemon origin   |
| `--token <token>`        | Remote daemon token                            |
| `--host <host>`          | Owned-daemon bind host                         |
| `--port <1-65535>`       | Owned-daemon HTTP port                         |
| `--https-port <1-65535>` | Mobile HTTPS port                              |
| `--allow-remote`         | Permit non-loopback binding                    |
| `--mobile-https`         | Generate/use local-CA HTTPS setup              |
| `--help`, `-h`           | Launcher help                                  |
| `--version`, `-v`        | Package version                                |

Pass app options after `--` when using `npx` or `pnpm dlx`.

## Nerve environment

| Variable                             | Purpose / default                                                          |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `NERVE_HOME`                         | Portable state root; `~/.nerve`                                            |
| `NERVE_HOST`                         | Daemon bind host; `127.0.0.1`                                              |
| `NERVE_PORT`                         | HTTP port; normal default 3747                                             |
| `NERVE_HTTPS_PORT`                   | Mobile HTTPS port; source desktop default 3748, server fallback HTTP+1     |
| `NERVE_ALLOW_REMOTE=1\|0`            | Enable/disable LAN access; enable implies wildcard host when none supplied |
| `NERVE_MOBILE_HTTPS=1\|0`            | Enable/disable mobile HTTPS                                                |
| `NERVE_DAEMON_TOKEN`                 | Token for `--connect`; secret                                              |
| `NERVE_WEB_DIST`                     | Override built Workbench asset directory                                   |
| `NERVE_DAEMON_STARTUP_TIMEOUT_MS`    | Owned readiness timeout; 60000                                             |
| `NERVE_DAEMON_MAX_OLD_SPACE_MB`      | Owned Node heap cap; 4096                                                  |
| `NERVE_API_TARGET`                   | Vite UI development daemon target                                          |
| `NERVE_LOGGING_ENABLED=1\|0`         | Enable/disable persistent application logs                                 |
| `NERVE_PERFORMANCE_DIAGNOSTICS=1\|0` | Enable/disable local performance sampling                                  |
| `NERVE_ELECTRON_OZONE_PLATFORM`      | Linux: `x11`, `wayland`, `auto`                                            |
| `NERVE_ELECTRON_FONT_RENDER_HINTING` | Linux: `system`, `none`, `slight`, `medium`, `full`; default slight        |
| `NERVE_DEBUG_PROXY=1`                | Redacted startup proxy diagnostics                                         |

Standard `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`, `ELECTRON_GET_USE_PROXY`, and `ELECTRON_MIRROR` apply to proxy/download scenarios.

Managed application settings resolve CLI → environment → saved settings → defaults. Explicit boolean `0`/`false` values are overrides. Settings shows the effective source and locks CLI/environment-controlled fields. `--allow-remote` or `NERVE_ALLOW_REMOTE=1` implies `0.0.0.0` when no host was supplied. Never place tokens or proxy credentials in committed config/examples.
