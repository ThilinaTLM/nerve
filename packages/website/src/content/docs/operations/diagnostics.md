---
title: Logs and diagnostics
description: Inspect workbench logs, daemon/desktop files, crash reports, and storage cleanup.
sidebar:
  order: 7
---

## In the workbench

The Nerve Logs tab can filter, expand, copy, refresh, and prune application logs. Task tabs have their own streaming/backfilled terminal output and retention/truncation indicators.

## Files

Desktop and daemon logs are JSONL under `<NERVE_HOME>/logs`, including daily desktop files. Crash and Node diagnostic reports are under `<NERVE_HOME>/crashes`.

The daemon writes structured reports for handled fatal errors, enables Node reports for runtime/native fatal conditions, and leaves a heartbeat marker. On the next start, an unclean prior exit can produce a fallback report.

There is no dedicated in-app crash-report list/download route. Inspect the directory directly and redact before sharing.

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
