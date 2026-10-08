import {
  agentCompletionSchema,
  parentConfigurationSnapshotSchema,
  type AgentCompletion,
  type ParentConfigurationSnapshot,
  agentContextBindingSchema,
  agentContextPrefixMigrationSchema,
  agentInputQueueStateSchema,
  agentInputPreparationSchema,
  type AgentInputPreparation,
  type AgentContextBinding,
  type AgentContextPrefixMigration,
  type AgentInputQueueState,
} from "@nervekit/contracts/agents";
import { createJsonPayloadCodec, type PayloadCodec } from "./codec.js";

/** Narrow v1 canonical authorities, not journal-derived runtime projections.
 * Keep the owning persisted schemas: acceptance defaults must not repair corrupt
 * queues, and model-entry bodies in a frozen prefix are opaque JSON envelopes.
 * The common codec preserves unknown compatibility fields on schema projections.
 */
export const agentRuntimeDocumentCodecs: Readonly<{
  "agent-run-completion": PayloadCodec<AgentCompletion>;
  "agent-delegation-input": PayloadCodec<ParentConfigurationSnapshot>;
  "agent-context-binding": PayloadCodec<AgentContextBinding>;
  "agent-context-prefix-migration": PayloadCodec<AgentContextPrefixMigration>;
  agent_inputs: PayloadCodec<AgentInputQueueState>;
  agent_input_preparation: PayloadCodec<AgentInputPreparation>;
}> = {
  "agent-run-completion": createJsonPayloadCodec({
    currentVersion: 1,
    read: (value) => agentCompletionSchema.parse(value),
  }),
  "agent-delegation-input": createJsonPayloadCodec({
    currentVersion: 1,
    read: (value) => parentConfigurationSnapshotSchema.parse(value),
  }),
  "agent-context-binding": createJsonPayloadCodec({
    currentVersion: 1,
    read: (value) => agentContextBindingSchema.parse(value),
  }),
  "agent-context-prefix-migration": createJsonPayloadCodec({
    currentVersion: 1,
    read: (value) => agentContextPrefixMigrationSchema.parse(value),
  }),
  agent_input_preparation: createJsonPayloadCodec({
    currentVersion: 1,
    read: (value) => agentInputPreparationSchema.parse(value),
  }),
  agent_inputs: createJsonPayloadCodec({
    currentVersion: 1,
    read: (value) => agentInputQueueStateSchema.parse(value),
  }),
};
