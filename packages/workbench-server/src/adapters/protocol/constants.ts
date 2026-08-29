import {
  STREAM_SUBSCRIPTION_CAPABILITY,
  WORKSPACE_STREAM,
  allOperationDefinitions,
  conversationStream,
} from "@nervekit/contracts";

const WORKBENCH_OPERATION_CAPABILITIES = allOperationDefinitions()
  .filter((definition) =>
    definition.allowedTargetRoles.includes("workbench_server"),
  )
  .map((definition) => definition.requiredCapability)
  .filter((capability): capability is string => Boolean(capability));

export const PROTOCOL_CAPABILITIES = [
  "encoding.json",
  "event.batch",
  "event.notify",
  STREAM_SUBSCRIPTION_CAPABILITY,
  "snapshot.workspace",
  "operation.snapshot.workspace.get",
  ...WORKBENCH_OPERATION_CAPABILITIES,
] as const;

export const REQUIRED_PROTOCOL_CAPABILITIES = [
  "encoding.json",
  "event.batch",
  STREAM_SUBSCRIPTION_CAPABILITY,
] as const;

export const PROTOCOL_SESSION_LIMITS = {
  maxMessageBytes: 4 * 1024 * 1024,
  maxBatchEvents: 500,
  maxBatchBytes: 1024 * 1024,
} as const;

export const PROTOCOL_HEARTBEAT = {
  intervalMs: 30_000,
  timeoutMs: 70_000,
} as const;

export { WORKSPACE_STREAM, conversationStream };
