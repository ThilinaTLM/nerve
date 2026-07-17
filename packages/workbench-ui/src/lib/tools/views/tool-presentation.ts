import {
  basename,
  detailsActionFor,
  detailsActionFromHidden,
  formatBytes,
  formatDuration,
  lineCount,
  plural,
  statusDot,
} from "./tool-presentation-helpers";
import type {
  MetaItem,
  PrimaryArg,
  ToolPresentation,
} from "./tool-presentation-types";
import type { ToolCallDisplayRecord } from "./tool-result-parser";
import {
  aggregateExploreTasks,
  ATLASSIAN_COLLAPSED_ITEMS,
  COLLAPSED_LINES,
  type ToolView,
} from "./tool-result-view";
import { presentToolArguments } from "../lifecycle/registry";

export type {
  DetailsActionInfo,
  MetaItem,
  MetaTone,
  PrimaryArg,
  ToolPresentation,
} from "./tool-presentation-types";

// Presentation is a pure product of (view, toolCall); the cached view object
// from parseToolViewCached is a stable identity per tool-call revision, so a
// WeakMap keyed by it lets re-renders/re-mounts reuse the derived header/meta.
const presentationCache = new WeakMap<ToolView, ToolPresentation>();

/** Cached wrapper around {@link toolPresentation}, keyed by the parsed view. */
export function toolPresentationCached(
  view: ToolView,
  toolCall: ToolCallDisplayRecord,
): ToolPresentation {
  const cached = presentationCache.get(view);
  if (cached) return cached;
  const presentation = toolPresentation(view, toolCall);
  presentationCache.set(view, presentation);
  return presentation;
}

/** Derive the header (badge + primary arg) and footer (meta chips) for a tool. */
function formatCount(
  value: number | undefined,
  noun: string,
): string | undefined {
  if (value === undefined || value <= 0) return undefined;
  return `${value.toLocaleString()} ${noun}${value === 1 ? "" : "s"}`;
}

/**
 * Footer details action for Atlassian views: the first item list exceeding the
 * collapsed card budget wins; otherwise fall back to hidden content lines.
 */
function atlassianDetailsAction(
  itemGroups: ReadonlyArray<readonly [count: number, noun: string]>,
  contentLineCount: number,
) {
  for (const [count, noun] of itemGroups) {
    if (count > ATLASSIAN_COLLAPSED_ITEMS) {
      return detailsActionFor(count, noun, "head", ATLASSIAN_COLLAPSED_ITEMS);
    }
  }
  return detailsActionFor(contentLineCount, "lines");
}

function isOneLine(text: string | undefined): boolean {
  return Boolean(
    text && !text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").includes("\n"),
  );
}

function hasOutputArtifactPath(
  view: ToolView,
  path: string | undefined,
): boolean {
  return Boolean(
    path &&
    "outputArtifacts" in view &&
    view.outputArtifacts?.some((artifact) => artifact.path === path),
  );
}

function confluencePrimaryArg(
  view: Extract<ToolView, { kind: "confluence" }>,
): PrimaryArg | undefined {
  switch (view.action) {
    case "search_spaces":
      return view.query ? { text: view.query } : undefined;
    case "search_pages":
      return view.cql
        ? { text: view.cql }
        : view.query
          ? { text: view.query }
          : undefined;
    case "download_pages":
      return view.downloadDir
        ? { text: basename(view.downloadDir), openPath: view.downloadDir }
        : view.pageId
          ? { text: view.pageId }
          : undefined;
    case "publish_pages":
      return view.inputPath
        ? { text: basename(view.inputPath), openPath: view.inputPath }
        : undefined;
    case "upload_attachment":
      return view.attachment?.filename
        ? { text: view.attachment.filename }
        : view.pageId
          ? { text: view.pageId }
          : undefined;
    case "get_page":
    case "create_page":
    case "update_page":
      return view.page?.title
        ? {
            text: view.page.id
              ? `${view.page.id} · ${view.page.title}`
              : view.page.title,
          }
        : view.pageId
          ? { text: view.pageId }
          : view.title
            ? { text: view.title }
            : undefined;
    default:
      return undefined;
  }
}

function jiraPrimaryArg(
  view: Extract<ToolView, { kind: "jira" }>,
): PrimaryArg | undefined {
  switch (view.action) {
    case "search_users":
      return view.query ? { text: view.query } : undefined;
    case "search_issues":
      return view.jql ? { text: view.jql } : undefined;
    case "get_project": {
      const label = view.project?.name
        ? `${view.project.key} · ${view.project.name}`
        : (view.projectKey ?? view.project?.key);
      return label ? { text: label } : undefined;
    }
    case "create_issue":
      return view.issueKey
        ? { text: view.issueKey }
        : view.summary
          ? {
              text: view.issueType
                ? `${view.issueType} · ${view.summary}`
                : view.summary,
            }
          : undefined;
    case "get_issue":
    case "update_issue":
    case "add_comment":
    case "transition_issue":
      return view.issueKey ? { text: view.issueKey } : undefined;
    default:
      return undefined;
  }
}

function outputMeta(view: ToolView): MetaItem[] {
  const limits = "outputLimits" in view ? view.outputLimits : undefined;
  const artifacts =
    "outputArtifacts" in view ? view.outputArtifacts : undefined;
  const meta: MetaItem[] = [];
  if (limits?.model?.truncated) {
    const lines = formatCount(limits.model.omittedLines, "line");
    const chars = formatCount(limits.model.omittedChars, "char");
    meta.push({
      text: ["LLM trimmed", lines ?? chars].filter(Boolean).join(" · "),
      tone: "warning",
    });
  }
  if (limits?.live?.capped) {
    const chars = formatCount(limits.live.omittedChars, "char");
    meta.push({
      text: ["live tail", chars ? `${chars} omitted` : undefined]
        .filter(Boolean)
        .join(" · "),
      tone: "info",
    });
  }
  for (const artifact of artifacts ?? []) {
    const label =
      artifact.kind === "raw_result"
        ? "raw result"
        : artifact.kind === "fetched_content"
          ? "fetched content"
          : "full output";
    meta.push({ text: label, mono: true, openPath: artifact.path });
  }
  return meta;
}

export function toolPresentation(
  view: ToolView,
  toolCall: ToolCallDisplayRecord,
): ToolPresentation {
  const previewOverflow =
    "previewOverflow" in toolCall ? toolCall.previewOverflow : undefined;
  const previewDetailsAction = previewOverflow
    ? detailsActionFromHidden(
        previewOverflow.hidden,
        previewOverflow.noun,
        previewOverflow.direction,
      )
    : undefined;
  const { tone: dotTone, pulse: dotPulse } = statusDot(toolCall, view);
  const payloads = toolCall as ToolCallDisplayRecord & {
    args?: unknown;
    argsPreview?: unknown;
  };
  const argumentPresentation = presentToolArguments(
    toolCall.toolName,
    { args: payloads.args, argsPreview: payloads.argsPreview },
    "completed",
    toolCall.cwd,
  );
  const base: ToolPresentation = {
    badge: toolCall.toolName,
    primaryArg: argumentPresentation.primaryArg,
    meta: [],
    dotTone,
    dotPulse,
  };

  switch (view.kind) {
    case "read": {
      const primaryArg = view.relPath
        ? { text: view.relPath, openPath: view.path }
        : undefined;
      if (view.image) {
        return { ...base, primaryArg, meta: [{ text: "image" }] };
      }
      const meta: MetaItem[] = [];
      if (view.lineLabel) meta.push({ text: view.lineLabel });
      if (view.truncated) meta.push({ text: "truncated", tone: "warning" });
      meta.push(...outputMeta(view));
      return {
        ...base,
        primaryArg,
        meta,
        detailsAction:
          previewDetailsAction ??
          detailsActionFor(view.lineCount ?? 0, "lines"),
      };
    }

    case "bash": {
      const meta: MetaItem[] = [];
      const lines = view.outputLineCount;
      if (view.exitCode !== undefined && view.exitCode !== 0) {
        meta.push({ text: `exit ${view.exitCode}`, tone: "error" });
      }
      if (view.signal)
        meta.push({ text: `signal ${view.signal}`, tone: "warning" });
      if (view.backgroundTask) {
        meta.push({
          text: `background ${view.backgroundTask.taskId}`,
          tone: "warning",
          mono: true,
        });
        meta.push({ text: view.backgroundTask.status });
      }
      if (lines > 0) meta.push({ text: plural(lines, "line") });
      if (view.truncated) meta.push({ text: "truncated", tone: "warning" });
      meta.push(...outputMeta(view));
      if (view.savedTo && !hasOutputArtifactPath(view, view.savedTo)) {
        meta.push({
          text: `saved ${basename(view.savedTo)}`,
          mono: true,
          openPath: view.savedTo,
        });
      }
      const commandLines = lineCount(view.command);
      const hiddenInput = Math.max(0, commandLines - COLLAPSED_LINES);
      const hiddenOutput = Math.max(0, lines - COLLAPSED_LINES);
      const hiddenTotal = hiddenInput + hiddenOutput;
      return {
        ...base,
        primaryArg: view.command
          ? isOneLine(view.command)
            ? { text: view.command }
            : { text: "inline" }
          : undefined,
        meta,
        detailsAction:
          previewDetailsAction ??
          (hiddenInput > 0
            ? detailsActionFromHidden(hiddenTotal, "lines", "mixed")
            : detailsActionFor(lines, "lines", "tail")),
      };
    }

    case "python": {
      const meta: MetaItem[] = [];
      const lines = view.outputLineCount;
      if (view.exitCode !== undefined && view.exitCode !== 0) {
        meta.push({ text: `exit ${view.exitCode}`, tone: "error" });
      }
      if (view.signal)
        meta.push({ text: `signal ${view.signal}`, tone: "warning" });
      if (view.timedOut) meta.push({ text: "timed out", tone: "error" });
      const duration = formatDuration(view.durationMs);
      if (duration) meta.push({ text: duration });
      if (lines > 0) meta.push({ text: plural(lines, "line") });
      if (view.artifacts && view.artifacts.length > 0)
        meta.push({
          text: plural(view.artifacts.length, "artifact"),
          tone: "info",
        });
      if (view.streams?.stdout?.truncated)
        meta.push({ text: "stdout truncated", tone: "warning" });
      if (view.streams?.stderr?.truncated)
        meta.push({ text: "stderr truncated", tone: "warning" });
      if (view.truncated) meta.push({ text: "truncated", tone: "warning" });
      meta.push(...outputMeta(view));
      if (view.savedTo && !hasOutputArtifactPath(view, view.savedTo)) {
        meta.push({
          text: `saved ${basename(view.savedTo)}`,
          mono: true,
          openPath: view.savedTo,
        });
      }
      const hiddenCode = Math.max(0, view.codeLineCount - COLLAPSED_LINES);
      const hiddenOutput = Math.max(0, lines - COLLAPSED_LINES);
      const hiddenTotal = hiddenCode + hiddenOutput;
      const detailsAction =
        previewDetailsAction ??
        detailsActionFromHidden(hiddenTotal, "lines", "mixed");
      const primaryArg =
        view.inputMode === "file" && view.relScriptPath
          ? { text: view.relScriptPath, openPath: view.scriptPath }
          : view.code && isOneLine(view.code)
            ? { text: view.code }
            : { text: "inline" };
      return {
        ...base,
        primaryArg,
        meta,
        detailsAction,
      };
    }

    case "edit": {
      const meta: MetaItem[] = [
        { text: plural(view.operationCount, "operation") },
      ];
      if (view.dryRun) meta.push({ text: "preview", tone: "info" });
      if (view.additions > 0)
        meta.push({ text: `+${view.additions}`, tone: "success" });
      if (view.deletions > 0)
        meta.push({ text: `−${view.deletions}`, tone: "error" });
      if (view.diffLineCount > 0)
        meta.push({ text: plural(view.diffLineCount, "diff line") });
      return {
        ...base,
        primaryArg: view.relPath
          ? { text: view.relPath, openPath: view.path }
          : undefined,
        meta,
        detailsAction:
          previewDetailsAction ?? detailsActionFor(view.diffLineCount, "lines"),
      };
    }

    case "write": {
      const meta: MetaItem[] = [];
      if (view.bytes !== undefined)
        meta.push({ text: `wrote ${view.bytes} bytes` });
      if (view.lineCount !== undefined)
        meta.push({ text: plural(view.lineCount, "line") });
      if (view.charCount !== undefined)
        meta.push({ text: plural(view.charCount, "char") });
      return {
        ...base,
        primaryArg: view.relPath
          ? { text: view.relPath, openPath: view.path }
          : undefined,
        meta,
        detailsAction:
          previewDetailsAction ??
          detailsActionFor(view.lineCount ?? 0, "lines"),
      };
    }

    case "grep":
      return {
        ...base,
        primaryArg: view.pattern ? { text: view.pattern } : undefined,
        meta: [
          { text: plural(view.matchCount, "match", "es") },
          { text: plural(view.fileCount, "file") },
        ],
        detailsAction:
          previewDetailsAction ?? detailsActionFor(view.matchCount, "matches"),
      };

    case "find":
      return {
        ...base,
        primaryArg: view.pattern ? { text: view.pattern } : undefined,
        meta: [{ text: plural(view.count, "file") }],
        detailsAction:
          previewDetailsAction ?? detailsActionFor(view.count, "files"),
      };

    case "ls":
      return {
        ...base,
        primaryArg: view.relPath
          ? { text: view.relPath, openPath: view.path }
          : undefined,
        meta: [
          {
            text: `${view.total} ${view.total === 1 ? "entry" : "entries"}`,
          },
        ],
        detailsAction:
          previewDetailsAction ?? detailsActionFor(view.total, "entries"),
      };

    case "task_logs": {
      const meta: MetaItem[] = [{ text: plural(view.eventCount, "event") }];
      if (view.mode) meta.push({ text: view.mode });
      return {
        ...base,
        primaryArg: view.task?.name
          ? { text: view.task.name }
          : base.primaryArg,
        meta,
        detailsAction:
          previewDetailsAction ??
          detailsActionFor(view.eventCount, "events", "tail"),
      };
    }

    case "web_fetch": {
      const meta: MetaItem[] = [];
      if (view.status !== undefined) {
        meta.push({
          text: `${view.status}`,
          tone: view.status >= 400 ? "error" : "success",
        });
      }
      if (view.contentType) meta.push({ text: view.contentType });
      const size = formatBytes(view.size);
      if (size) meta.push({ text: size });
      if (view.converted) meta.push({ text: "markdown", tone: "info" });
      if (view.savedTo && !hasOutputArtifactPath(view, view.savedTo))
        meta.push({
          text: `saved ${basename(view.savedTo)}`,
          mono: true,
          openPath: view.savedTo,
        });
      meta.push(...outputMeta(view));
      return {
        ...base,
        primaryArg: view.url ? { text: view.url, href: view.url } : undefined,
        meta,
        detailsAction:
          previewDetailsAction ??
          detailsActionFor(lineCount(view.content), "lines"),
      };
    }

    case "jira": {
      const meta: MetaItem[] = [];
      if (view.dryRun) meta.push({ text: "preview", tone: "info" });
      const countChip = (count: number | undefined, noun: string) => {
        if (count !== undefined) meta.push({ text: plural(count, noun) });
      };
      switch (view.action) {
        case "search_users":
          countChip(view.userCount ?? view.users.length, "user");
          if (view.projectKey)
            meta.push({ text: `project ${view.projectKey}`, mono: true });
          if (view.issueKey) meta.push({ text: view.issueKey, mono: true });
          break;
        case "search_issues":
          countChip(view.issueCount ?? view.issues.length, "issue");
          if (view.total !== undefined && view.total !== view.issueCount) {
            meta.push({ text: `${view.total} total` });
          }
          if (view.nextPageToken)
            meta.push({ text: "next page", tone: "info" });
          break;
        case "get_issue":
          if (view.issue?.issueType) meta.push({ text: view.issue.issueType });
          if (view.issue?.status) meta.push({ text: view.issue.status });
          if (view.issue?.assignee)
            meta.push({ text: `assignee ${view.issue.assignee}` });
          if (view.includedCounts?.comments !== undefined) {
            countChip(view.includedCounts.comments, "comment");
          }
          if (view.includedCounts?.transitions !== undefined) {
            countChip(view.includedCounts.transitions, "transition");
          }
          break;
        case "get_project":
          if (view.project?.projectTypeKey)
            meta.push({ text: view.project.projectTypeKey });
          if (view.includedCounts?.statuses !== undefined) {
            meta.push({ text: `${view.includedCounts.statuses} statuses` });
          }
          if (view.includedCounts?.components !== undefined) {
            countChip(view.includedCounts.components, "component");
          }
          if (view.includedCounts?.versions !== undefined) {
            countChip(view.includedCounts.versions, "version");
          }
          break;
        case "create_issue":
          if (view.projectKey)
            meta.push({ text: `project ${view.projectKey}`, mono: true });
          if (view.issueType) meta.push({ text: view.issueType });
          break;
        case "update_issue": {
          const updated = view.updatedFieldCount ?? view.updatedFields?.length;
          if (updated !== undefined)
            meta.push({ text: `${plural(updated, "field")} updated` });
          break;
        }
        case "add_comment":
          if (view.commentId)
            meta.push({ text: `comment ${view.commentId}`, mono: true });
          break;
        case "transition_issue":
          if (view.transition?.name) meta.push({ text: view.transition.name });
          if (view.transition?.to)
            meta.push({ text: `to ${view.transition.to}` });
          if (!view.transition)
            countChip(
              view.transitionCount ?? view.transitions.length,
              "transition",
            );
          break;
      }
      meta.push(...outputMeta(view));
      const detailsAction =
        previewDetailsAction ??
        atlassianDetailsAction(
          [
            [view.issues.length, "issues"],
            [view.users.length, "users"],
            [view.transitions.length, "transitions"],
          ],
          view.contentLineCount,
        );
      return {
        ...base,
        primaryArg: jiraPrimaryArg(view),
        meta,
        detailsAction,
      };
    }

    case "confluence": {
      const meta: MetaItem[] = [];
      if (view.dryRun) meta.push({ text: "preview", tone: "info" });
      const countChip = (count: number | undefined, noun: string) => {
        if (count !== undefined) meta.push({ text: plural(count, noun) });
      };
      switch (view.action) {
        case "search_spaces":
          countChip(view.spaceCount ?? view.spaces.length, "space");
          break;
        case "search_pages":
        case "download_pages":
          countChip(view.pageCount ?? view.pages.length, "page");
          if (view.action === "download_pages") {
            const downloaded =
              view.includedCounts?.downloadedAttachments ??
              view.includedCounts?.attachments;
            if (downloaded !== undefined && downloaded > 0) {
              countChip(downloaded, "attachment");
            }
          }
          if (view.bodyFormat) meta.push({ text: view.bodyFormat });
          if (view.downloadDir) {
            meta.push({
              text: "bundle",
              mono: true,
              openPath: view.downloadDir,
            });
          }
          if (view.manifestPath) {
            meta.push({
              text: "manifest",
              mono: true,
              openPath: view.manifestPath,
            });
          }
          if (view.pagesJsonlPath) {
            meta.push({
              text: "pages.jsonl",
              mono: true,
              openPath: view.pagesJsonlPath,
            });
          }
          break;
        case "get_page": {
          // Attachments are not listed in the body; surface the count here.
          // Other include-counts render in the page row and metric strip.
          const attachments =
            view.attachmentCount ?? view.includedCounts?.attachments;
          if (attachments !== undefined && attachments > 0) {
            countChip(attachments, "attachment");
          }
          break;
        }
        case "create_page":
        case "update_page":
          // Space key and version render in the page row's chip line.
          break;
        case "publish_pages":
          countChip(view.outcomeCount ?? view.outcomes.length, "outcome");
          break;
        case "upload_attachment":
          countChip(
            view.attachmentCount ?? view.attachments.length,
            "attachment",
          );
          if (view.pageId)
            meta.push({ text: `page ${view.pageId}`, mono: true });
          break;
      }
      meta.push(...outputMeta(view));
      const detailsAction =
        previewDetailsAction ??
        atlassianDetailsAction(
          [
            [view.pages.length, "pages"],
            [view.spaces.length, "spaces"],
            [view.outcomes.length, "outcomes"],
          ],
          view.contentLineCount,
        );
      return {
        ...base,
        primaryArg: confluencePrimaryArg(view),
        meta,
        detailsAction,
      };
    }

    case "web_search":
      return {
        ...base,
        primaryArg: view.query ? { text: view.query } : undefined,
        meta: [
          { text: plural(view.results.length, "result") },
          ...outputMeta(view),
        ],
        detailsAction: detailsActionFor(view.results.length, "results"),
      };

    case "todos":
      return {
        ...base,
        badge: "todos",
        primaryArg:
          view.total > 0
            ? { text: `${view.completed}/${view.total} done` }
            : undefined,
        meta: [],
      };

    case "task_action": {
      // Status / exit / signal metadata render on the TaskRow badges and
      // tooltip in the body, so the header stays minimal.
      const task = view.task ?? view.tasks?.[0];
      return {
        ...base,
        badge: `task_${view.action}`,
        primaryArg: task?.name ? { text: task.name } : base.primaryArg,
        meta:
          view.action === "cancel" && (view.outcomeCount ?? 0) > 1
            ? [{ text: plural(view.outcomeCount ?? 0, "outcome") }]
            : [],
        detailsAction: previewDetailsAction,
      };
    }

    case "task_status":
      return {
        ...base,
        meta: [{ text: plural(view.taskCount, "task", "s") }],
        detailsAction: detailsActionFromHidden(
          view.hiddenTaskCount,
          "tasks",
          "head",
        ),
      };

    case "explore": {
      const { summary } = aggregateExploreTasks(view);
      const meta: MetaItem[] = [];
      // Per-agent report paths, model, turns, and token usage render inside the
      // explore rows; keep the generic footer reserved for high-signal status.
      if (summary.failed > 0)
        meta.push({ text: `${summary.failed} failed`, tone: "error" });
      const finished = summary.completed + summary.failed;
      const countLabel = `${finished}/${summary.total} ${
        summary.total === 1 ? "agent" : "agents"
      }`;
      return {
        ...base,
        primaryArg: summary.total > 0 ? { text: countLabel } : undefined,
        meta,
      };
    }

    case "ask_user":
      return { ...base, meta: [] };

    case "plan_mode":
      // The presented-plan card renders its own footer (status chip + accept/
      // reject buttons on one line) from live review state inside
      // PlanModeToolView, so the generic footer stays empty here.
      return {
        ...base,
        badge: `plan_mode_${view.action}`,
        primaryArg:
          base.primaryArg ??
          (view.planPath
            ? { text: view.planPath, openPath: view.planPath }
            : undefined),
        meta: [],
        detailsAction: previewDetailsAction,
      };

    default:
      return base;
  }
}
