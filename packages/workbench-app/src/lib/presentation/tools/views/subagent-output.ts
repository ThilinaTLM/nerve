import { teammateStateLabel } from "./subagent-result-parser";
import type { ToolView } from "./tool-view-types";

type SubagentView = Extract<ToolView, { kind: "subagent" }>;

/** One result body for the compact card and the formatted details view. */
export function subagentOutput(view: SubagentView): string | undefined {
  if (view.previewUnavailable) return undefined;
  if (view.action === "list") {
    return view.teammates.length
      ? view.teammates
          .map(
            (teammate) => `${teammate.name} · ${teammateStateLabel(teammate)}`,
          )
          .join("\n")
      : undefined;
  }
  if (view.action === "status" && view.response?.text)
    return view.response.text;
  const teammate = view.teammates[0];
  if (!teammate) return undefined;
  if (view.action === "status") return "No response yet.";
  return `${teammate.name} · ${teammateStateLabel(teammate)}`;
}

/** Visible, addressable teammates only; hidden previews cannot be navigated. */
export function subagentTranscriptTargets(
  view: SubagentView,
  parentAgentId: string | undefined,
): { agentId: string; name: string }[] {
  if (!parentAgentId || view.previewUnavailable) return [];
  return view.teammates.flatMap((teammate) =>
    teammate.agentId
      ? [{ agentId: teammate.agentId, name: teammate.name }]
      : [],
  );
}
