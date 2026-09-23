import type { MetaItem } from "../../cards/card-presentation";
import { outcomeTone } from "./subagent-result-parser";
import { plural } from "./tool-presentation-helpers";
import type {
  DetailsActionInfo,
  ToolPresentation,
} from "./tool-presentation-types";
import type { ToolCallDisplayRecord } from "./tool-result-parser";
import type { ToolView } from "./tool-view-types";

/** Header, footer chips and details action of async teammate tool cards. */
export function subagentPresentation(
  view: Extract<ToolView, { kind: "subagent" }>,
  toolCall: ToolCallDisplayRecord,
  base: ToolPresentation,
  previewDetailsAction: DetailsActionInfo | undefined,
): ToolPresentation {
  const meta: MetaItem[] = [];
  const teammate = view.teammates[0];
  if (view.action === "prompt" && toolCall.status === "completed" && view.runId)
    meta.push({ text: "assignment started", tone: "success" });
  if (view.action === "list") {
    const running = view.teammates.filter(
      (candidate) => candidate.state === "running",
    ).length;
    if (running > 0) meta.push({ text: `${running} running`, tone: "info" });
    if (view.hasMore) meta.push({ text: "more available" });
  }
  if (
    (view.action === "status" || view.action === "stop") &&
    teammate?.state === "idle" &&
    teammate.outcome
  )
    meta.push({
      text: teammate.outcome,
      tone: outcomeTone(teammate.outcome),
    });
  if (view.response && !view.response.complete)
    meta.push({ text: "partial response", tone: "warning" });
  if (view.hidden)
    meta.push({
      text: `${view.hidden.count.toLocaleString()} more ${view.hidden.noun}`,
    });
  const listCount =
    view.teammates.length +
    (view.hidden?.noun === "teammates" ? view.hidden.count : 0);
  return {
    ...base,
    primaryArg:
      view.action === "list"
        ? toolCall.status === "completed" && !view.previewUnavailable
          ? {
              text: `${plural(listCount, "teammate")}${view.hasMore && !view.hidden ? "+" : ""}`,
            }
          : undefined
        : (base.primaryArg ?? (teammate ? { text: teammate.name } : undefined)),
    meta,
    detailsAction: previewDetailsAction,
  };
}
