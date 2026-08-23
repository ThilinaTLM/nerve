export function activeTabIsConversation(kind: string | undefined): boolean {
  return kind === "conversation" || kind === "pending-conversation";
}
