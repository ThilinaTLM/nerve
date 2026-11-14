import {
  basename,
  detailsActionFor,
  detailsActionFromHidden,
  formatBytes,
  formatDuration,
  lineCount,
  hasOutputArtifactPath,
  outputMeta,
  plural,
  statusDot,
} from "./tool-presentation-helpers";
import type { MetaItem } from "../../cards/card-presentation";
import type { ToolPresentation } from "./tool-presentation-types";
import type { ToolCallDisplayRecord } from "./tool-result-parser";
import { COLLAPSED_LINES, type ToolView } from "./tool-result-view";
import { presentToolArguments } from "../lifecycle/registry";
import { displayItemCount } from "./extension-display";
import { subagentPresentation } from "./subagent-presentation";

export type { ToolPresentation } from "./tool-presentation-types";

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

function isOneLine(text: string | undefined): boolean {
  return Boolean(
    text && !text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").includes("\n"),
  );
}

function projectToolPresentation(
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
      if (
        view.lineLabel &&
        !argumentPresentation.secondary.some(
          (item) => item.key === "read-range",
        )
      )
        meta.push({ key: "read-range", text: view.lineLabel });
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
      if (view.exitCode !== undefined) {
        // A clean exit is the expected outcome, so only a failure takes colour.
        meta.push({
          key: "exit",
          text: `exit ${view.exitCode}`,
          ...(view.exitCode === 0 ? {} : { tone: "destructive" as const }),
        });
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
      meta.push(...outputMeta(view, { includeLiveLimit: false }));
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
        // A promoted call is finished for the agent but unfinished for the
        // reader: the process outlived the tool call and still owes a result.
        ...(view.backgroundTask
          ? {
              dotTone: "warning" as const,
              dotPulse: false,
              glyph: "pending" as const,
            }
          : {}),
        backgroundTaskId: view.backgroundTask?.taskId,
        primaryArg: view.command
          ? isOneLine(view.command)
            ? { text: view.command }
            : { text: "inline" }
          : base.primaryArg,
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
        meta.push({
          key: "exit",
          text: `exit ${view.exitCode}`,
          tone: "destructive",
        });
      }
      if (view.signal)
        meta.push({ text: `signal ${view.signal}`, tone: "warning" });
      if (view.timedOut) meta.push({ text: "timed out", tone: "destructive" });
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
      const meta: MetaItem[] = [];
      if (!argumentPresentation.secondary.some((item) => item.key === "add")) {
        meta.push({ key: "add", text: `+${view.additions}`, tone: "success" });
        meta.push({
          key: "del",
          text: `−${view.deletions}`,
          tone: "destructive",
        });
      }
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
      if (view.outcome)
        meta.push({
          key: "write-outcome",
          text: view.outcome,
          tone: "success",
        });
      if (
        view.lineCount !== undefined &&
        !argumentPresentation.secondary.some(
          (item) => item.key === "write-lines",
        )
      )
        meta.push({ key: "write-lines", text: plural(view.lineCount, "line") });
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
          {
            key: "matches",
            text: plural(view.totalMatches ?? view.matchCount, "match", "es"),
          },
          {
            key: "files",
            text: plural(view.totalFiles ?? view.fileCount, "file"),
          },
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

    case "web_fetch": {
      const meta: MetaItem[] = [];
      if (view.status !== undefined) {
        meta.push({
          text: `${view.status}`,
          tone: view.status >= 400 ? "destructive" : "success",
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

    case "quick_script": {
      const meta: MetaItem[] = [];
      if (view.status && view.status !== "completed")
        meta.push({
          text: view.status.replaceAll("_", " "),
          tone: "destructive",
        });
      if (view.hostCalls.length > 0)
        meta.push({ text: plural(view.hostCalls.length, "SDK call") });
      if (view.artifacts.length > 0)
        meta.push({ text: plural(view.artifacts.length, "artifact") });
      const denied = view.hostCalls.filter((c) => c.outcome === "denied");
      if (denied.length > 0)
        meta.push({ text: `${denied.length} denied`, tone: "warning" });
      // The card footer already shows the elapsed time.
      if (view.outputTruncated)
        meta.push({ text: "truncated", tone: "warning" });
      return { ...base, meta };
    }

    case "explain_image": {
      const content = view.live ? view.liveExplanation : view.explanation;
      const meta: MetaItem[] = view.live
        ? [{ text: view.thinking ? "thinking" : "generating", tone: "info" }]
        : [];
      meta.push(...outputMeta(view));
      return {
        ...base,
        primaryArg: view.path
          ? { text: view.relPath ?? view.path, openPath: view.path }
          : base.primaryArg,
        meta,
        detailsAction:
          previewDetailsAction ?? detailsActionFor(lineCount(content), "lines"),
      };
    }

    case "extension": {
      const items = displayItemCount(view.display);
      return {
        ...base,
        meta: items ? [{ text: plural(items.count, items.noun) }] : [],
        detailsAction: items
          ? (previewDetailsAction ??
            detailsActionFor(items.count, `${items.noun}s`))
          : previewDetailsAction,
      };
    }

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

    case "subagent":
      return subagentPresentation(view, base);

    case "ask_user":
      // The sheet renders every question, so the header only counts them.
      return {
        ...base,
        primaryArg: view.questions.length
          ? {
              text: `${view.questions.length} question${view.questions.length === 1 ? "" : "s"}`,
            }
          : undefined,
        meta:
          view.questions.length > 1 && toolCall.status === "completed"
            ? [
                {
                  key: "answered",
                  text: `${view.questions.filter((question) => question.answer !== undefined && !question.skipped).length}/${view.questions.length} answered`,
                  tone: view.questions.every(
                    (question) =>
                      question.answer !== undefined && !question.skipped,
                  )
                    ? "success"
                    : "warning",
                },
              ]
            : [],
      };

    case "plan_present":
      // The presented-plan card renders its own footer (status chip + accept/
      // reject buttons on one line) from live review state inside
      // PlanPresentToolView, so the generic footer stays empty here.
      return {
        ...base,
        badge: `plan_${view.action}`,
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

/** Argument facts retain their identity and order; result facts append. */
export function toolPresentation(
  view: ToolView,
  toolCall: ToolCallDisplayRecord,
): ToolPresentation {
  const result = projectToolPresentation(view, toolCall);
  const payload = toolCall as ToolCallDisplayRecord & {
    args?: unknown;
    argsPreview?: unknown;
  };
  const argument = presentToolArguments(
    toolCall.toolName,
    { args: payload.args, argsPreview: payload.argsPreview },
    "completed",
    toolCall.cwd,
  );
  const byKey = new Map<string, MetaItem>();
  for (const item of [...argument.secondary, ...result.meta]) {
    const key =
      item.key ?? `result:${item.text.replace(/\d+(?:\.\d+)?/g, "#")}`;
    byKey.set(key, { ...item, key });
  }
  return {
    ...result,
    primaryArg: result.primaryArg,
    meta: [...byKey.values()],
  };
}
