---
title: Use history, branches, and recovery
description: Navigate prior entries, edit prompts, compact context, retry, and continue failures.
sidebar:
  order: 7
---

## Navigate and branch

Open the history graph to inspect the conversation tree, minimap, entry details, and segments. Navigating to an earlier entry makes that lineage active. New work from there creates a branch while the rest of the stored tree remains available.

Optional navigation summarization is extractive: Nerve assembles a local branch summary from discarded messages and writes a `branch_summary` system entry. It does not call a model for that operation.

## Edit a prior prompt

Choose edit on a user entry. Nerve navigates to its parent, copies the old text into the composer, and focuses the editor. Review and send manually; editing never resubmits automatically.

## Context compaction

Automatic compaction defaults to a balanced profile: trigger near 80% context use and retain roughly 15%. Aggressive and conservative profiles use 70/10 and 90/25. A run can automatically continue after compaction up to three times.

Compaction summarizes earlier work. Important file-operation context is preserved where possible, but summaries are lossy; keep durable requirements in project resources or restate them.

## Retry and continue

Host retries are enabled by default for retryable failures: three retries with a 2-second exponential base delay, for four total attempts. Provider-library request retries are a separate layer and should not be assumed to share the same classification.

After daemon restart, active runs with valid checkpoints become interrupted and can be continued. Invalid checkpoints fail. Manual continuation verifies the run belongs to the agent and resumes from recoverable persisted state.

## Next steps

- [Task recovery](/troubleshooting/tasks-and-recovery/)
- [Conversation import/export](/guides/import-export-editors/)
