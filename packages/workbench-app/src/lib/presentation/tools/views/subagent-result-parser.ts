import {
  asyncSubagentStatusSchema,
  type AsyncSubagentToolName,
} from "@nervekit/contracts/agents";
import {
  subagentListToolResultPreviewSchema,
  subagentPromptToolResultPreviewSchema,
  subagentStatusToolResultPreviewSchema,
  subagentTeammateToolResultPreviewSchema,
} from "@nervekit/contracts/tools";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { ToolCallDisplayRecord } from "./tool-result-parser";
import type {
  SubagentTeammateView,
  SubagentToolAction,
  ToolView,
} from "./tool-view-types";

type SubagentView = Extract<ToolView, { kind: "subagent" }>;
type ParsedResult = Omit<SubagentView, "kind" | "action" | "hidden">;

const ACTIONS: Record<AsyncSubagentToolName, SubagentToolAction> = {
  subagent_new: "new",
  subagent_prompt: "prompt",
  subagent_list: "list",
  subagent_status: "status",
  subagent_stop: "stop",
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hiddenFromOverflow(
  toolCall: ToolCallDisplayRecord,
): SubagentView["hidden"] {
  const overflow =
    "previewOverflow" in toolCall ? toolCall.previewOverflow : undefined;
  if (!overflow || overflow.hidden <= 0) return undefined;
  const noun = overflow.noun;
  if (noun !== "lines" && noun !== "characters" && noun !== "teammates")
    return undefined;
  return { count: overflow.hidden, noun };
}

/** Compact transcript preview published by the server. */
function fromPreview(
  toolName: AsyncSubagentToolName,
  raw: unknown,
): ParsedResult | undefined {
  switch (toolName) {
    case "subagent_new":
    case "subagent_stop": {
      const parsed = subagentTeammateToolResultPreviewSchema.safeParse(raw);
      return parsed.success
        ? {
            teammates: [parsed.data.teammate],
            hasMore: false,
            previewUnavailable: false,
          }
        : undefined;
    }
    case "subagent_status": {
      const parsed = subagentStatusToolResultPreviewSchema.safeParse(raw);
      return parsed.success
        ? {
            teammates: [parsed.data.teammate],
            response: parsed.data.response,
            hasMore: false,
            previewUnavailable: false,
          }
        : undefined;
    }
    case "subagent_prompt": {
      const parsed = subagentPromptToolResultPreviewSchema.safeParse(raw);
      return parsed.success
        ? {
            teammates: [parsed.data.teammate],
            runId: parsed.data.runId,
            hasMore: false,
            previewUnavailable: false,
          }
        : undefined;
    }
    case "subagent_list": {
      const parsed = subagentListToolResultPreviewSchema.safeParse(raw);
      return parsed.success
        ? {
            teammates: parsed.data.teammates,
            hasMore: parsed.data.more,
            previewUnavailable: false,
          }
        : undefined;
    }
  }
}

function fullTeammate(value: unknown): SubagentTeammateView | undefined {
  const parsed = asyncSubagentStatusSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const agentId = record(value)?.agentId;
  return {
    agentId: typeof agentId === "string" ? agentId : undefined,
    name: parsed.data.name,
    state: parsed.data.state,
    outcome: parsed.data.outcome,
    runId: parsed.data.runId,
  };
}

/** Complete durable result (`{ details, content }`), e.g. in the details dialog. */
function fromFullResult(
  toolName: AsyncSubagentToolName,
  raw: unknown,
): ParsedResult | undefined {
  const details = record(record(raw)?.details);
  if (!details) return undefined;
  if (toolName === "subagent_list") {
    if (!Array.isArray(details.subagents)) return undefined;
    const teammates = details.subagents.map(fullTeammate);
    if (teammates.some((teammate) => !teammate)) return undefined;
    return {
      teammates: teammates as SubagentTeammateView[],
      hasMore: typeof details.nextCursor === "string",
      previewUnavailable: false,
    };
  }
  if (toolName === "subagent_prompt") {
    if (typeof details.name !== "string" || typeof details.runId !== "string")
      return undefined;
    return {
      teammates: [
        {
          agentId:
            typeof details.agentId === "string" ? details.agentId : undefined,
          name: details.name,
          state: "running",
          runId: details.runId,
        },
      ],
      runId: details.runId,
      hasMore: false,
      previewUnavailable: false,
    };
  }
  const teammate = fullTeammate(details);
  if (!teammate) return undefined;
  const response =
    toolName === "subagent_status"
      ? asyncSubagentStatusSchema.parse(details).response
      : undefined;
  return {
    teammates: [teammate],
    response: response
      ? {
          text: response.text,
          complete: response.complete,
          runId: response.runId,
        }
      : undefined,
    hasMore: false,
    previewUnavailable: false,
  };
}

export function parseSubagentResult(
  toolCall: ToolCallDisplayRecord,
  toolName: AsyncSubagentToolName,
  args: Record<string, unknown>,
  rawResult: unknown,
): SubagentView {
  const action = ACTIONS[toolName];
  const parsed =
    rawResult === undefined
      ? undefined
      : (fromPreview(toolName, rawResult) ??
        fromFullResult(toolName, rawResult));
  if (parsed) {
    return {
      kind: "subagent",
      action,
      ...parsed,
      hidden: hiddenFromOverflow(toolCall),
    };
  }
  const name = typeof args.name === "string" ? args.name : undefined;
  return {
    kind: "subagent",
    action,
    teammates: name ? [{ name }] : [],
    hasMore: false,
    // A settled call without a readable preview (metadata-only or legacy).
    previewUnavailable: toolCall.status === "completed",
  };
}

/** Status tone of a teammate row: live states first, then the last outcome. */
export function teammateTone(teammate: SubagentTeammateView): StatusTone {
  if (teammate.state === "running") return "info";
  if (teammate.state === "stopping") return "warning";
  switch (teammate.outcome) {
    case "completed":
      return "success";
    case "failed":
      return "destructive";
    case "cancelled":
    case "interrupted":
      return "warning";
    default:
      return "neutral";
  }
}

export function teammatePulse(teammate: SubagentTeammateView): boolean {
  return teammate.state === "running" || teammate.state === "stopping";
}

/** Short state label shown on the row badge. */
export function teammateStateLabel(teammate: SubagentTeammateView): string {
  if (!teammate.state) return "pending";
  if (teammate.state !== "idle") return teammate.state;
  return teammate.outcome ?? "idle";
}

export function outcomeTone(
  outcome: SubagentTeammateView["outcome"],
): StatusTone {
  return teammateTone({ name: "", state: "idle", outcome });
}
