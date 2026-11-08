# Tool-result projection

Tool results can contain far more data than a model request or transcript card should carry. Core saves the received result for inspection and builds two smaller representations: one for the model and one for the user. Each reader gets a representation suited to its cost and purpose, while managed files provide a route back to fuller evidence.

```mermaid
flowchart TB
  Result[Result received by core] --> Prepare[Prepare result and register assets]
  Prepare --> Complete[Complete payload: managed result.json]
  Prepare --> Agent[Agent projection: durable response event]
  Prepare --> User[User projection: durable response event]
  Complete --> Details[On-demand details and file inspection]
  Agent --> Context[Subsequent model context]
  User --> Transfer[History and live event transfer]
  Transfer --> Transcript[Transcript cards]
```

## Three readers, three representations

A **projection** is a selected representation of a result, rather than a second execution of the tool. The agent projection protects model context, where oversized output can be paid for again on later requests. The user projection keeps transcript rendering small and predictable. The complete payload supports inspection without loading full results for every card.

“Complete” means the result received by core, independently of preview reduction. Execution may already have bounded capture or saved separate artifacts, so this payload cannot reconstruct bytes the tool never returned. Core also normalizes display data and replaces embedded image bytes with asset references before saving it.

## Agent projection

A tool policy first builds a **candidate**: the semantic content worth showing to the model. A **profile** supplies its inline and overflow budgets. A fitting candidate passes through unchanged; oversized candidates use a reduction strategy such as a head/tail excerpt or source continuation. “Unchanged” therefore refers to the candidate, which may already differ from raw output.

Each call has its own budget so parallel calls do not compete for a shared allowance. Text is measured by lines and UTF-8 bytes, with item accounting where applicable. Images are outside this text accounting.

Failures, denials, cancellations and interruptions take precedence over ordinary output so the model sees the outcome before bulk data. Their explanation does not imply rollback, because an interrupted operation may already have changed external state. Unknown tools and candidate-building failures use a conservative fallback so projection can still produce bounded context.

Reduction can retain references to validated artifacts or the complete payload, allowing further inspection instead of treating a summary as the only evidence. Process output notices use the same projection machinery so background completion and ordinary tool settlement share policy.

Budgets are sized against recovery cost: a preview the agent must immediately recover through a file read or re-run costs a whole extra turn, which outweighs the context it saved. Budgets are therefore decided mainly by size; line ceilings only guard against pathological many-short-line output. Per-tool budgets live in the profiles below.

- **Process output** (`bash`, `python_exec`, background notices) is shown in full below its inline budget; larger output gets a contiguous head/tail excerpt that favors the tail, where errors and exit context usually appear, plus a notice with the shown range, omitted size and capture file path. Content-based selection such as error keywords is deliberately absent because it matches ordinary file contents and successful logs.
- **`read` pages and log pages** are already bounded by their tools, and their profiles leave room above that bound so projection never cuts a page the tool bounded. `read` continuation stays exact through the `offset` notice.

Each result has one projection owner. Foreground `bash` and `python_exec` project while producing the result, using the same policy, so settlement leaves their output unchanged. The producer's snapshot is recorded only when the settlement pass changed nothing, so the snapshot describes the actual reduction.

| Concern                                     | Owner                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Candidate selection and terminal precedence | [`projectAgentResult`](../../packages/tools/src/result-projection/projector.ts)                                           |
| Budgets                                     | [`AGENT_RESULT_PROFILES`](../../packages/tools/src/result-projection/profiles.ts)                                         |
| Tool-specific policies                      | [`agentResultPolicyForTool`](../../packages/tools/src/result-projection/policies/index.ts) and neighboring policy modules |
| Reduction behavior                          | [`strategies.ts`](../../packages/tools/src/result-projection/strategies.ts)                                               |
| Process output, notices and log pages       | [`projectProcessOutputResult`](../../packages/tools/src/result-projection/process-output.ts) and `projectProcessText`     |

Sub-agent completion reports have a separate lifecycle cap; see [delegation](conversation-core/delegation.md). The sub-agent tool's own result still passes through tool-result projection because it enters model context as a tool response.

## User projection

The settled transcript preview contains bounded argument and result data plus overflow metadata. Tool-specific summaries, such as edit diffs, can differ from the agent's candidate because users are inspecting what happened rather than consuming model context. Live progress is separate from this settled preview.

Core builds the preview at settlement, and the app consumes it without loading the complete payload for every card. Preview limits belong to the shared builder so rendering components can rely on bounded input.

| Concern                      | Owner                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Argument and result previews | [`buildUserProjection`](../../packages/tools/src/result-projection/user-projection/tool-user-projection.ts)                                     |
| App transcript adaptation    | `toolRecord` in [`core-transcript.adapter.ts`](../../packages/workbench-app/src/lib/features/conversations/adapters/core-transcript.adapter.ts) |

## Persistence and transfer

Result preparation saves the complete payload, registers produced files, validates artifact claims and builds both projections. An **artifact** is a separately retained file. Claims must resolve to registered files from that tool call, because an arbitrary claimed path is insufficient evidence of ownership.

The payload lives at `conversations/<id>/tool-calls/<toolCallId>/result.json` under the managed data directory. Managed assets carry producer ownership and event linkage; event-linked assets cannot be overwritten through the asset store's write operation, preserving settled evidence.

The complete payload stores result text once, in `content`; duplicate process streams and repeated text blocks are dropped because the full text lives in the capture file. Process tools write a single `output.txt` in arrival order, so line numbers in notices and log pages match the file. Launches keep their own per-stream logs.

The durable response event holds the projections, the agent projection snapshot, call metadata and asset IDs. The **snapshot** ([`AgentProjectionSnapshot`](../../packages/contracts/src/domains/tools/tool-agent-projection.ts)) records profile, strategy, recovery kind and original versus displayed bytes and lines, so reduction and recovery can be measured from stored events rather than inferred from notice text. Older events have no snapshot. Ordinary event transfer omits the agent projection, keeping transcript delivery focused on the user preview. Opening details fetches the selected call's agent projection and complete payload on demand.

| Concern                                    | Owner                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Result preparation and artifact validation | [`prepareToolResult`](../../packages/conversation-core/src/tool-calls/tool-result.service.ts)                        |
| Managed paths, ownership and files         | [`AssetStore`](../../packages/conversation-core/src/assets/asset-store.ts)                                           |
| Event transfer filtering                   | [`transferConversationEvent`](../../packages/contracts/src/domains/core/event.ts)                                    |
| Protocol delivery and details operation    | [`createConversationProtocolSession`](../../packages/workbench-server/src/adapters/protocol/conversation-channel.ts) |
| Details retrieval                          | `ConversationCore.getToolCallDetails` in [`core.ts`](../../packages/conversation-core/src/core.ts)                   |

## Images and model context

Images returned in tool content become managed assets referenced by ID. They need not appear in both previews, because each projection chooses its own content. Model-context assembly resolves image references explicitly present in the agent projection; UI image requests use the asset HTTP route. Keeping bytes outside events avoids carrying binary payloads through transcript replay.

Image resolution is owned by [`loadProjectionOptions`](../../packages/conversation-core/src/context/asset-projection.ts). For how projections enter subsequent model requests, see [events and context](conversation-core/events-and-context.md).

An agent projection stays in model context until compaction; older tool output is never cleared or shortened. This is why inline budgets stay below those of harnesses that clear old output. See the [old tool output clearing proposal](../proposals/old-tool-output-clearing.md).
