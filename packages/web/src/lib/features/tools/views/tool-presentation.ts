import type { ToolCallRecord } from "$lib/api";
import { taskTone } from "./task";
import {
  basename,
  collapseFor,
  formatBytes,
  formatDuration,
  lineCount,
  plural,
  statusDot,
  toneFromDot,
} from "./tool-presentation-helpers";
import type { MetaItem, ToolPresentation } from "./tool-presentation-types";
import {
  aggregateExploreTasks,
  COLLAPSED_LINES,
  type ToolView,
} from "./tool-result-view";

export type {
  CollapseInfo,
  MetaItem,
  MetaTone,
  PrimaryArg,
  ToolPresentation,
} from "./tool-presentation-types";

/** Derive the header (badge + primary arg) and footer (meta chips) for a tool. */
export function toolPresentation(
  view: ToolView,
  toolCall: ToolCallRecord,
): ToolPresentation {
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
      return {
        ...base,
        primaryArg,
        meta,
        collapse: collapseFor(lineCount(view.content), "lines"),
      };
    }

    case "bash": {
      const meta: MetaItem[] = [];
      const lines = lineCount(view.output);
      if (view.exitCode !== undefined && view.exitCode !== 0) {
        meta.push({ text: `exit ${view.exitCode}`, tone: "error" });
      }
      if (view.signal)
        meta.push({ text: `signal ${view.signal}`, tone: "warning" });
      if (lines > 0) meta.push({ text: plural(lines, "line") });
      if (view.truncated) meta.push({ text: "truncated", tone: "warning" });
      if (view.savedTo) {
        meta.push({ text: `saved ${basename(view.savedTo)}`, mono: true });
      }
      return {
        ...base,
        primaryArg: view.command ? { text: view.command } : undefined,
        meta,
        collapse: collapseFor(lines, "lines", "tail"),
      };
    }

    case "python": {
      const meta: MetaItem[] = [];
      const lines = lineCount(view.output);
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
      if (view.savedTo) {
        meta.push({ text: `saved ${basename(view.savedTo)}`, mono: true });
      }
      // The script comes inline (not from a file); the header carries an
      // `inline` source marker, while the full script renders in the body.
      const hiddenCode = Math.max(0, view.codeLineCount - COLLAPSED_LINES);
      const hiddenOutput = Math.max(0, lines - COLLAPSED_LINES);
      const hiddenTotal = hiddenCode + hiddenOutput;
      const collapse =
        hiddenTotal > 0
          ? {
              hidden: hiddenTotal,
              expandLabel: `Show ${hiddenTotal} more lines`,
              collapseLabel: "Show less",
            }
          : undefined;
      return {
        ...base,
        primaryArg: { text: "inline" },
        meta,
        collapse,
      };
    }

    case "edit": {
      const meta: MetaItem[] = [
        { text: plural(view.replacements, "replacement") },
      ];
      if (view.additions > 0)
        meta.push({ text: `+${view.additions}`, tone: "success" });
      if (view.deletions > 0)
        meta.push({ text: `−${view.deletions}`, tone: "error" });
      return {
        ...base,
        primaryArg: view.relPath
          ? { text: view.relPath, openPath: view.path }
          : undefined,
        meta,
        collapse: collapseFor(lineCount(view.diff), "lines"),
      };
    }

    case "write": {
      const meta: MetaItem[] = [];
      if (view.bytes !== undefined)
        meta.push({ text: `wrote ${view.bytes} bytes` });
      return {
        ...base,
        primaryArg: view.relPath
          ? { text: view.relPath, openPath: view.path }
          : undefined,
        meta,
        collapse: collapseFor(lineCount(view.content), "lines"),
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
        collapse: collapseFor(view.matchCount, "matches"),
      };

    case "find":
      return {
        ...base,
        primaryArg: view.pattern ? { text: view.pattern } : undefined,
        meta: [{ text: plural(view.count, "file") }],
        collapse: collapseFor(view.count, "files"),
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
        collapse: collapseFor(view.total, "entries"),
      };

    case "task_logs": {
      const meta: MetaItem[] = [{ text: plural(view.events.length, "event") }];
      if (view.mode) meta.push({ text: view.mode });
      return {
        ...base,
        primaryArg: view.task?.name
          ? { text: view.task.name }
          : view.mode
            ? { text: view.mode }
            : undefined,
        meta,
        collapse: collapseFor(view.events.length, "events", "tail"),
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
      if (view.savedTo)
        meta.push({ text: `saved ${basename(view.savedTo)}`, mono: true });
      return {
        ...base,
        primaryArg: view.url ? { text: view.url, href: view.url } : undefined,
        meta,
        collapse: collapseFor(lineCount(view.content), "lines"),
      };
    }

    case "web_search":
      return {
        ...base,
        primaryArg: view.query ? { text: view.query } : undefined,
        meta: [{ text: plural(view.results.length, "result") }],
      };

    case "todos":
      return {
        ...base,
        badge: "todos",
        meta: [{ text: `${view.completed}/${view.total} done` }],
      };

    case "task_action": {
      const meta: MetaItem[] = [{ text: view.action }];
      const task = view.task ?? view.tasks?.[0];
      if (task) {
        meta.push({
          text: task.status,
          tone: toneFromDot(taskTone(task.status)),
        });
        if (task.exitCode !== undefined && task.exitCode !== null) {
          meta.push({ text: `exit ${task.exitCode}` });
        }
        if (task.signal) meta.push({ text: `signal ${task.signal}` });
      }
      return {
        ...base,
        badge: `task_${view.action}`,
        primaryArg: task?.name
          ? { text: task.name }
          : task?.command
            ? { text: task.command }
            : undefined,
        meta,
      };
    }

    case "task_list":
      return {
        ...base,
        meta: [{ text: plural(view.tasks.length, "task", "s") }],
      };

    case "explore": {
      const { summary } = aggregateExploreTasks(view);
      const count = view.reports.length;
      const fileCount = view.reports.filter(
        (report) => report.reportPath,
      ).length;
      const meta: MetaItem[] = [];
      if (summary.done) {
        if (count > 0)
          meta.push({ text: plural(count, "report", "s"), tone: "success" });
        if (fileCount > 0) meta.push({ text: plural(fileCount, "file", "s") });
      } else if (summary.total > 0) {
        meta.push({
          text: `${summary.completed}/${summary.total} agents`,
          tone: "info",
        });
      }
      if (summary.failed > 0)
        meta.push({ text: `${summary.failed} failed`, tone: "error" });
      const models = [
        ...new Set(view.reports.map((report) => report.model).filter(Boolean)),
      ];
      if (models.length === 1 && models[0]) {
        meta.push({ text: basename(models[0]) });
      }
      const turns = view.reports.reduce(
        (sum, report) => sum + (report.usage?.turns ?? 0),
        0,
      );
      if (turns > 0) meta.push({ text: plural(turns, "turn") });
      return {
        ...base,
        primaryArg: view.task
          ? { text: view.task }
          : summary.total > 1
            ? { text: `${summary.total} explore agents` }
            : undefined,
        meta,
      };
    }

    case "ask_user":
      return { ...base, meta: [] };

    case "plan_mode":
      return {
        ...base,
        badge: `plan_mode_${view.action}`,
        primaryArg: view.planPath
          ? { text: view.planPath, openPath: view.planPath }
          : undefined,
        meta: [],
      };

    default:
      return base;
  }
}
