/**
 * A request to open one server's review dialog on the MCP servers page: set
 * when a link (the attention list) names a server, consumed by the page once
 * its list has loaded.
 */
export const mcpReviewRequest = $state<{ name?: string }>({});

export function requestMcpReview(name: string): void {
  mcpReviewRequest.name = name;
}
