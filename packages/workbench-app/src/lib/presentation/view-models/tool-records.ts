/** Presentation-owned tool records shapes. No runtime schemas. */
import type {
  ToolCallInteraction,
  ToolPermissionEvaluation,
} from "./tool-interactions";

export type ToolCallStatus =
  | "completed"
  | "running"
  | "failed"
  | "cancelled"
  | "committed"
  | "waiting"
  | "denied";

export type ToolRisk =
  | "read"
  | "command"
  | "network"
  | "interaction"
  | "deployment"
  | "secret"
  | "destructive"
  | "agent_spawn"
  | "workspace_write";

export type ToolCallRecord = {
  id: string;
  agentId: string;
  conversationId: string;
  projectId: string;
  toolName: string;
  risk?: ToolRisk;
  args: unknown;
  cwd: string;
  status:
    | "completed"
    | "running"
    | "failed"
    | "cancelled"
    | "committed"
    | "waiting"
    | "denied";
  revision: number;
  attempt: number;
  interaction?: ToolCallInteraction | undefined;
  createdAt: string;
  updatedAt: string;
  sourceToolCallId?: string | undefined;
  providerToolCallId?: string | undefined;
  runId?: string | undefined;
  groupId?: string | undefined;
  turnId?: string | undefined;
  liveMessageId?: string | undefined;
  contentIndex?: number | undefined;
  phase?:
    | "completed"
    | "failed"
    | "cancelled"
    | "denied"
    | "drafting"
    | "drafted"
    | "executing"
    | "interrupted"
    | undefined;
  /** Core supervisor outcome; `effectiveRisk` is the risk it settled on. */
  supervision?:
    | {
        decision: "allow" | "approval" | "deny";
        reason?: string | undefined;
        effectiveRisk?: ToolRisk | undefined;
      }
    | undefined;
  /** Open call is still being checked by the supervisor (status stays committed). */
  supervising?: boolean | undefined;
  /** When the call entered `running`; absent if it never ran. */
  startedAt?: string | undefined;
  permissionEvaluation?: ToolPermissionEvaluation;
  execution?:
    | {
        kind: "local" | "host";
        status:
          | "completed"
          | "running"
          | "failed"
          | "cancelled"
          | "interrupted"
          | "waiting_for_input";
        executionId: string;
        startedAt: string;
        hostHandle?: string | undefined;
        endedAt?: string | undefined;
      }
    | undefined;
  hidden?: boolean | undefined;
  result?: unknown;
  resultPreview?: unknown;
  resultPayload?:
    | {
        version: 2;
        kind: "tool_result";
        conversationId: string;
        toolCallId: string;
        logicalPath: string;
        digest: string;
        byteLength: number;
        mediaType: "application/json";
        encoding: "utf-8";
        completeness: "complete" | "legacy_bounded";
      }
    | undefined;
  validatedArtifacts?:
    | {
        version: 1;
        id: string;
        role: "primary_result" | "supporting_data" | "overflow_recovery";
        access:
          | { kind: "agent_file"; path: string }
          | { kind: "managed_reference"; logicalPath: string }
          | { kind: "metadata_only"; location?: string | undefined };
        availability: "available" | "unavailable";
        format: {
          kind:
            | "text"
            | "image"
            | "markdown"
            | "json"
            | "jsonl"
            | "binary"
            | "directory_manifest";
          mediaType: string;
          encoding?: "utf-8" | undefined;
        };
        size: {
          bytes: number;
          lines?: number | undefined;
          items?: number | undefined;
          itemKind?: string | undefined;
        };
        recommendedTools: ("read" | "grep" | "explain_image")[];
        label: string;
        unavailableReason?:
          | "missing"
          | "unsafe_path"
          | "symlink"
          | "not_regular"
          | "unsupported_format"
          | "validation_failed"
          | undefined;
      }[]
    | undefined;
  agentProjection?:
    | {
        version: 1;
        profile:
          | "source_text"
          | "process_diagnostics"
          | "search_matches"
          | "file_listing"
          | "search_summaries"
          | "network_prose"
          | "resource_detail"
          | "mutation_acknowledgement"
          | "lifecycle_state"
          | "primary_file_result"
          | "human_response"
          | "vision_explanation"
          | "terminal_outcome"
          | "conservative_fallback";
        strategy:
          | "terminal_outcome"
          | "unchanged"
          | "head"
          | "tail"
          | "head_tail"
          | "compact_diagnostic"
          | "item_aware"
          | "continuation_aware"
          | "artifact_index"
          | "task_log_window";
        terminalOutcomePrecedence: boolean;
        fastPath: boolean;
        recovery: "none" | "artifact" | "complete_payload";
        artifactRoles: (
          | "primary_result"
          | "supporting_data"
          | "overflow_recovery"
        )[];
        counts: {
          kind: "line" | "byte" | "item" | "event" | "task";
          original: number;
          displayed: number;
          omitted: number;
        }[];
        originalTextBytes: number;
        displayedTextBytes: number;
        originalTextLines: number;
        displayedTextLines: number;
        perTask?:
          | {
              index: number;
              decision: "outcome" | "index" | "inline";
              displayedBytes: number;
              displayedLines: number;
            }[]
          | undefined;
        continuation?:
          | (
              | {
                  kind: "line";
                  nextOffset: number;
                  displayedStart: number;
                  displayedEnd: number;
                  total: number;
                }
              | {
                  kind: "byte";
                  nextByteOffset: number;
                  displayedStart: number;
                  displayedEnd: number;
                  total: number;
                }
              | {
                  kind: "cursor";
                  cursorName: string;
                  value: string | number;
                  direction: "before" | "after";
                }
              | { kind: "page_token"; parameter: string; value: string }
            )[]
          | undefined;
      }
    | undefined;
  agentPreview?:
    | {
        version: 1;
        blocks: (
          | { type: "text"; text: string }
          | {
              type: "image";
              mimeType: string;
              byteLength: number;
              digest?: string;
              resultContentBlockIndex: number;
            }
        )[];
      }
    | undefined;
  error?: string | undefined;
  errorDetails?:
    | {
        code: string;
        message: string;
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
      }
    | undefined;
  settledAt?: string | undefined;
};

export type ToolCallTranscriptRecord = Omit<
  ToolCallRecord,
  | "args"
  | "result"
  | "resultPayload"
  | "validatedArtifacts"
  | "agentProjection"
  | "agentPreview"
> & {
  argsPreview?: unknown;
  previewOverflow?: {
    hidden: number;
    noun: string;
    direction?: "head" | "tail" | "mixed";
  };
};

export type CompleteToolResultDescriptor = {
  status: "inline" | "legacy_bounded" | "unavailable" | "payload" | "corrupt";
  hasResult: boolean;
  byteLength: number;
  mediaType: "application/json";
  encoding: "utf-8";
  digest?: string | undefined;
};

export type ToolCallDetails = {
  toolCall: ToolCallRecord;
  completeResult: {
    status: "inline" | "legacy_bounded" | "unavailable" | "payload" | "corrupt";
    hasResult: boolean;
    byteLength: number;
    mediaType: "application/json";
    encoding: "utf-8";
    digest?: string | undefined;
  };
};

export type ToolCallResultChunk = {
  status: "inline" | "legacy_bounded" | "unavailable" | "payload" | "corrupt";
  totalBytes: number;
  byteOffset: number;
  nextByteOffset: number;
  text: string;
  done: boolean;
};
