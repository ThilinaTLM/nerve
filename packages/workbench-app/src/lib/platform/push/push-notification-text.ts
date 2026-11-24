import type { PushPayload } from "@nervekit/contracts/access";

/**
 * Notification text for a push payload. Pure so the service worker stays
 * small and the wording is testable; the payload carries no transcript text.
 */
export type PushNotificationContent = {
  title: string;
  body: string;
  /** One notification slot per conversation; a newer one replaces the older. */
  tag: string;
  /** The conversation a tap opens. */
  openConversationId?: string;
};

type AttentionPayload = Extract<PushPayload, { type: "attention" }>;

const inputText = {
  approval: "Approval needed",
  user_input: "Question for you",
  plan_review: "Plan ready for review",
  configuration_blocked: "Setup needed",
} as const;

const resultText = {
  finished: "Agent finished",
  failed: "Agent failed",
  interrupted: "Agent interrupted",
} as const;

function attentionText(payload: AttentionPayload): string {
  if (payload.reason === "input") {
    return inputText[payload.inputKind ?? "approval"];
  }
  return resultText[payload.reason];
}

export function pushNotificationContent(
  payload: PushPayload,
): PushNotificationContent {
  if (payload.type === "test") {
    return {
      title: "Nerve notifications work",
      body: "You will be notified when an agent needs you.",
      tag: "nerve-test",
    };
  }
  const text = attentionText(payload);
  return {
    title: payload.subAgentTitle
      ? `${payload.subAgentTitle} · ${text.charAt(0).toLowerCase()}${text.slice(1)}`
      : text,
    body: [payload.projectName, payload.conversationTitle]
      .filter(Boolean)
      .join(" · "),
    tag: payload.conversationId,
    openConversationId: payload.openConversationId,
  };
}
