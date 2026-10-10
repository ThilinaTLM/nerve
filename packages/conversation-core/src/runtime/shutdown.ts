// Distinguish daemon teardown from an explicit user stop without persisting it.
export const shutdownReason = new Error("Conversation core is shutting down");
