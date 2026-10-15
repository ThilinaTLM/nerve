---
title: Review approvals, questions, and plans
description: Resolve human-in-the-loop decisions in the transcript.
sidebar:
  order: 5
---

Nerve places review gates beside the work that caused them. While one is pending, the normal composer is disabled so a new prompt cannot bypass the decision.

## Tool approvals

In supervised mode, non-read actions pause before execution. Review the tool name, arguments, risk, workspace target, and any preview. Approve only the request you understand. A denied or failed action remains visible in the transcript.

Supervised mode automatically allows safe reads. When Nerve can describe a bounded tool rule, **Always in project** saves it only for the current Nerve project; **Always for user** applies it to every project. User rules live in `<NERVE_HOME>/config/permissions.json`; project rules live in `.nerve/config/permissions.json`. Project allow rules require trust in the exact document content; external edits invalidate that trust. Review imported project rules before trusting them. Python and destructive, secret, or deployment calls offer approval once only. Autonomous permission skips normal approval for allowed risks but still honors explicit blocks; Read only denies disallowed tools rather than offering an approval override.

## User questions

The question card accepts a free-text reply and provides common quick replies. It can also use the shared voice-input session. Dismiss when the question is no longer relevant.

## Plan review

A planning run writes a reviewed plan in Nerve plan storage and presents it in the transcript. Acceptance options can:

- implement in the same conversation;
- compact context, then implement;
- optionally open a new implementation conversation and choose its model.

Review file scope, validation, migration impact, and security assumptions before accepting. A plan is a proposal, not evidence that implementation is already complete.

## Transparency after resolution

Tool arguments, decisions, results, and failures stay associated with the requesting work. Pending tool state is distinct from completed history; reconnect reconciles it with stored conversation events. Long output is bounded or stored as linked artifacts rather than silently injected in full.

## Next steps

- [History and recovery](/guides/history-and-recovery/)
- [Tools and approval policy](/developers/tools-policy/)
