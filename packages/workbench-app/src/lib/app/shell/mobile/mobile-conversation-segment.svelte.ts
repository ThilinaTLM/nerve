/**
 * Which hub segment each conversation screen shows. Session memory only: the
 * map lives for the page lifetime and is never persisted.
 */
export type MobileConversationSegment = "chat" | "changes" | "files" | "pr";

const segments = $state<Record<string, MobileConversationSegment>>({});

export function mobileConversationSegment(
  key: string,
): MobileConversationSegment {
  return segments[key] ?? "chat";
}

export function setMobileConversationSegment(
  key: string,
  segment: MobileConversationSegment,
): void {
  segments[key] = segment;
}
