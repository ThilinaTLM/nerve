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
  harness/
    agent-harness.ts             high-level public facade
    configuration/               options, tools, turn snapshots, mutations
    lifecycle/                   event contracts, hooks, persistence processing
    queue/                       steering/follow-up queues and coalescing
    run/                         turn execution, continuation, and mutable run state
    maintenance/                 conversation-tree maintenance
  conversation/                  conversation facade and storage-neutral port
  compaction/                    policy, serialization, file tracking, and summaries
  resources/                     skills and prompt templates
  environment/                   execution environment abstraction and Node adapter
```

## Where to make a change

- Agent state or low-level queue behavior: `src/agent/agent.ts`
- Provider turn sequencing or tool execution: `src/agent/loop/`
- Shared agent contracts: `src/agent/contracts/`
- Provider registration and lookup: `src/models/model-registry.ts`
- Provider request defaults and dispatch: `src/models/model-streaming.ts`
- Model selection and catalog behavior: `src/models/resolution.ts`
- High-level harness API: `src/harness/agent-harness.ts`
- Harness hooks and event persistence: `src/harness/lifecycle/`
- Persisted conversation behavior: `src/conversation/`
- Compaction decisions or summaries: `src/compaction/`
- Skills and prompt templates: `src/resources/`

## Dependency direction

Entrypoints compose the package domains. Harness orchestration may depend on the low-level agent and model domains. The agent loop may use model streaming, but model and transport modules must not depend on harness orchestration. Conversation, compaction, and resource modules should remain focused on their own features.

Use direct internal imports rather than broad internal barrels. `src/index.ts` is the public API barrel; `src/agent/contracts/index.ts` is the narrow public aggregation point for agent contracts.

## Public API

Supported imports are:

```ts
import { Agent, AgentHarness } from "@nervekit/harness";
import { NodeExecutionEnv } from "@nervekit/harness/node";
import type { AgentMessage } from "@nervekit/harness/agent";
import { Conversation } from "@nervekit/harness/conversation";
```

Paths beneath `dist/` are internal and may change.

## Development

```bash
pnpm --filter @nervekit/harness check
pnpm --filter @nervekit/harness test
pnpm --filter @nervekit/harness build
```
