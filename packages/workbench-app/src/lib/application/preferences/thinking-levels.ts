import {
  thinkingLevels,
  type ModelInfo,
  type ThinkingLevel,
} from "@nervekit/contracts/models";
export const THINKING_LEVEL_ORDER: ThinkingLevel[] = [...thinkingLevels];
export function supportedThinkingLevelsForModel(
  model: ModelInfo | undefined,
): ThinkingLevel[] {
  return model?.supportedThinkingLevels?.length
    ? model.supportedThinkingLevels
    : ["off"];
}
export function clampThinkingLevelForModel(
  level: ThinkingLevel,
  model: ModelInfo | undefined,
): ThinkingLevel {
  const supported = supportedThinkingLevelsForModel(model);
  if (supported.includes(level)) return level;
  const index = THINKING_LEVEL_ORDER.indexOf(level);
  return (
    THINKING_LEVEL_ORDER.slice(index).find((candidate) =>
      supported.includes(candidate),
    ) ??
    THINKING_LEVEL_ORDER.slice(0, index)
      .reverse()
      .find((candidate) => supported.includes(candidate)) ??
    supported[0] ??
    "off"
  );
}
