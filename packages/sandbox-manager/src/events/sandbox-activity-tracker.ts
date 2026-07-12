import type { SandboxActivitySummary } from "@nervekit/contracts";

const MAX_TITLE = 80;
const THROTTLE_MS = 750;

type ObservedEvent = {
  type: string;
  ts?: string;
  payload?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function truncate(text: string): string | undefined {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;
  return trimmed.length > MAX_TITLE
    ? `${trimmed.slice(0, MAX_TITLE - 1)}…`
    : trimmed;
}

function firstStringArg(value: unknown): string | undefined {
  const record = asRecord(value);
  for (const key of [
    "path",
    "file",
    "filePath",
    "command",
    "cmd",
    "query",
    "url",
  ]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

function describeTool(payload: Record<string, unknown>): string | undefined {
  const toolCall = asRecord(payload.toolCall);
  const toolName =
    typeof toolCall.toolName === "string" ? toolCall.toolName : "tool";
  const arg = firstStringArg(toolCall.argsPreview);
  return truncate(arg ? `${toolName}: ${arg}` : toolName);
}

/**
 * Applies a `contextUsage` payload ({ tokens, contextWindow }) as a percentage
 * when present. The sandbox controller does not emit this today; the plumbing
 * is here so tiles light up once a usage signal is added (see follow-ups).
 */
function applyContextUsage(
  summary: { contextUsagePct?: number },
  payload: Record<string, unknown>,
): void {
  const usage = asRecord(payload.contextUsage);
  const tokens = Number(usage.tokens);
  const window = Number(usage.contextWindow);
  if (Number.isFinite(tokens) && Number.isFinite(window) && window > 0)
    summary.contextUsagePct = Math.max(
      0,
      Math.min(100, Math.round((tokens / window) * 100)),
    );
}

function textOf(value: unknown): string {
  const record = asRecord(value);
  if (typeof record.text === "string") return record.text;
  return typeof value === "string" ? value : "";
}

/**
 * Derives a compact, best-effort per-sandbox activity summary from the
 * controller events the manager already ingests, and emits a throttled
 * `sandbox.activity.changed` event whenever the summary meaningfully changes.
 *
 * State is in-memory and rebuildable; it is never a source of truth.
 */
export class SandboxActivityTracker {
  private readonly summaries = new Map<string, SandboxActivitySummary>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly emit: (summary: SandboxActivitySummary) => void,
  ) {}

  get(sandboxId: string): SandboxActivitySummary | undefined {
    return this.summaries.get(sandboxId);
  }

  snapshot(): SandboxActivitySummary[] {
    return [...this.summaries.values()];
  }

  forget(sandboxId: string): void {
    this.summaries.delete(sandboxId);
    const timer = this.timers.get(sandboxId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sandboxId);
    }
  }

  observe(sandboxId: string, event: ObservedEvent): void {
    const previous = this.summaries.get(sandboxId);
    const next: SandboxActivitySummary = previous
      ? { ...previous }
      : { sandboxId, runStatus: "idle", updatedAt: new Date().toISOString() };
    next.updatedAt = event.ts ?? new Date().toISOString();

    let immediate = false;
    const applied = this.reduce(next, event, () => {
      immediate = true;
    });
    if (!applied) return;

    this.summaries.set(sandboxId, next);
    if (immediate) this.flush(sandboxId, next);
    else this.schedule(sandboxId, next);
  }

  /** Returns true when the event changed the summary. */
  private reduce(
    summary: SandboxActivitySummary,
    event: ObservedEvent,
    markImmediate: () => void,
  ): boolean {
    const payload = asRecord(event.payload);
    switch (event.type) {
      case "run.started": {
        summary.runStatus = "running";
        summary.needsAttention = undefined;
        applyContextUsage(summary, payload);
        return true;
      }
      case "toolCall.updated": {
        summary.runStatus = "running";
        const title = describeTool(payload);
        if (title) summary.title = title;
        return true;
      }
      case "run.transcript.appended": {
        if (payload.role !== undefined && payload.role !== "assistant")
          return false;
        const title = truncate(textOf(payload.content));
        if (!title) return false;
        summary.title = title;
        return true;
      }
      case "run.waiting":
        summary.runStatus = "waiting";
        summary.needsAttention = true;
        markImmediate();
        return true;
      case "run.completed":
        summary.runStatus = "completed";
        summary.needsAttention = undefined;
        applyContextUsage(summary, payload);
        markImmediate();
        return true;
      case "run.failed":
        summary.runStatus = "failed";
        summary.needsAttention = undefined;
        markImmediate();
        return true;
      case "run.cancelled":
        summary.runStatus = "cancelled";
        summary.needsAttention = undefined;
        markImmediate();
        return true;
      case "sandbox.controller.disconnected":
        summary.runStatus = "idle";
        summary.needsAttention = undefined;
        markImmediate();
        return true;
      default:
        return false;
    }
  }

  /** Phase B: enrich with model/provider/context-usage from richer events. */
  setRunMeta(
    sandboxId: string,
    meta: { model?: string; provider?: string; contextUsagePct?: number },
    ts?: string,
  ): void {
    const previous = this.summaries.get(sandboxId);
    const next: SandboxActivitySummary = previous
      ? { ...previous }
      : {
          sandboxId,
          runStatus: "running",
          updatedAt: new Date().toISOString(),
        };
    let changed = false;
    if (meta.model && meta.model !== next.model) {
      next.model = meta.model;
      changed = true;
    }
    if (meta.provider && meta.provider !== next.provider) {
      next.provider = meta.provider;
      changed = true;
    }
    if (
      typeof meta.contextUsagePct === "number" &&
      meta.contextUsagePct !== next.contextUsagePct
    ) {
      next.contextUsagePct = Math.max(0, Math.min(100, meta.contextUsagePct));
      changed = true;
    }
    if (!changed) return;
    next.updatedAt = ts ?? new Date().toISOString();
    this.summaries.set(sandboxId, next);
    this.schedule(sandboxId, next);
  }

  private schedule(sandboxId: string, summary: SandboxActivitySummary): void {
    if (this.timers.has(sandboxId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(sandboxId);
      const latest = this.summaries.get(sandboxId) ?? summary;
      this.emit(latest);
    }, THROTTLE_MS);
    if (typeof timer.unref === "function") timer.unref();
    this.timers.set(sandboxId, timer);
  }

  private flush(sandboxId: string, summary: SandboxActivitySummary): void {
    const timer = this.timers.get(sandboxId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sandboxId);
    }
    this.emit(summary);
  }
}
