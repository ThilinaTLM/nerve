# `@nervekit/harness`

Reusable model, agent-loop, and conversation harness runtime for Nerve.

## Architecture

The package has two orchestration levels:

- **`Agent`** is the low-level, stateful wrapper around the model/tool loop. It owns an in-memory transcript, emits loop events, and supports steering and follow-up queues.
- **`AgentHarness`** is the conversation-aware facade. It adds persisted conversation trees, lifecycle hooks, resources, configuration changes, compaction, and tree navigation.

```text
src/
  index.ts, node.ts              supported package entrypoints
  agent/                         low-level Agent, loop, tools, and contracts
  models/                        model registration, streaming, and resolution
  runtime/
    agent-harness.ts             high-level public facade
    configuration/               options, tools, turn snapshots, mutations
    lifecycle/                   event contracts, hooks, persistence processing
    queue/                       steering/follow-up queues and coalescing
    run/                         turn execution and continuation
    maintenance/                 compaction and conversation-tree navigation
    conversation/                conversation facade, storage-neutral port, and in-memory test adapter
    compaction/                  context usage, policy, and summarization
    resources/                   skills and prompt templates
    environment/                 execution environment abstraction and Node adapter
```

## Where to make a change

- Agent state or low-level queue behavior: `src/agent/agent.ts`
- Provider turn sequencing or tool execution: `src/agent/loop/`
- Shared agent contracts: `src/agent/types/`
- Provider registration and lookup: `src/models/model-registry.ts`
- Provider request defaults and dispatch: `src/models/model-streaming.ts`
- Model selection and catalog behavior: `src/models/resolution.ts`
- High-level harness API: `src/runtime/agent-harness.ts`
- Harness hooks and event persistence: `src/runtime/lifecycle/`
- Persisted conversation behavior: `src/runtime/conversation/`
- Compaction decisions or summaries: `src/runtime/compaction/`
- Skills and prompt templates: `src/runtime/resources/`

## Dependency direction

Entrypoints compose the package domains. Harness orchestration may depend on the low-level agent and model domains. The agent loop may use model streaming, but model and transport modules must not depend on harness orchestration. Conversation, compaction, and resource modules should remain focused on their own features.

Use direct internal imports rather than broad internal barrels. `src/index.ts` is the public API barrel; `src/agent/types/index.ts` is the narrow public aggregation point for agent contracts.

## Public API

Supported imports are limited to:

```ts
import { Agent, AgentHarness } from "@nervekit/harness";
import { NodeExecutionEnv } from "@nervekit/harness/node";
```

Paths beneath `dist/` are internal and may change.

## Development

```bash
pnpm --filter @nervekit/harness check
pnpm --filter @nervekit/harness test
pnpm --filter @nervekit/harness build
```
