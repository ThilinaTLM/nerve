export function conversationViewKey(conversationId: string): string {
  return `conversation-view:${conversationId}`;
}

export function pendingConversationKey(pendingId: string): string {
  return `pending-conversation:${pendingId}`;
}

export function fileViewKey(fileTabId: string): string {
  return `file-view:${fileTabId}`;
}

export function prViewKey(prTabId: string): string {
  return `pr-view:${prTabId}`;
}

export function gitProjectStateKey(projectId: string): string {
  return `git-project:${projectId}`;
}

export function gitRepoStateKey(repo: string): string {
  return `git-repo:${repo}`;
}
