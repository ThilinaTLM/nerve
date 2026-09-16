import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ThinkingLevel } from "@nervekit/contracts/models";
import type { StartTaskRequest, TaskRecord } from "@nervekit/contracts/tasks";
import type {
  ExploreReportSummaryPayload,
  ToolCallRecord,
} from "@nervekit/contracts/tools";
import type { ToolAnchor } from "../../runs/runtime/conversation-runtime.js";

export type ToolRequestOptions = {
  signal?: AbortSignal;
  sourceToolCallId?: string;
  providerToolCallId?: string;
  runId?: string;
  turnId?: string;
  liveMessageId?: string;
  contentIndex?: number;
  anchor?: ToolAnchor;
  durableSuspend?: boolean;
  forceApproval?: boolean;
  hidden?: boolean;
  continueAfterPromotedTask?: boolean;
  useForegroundBash?: boolean;
  onLifecycle?: (toolCall: ToolCallRecord) => Promise<void>;
};

export type ExploreProgressUpdate = {
  type: "explore_progress";
  timestamp: string;
  agentId?: string;
  taskIndex?: number;
  taskCount?: number;
  label?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  phase:
    | "queued"
    | "started"
    | "tool_call"
    | "tool_result"
    | "assistant"
    | "completed"
    | "failed";
  message: string;
  report?: ExploreReportSummaryPayload;
};

export type ExploreRunResult = {
  reports: Array<{
    agentId: string;
    task: string;
    label?: string;
    status?: "completed" | "failed" | "aborted";
    report: string;
    reportPath?: string;
    reportBytes?: number;
    reportLines?: number;
    artifactId?: string;
    summaryPreview?: string;
    usage?: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      totalTokens: number;
      cost: number;
      turns: number;
    };
    model?: string;
    thinkingLevel?: ThinkingLevel;
    stopReason?: string;
    errorMessage?: string;
    steps?: Array<{
      type: "tool_call" | "tool_result" | "assistant";
      toolName?: string;
      message: string;
      timestamp?: string;
    }>;
  }>;
  contentBlocks?: Array<{ type: "text"; text: string }>;
  details?: {
    outputLimits?: {
      artifacts?: Array<{
        id?: string;
        role: "primary_result" | "supporting_data" | "overflow_recovery";
        path: string;
        format: {
          kind:
            | "markdown"
            | "text"
            | "json"
            | "jsonl"
            | "image"
            | "binary"
            | "directory_manifest";
          mediaType: string;
          encoding?: "utf-8";
        };
        bytes?: number;
        lines?: number;
        label: string;
        recommendedTools: Array<"read" | "grep" | "explain_image">;
      }>;
    };
  };
};

export type ExploreRunner = (
  parent: AgentRecord,
  args: Record<string, unknown>,
  options?: {
    onProgress?: (update: ExploreProgressUpdate) => void;
    signal?: AbortSignal;
    parentRunId?: string;
    parentToolCallId?: string;
  },
) => Promise<ExploreRunResult>;

export type TaskStarter = (
  request: StartTaskRequest & {
    origin?: TaskRecord["origin"];
    completion?: TaskRecord["completion"];
    visibility?: TaskRecord["visibility"];
  },
) => Promise<TaskRecord>;
