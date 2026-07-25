# Tool output lifecycle

Tool output crosses several boundaries with different responsibilities. A limit at one boundary must not be reused as a substitute for another.

## Invariants

1. **Source truth is complete.** Task logs and process-result artifacts preserve full stdout/stderr. Live state and model context are projections, never recovery sources.
2. **Live transport is lossless and framed.** Process bytes are decoded with a streaming UTF-8 decoder and partitioned into bounded events. Concatenating deltas reproduces the decoded stream exactly.
3. **Live state is a rolling tail.** Server and UI retain the same character-count and chunk-count tail and expose omission metadata. Character offsets are protocol semantics; event framing uses UTF-8 bytes.
4. **Model context is independently bounded.** Execution previews, stored tool results, model projections, and transcript previews keep their purpose-specific byte/line budgets and recovery routes.
5. **Projection failures do not change process truth.** Live event or observer failures are diagnosed at an explicit async boundary and cannot orphan a supervised task.
6. **Validation remains strict.** Producers frame payloads before publication; public-event validation remains a final defense and is never bypassed.

## Ownership

| Boundary                 | Owner                                            | Behavior                                                          |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------------------------- |
| Process bytes            | `@nervekit/tools` / host process adapter         | Streaming UTF-8 decode; preserve raw buffers/files                |
| Live event framing       | `splitLiveOutputChunks`                          | Lossless chunks within `LIVE_TOOL_OUTPUT_EVENT_MAX_BYTES`         |
| Task output              | `TaskService`                                    | Durable append first, then bounded ephemeral events and observers |
| Conversation live output | `LiveToolOutputPublisher`                        | Ordered publication, contiguous offsets, bounded diagnostics      |
| Rolling live projection  | contracts `ConversationRuntime` and workbench UI | Shared 32,000-character / 400-chunk tail                          |
| Final execution result   | process-result builders                          | Inline head/tail preview plus full-output artifact when required  |
| Storage/model projection | workbench tool-result bounds                     | Separate storage and model budgets with `outputLimits` metadata   |
| Agent transcript preview | tool-call transcript preview                     | Small tool-specific summary; never the full-output store          |

## Async publication

Lifecycle/domain events use strict `await events.publish(...)`. Intentionally lossy notifications from synchronous callbacks use `publishBestEffort(...)`, which catches synchronous validation errors and asynchronous persistence errors and reports them through diagnostics. Bare `void events.publish(...)` is not allowed.

New streamed tools and provider integrations must route live text through the canonical UTF-8 chunker and the workbench live-output publisher. Detached promises must terminate in an explicit diagnostic boundary; the daemon-wide unhandled-rejection policy remains fail-fast for genuine programming errors.
