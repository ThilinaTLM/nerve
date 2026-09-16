import { AgentHarness } from "@nervekit/harness";

const MODEL_REQUEST_TIMEOUT_MS = 600_000;

export function createWorkbenchAgentHarness(
  options: ConstructorParameters<typeof AgentHarness>[0],
): AgentHarness {
  return new AgentHarness({
    ...options,
    streamOptions: {
      ...options.streamOptions,
      timeoutMs: MODEL_REQUEST_TIMEOUT_MS,
    },
  });
}
