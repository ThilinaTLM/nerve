import type {
  QuickScriptArtifact,
  QuickScriptHostCall,
  QuickScriptOperation,
  QuickScriptPageReport,
  FileEntry,
  GrepMatch,
  ProcessStreamResultDetails,
  PythonArtifactResultDetails,
  TodoItem,
  ToolOutputArtifactPayload,
  ToolOutputLimitsPayload,
} from "@nervekit/contracts/tools";
import type { ExtensionDisplayKind } from "@nervekit/contracts/extensions";
import type { LaunchStatus } from "@nervekit/contracts/launches";
import type { UserInputAnswer } from "@nervekit/contracts/core";
import type { RedactedStructuredEntry } from "../lifecycle/argument-source";

export type AskUserViewOption = {
  /** Undefined while the option object is open but its label has not streamed. */
  label?: string;
  description?: string;
  recommended?: boolean;
};

/** One ask_user question; fields are optional only while arguments stream. */
export type AskUserViewQuestion = {
  id: string;
  question?: string;
  context?: string;
  recommendation?: string;
  options: AskUserViewOption[];
  answer?: UserInputAnswer;
  skipped?: boolean;
};

export type GrepMatchView = GrepMatch & { openPath?: string };
export type GroupedMatches = {
  path: string;
  openPath?: string;
  matches: GrepMatchView[];
};

/** One `subagent_prompt` assignment, joined with its result line when settled. */
export type SubagentAssignmentView = {
  name: string;
  /** Profile named by the call, else the one the result line reports. */
  profile?: string;
  prompt: string;
  /** Whether the call created the sub-agent or queued a follow-up. */
  disposition?: "created" | "follow_up" | "rejected";
  reason?: string;
  agentId?: string;
  /** Sub-agent state reported by the result when the follow-up was queued. */
  queuedState?: string;
};

/** One line of a `subagent_status` listing. */
export type SubagentStatusRow = {
  name: string;
  agentId?: string;
  contextPercent?: number;
  lastActivityAt?: string;
  profile?: string;
  state: string;
  context?: string;
  activity?: string;
};

/** One line of a `subagent_stop` result. */
export type SubagentStopLine = {
  name: string;
  outcome: "stopped" | "already_idle" | "not_found" | "failed";
  runMs?: number;
  reason?: string;
};

export type ToolView =
  | {
      kind: "read";
      path?: string;
      relPath?: string;
      lineLabel?: string;
      lineCount?: number;
      image?: { dataUrl: string; mimeType: string };
      content?: string;
      truncated: boolean;
      outputLimits?: ToolOutputLimitsPayload;
      outputArtifacts?: ToolOutputArtifactPayload[];
    }
  | {
      kind: "quick_script";
      code?: string;
      output: string;
      /** Script-level status; absent while running or when details are missing. */
      status?:
        | "completed"
        | "failed"
        | "timed_out"
        | "cancelled"
        | "memory_limit";
      error?: string;
      durationMs?: number;
      outputTruncated?: boolean;
      hostCalls: QuickScriptHostCall[];
      /** Operations the admission scan found, shown before the script runs and when it never ran. */
      plannedOperations: QuickScriptOperation[];
      /** Confluence pages the run wrote, with the linter's report. */
      pages: QuickScriptPageReport[];
      /** Files the run wrote to the conversation artifact folder. */
      artifacts: QuickScriptArtifact[];
      /** Entities the run created (`SCRUM-6`, `comment 77 on SCRUM-6`). */
      created: string[];
      live?: boolean;
    }
  | {
      kind: "bash";
      command?: string;
      exitCode?: number;
      signal?: string | null;
      backgroundTask?: {
        taskId: string;
        status: LaunchStatus;
        elapsedMs: number;
        terminalUpdate: "automatic";
      };
      output: string;
      outputLineCount: number;
      savedTo?: string;
      truncated: boolean;
      live?: boolean;
      outputLimits?: ToolOutputLimitsPayload;
      outputArtifacts?: ToolOutputArtifactPayload[];
    }
  | {
      kind: "python";
      inputMode?: "inline" | "file";
      code?: string;
      codeLineCount: number;
      scriptPath?: string;
      relScriptPath?: string;
      exitCode?: number;
      signal?: string | null;
      output: string;
      outputLineCount: number;
      savedTo?: string;
      truncated: boolean;
      live?: boolean;
      allowNetwork?: boolean;
      allowFileWrite?: boolean;
      durationMs?: number;
      timedOut?: boolean;
      timeoutKilled?: boolean;
      envKeys?: string[];
      artifactDir?: string;
      artifacts?: PythonArtifactResultDetails[];
      streams?: {
        stdout?: ProcessStreamResultDetails;
        stderr?: ProcessStreamResultDetails;
        combined?: ProcessStreamResultDetails;
      };
      outputLimits?: ToolOutputLimitsPayload;
      outputArtifacts?: ToolOutputArtifactPayload[];
    }
  | {
      kind: "edit";
      path?: string;
      relPath?: string;
      operationCount: number;
      operations?: Array<{
        index: number;
        status: "applied" | "failed" | "not_applied";
        error?: string;
      }>;
      appliedCount?: number;
      additions: number;
      deletions: number;
      diff?: string;
      diffLineCount: number;
      dryRun?: boolean;
    }
  | {
      kind: "write";
      outcome?: "created" | "overwritten";
      path?: string;
      relPath?: string;
      bytes?: number;
      lineCount?: number;
      charCount?: number;
      content?: string;
    }
  | {
      kind: "grep";
      pattern?: string;
      matchCount: number;
      totalMatches?: number;
      totalFiles?: number;
      fileCount: number;
      allMatches: GroupedMatches[];
    }
  | {
      kind: "find";
      totalEntries?: number;
      pattern?: string;
      paths: string[];
      openPaths: string[];
      count: number;
    }
  | {
      kind: "ls";
      totalEntries?: number;
      path?: string;
      relPath?: string;
      entries: Array<FileEntry & { openPath?: string }>;
      total: number;
    }
  | {
      kind: "ask_user";
      questions: AskUserViewQuestion[];
      /** The whole call was dismissed; unanswered questions read "Not answered". */
      dismissed: boolean;
      /** Arguments are still streaming in: missing values render as skeletons. */
      streaming?: boolean;
    }
  | {
      kind: "todos";
      items: TodoItem[];
      completed: number;
      total: number;
    }
  | {
      kind: "subagent";
      action: "prompt";
      context?: string;
      assignments: SubagentAssignmentView[];
    }
  | {
      kind: "subagent";
      action: "status";
      name?: string;
      /** Listing without a name. */
      rows: SubagentStatusRow[];
      /** First line of a single sub-agent's answer. */
      header?: string;
      /** Final response or recent activity of a single sub-agent. */
      body?: string;
    }
  | {
      kind: "subagent";
      action: "stop";
      names: string[];
      lines: SubagentStopLine[];
    }
  | {
      kind: "plan_present";
      action: "present";
      summary?: string;
      planPreview?: string;
      planPath?: string;
      outcome?: string;
    }
  | {
      kind: "extension";
      toolName: string;
      /** Id of the extension that contributes the tool. */
      extension: string;
      /** How the result renders; `value` is the method's result as data when it was small enough to carry. */
      display: { kind: ExtensionDisplayKind; value?: unknown };
      artifacts: QuickScriptArtifact[];
      /** The result text the agent saw; the fallback when `value` is absent. */
      resultText?: string;
    }
  | {
      kind: "web_fetch";
      url?: string;
      status?: number;
      contentType?: string;
      size?: number;
      savedTo?: string;
      converted: boolean;
      content?: string;
      outputLimits?: ToolOutputLimitsPayload;
      outputArtifacts?: ToolOutputArtifactPayload[];
    }
  | {
      kind: "explain_image";
      path?: string;
      relPath?: string;
      explanation?: string;
      thinking?: string;
      liveExplanation?: string;
      live: boolean;
      outputLimits?: ToolOutputLimitsPayload;
    }
  | {
      kind: "generic";
      toolName: string;
      args: RedactedStructuredEntry[];
      result: RedactedStructuredEntry[];
      resultText?: string;
    };
