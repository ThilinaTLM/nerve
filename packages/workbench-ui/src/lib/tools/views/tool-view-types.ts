import type {
  ConfluenceAttachmentSummaryPayload,
  ConfluenceIncludedCountsPayload,
  ConfluencePageSummaryPayload,
  ConfluencePublishOutcomePayload,
  ConfluenceSpaceSummaryPayload,
  ExploreReportSummaryPayload,
  FileEntry,
  GrepMatch,
  JiraFieldSummaryPayload,
  JiraIncludedCountsPayload,
  JiraIssueSummaryPayload,
  JiraProjectSummaryPayload,
  JiraTransitionSummaryPayload,
  JiraUserSummaryPayload,
  ProcessStreamResultDetails,
  PythonArtifactResultDetails,
  TaskLogEvent,
  TaskRecord,
  TodoItem,
  ToolOutputArtifactPayload,
  ToolOutputLimitsPayload,
} from "@nervekit/contracts";
import type { RedactedStructuredEntry } from "../lifecycle/argument-source";

export type ToolOutputInfo = {
  outputLimits?: ToolOutputLimitsPayload;
  outputArtifacts?: ToolOutputArtifactPayload[];
};

export type JiraToolAction =
  | "search_users"
  | "search_issues"
  | "get_issue"
  | "get_project"
  | "create_issue"
  | "update_issue"
  | "add_comment"
  | "transition_issue";

export type ConfluenceToolAction =
  | "search_spaces"
  | "search_pages"
  | "get_page"
  | "download_pages"
  | "create_page"
  | "update_page"
  | "publish_pages"
  | "upload_attachment";

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
  thinkingLevel?: string;
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

export type ExploreTaskAction = {
  text: string;
  mono: boolean;
};

export type ExploreTaskState = {
  /** Stable key so rows never reshuffle. */
  key: string;
  index?: number;
  count?: number;
  label?: string;
  task?: string;
  agentId?: string;
  model?: string;
  thinkingLevel?: string;
  status: ExploreTaskStatus;
  /** De-noised latest activity while running. */
  currentAction?: string;
  /** Whether currentAction is a concrete tool action (render as mono). */
  currentActionMono: boolean;
  /** Recent display-safe activity lines while running. */
  recentActions: ExploreTaskAction[];
  /** Latest three display messages for the sub-agent card. */
  recentMessages: ExploreTaskAction[];
  /** Count of tool_call updates seen (activity meter). */
  actionCount: number;
  report?: ExploreReportSummaryPayload;
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
      lineCount?: number;
      image?: { dataUrl: string; mimeType: string };
      content?: string;
      truncated: boolean;
      outputLimits?: ToolOutputLimitsPayload;
      outputArtifacts?: ToolOutputArtifactPayload[];
    }
  | {
      kind: "bash";
      command?: string;
      exitCode?: number;
      signal?: string | null;
      backgroundTask?: {
        taskId: string;
        status: TaskRecord["status"];
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
      additions: number;
      deletions: number;
      diff?: string;
      diffLineCount: number;
      dryRun?: boolean;
    }
  | {
      kind: "write";
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
      liveLog?: string;
    }
  | { kind: "task_status"; tasks: TaskRecord[] }
  | {
      kind: "task_logs";
      task?: TaskRecord;
      events: TaskLogEvent[];
      eventCount: number;
      mode?: string;
    }
  | {
      kind: "explore";
      task?: string;
      reports: ExploreReportSummaryPayload[];
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
      kind: "jira";
      action: JiraToolAction;
      toolName: string;
      content?: string;
      contentLineCount: number;
      messageLines: string[];
      query?: string;
      jql?: string;
      issueKey?: string;
      projectKey?: string;
      issueType?: string;
      summary?: string;
      issue?: JiraIssueSummaryPayload;
      issues: JiraIssueSummaryPayload[];
      issueCount?: number;
      displayedIssueCount?: number;
      total?: number;
      nextPageToken?: string;
      users: JiraUserSummaryPayload[];
      userCount?: number;
      displayedUserCount?: number;
      project?: JiraProjectSummaryPayload;
      includedCounts?: JiraIncludedCountsPayload;
      dryRun?: boolean;
      resolvedAssignee?: JiraUserSummaryPayload;
      updatedFields?: string[];
      updatedFieldCount?: number;
      commentId?: string;
      transition?: JiraTransitionSummaryPayload;
      transitions: JiraTransitionSummaryPayload[];
      fields: JiraFieldSummaryPayload[];
      payload?: unknown;
      fieldCount?: number;
      displayedFieldCount?: number;
      transitionCount?: number;
      displayedTransitionCount?: number;
      outputLimits?: ToolOutputLimitsPayload;
      outputArtifacts?: ToolOutputArtifactPayload[];
    }
  | {
      kind: "confluence";
      action: ConfluenceToolAction;
      toolName: string;
      content?: string;
      contentLineCount: number;
      messageLines: string[];
      query?: string;
      cql?: string;
      pageId?: string;
      spaceId?: string;
      spaceKey?: string;
      title?: string;
      status?: string;
      bodyFormat?: string;
      spaces: ConfluenceSpaceSummaryPayload[];
      space?: ConfluenceSpaceSummaryPayload;
      spaceCount?: number;
      displayedSpaceCount?: number;
      pages: ConfluencePageSummaryPayload[];
      page?: ConfluencePageSummaryPayload;
      pageCount?: number;
      displayedPageCount?: number;
      attachments: ConfluenceAttachmentSummaryPayload[];
      attachment?: ConfluenceAttachmentSummaryPayload;
      attachmentCount?: number;
      displayedAttachmentCount?: number;
      includedCounts?: ConfluenceIncludedCountsPayload;
      downloadDir?: string;
      manifestPath?: string;
      pagesJsonlPath?: string;
      inputPath?: string;
      nextCursor?: string;
      outcomes: ConfluencePublishOutcomePayload[];
      outcomeCount?: number;
      displayedOutcomeCount?: number;
      dryRun?: boolean;
      payload?: unknown;
      outputLimits?: ToolOutputLimitsPayload;
      outputArtifacts?: ToolOutputArtifactPayload[];
    }
  | {
      kind: "web_search";
      query?: string;
      answer?: string;
      results: Array<{
        title: string;
        url: string;
        content?: string;
        score?: number;
      }>;
      outputLimits?: ToolOutputLimitsPayload;
      outputArtifacts?: ToolOutputArtifactPayload[];
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
      kind: "generic";
      toolName: string;
      args: RedactedStructuredEntry[];
      result: RedactedStructuredEntry[];
      resultText?: string;
    };
