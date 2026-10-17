import type { ConversationLiveToolDraftBlockSnapshot } from "$lib/presentation/view-models/conversation";

import type {
  ToolCallStatus,
  ToolCallTranscriptRecord,
} from "$lib/presentation/view-models/conversation";
import type {
  ToolArgumentRegion,
  ToolResultPlaceholder,
} from "../lifecycle/tool-lifecycle-contracts";

import type { RecoveryIssue } from "$lib/presentation/view-models/conversation";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { CardGlyph, MetaItem } from "../../cards/card-presentation";
import type { LeadStage } from "../../cards/lead-chip";

export type ToolActivityPhase = "drafting" | "prepared" | ToolCallStatus;

export type ToolActivityInteractionMode = "none" | "approval";

export type ToolActivityResultMode = "none" | "placeholder" | "output";

export type ToolLifecycleVisualStage =
  | "drafting"
  | "prepared"
  /** Open call the supervisor is still checking. */
  | "supervising"
  | "approval"
  | "interaction"
  /** Approved and durably queued; not yet dispatched. */
  | "queued"
  | "executing"
  /** Recovery could not tell whether the side effect happened. */
  | "outcome_unknown"
  | "completed"
  | "cancelled"
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
  /** Recovery reported this call's outcome as unknown. */
  outcomeUnknown?: boolean;
  /** Executing-state placeholder configured by the lifecycle spec. */
  resultPlaceholder?: ToolResultPlaceholder;
  footerItems?: readonly Pick<MetaItem, "key" | "text">[];
  hasDetailsAction?: boolean;
};

export function deriveToolLifecycleVisualStage(input: {
  draft?: Pick<ConversationLiveToolDraftBlockSnapshot, "done">;
  toolCall?: Pick<ToolCallTranscriptRecord, "status"> &
    Partial<Pick<ToolCallTranscriptRecord, "interaction" | "supervising">>;
  outcomeUnknown?: boolean;
}): ToolLifecycleVisualStage {
  if (!input.toolCall) return input.draft?.done ? "prepared" : "drafting";
  if (input.outcomeUnknown) return "outcome_unknown";
  switch (input.toolCall.status) {
    case "waiting":
      return input.toolCall.interaction?.status === "pending" &&
        input.toolCall.interaction.kind === "approval"
        ? "approval"
        : "interaction";
    case "committed":
      return input.toolCall.supervising ? "supervising" : "queued";
    case "running":
      return "executing";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "failed":
    case "denied":
      return "failed";
  }
}

export type ToolLifecycleStageIndicator = {
  tone: StatusTone;
  pulse: boolean;
  glyph?: CardGlyph;
  label: string;
};

/** A call must stay queued this long before the queued indicator appears. */
export const QUEUED_INDICATOR_DELAY_MS = 400;

/**
 * Auto-approved calls pass through `committed` within a frame or two. Present
 * them as executing until the queue wait is long enough to be meaningful, so
 * the queued chip does not flash and shift the footer.
 */
export function visibleLifecycleStage(
  stage: ToolLifecycleVisualStage,
  queuedVisible: boolean,
): ToolLifecycleVisualStage {
  return stage === "queued" && !queuedVisible ? "executing" : stage;
}

/**
 * Header/footer overrides for stages whose meaning is not carried by the tool
 * status presentation: a queued call must not look like it is executing, and an
 * unknown outcome or cancelled call must not keep spinning.
 */
export function toolLifecycleStageIndicator(
  stage: ToolLifecycleVisualStage,
): ToolLifecycleStageIndicator | undefined {
  switch (stage) {
    case "supervising":
      return { tone: "info", pulse: true, label: "Checking" };
    case "queued":
      return {
        tone: "info",
        pulse: false,
        glyph: "pending",
        label: "Approved · queued",
      };
    case "outcome_unknown":
      return { tone: "warning", pulse: false, label: "Outcome unknown" };
    case "cancelled":
      return { tone: "warning", pulse: false, label: "Cancelled" };
    default:
      return undefined;
  }
}

/** Maps the card's visual stage onto the lead chip's lifecycle vocabulary. */
export function leadStageFor(
  stage: ToolLifecycleVisualStage,
  status?: ToolCallStatus,
  options?: { dismissed?: boolean },
): LeadStage {
  if (options?.dismissed && stage === "completed") return "dismissed";
  switch (stage) {
    case "drafting":
    case "prepared":
      return "drafting";
    case "supervising":
      return "supervising";
    case "approval":
      return "approval";
    case "interaction":
      return "waiting_for_user";
    case "queued":
      return "queued";
    case "executing":
      return "running";
    case "outcome_unknown":
      return "outcome_unknown";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "failed":
      return status === "denied" ? "denied" : "failed";
  }
}

/** Tool call ids whose external outcome recovery could not determine. */
export function outcomeUnknownToolCallIds(
  issues: readonly Pick<RecoveryIssue, "code" | "proposalId">[] | undefined,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const issue of issues ?? []) {
    if (issue.code === "outcome_unknown" && issue.proposalId) {
      ids.add(issue.proposalId);
    }
  }
  return ids;
}

/**
 * Chips are keyed and append-only, so only their count (not tone/text) is a
 * structural change.
 */
function footerStructure(
  items: DeriveToolActivitySectionsInput["footerItems"],
  hasDetailsAction: boolean,
): string {
  return `chips:${items?.length ?? 0}${hasDetailsAction ? ",details" : ""}`;
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
    input.toolCall?.status === "failed" ||
    input.toolCall?.status === "denied" ||
    input.toolCall?.status === "cancelled";
  // Only dispatched work earns the executing placeholder. Queued calls and
  // calls with an unknown outcome are not known to be producing output.
  const inFlight = Boolean(
    input.toolCall?.status === "running" && !input.outcomeUnknown,
  );
  const idleNonTerminal = Boolean(
    input.toolCall &&
    !inFlight &&
    (input.toolCall.status === "committed" ||
      input.toolCall.status === "running"),
  );

  let resultMode: ToolActivityResultMode;
  if (!input.toolCall || terminalFailure) {
    // Failures never mount the result view. Argument input context is kept
    // only when the tool's argument-region policy calls for it.
    resultMode = "none";
  } else if (input.hasInteraction) {
    // Native interaction views own their body for every lifecycle status.
    resultMode = "output";
  } else if (input.hasApproval || input.toolCall.status === "waiting") {
    // The durable tool row may arrive one frame before its approval projection.
    resultMode = "none";
  } else if (idleNonTerminal && !input.hasDurableBodyContent) {
    resultMode = "none";
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
        : Boolean(
            input.hasArgumentBody &&
            !resultOwnsArgument &&
            !(input.argumentRegion === "until-settled" && terminalFailure),
          );

  const interactionMode: ToolActivityInteractionMode = input.hasApproval
    ? "approval"
    : "none";

  const errorVisible = Boolean(
    terminalFailure && input.toolCall?.error?.trim(),
  );
  // The footer persists through approval (it hosts Approve/Deny); interactive
  // tools (ask_user, plan review) still own their own action row.
  const footerVisible =
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
