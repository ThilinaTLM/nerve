/** Only the newest, non-invalidated asynchronous usage read may update a view. */
export class ContextUsageRefreshGuard {
  private readonly requests = new Map<string, symbol>();

  begin(conversationId: string): () => boolean {
    const token = Symbol();
    this.requests.set(conversationId, token);
    return () => {
      if (this.requests.get(conversationId) !== token) return false;
      this.requests.delete(conversationId);
      return true;
    };
  }

  invalidate(conversationId: string): void {
    this.requests.delete(conversationId);
  }
}
