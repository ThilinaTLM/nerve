import {
  type AgentRecord,
  type ModelInfo,
  thinkingLevels,
} from "@nervekit/contracts";

export const THINKING_LEVEL_ORDER: AgentRecord["thinkingLevel"][] = [
  ...thinkingLevels,
];

export function supportedThinkingLevelsForModel(
  model: ModelInfo | undefined,
): AgentRecord["thinkingLevel"][] {
  return model?.supportedThinkingLevels?.length
    ? model.supportedThinkingLevels
    : ["off"];
}

export function clampThinkingLevelForModel(
  level: AgentRecord["thinkingLevel"],
  model: ModelInfo | undefined,
): AgentRecord["thinkingLevel"] {
  const supported = supportedThinkingLevelsForModel(model);
  if (supported.includes(level)) return level;

  const requestedIndex = THINKING_LEVEL_ORDER.indexOf(level);
  if (requestedIndex === -1) return supported[0] ?? "off";

  for (
    let index = requestedIndex;
    index < THINKING_LEVEL_ORDER.length;
    index++
  ) {
    const candidate = THINKING_LEVEL_ORDER[index];
    if (supported.includes(candidate)) return candidate;
  }
  for (let index = requestedIndex - 1; index >= 0; index--) {
    const candidate = THINKING_LEVEL_ORDER[index];
    if (supported.includes(candidate)) return candidate;
  }
  return supported[0] ?? "off";
}
