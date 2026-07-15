import type {
  ConversationLiveToolDraftBlockSnapshot,
  ToolCallStatus,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import type { MetaItem } from "./tool-presentation-types";

export type ToolActivityPhase = "drafting" | "prepared" | ToolCallStatus;

export type ToolActivityBodyMode =
  | "none"
  | "draft-preview"
  | "tool-output"
  | "approval"
  | "interaction"
  | "error";

export type ToolActivityRenderState = {
  phase: ToolActivityPhase;
  bodyMode: ToolActivityBodyMode;
  bodyVisible: boolean;
  errorVisible: boolean;
  footerVisible: boolean;
  /** Changes only when the card's structural regions change. */
  structuralRevision: string;
};

type DeriveToolActivityStateInput = {
  draft?: ConversationLiveToolDraftBlockSnapshot;
  toolCall?: Pick<ToolCallTranscriptRecord, "status" | "error">;
  hasMeaningfulDraftBody?: boolean;
  bodyHydrated?: boolean;
  hasApproval?: boolean;
  hasInteraction?: boolean;
  footerItems?: readonly Pick<
    MetaItem,
    "tone" | "mono" | "openPath" | "href"
  >[];
  hasDetailsAction?: boolean;
};

function footerStructure(
  items: DeriveToolActivityStateInput["footerItems"],
  hasDetailsAction: boolean,
): string {
  return [
    ...(items ?? []).map(
      (item) =>
        `${item.tone ?? "default"}:${item.mono ? "mono" : "text"}:${
          item.openPath ? "file" : item.href ? "link" : "label"
        }`,
    ),
    hasDetailsAction ? "details" : "",
  ].join(",");
}

/**
 * Frontend-only lifecycle projection for one persistent tool activity card.
 * Durable records win as soon as they exist; a retained draft remains the
 * presentation fallback during the entry-to-record handoff gap.
 */
export function deriveToolActivityState(
  input: DeriveToolActivityStateInput,
): ToolActivityRenderState {
  const phase: ToolActivityPhase = input.toolCall
    ? input.toolCall.status
    : input.draft?.done
      ? "prepared"
      : "drafting";

  let bodyMode: ToolActivityBodyMode;
  if (!input.toolCall) {
    bodyMode = input.hasMeaningfulDraftBody ? "draft-preview" : "none";
  } else if (
    input.toolCall.status === "error" ||
    input.toolCall.status === "denied"
  ) {
    bodyMode = "error";
  } else if (input.hasApproval) {
    bodyMode = "approval";
  } else if (input.hasInteraction) {
    bodyMode = "interaction";
  } else {
    bodyMode = "tool-output";
  }

  const bodyHydrated =
    bodyMode === "tool-output" || bodyMode === "interaction"
      ? Boolean(input.bodyHydrated)
      : true;
  const bodyVisible =
    bodyMode !== "none" && bodyMode !== "error" && bodyHydrated;
  const errorVisible = Boolean(
    bodyMode === "error" && input.toolCall?.error?.trim(),
  );
  const footerVisible =
    bodyMode !== "approval" &&
    bodyMode !== "interaction" &&
    ((input.footerItems?.length ?? 0) > 0 || Boolean(input.hasDetailsAction));
  const footerShape = footerStructure(
    input.footerItems,
    Boolean(input.hasDetailsAction),
  );

  return {
    phase,
    bodyMode,
    bodyVisible,
    errorVisible,
    footerVisible,
    structuralRevision: [
      bodyMode,
      bodyVisible ? "body" : "no-body",
      errorVisible ? "error" : "no-error",
      footerVisible ? `footer:${footerShape}` : "no-footer",
    ].join("|"),
  };
}
