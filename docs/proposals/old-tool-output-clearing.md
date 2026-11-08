# Old tool output clearing

> **Status:** Proposal. Follow-up to the size-based tool output projection (#520).

## Problem

An [agent projection](../architecture/tool-result-projection.md#agent-projection) stays in model context until compaction, so every inline byte is paid as a cache read on every later turn (median 54 turns before compaction in production). That cost caps inline budgets for process output near 12 KB, while other harnesses allow 30–50 KB because they clear or shorten old output later: Claude Code replaces old results with a placeholder, Gemini CLI masks older tool output past a prunable threshold while protecting the newest, and opencode shortens older output when the context window is at risk. Codex only truncates once at recording time.

## Proposal

After a configurable number of turns, or once older tool output passes a token threshold, replace older large tool results in the provider-visible history with a short stub that keeps the status line, the original size and the file path. The agent can re-read the file if it needs the content again.

Constraints:

- **Prompt cache.** Rewriting earlier messages invalidates the cached prefix, so clear in batches at infrequent boundaries (as Gemini CLI does by acting only above a prunable minimum), not every turn.
- **Protect recent output.** The newest N turns or tokens stay intact.
- **Durability.** Only the provider-visible history changes; the stored transcript, events and output files keep the full results.
- **No schema change.** Clearing is a context-assembly decision.

## Validation

Use the persisted `agentProjectionSnapshot` on `tool_call_response` events to measure reduction rate, recovery calls after reduction, and context tokens per conversation. Once clearing exists, rerun the inline-budget cost model; process-output budgets of 24–32 KB are likely to become worthwhile.

## Open questions

- Trigger: turn count, token threshold, or both.
- Whether context-relative limits (lowering inline budgets as the context fills) belong in the same mechanism.
