---
title: Review approvals, questions, and plans
description: Resolve human-in-the-loop decisions in the transcript.
sidebar:
  order: 5
---

Nerve places review gates beside the work that caused them. While one is pending, the normal composer is disabled so a new prompt cannot bypass the decision.

## Tool approvals

In supervised mode, non-read actions pause before execution. Review the tool name, arguments, risk, workspace target, and any preview. Approve only the request you understand. A denied or failed action remains visible in the transcript.

Supervised mode automatically allows safe reads. When Nerve can describe a bounded, risk-specific exception, **Always in project** saves it only for the current Nerve project; **Always globally** applies it to every project. Project exceptions live in Nerve's host-side project metadata under `~/.nerve/projects/<project-id>`, not in the agent-writable workspace. Python and destructive, secret, or deployment calls offer approval once only. Autonomous permission skips normal approval for allowed risks but still honors explicit blocks; Read only denies disallowed tools rather than offering an approval override.

## User questions

The question card accepts a free-text reply and provides common quick replies. It can also use the shared voice-input session. Dismiss when the question is no longer relevant.

## Plan review

A planning run writes a reviewed plan in Nerve plan storage and presents it in the transcript. Acceptance options can:

- implement in the same conversation;
- compact context, then implement;
- optionally open a new implementation conversation and choose its model.

Review file scope, validation, migration impact, and security assumptions before accepting. A plan is a proposal, not evidence that implementation is already complete.

## Transparency after resolution

Tool lifecycle states—requested, started, output, completed, or failed—remain in history. Replayed events are deduplicated after reconnect, and long outputs are bounded or stored as artifacts/transcripts rather than silently injected in full.

## Next steps

- [History and recovery](/guides/history-and-recovery/)
- [Tools and approval policy](/developers/tools-policy/)
