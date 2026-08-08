import {
  setupGuideSteps,
  type SetupGuideArea,
  type SetupGuideStep,
} from "./setup-guide-content.js";

export function setupStepsForArea(
  area: SetupGuideArea,
  input: { codexConnected: boolean },
): SetupGuideStep[] {
  const steps = [...setupGuideSteps[area]];
  if (area !== "voice" || !input.codexConnected) return steps;
  return [
    {
      id: "voice-connected",
      title: "OpenAI Codex is connected",
      description:
        "Your ChatGPT subscription is ready, so the composer microphone is available for voice input.",
      targetId: "setup-auth-openai-codex-connected",
      fallback:
        "Open Connections → Subscriptions to review the connected OpenAI Codex provider.",
      preparation: {
        kind: "auth",
        pageId: "connections",
        sectionId: "subscriptions",
      },
    },
  ];
}

export function adjacentSetupStep(
  index: number,
  length: number,
  direction: -1 | 1,
): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index + direction));
}
