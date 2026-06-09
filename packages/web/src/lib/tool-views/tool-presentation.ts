import type { ToolCallRecord } from "../api";
import type { StatusTone } from "../components/ui/status-dot";
import { processTone } from "./process";
import { COLLAPSED_LINES, type ToolView } from "./tool-result-view";

export type MetaTone = "default" | "success" | "warning" | "error" | "info";

export type MetaItem = { text: string; tone?: MetaTone; mono?: boolean };

export type CollapseInfo = {
  hidden: number;
  expandLabel: string;
  collapseLabel: string;
};

export type PrimaryArg = {
  text: string;
  openPath?: string;
  line?: number;
  href?: string;
};

export type ToolPresentation = {
  badge: string;
  primaryArg?: PrimaryArg;
  meta: MetaItem[];
  collapse?: CollapseInfo;
  /** Tone for the leading status dot. */
  dotTone: StatusTone;
  /** Pulse the leading status dot (in-flight / awaiting states). */
  dotPulse: boolean;
};

function basename(path: string): string {
  return path.split("/").pop() || path;
}

function formatBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function plural(count: number, singular: string, suffix = "s"): string {
  return `${count} ${singular}${count === 1 ? "" : suffix}`;
}

function lineCount(text: string | undefined): number {
  if (!text) return 0;
  return text.length === 0 ? 0 : text.split("\n").length;
}

function collapseFor(
  total: number,
  noun: string,
  direction: "head" | "tail" = "head",
): CollapseInfo | undefined {
  const hidden = total - COLLAPSED_LINES;
  if (hidden <= 0) return undefined;
  const verb = direction === "tail" ? "earlier" : "more";
  return {
    hidden,
    expandLabel: `Show ${hidden} ${verb} ${noun}`,
    collapseLabel: "Show less",
  };
}

function statusDot(
  toolCall: ToolCallRecord,
  view: ToolView,
): {
  tone: StatusTone;
  pulse: boolean;
} {
  switch (toolCall.status) {
    case "error":
    case "denied":
      return { tone: "danger", pulse: false };
    case "running":
    case "requested":
      return { tone: "running", pulse: true };
    case "pending_approval":
    case "waiting_for_user":
      return { tone: "warn", pulse: true };
    default:
      break;
  }
  if (
    view.kind === "bash" &&
    view.exitCode !== undefined &&
    view.exitCode !== 0
  ) {
    return { tone: "danger", pulse: false };
  }
  return { tone: "good", pulse: false };
}

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

    case "process_logs": {
      const meta: MetaItem[] = [{ text: plural(view.events.length, "event") }];
      if (view.mode) meta.push({ text: view.mode });
      return {
        ...base,
        primaryArg: view.process?.name
          ? { text: view.process.name }
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

    case "process_action": {
      const meta: MetaItem[] = [{ text: view.action }];
      const process = view.process;
      if (process) {
        meta.push({
          text: process.status,
          tone: toneFromDot(processTone(process.status)),
        });
        if (process.exitCode !== undefined && process.exitCode !== null) {
          meta.push({ text: `exit ${process.exitCode}` });
        }
        if (process.signal) meta.push({ text: `signal ${process.signal}` });
      }
      return {
        ...base,
        badge: `process_${view.action}`,
        primaryArg: process?.name
          ? { text: process.name }
          : process?.command
            ? { text: process.command }
            : undefined,
        meta,
      };
    }

    case "process_list":
      return {
        ...base,
        meta: [{ text: plural(view.processes.length, "process", "es") }],
      };

    case "subagent_run": {
      const meta: MetaItem[] = [];
      if (view.childAgentId)
        meta.push({ text: `child ${view.childAgentId}`, mono: true });
      return {
        ...base,
        primaryArg: view.task ? { text: view.task } : undefined,
        meta,
      };
    }

    case "ask_user": {
      const meta: MetaItem[] = [];
      if (view.dismissed) meta.push({ text: "dismissed", tone: "warning" });
      return { ...base, meta };
    }

    case "plan_mode": {
      const meta: MetaItem[] = [];
      if (view.outcome)
        meta.push({ text: view.outcome, tone: outcomeTone(view.outcome) });
      return {
        ...base,
        badge: `plan_mode_${view.action}`,
        primaryArg: view.planPath
          ? { text: view.planPath, openPath: view.planPath }
          : undefined,
        meta,
      };
    }

    default:
      return base;
  }
}

function toneFromDot(tone: StatusTone): MetaTone {
  switch (tone) {
    case "good":
      return "success";
    case "warn":
      return "warning";
    case "danger":
      return "error";
    case "running":
      return "info";
    default:
      return "default";
  }
}

function outcomeTone(outcome: string): MetaTone {
  if (outcome === "accepted") return "success";
  if (outcome === "changes_requested" || outcome === "changes requested") {
    return "warning";
  }
  if (outcome === "discarded") return "default";
  return "default";
}
