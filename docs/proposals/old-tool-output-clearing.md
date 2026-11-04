# Old tool output clearing

> **Status:** Proposal. Follow-up to the size-based tool output projection (#520).

## Problem

An [agent projection](../architecture/tool-result-projection.md#agent-projection) stays in model context until compaction, so every inline byte is paid as a cache read on every later turn (median 54 turns before compaction in production). That cost caps inline budgets at about 12 KB for process output, while other harnesses show 30–50 KB in full because they clear or shorten old output:

- **Claude Code** replaces old results with `[Old tool result content cleared]` (microcompact).
- **Gemini CLI** masks older tool outputs once more than 30,000 tool tokens can be pruned, always protecting the newest 50,000 tool tokens.
- **opencode** shortens older tool output first when a request would exceed the context window.
- **Codex** truncates each output once when recorded, with no later pass.

## Proposal

After a configurable number of turns, or once older tool output passes a token threshold, replace older large tool results in the provider-visible history with a short stub that keeps the status line, the original size and the file path. The agent can re-read the file if it needs the content again.

Constraints:

- **Prompt cache.** Rewriting earlier messages invalidates the cached prefix. Clear in batches at infrequent boundaries, as Gemini CLI does by acting only above a prunable minimum. Do not clear on every turn.
- **Protect recent output.** Recent tool results stay intact, for example the newest N turns or tokens.
- **Durability.** Only the provider-visible history changes. The stored transcript, events and output files do not, so replay and the UI keep the full results.
- **No schema change.** Clearing is a context-assembly decision; it needs no new tables or columns.

## Validation

Measure with the persisted `agentProjectionSnapshot` on `tool_call_response` events: reduction rate, recovery calls after reduction, and context tokens per conversation. Once clearing exists, rerun the inline-budget cost model; process-output budgets of 24–32 KB are likely to become worthwhile.

## Open questions

- Trigger: turn count, token threshold, or both.
- Whether context-relative limits (lowering inline budgets as the context fills, as Gemini CLI does) belong in the same mechanism.
