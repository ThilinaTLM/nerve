/**
 * Routes a toast's "Review" click to the mounted profile notice of a
 * conversation. The toast outlives the notice, so its action must not close
 * over the component: a closure created inside a component keeps that
 * component's whole scope chain (host deriveds, transcript) alive for as long
 * as the toast state holds it. The action created here captures only the
 * conversation id and this module's registry.
 */
const handlers = new Map<string, () => void>();

/** Registers the open-review handler for a conversation; returns its unregister. */
export function registerProfileReviewHandler(
  conversationId: string,
  handler: () => void,
): () => void {
  handlers.set(conversationId, handler);
  return () => {
    if (handlers.get(conversationId) === handler)
      handlers.delete(conversationId);
  };
}

/** A toast action that opens the review for `conversationId` if it is still mounted. */
export function profileReviewAction(conversationId: string): {
  label: string;
  onClick: () => void;
} {
  return { label: "Review", onClick: () => handlers.get(conversationId)?.() };
}
