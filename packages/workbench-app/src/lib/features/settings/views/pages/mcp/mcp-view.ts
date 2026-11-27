import type { McpServerRow } from "@nervekit/contracts/mcp";

/** A server waiting for the user's decision on its exact entry. */
export const mcpPending = (row: Pick<McpServerRow, "review">) =>
  row.review !== "trusted";

/** The command line or URL, as one line. */
export function mcpCommandLine(row: Pick<McpServerRow, "entry">): string {
  const { entry } = row;
  return entry.url ?? [entry.command, ...(entry.args ?? [])].join(" ").trim();
}

/** The status line of a row: the reason it is not working, else nothing. */
export function mcpProblem(row: McpServerRow): string | undefined {
  switch (row.state) {
    case "failed":
      return row.error ?? "Could not connect.";
    case "needs_review":
      return "Needs review";
    case "declined":
      return "Declined";
    default:
      return undefined;
  }
}

/** Tools the server offers, once it was connected. */
export function mcpToolCount(row: McpServerRow): string | undefined {
  return row.toolCount === undefined
    ? undefined
    : `${row.toolCount} ${row.toolCount === 1 ? "tool" : "tools"}`;
}
