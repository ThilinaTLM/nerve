---
title: Logs and diagnostics
description: Inspect workbench logs, daemon/desktop files, crash reports, and storage cleanup.
sidebar:
  order: 7
---

## Application logs

Nerve application logging is disabled by default. Developers can explicitly enable it for a launch by setting `NERVE_LOGGING_ENABLED=1`. When enabled, the Nerve Logs button and tab can filter, expand, copy, refresh, and prune application logs.

Desktop and daemon application logs are JSONL under `<NERVE_HOME>/logs`, including daily desktop files. Existing files are retained but are not read or appended while application logging is disabled.

Task tabs have separate streaming/backfilled terminal output and retention/truncation indicators. Task logs are not controlled by `NERVE_LOGGING_ENABLED`.

## Crash diagnostics

Crash and Node diagnostic reports are under `<NERVE_HOME>/crashes` and remain enabled independently of application logging.

The daemon writes structured reports for handled fatal errors, enables Node reports for runtime/native fatal conditions, and leaves a heartbeat marker. On the next start, an unclean prior exit can produce a fallback report.

There is no dedicated in-app crash-report list/download route. Inspect the directory directly and redact before sharing.

## Developer performance diagnostics

Unpackaged source desktop launches (`pnpm desktop`) automatically write content-free 10-second process, event-loop, and subsystem activity samples to `<NERVE_HOME>/logs/performance-<session-id>.jsonl`. Each desktop launch gets a separate timestamped file shared with its owned daemon; daemon restarts during that launch remain in the same file. When CPU becomes high, note the time and ask the coding agent to inspect the recent samples. No alternate profile, ports, or launch flags are required.

Packaged/released Nerve does not enable performance sampling automatically. Developers can set `NERVE_PERFORMANCE_DIAGNOSTICS=0` for a clean source-launch baseline. Samples remain local, contain no prompts or task output, and are never uploaded.

## Proxy diagnostics

Run with `NERVE_DEBUG_PROXY=1` for redacted proxy configuration diagnostics. Redaction reduces obvious credential exposure but does not make complete logs safe to publish.

## Collecting a report

Record Nerve version, operating system, launch command with tokens removed, relevant timestamps, current daemon mode, and the smallest log excerpt that shows the failure. Never include provider keys, OAuth codes, daemon tokens, private source, or token-bearing LAN URLs.

:::caution
Tool output, paths, command arguments, prompts, and crash state can reveal source or environment details. Review every artifact before attaching it to an issue.
:::

## Next steps

- [Troubleshooting index](/troubleshooting/)
- [Storage and cleanup](/operations/storage-migration/)
