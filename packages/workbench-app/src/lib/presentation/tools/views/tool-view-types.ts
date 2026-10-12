import type {
  ConfluenceAttachmentSummaryPayload,
  ConfluenceCommentSummaryPayload,
  ConfluenceIncludedCountsPayload,
  ConfluenceLabelSummaryPayload,
  ConfluencePageSummaryPayload,
  ConfluenceRestrictionSummaryPayload,
  ConfluencePublishOutcomePayload,
  ConfluenceSpaceSummaryPayload,
  FileEntry,
  GrepMatch,
  JiraAttachmentSummaryPayload,
  JiraBoardSummaryPayload,
  JiraCommentSummaryPayload,
  JiraFieldSummaryPayload,
  JiraIncludedCountsPayload,
  JiraIssueLinkSummaryPayload,
  JiraIssueSummaryPayload,
  JiraProjectSummaryPayload,
  JiraSprintSummaryPayload,
  JiraTransitionSummaryPayload,
  JiraUserSummaryPayload,
  JiraWorklogSummaryPayload,
  ProcessStreamResultDetails,
  PythonArtifactResultDetails,
  TodoItem,
  ToolOutputArtifactPayload,
  ToolOutputLimitsPayload,
} from "@nervekit/contracts/tools";
import type { LaunchStatus } from "@nervekit/contracts/launches";
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
  | "search_boards"
  | "get_board"
  | "get_sprint"
  | "download_attachment"
  | "create_issue"
  | "update_issue"
  | "manage_comment"
  | "manage_worklog"
  | "manage_issue_link"
  | "manage_attachment"
  | "manage_sprint"
  | "manage_backlog"
  | "transition_issue";

export type ConfluenceToolAction =
  | "search_spaces"
  | "search_pages"
  | "get_page"
  | "download_page"
  | "create_page"
  | "update_page"
  | "manage_comment"
  | "manage_page"
  | "manage_label"
  | "manage_restriction"
  | "manage_attachment";

export type GrepMatchView = GrepMatch & { openPath?: string };
export type GroupedMatches = {
  path: string;
  openPath?: string;
  matches: GrepMatchView[];
};

export type SubagentToolAction = "prompt" | "status" | "stop";

/** One `subagent_prompt` assignment, joined with its result line when settled. */
export type SubagentAssignmentView = {
  name: string;
  /** Profile named by the call, else the one the result line reports. */
  profile?: string;
  prompt: string;
  /** Whether the call created the sub-agent or queued a follow-up. */
  disposition?: "created" | "follow_up";
  /** Sub-agent state reported by the result when the follow-up was queued. */
  queuedState?: string;
};

/** One line of a `subagent_status` listing. */
export type SubagentStatusRow = {
  name: string;
  profile?: string;
  state: string;
  context?: string;
  activity?: string;
};

/** One line of a `subagent_stop` result. */
export type SubagentStopLine = { name: string; outcome: string };

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
      kind: "kroki_export";
      /** Footer tag such as "mermaid → SVG". */
      conversion: string;
      path?: string;
      bytes?: number;
    }
  | {
      kind: "generate_image";
      prompt?: string;
      paths: string[];
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
      kind: "plan_mode";
      action: "present";
      summary?: string;
      planPreview?: string;
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
      operation?: string;
      boardId?: string;
      board?: JiraBoardSummaryPayload;
      boards: JiraBoardSummaryPayload[];
      boardCount?: number;
      displayedBoardCount?: number;
      startAt?: number;
      maxResults?: number;
      sprintId?: string;
      sprint?: JiraSprintSummaryPayload;
      sprints: JiraSprintSummaryPayload[];
      sprintCount?: number;
      backlogIssues: JiraIssueSummaryPayload[];
      backlogCount?: number;
      attachmentId?: string;
      attachment?: JiraAttachmentSummaryPayload;
      attachments: JiraAttachmentSummaryPayload[];
      filename?: string;
      mediaType?: string;
      bytes?: number;
      path?: string;
      comment?: JiraCommentSummaryPayload;
      worklogId?: string;
      worklog?: JiraWorklogSummaryPayload;
      issueLink?: JiraIssueLinkSummaryPayload;
      linkId?: string;
      otherIssueKey?: string;
      linkType?: string;
      direction?: "outward" | "inward";
      rankBeforeIssueKey?: string;
      rankAfterIssueKey?: string;
      previousState?: string;
      resultingState?: string;
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
      operation?: string;
      commentId?: string;
      comment?: ConfluenceCommentSummaryPayload;
      commentKind?: "footer" | "inline";
      label?: string;
      labels: ConfluenceLabelSummaryPayload[];
      labelCount?: number;
      prefix?: string;
      restrictionOperation?: "read" | "update";
      subjectType?: "user" | "group";
      subjectId?: string;
      restrictions: ConfluenceRestrictionSummaryPayload[];
      restrictionCount?: number;
      previousStatus?: string;
      resultingStatus?: string;
      attachmentId?: string;
      filename?: string;
      newFilename?: string;
      bytes?: number;
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
