import type {
  ExploreReportPayload,
  FileEntry,
  GrepMatch,
  ProcessStreamResultDetails,
  PythonArtifactResultDetails,
  TaskLogEvent,
  TaskRecord,
  TodoItem,
} from "@nerve/shared";

export type GrepMatchView = GrepMatch & { openPath?: string };
export type GroupedMatches = {
  path: string;
  openPath?: string;
  matches: GrepMatchView[];
};

export type ExploreProgressView = {
  type: "explore_progress";
  timestamp: string;
  agentId?: string;
  taskIndex?: number;
  taskCount?: number;
  label?: string;
  model?: string;
  phase:
    | "queued"
    | "started"
    | "tool_call"
    | "tool_result"
    | "assistant"
    | "completed"
    | "failed";
  message: string;
};

export type ExploreTaskStatus = "queued" | "running" | "completed" | "failed";

export type ExploreTaskState = {
  /** Stable key so rows never reshuffle. */
  key: string;
  index?: number;
  count?: number;
  label?: string;
  task?: string;
  agentId?: string;
  model?: string;
  status: ExploreTaskStatus;
  /** De-noised latest activity while running. */
  currentAction?: string;
  /** Whether currentAction is a concrete tool action (render as mono). */
  currentActionMono: boolean;
  /** Count of tool_call updates seen (activity meter). */
  actionCount: number;
  report?: ExploreReportPayload;
  error?: string;
};

export type ExploreSummary = {
  total: number;
  completed: number;
  failed: number;
  running: number;
  done: boolean;
};

export type ToolView =
  | {
      kind: "read";
      path?: string;
      relPath?: string;
      lineLabel?: string;
      image?: { dataUrl: string; mimeType: string };
      content?: string;
      truncated: boolean;
    }
  | {
      kind: "bash";
      command?: string;
      exitCode?: number;
      signal?: string | null;
      output: string;
      savedTo?: string;
      truncated: boolean;
      live?: boolean;
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
    }
  | {
      kind: "edit";
      path?: string;
      relPath?: string;
      operationCount: number;
      additions: number;
      deletions: number;
      diff?: string;
      dryRun?: boolean;
    }
  | {
      kind: "write";
      path?: string;
      relPath?: string;
      bytes?: number;
      content?: string;
    }
  | {
      kind: "grep";
      pattern?: string;
      matchCount: number;
      fileCount: number;
      allMatches: GroupedMatches[];
    }
  | {
      kind: "find";
      pattern?: string;
      paths: string[];
      openPaths: string[];
      count: number;
    }
  | {
      kind: "ls";
      path?: string;
      relPath?: string;
      entries: Array<FileEntry & { openPath?: string }>;
      total: number;
    }
  | {
      kind: "ask_user";
      question?: string;
      context?: string;
      recommendation?: string;
      answer?: string;
      dismissed: boolean;
      dismissedReason?: string;
    }
  | {
      kind: "todos";
      items: TodoItem[];
      completed: number;
      total: number;
    }
  | {
      kind: "task_action";
      action: "start" | "cancel" | "restart";
      task?: TaskRecord;
      tasks?: TaskRecord[];
    }
  | { kind: "task_list"; tasks: TaskRecord[] }
  | {
      kind: "task_logs";
      task?: TaskRecord;
      events: TaskLogEvent[];
      mode?: string;
    }
  | {
      kind: "explore";
      task?: string;
      reports: ExploreReportPayload[];
      liveUpdates: ExploreProgressView[];
      liveLog?: string;
    }
  | {
      kind: "plan_mode";
      action: "enter" | "present" | "force_exit";
      summary?: string;
      planPath?: string;
      outcome?: string;
    }
  | {
      kind: "web_search";
      query?: string;
      answer?: string;
      results: Array<{ title: string; url: string }>;
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
    }
  | { kind: "generic" };
