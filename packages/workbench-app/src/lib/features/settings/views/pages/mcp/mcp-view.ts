import type { McpServerRow } from "@nervekit/contracts/mcp";

/** A server waiting for the user's decision on its exact entry. */
export const mcpPending = (row: Pick<McpServerRow, "review">) =>
  row.review !== "approved";

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
    case "needs_approval":
      return "Needs approval";
    case "rejected":
      return "Rejected";
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

/** Splits text at `backtick` spans, so the daemon's sentences render with inline code and never as HTML. */
export function codeSpans(text: string): { text: string; code: boolean }[] {
  return text
    .split(/(`[^`]+`)/)
    .filter((part) => part !== "")
    .map((part) =>
      part.length > 2 && part.startsWith("`") && part.endsWith("`")
        ? { text: part.slice(1, -1), code: true }
        : { text: part, code: false },
    );
}
