import type { McpServerRow, McpServerStateName } from "@nervekit/contracts/mcp";
import type { BadgeVariant } from "@nervekit/ui-kit/components/ui/badge";

const STATES: Record<
  McpServerStateName,
  { label: string; variant: BadgeVariant }
> = {
  connected: { label: "Connected", variant: "success" },
  idle: { label: "Idle", variant: "neutral" },
  failed: { label: "Failed", variant: "destructive" },
  disabled: { label: "Disabled", variant: "neutral" },
  needs_approval: { label: "Needs approval", variant: "warning" },
  rejected: { label: "Rejected", variant: "destructive" },
};

export const mcpStateBadge = (state: McpServerStateName) => STATES[state];

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
      return "Not used until you approve it.";
    case "rejected":
      return "You rejected this entry. It stays off until you approve it.";
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
