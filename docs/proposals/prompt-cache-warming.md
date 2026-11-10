# Prompt cache warming

> **Status:** Proposal. Follow-up to the pi-ai 1.5.1 upgrade, which ships the warming policy as shared helpers.

## Problem

Provider prompt caches expire quickly. Anthropic's short retention is 5 minutes. When a conversation pauses longer than the TTL, the next request writes the whole prefix to the cache again. That costs the cache-write price (1.25× input on Anthropic), when a cache read would cost 0.1×. On a 150K-token Opus prefix, one miss costs well over a dollar.

Nerve produces long pauses inside active runs:

- a tool runs for a long time, such as a build, a test suite or a long `bash`;
- a parent waits on sub-agents (`execution_state` `waiting` with `childConversationId`);
- the run waits on a person: an approval or `ask_user` (`waiting` with `toolCallId`);
- the user reads the reply and answers a few minutes later.

## What pi-ai provides

`@earendil-works/pi-ai` ≥ 1.5.1 exports only the policy. The host owns the scheduling.

- `getPromptCacheTtlMs(model, options)` returns the cache lifetime from the model's `promptCache` tier and the request's `cacheRetention`.
- `getCacheWarmingDelayMs(ttl)` schedules the refresh at 90% of the TTL, with at least 10 s of margin.
- `isCacheWarmingReplayable(model, options)` is false for Anthropic budget-based thinking. There, `budget_tokens` derives from `max_tokens`, so a 1-token replay would change the cache key.
- `evaluateCacheWarming(model, promptTokens, phase)` returns `"warm"` when `p(continue) × missCost − warmCost ≥ $0.05`. `p` is 1 in the `streaming` phase and 0.15 in the `idle` phase.
- `getCacheWarmingRequestOptions(options, signal)` returns the request's own options with `maxTokens: 1`, `maxRetries: 0` and `disableContinuation: true`. The last flag keeps a refresh from replacing the conversation's Anthropic message thread.
- The constants `CACHE_WARMING_MAX_AGE_MS` (60 min, streaming) and `CACHE_WARMING_MAX_IDLE_AGE_MS` (30 min, idle).

## Proposal

A `CacheWarmer` in `conversation-core` keeps one entry per conversation. It is in memory only and is lost on restart, which is acceptable.

```mermaid
sequenceDiagram
  participant MT as ModelTurn
  participant CW as CacheWarmer
  participant P as Provider
  MT->>P: real request (sessionId = conversation id)
  P-->>MT: reply + usage
  MT->>CW: record(model, context, options, promptTokens)
  CW->>CW: ttl → delay; schedule timer
  Note over CW: timer fires at 0.9 × TTL
  CW->>CW: current phase → evaluateCacheWarming / max-age check
  alt warm
    CW->>P: replay with getCacheWarmingRequestOptions
    P-->>CW: usage (cache read + 1 output token)
    CW->>CW: persist cost, reschedule
  else stop
    CW->>CW: drop entry
  end
  MT->>CW: next real request → cancel timer, abort in-flight warm
```

- **Record after each successful real request** in `ModelTurn.runPrepared`: keep the exact `context` and stream options that were sent, plus `promptTokens = input + cacheRead + cacheWrite`. Skip errored or aborted replies, and any request where `isCacheWarmingReplayable` is false or `getPromptCacheTtlMs` is undefined.
- **Phase mapping**, re-read when the timer fires:
  - `streaming`: the execution is open and a tool or sub-agent is still working.
  - `idle`: the execution finished, or it waits on a person (`awaiting_approval`, `awaiting_input`). A person may not return before the TTL, so these waits use the idle continuation probability.
- **Cancellation**: start of a real request for the conversation (abort any in-flight warm first, so the two never overlap), conversation delete or pause, a change of model or credential, and daemon shutdown. Timers are `unref`'d.
- **Concurrency cap**: a small global limit on warms in flight, so a busy multi-agent tree does not send a burst of refreshes.
- **Never block or fail a run**: a warm failure only drops the entry, and it is logged at debug level.

### Cost accounting

The total shown for a conversation must include the refreshes. Today `ConversationEventRepository.getUsage` sums `usage.cost.total` over `assistant_message` events only.

1. **Recommended**: a new `cache_warm` conversation event type that carries `{ usage, provider, model }`. `getUsage` sums it with `assistant_message`. It is not added to the transcript, or is shown as one collapsed "Cache warmed: $x" line per idle period. No table or column change, only a contract addition and a query change.
2. Log only: no persisted cost. That is cheap, but the conversation's cost would be under-reported.
3. A counter column on `conversation`: a schema change, which AGENTS.md asks us to avoid.

### Setting

A home-level `cacheWarming: "off" | "streaming" | "idle"` in the home configuration.

## Validation

- Unit tests for the warmer with a fake clock and the faux provider: scheduling, phase re-evaluation, cancellation when a real request starts, the max-age stop, and that `disableContinuation` is set.
- Dogfood on Anthropic with a long sub-agent wait. Confirm that `cacheRead` replaces `cacheWrite` on the next real request, and that the persisted warm costs add up to the conversation total.

## Open questions

- Default mode: `streaming` is the safest win, because `p = 1` only while work continues. pi now defaults to `idle`.
- Subscription logins (Claude or ChatGPT OAuth): the dollar cost is notional, but refreshes use up plan rate limits. Should warming be off, or `streaming` only, for OAuth credentials?
- Whether `cache_warm` events appear in the transcript or only in the usage totals.
- Whether sub-agent conversations warm on their own, or only the conversation the user is looking at.
