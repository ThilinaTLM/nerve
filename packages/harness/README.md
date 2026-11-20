# `@nervekit/harness`

Reusable library for model access, messages, compaction, conversation trees and resources. The product's turn loop and tool-call lifecycle live in `@nervekit/conversation-core`; this package has no agent runtime.

## Layout

```text
src/
  index.ts, node.ts   package entrypoints (errors, results, paths; Node helpers)
  models/             model registry, streaming, resolution, image handling, shared model types
  messages/           message types, `AgentMessage`, conversion to LLM messages
  conversation/       conversation tree, context building, storage-neutral port
  compaction/         policy, preparation, usage estimates, results, serialization, file tracking, summaries
  resources/          skills, prompt templates and system-prompt formatting
  environment/        execution environment abstraction and Node adapter
```

## Where to make a change

- Provider registration and lookup: `src/models/model-registry.ts`
- Provider request defaults and dispatch: `src/models/model-streaming.ts`
- Model selection and catalog behavior: `src/models/resolution.ts`
- Shared model types (`AnyModel`, `ThinkingLevel`): `src/models/model-contracts.ts`
- Message shapes and LLM conversion: `src/messages/messages.ts`
- Persisted conversation behavior: `src/conversation/`
- Compaction decisions or summaries: `src/compaction/`
- Skills and prompt templates: `src/resources/`

## Public API

Subpaths: `.`, `./node`, `./models`, `./messages`, `./conversation`, `./compaction`, `./resources`.

```ts
import type { AnyModel, ThinkingLevel } from "@nervekit/harness/models";
import { Conversation } from "@nervekit/harness/conversation";
import { NodeExecutionEnv } from "@nervekit/harness/node";
```

Paths beneath `dist/` are internal and may change. Use direct internal imports rather than broad internal barrels.

## Development

```bash
pnpm --filter @nervekit/harness check
pnpm --filter @nervekit/harness test
pnpm --filter @nervekit/harness build
```
