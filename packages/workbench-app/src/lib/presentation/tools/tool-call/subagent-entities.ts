import {
  subagentPromptResultDetailsSchema,
  subagentStatusResultDetailsSchema,
  subagentStopResultDetailsSchema,
} from "@nervekit/contracts/tools";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { subagentLiveState } from "../views/subagent-live";
import { formatDuration } from "../views/tool-presentation-helpers";
import { parseToolView } from "../views/tool-result-parser";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import { parseToolExecutionResult } from "../views/tool-view-helpers";

type SubagentView = Extract<ToolView, { kind: "subagent" }>;

export type EntityItem = {
  key: string;
  title?: string;
  detail?: string;
  body?: string;
  status?: { tone: StatusTone; label: string };
  followUp?: boolean;
  /** Looked up among live sub-agents for the live dot and Open pill. */
  agentName?: string;
};

/** Structured `details` of a settled call (also kept on failed calls). */
export function subagentDetails(toolCall: object): unknown {
  const payloads = toolCall as { result?: unknown; resultPreview?: unknown };
  return parseToolExecutionResult(payloads.resultPreview ?? payloads.result)
    ?.details;
}

/**
 * The persistent argument rows of a settled prompt/stop call, filled with the
 * result (disposition, rejection reason, stop outcome) while keeping each
 * row's key and any status the lifecycle spec already assigned.
 */
export function enrichEntities(
  toolCall: ToolCallDisplayRecord,
  items: EntityItem[],
): EntityItem[] {
  const view = parseToolView(toolCall);
  if (view.kind !== "subagent") return items;
  const details = subagentDetails(toolCall);
  const enriched =
    view.action === "prompt"
      ? promptEntities(view, details)
      : view.action === "stop"
        ? stopEntities(view, details)
        : [];
  return items.map((item, index) => {
    const next = enriched[index];
    return next
      ? { ...item, ...next, status: next.status ?? item.status }
      : item;
  });
}

export function textStateTone(state: string): StatusTone {
  if (state.startsWith("running")) return "info";
  if (state.startsWith("waiting")) return "warning";
  if (state.startsWith("failed")) return "destructive";
  return "neutral";
}

/** `active 20s ago` from an ISO timestamp. */
export function activeAgo(iso: string, now = Date.now()): string | undefined {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `active ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `active ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `active ${hours}h ago`;
  return `active ${Math.round(hours / 24)}d ago`;
}

export function promptEntities(
  view: Extract<SubagentView, { action: "prompt" }>,
  details: unknown,
): EntityItem[] {
  const parsed = subagentPromptResultDetailsSchema.safeParse(details);
  const results = new Map(
    (parsed.success ? (parsed.data.assignments ?? []) : []).map((item) => [
      item.name.toLowerCase(),
      item,
    ]),
  );
  return view.assignments.map((assignment, index): EntityItem => {
    const result = results.get(assignment.name.toLowerCase());
    const disposition = result?.disposition ?? assignment.disposition;
    const rejected = disposition === "rejected";
    const queued = assignment.queuedState;
    return {
      key: String(index),
      title: assignment.name,
      detail: result?.profile ?? assignment.profile,
      body: rejected && result?.reason ? result.reason : assignment.prompt,
      status: rejected
        ? { tone: "destructive", label: "rejected" }
        : disposition === "follow_up"
          ? { tone: textStateTone(queued ?? ""), label: queued ?? "queued" }
          : disposition === "created"
            ? { tone: "neutral", label: "created" }
            : undefined,
      followUp: disposition === "follow_up",
      agentName: rejected ? undefined : assignment.name,
    };
  });
}

export function statusEntities(
  view: Extract<SubagentView, { action: "status" }>,
  details: unknown,
  now = Date.now(),
): EntityItem[] {
  const parsed = subagentStatusResultDetailsSchema.safeParse(details);
  if (parsed.success && parsed.data.agents) {
    return parsed.data.agents.map((agent, index): EntityItem => {
      const text = view.rows.find(
        (row) => row.name.toLowerCase() === agent.name.toLowerCase(),
      );
      const live = subagentLiveState(
        agent.state === "stopped" ? "interrupted" : agent.state,
      );
      const body = [
        agent.contextPercent !== undefined
          ? `ctx ${Math.round(agent.contextPercent)}%`
          : text?.context
            ? `ctx ${text.context}`
            : undefined,
        agent.lastActivityAt
          ? activeAgo(agent.lastActivityAt, now)
          : text?.activity,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        key: String(index),
        title: agent.name,
        detail: agent.profile,
        body: body || undefined,
        status: live,
        agentName: agent.name,
      };
    });
  }
  return view.rows.map(
    (row, index): EntityItem => ({
      key: String(index),
      title: row.name,
      detail: row.profile,
      body:
        [row.context ? `ctx ${row.context}` : undefined, row.activity]
          .filter(Boolean)
          .join(" · ") || undefined,
      status: { tone: textStateTone(row.state), label: row.state },
      agentName: row.name,
    }),
  );
}

const stopOutcome = {
  stopped: { tone: "neutral", label: "stopped" },
  already_idle: { tone: "neutral", label: "already idle" },
  not_found: { tone: "warning", label: "not found" },
  failed: { tone: "destructive", label: "failed" },
} as const satisfies Record<string, { tone: StatusTone; label: string }>;

export function stopEntities(
  view: Extract<SubagentView, { action: "stop" }>,
  details: unknown,
): EntityItem[] {
  const parsed = subagentStopResultDetailsSchema.safeParse(details);
  if (parsed.success && parsed.data.results) {
    return parsed.data.results.map((result, index): EntityItem => {
      const ran = formatDuration(result.runMs);
      return {
        key: String(index),
        title: result.name,
        body:
          [
            stopOutcome[result.outcome].label,
            ran ? `ran ${ran}` : undefined,
            result.reason,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        status: stopOutcome[result.outcome],
      };
    });
  }
  if (view.lines.length === 0) {
    return view.names.map((name, index) => ({
      key: String(index),
      title: name,
    }));
  }
  return view.lines.map(
    (line, index): EntityItem => ({
      key: String(index),
      title: line.name,
      body: line.outcome,
      status: {
        tone: line.outcome.startsWith("failed")
          ? "destructive"
          : line.outcome.includes("not found")
            ? "warning"
            : "neutral",
        label: line.outcome,
      },
    }),
  );
}
