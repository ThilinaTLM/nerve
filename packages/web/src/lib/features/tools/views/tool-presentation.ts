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
import type { MetaItem, ToolPresentation } from "./tool-presentation-types";
import type { ToolCallDisplayRecord } from "./tool-result-parser";
import {
  aggregateExploreTasks,
  COLLAPSED_LINES,
  type ToolView,
} from "./tool-result-view";

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
  const base = { badge: toolCall.toolName, meta: [], dotTone, dotPulse };

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
      if (view.codeLineCount > 0)
        meta.push({ text: plural(view.codeLineCount, "code line") });
      if (lines > 0) meta.push({ text: plural(lines, "line") });
      if (view.allowFileWrite === false)
        meta.push({ text: "writes off", tone: "warning" });
      if (view.envKeys && view.envKeys.length > 0)
        meta.push({ text: plural(view.envKeys.length, "env") });
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
          : view.mode
            ? { text: view.mode }
            : undefined,
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

    case "web_search":
      return {
        ...base,
        primaryArg: view.query ? { text: view.query } : undefined,
        meta: [
          { text: plural(view.results.length, "result") },
          ...outputMeta(view),
        ],
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
      // Status / exit / signal / runtime metadata render on the TaskRow badges
      // and tooltip in the body, so the header stays minimal.
      const task = view.task ?? view.tasks?.[0];
      return {
        ...base,
        badge: `task_${view.action}`,
        primaryArg: task?.name ? { text: task.name } : undefined,
      };
    }

    case "task_list":
      return {
        ...base,
        meta: [{ text: plural(view.tasks.length, "task", "s") }],
      };

    case "explore": {
      const { summary } = aggregateExploreTasks(view);
      const meta: MetaItem[] = [];
      // Per-agent report paths, model, turns, and token usage render inside the
      // explore rows; keep the generic footer reserved for high-signal status.
      if (summary.failed > 0)
        meta.push({ text: `${summary.failed} failed`, tone: "error" });
      return {
        ...base,
        primaryArg: undefined,
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
        primaryArg: view.planPath
          ? { text: view.planPath, openPath: view.planPath }
          : undefined,
        meta: [],
        detailsAction: previewDetailsAction,
      };

    default:
      return base;
  }
}
