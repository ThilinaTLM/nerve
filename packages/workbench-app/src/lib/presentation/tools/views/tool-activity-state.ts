import type {
  ConversationLiveToolDraftBlockSnapshot,
  ToolCallStatus,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import type {
  ToolArgumentRegion,
  ToolResultPlaceholder,
} from "../lifecycle/types";
import type { MetaItem } from "./tool-presentation-types";

export type ToolActivityPhase = "drafting" | "prepared" | ToolCallStatus;

export type ToolActivityInteractionMode = "none" | "approval";

export type ToolActivityResultMode = "none" | "placeholder" | "output";

export type ToolLifecycleVisualStage =
  | "drafting"
  | "prepared"
  | "approval"
  | "interaction"
  | "executing"
  | "completed"
  | "failed";

export type ToolActivitySections = {
  phase: ToolActivityPhase;
  /** Persistent argument section (command/diff/content from tool args). */
  argumentVisible: boolean;
  interactionMode: ToolActivityInteractionMode;
  resultMode: ToolActivityResultMode;
  errorVisible: boolean;
  footerVisible: boolean;
  /** Changes only when the card's structural regions change. */
  structuralRevision: string;
};

type DeriveToolActivitySectionsInput = {
  draft?: ConversationLiveToolDraftBlockSnapshot;
  toolCall?: Pick<ToolCallTranscriptRecord, "status" | "error">;
  /** How the tool's argument section behaves across the lifecycle. */
  argumentRegion: ToolArgumentRegion;
  /** The current lifecycle argument presentation has a renderable body. */
  hasArgumentBody?: boolean;
  hasDurableBodyContent?: boolean;
  bodyHydrated?: boolean;
  hasApproval?: boolean;
  hasInteraction?: boolean;
  /** Executing-state placeholder configured by the lifecycle spec. */
  resultPlaceholder?: ToolResultPlaceholder;
  footerItems?: readonly Pick<
    MetaItem,
    "tone" | "mono" | "openPath" | "href"
  >[];
  hasDetailsAction?: boolean;
};

export function deriveToolLifecycleVisualStage(input: {
  draft?: Pick<ConversationLiveToolDraftBlockSnapshot, "done">;
  toolCall?: Pick<ToolCallTranscriptRecord, "status">;
}): ToolLifecycleVisualStage {
  if (!input.toolCall) return input.draft?.done ? "prepared" : "drafting";
  switch (input.toolCall.status) {
    case "pending_approval":
      return "approval";
    case "waiting_for_user":
      return "interaction";
    case "requested":
    case "running":
      return "executing";
    case "completed":
      return "completed";
    case "error":
    case "denied":
      return "failed";
  }
}

function footerStructure(
  items: DeriveToolActivitySectionsInput["footerItems"],
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
 *
 * The card body is composed of three stacked sections instead of one switched
 * mode, so big content stays mounted across state transitions:
 * - argument section: the tool's own input (command, diff, checklist, …),
 *   mounted per the spec's `argumentRegion` policy; on failure it doubles as
 *   the input context shown next to the error;
 * - interaction section: approval actions, mounted only while pending;
 * - result section: executing placeholder, then live/final tool output.
 */
export function deriveToolActivitySections(
  input: DeriveToolActivitySectionsInput,
): ToolActivitySections {
  const phase: ToolActivityPhase = input.toolCall
    ? input.toolCall.status
    : input.draft?.done
      ? "prepared"
      : "drafting";

  const terminalFailure =
    input.toolCall?.status === "error" || input.toolCall?.status === "denied";
  const inFlight = Boolean(
    input.toolCall &&
    (input.toolCall.status === "requested" ||
      input.toolCall.status === "running"),
  );

  let resultMode: ToolActivityResultMode;
  if (!input.toolCall || terminalFailure) {
    // Failures keep the argument section as input context; the result view
    // never mounts for them.
    resultMode = "none";
  } else if (
    input.hasApproval ||
    input.toolCall.status === "pending_approval"
  ) {
    // The durable tool row may arrive one frame before its approval record.
    // Never treat that handoff gap as result output.
    resultMode = "none";
  } else if (input.hasInteraction) {
    // HIL views (ask_user, plan review) own their body for every status.
    resultMode = "output";
  } else if (inFlight && !input.hasDurableBodyContent) {
    // Header-only tools do not grow an empty waiting body while executing;
    // opted-in tools show a placeholder so results replace it without a jump.
    resultMode = input.resultPlaceholder ? "placeholder" : "none";
  } else {
    // In-flight with live content, or completed (views render their own
    // empty-result placeholders such as "No output").
    resultMode = "output";
  }
  // A deferred result still owns the slot: do not fall back to the argument
  // body while an inactive transcript row waits for hydration.
  const resultOwnsArgument = resultMode === "output";
  if (resultMode === "output" && !input.bodyHydrated) resultMode = "none";

  const argumentVisible =
    input.argumentRegion === "none"
      ? false
      : input.argumentRegion === "persistent"
        ? Boolean(input.hasArgumentBody)
        : Boolean(input.hasArgumentBody && !resultOwnsArgument);

  const interactionMode: ToolActivityInteractionMode = input.hasApproval
    ? "approval"
    : "none";

  const errorVisible = Boolean(
    terminalFailure && input.toolCall?.error?.trim(),
  );
  const footerVisible =
    interactionMode === "none" &&
    !input.hasInteraction &&
    ((input.footerItems?.length ?? 0) > 0 || Boolean(input.hasDetailsAction));
  const footerShape = footerStructure(
    input.footerItems,
    Boolean(input.hasDetailsAction),
  );

  return {
    phase,
    argumentVisible,
    interactionMode,
    resultMode,
    errorVisible,
    footerVisible,
    structuralRevision: [
      argumentVisible ? "arg" : "no-arg",
      `interaction:${interactionMode}`,
      resultMode === "placeholder"
        ? `result:placeholder:${input.resultPlaceholder?.variant}:${input.resultPlaceholder?.rows}`
        : `result:${resultMode}`,
      errorVisible ? "error" : "no-error",
      footerVisible ? `footer:${footerShape}` : "no-footer",
    ].join("|"),
  };
}
