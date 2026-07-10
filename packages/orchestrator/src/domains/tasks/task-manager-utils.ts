import type {
  StartTaskRequest,
  TaskEnvInfo,
  TaskRecord,
} from "@nervekit/contracts";

const RUNTIME_TIMEOUT_FORCE_KILL_AFTER_MS = 5000;
const FOREGROUND_TIMEOUT_RESULT_GRACE_MS = 500;

export function foregroundPromotionDelayMs(input: {
  timeoutMs?: number;
  autoPromoteAfterMs: number;
}): number {
  if (input.timeoutMs && input.timeoutMs <= input.autoPromoteAfterMs) {
    return (
      input.timeoutMs +
      RUNTIME_TIMEOUT_FORCE_KILL_AFTER_MS +
      FOREGROUND_TIMEOUT_RESULT_GRACE_MS
    );
  }
  return input.autoPromoteAfterMs;
}

export function defaultTaskNotificationsEnabled(
  request: StartTaskRequest & {
    origin?: TaskRecord["origin"];
    completion?: TaskRecord["completion"];
  },
): boolean {
  if (request.notify !== undefined) return request.notify;
  if (request.injectCompletion === true || request.completion?.inject === true)
    return true;
  if (request.origin?.kind === "agent_tool") return true;
  return Boolean(request.agentId && request.conversationId);
}

export function buildTaskEnvInfo(
  env?: Record<string, string>,
): TaskEnvInfo | undefined {
  const keys = Object.keys(env ?? {})
    .filter((key) => key.length > 0)
    .sort();
  if (keys.length === 0) return undefined;
  return { keys, persisted: true, redacted: true };
}
