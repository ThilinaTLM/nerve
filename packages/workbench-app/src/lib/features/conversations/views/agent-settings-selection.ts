import type { UpdateAgentRequest } from "@nervekit/contracts/agents";
export function agentSettingsSelection(
  inherit: boolean,
  text: string,
): string[] | null {
  return inherit
    ? null
    : text
        .split("\n")
        .map((name) => name.trim())
        .filter(Boolean);
}
/** Untouched fields remain under the latest committed configuration authority. */
export function agentSettingsPatch(
  before: UpdateAgentRequest,
  after: UpdateAgentRequest,
): UpdateAgentRequest {
  return Object.fromEntries(
    Object.entries(after).filter(
      ([key, value]) =>
        JSON.stringify(value) !==
        JSON.stringify(before[key as keyof UpdateAgentRequest]),
    ),
  ) as UpdateAgentRequest;
}
