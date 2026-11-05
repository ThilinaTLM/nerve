import type { PrimaryArg } from "../../cards/card-presentation";
import type {
  ApprovalWithToolCall,
  ToolCallTranscriptRecord,
} from "../../state/tool-types";
import type { ToolActivitySections } from "../views/tool-activity-state";
import type { ToolView } from "../views/tool-result-view";

/** The pending approval, only while it belongs to this call and it waits. */
export function resolveToolApproval(
  toolCall: Pick<ToolCallTranscriptRecord, "id" | "status"> | undefined,
  pendingApproval: ApprovalWithToolCall | undefined,
): ApprovalWithToolCall | undefined {
  return toolCall &&
    pendingApproval?.toolCallId === toolCall.id &&
    toolCall.status === "waiting"
    ? pendingApproval
    : undefined;
}

/** The pending configuration-blocked request, if the call is blocked on one. */
export function resolveConfigurationBlocked(
  toolCall: Pick<ToolCallTranscriptRecord, "interaction"> | undefined,
) {
  return toolCall?.interaction?.kind === "configuration_blocked" &&
    toolCall.interaction.status === "pending"
    ? toolCall.interaction.request
    : undefined;
}

/** Plan review owns its own body and actions outside the sheet. */
export function isPlanInteractive(view: ToolView | undefined): boolean {
  return view?.kind === "plan_present" && view.action === "present";
}

/** Human-in-the-loop tools: ask_user and plan review. */
export function isHilInteractive(view: ToolView | undefined): boolean {
  return view?.kind === "ask_user" || isPlanInteractive(view);
}

/** Header argument fallback derived from a drafting summary. */
export function draftPrimaryArg(
  summary: { primaryArg?: PrimaryArg; path?: string } | undefined,
): PrimaryArg | undefined {
  if (!summary) return undefined;
  if (summary.primaryArg) return summary.primaryArg;
  if (summary.path) return { text: summary.path };
  return undefined;
}

/**
 * For HIL interactive tools the durable presentation is authoritative and
 * deliberately omits the header arg so the question/plan is not duplicated in
 * the interactive body. Other tools keep the streaming-arg fallback.
 */
export function selectPrimaryArg(input: {
  planInteractive: boolean;
  durable: PrimaryArg | undefined;
  lifecycle: PrimaryArg | undefined;
  draft: PrimaryArg | undefined;
}): PrimaryArg | undefined {
  return input.planInteractive
    ? input.durable
    : (input.durable ?? input.lifecycle ?? input.draft);
}

/** Which regions of the card render outside or inside the sheet. */
export function deriveSheetVisibility(input: {
  planInteractive: boolean;
  activitySections: Pick<
    ToolActivitySections,
    "argumentVisible" | "resultMode" | "errorVisible"
  >;
  hasAskUserDraftQuestions: boolean;
  hasAskUserView: boolean;
  hasErrorPreview: boolean;
}): { hilBodyVisible: boolean; sheetVisible: boolean } {
  const { activitySections } = input;
  const askUserSheetVisible =
    input.hasAskUserDraftQuestions ||
    (input.hasAskUserView && activitySections.resultMode === "output");
  return {
    hilBodyVisible:
      input.planInteractive && activitySections.resultMode === "output",
    sheetVisible:
      !input.planInteractive &&
      (askUserSheetVisible ||
        activitySections.argumentVisible ||
        activitySections.resultMode !== "none" ||
        (activitySections.errorVisible && input.hasErrorPreview)),
  };
}
