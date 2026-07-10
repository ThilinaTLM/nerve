import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentHarness } from "@nervekit/host-runtime/harness";
import type {
  SandboxAgentRelationshipRecord,
  SandboxConfigV1,
} from "@nervekit/contracts";
import { Redactor } from "../security/redaction.js";
import { atomicWriteFile } from "../state/json-store.js";
import type { SandboxToolRuntime } from "../tools/tool-runtime.js";
import type {
  HarnessCreateOptions,
  SandboxHarnessRunScope,
} from "./harness-factory.js";

export type ExploreRequest = {
  conversationId?: string;
  agentId?: string;
  runId?: string;
  task: string;
  context?: string;
  label?: string;
  depth?: number;
  signal?: AbortSignal;
};

export type ExploreResult = {
  content: string;
  details: {
    childAgentId: string;
    childRunId: string;
    relationship: SandboxAgentRelationshipRecord;
  };
};

type ActiveChild = {
  key: string;
  conversationId: string;
  parentAgentId: string;
  parentRunId?: string;
  childAgentId: string;
  childRunId: string;
  abortController: AbortController;
  harness?: AgentHarness;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
};

export type ExploreRuntimeOptions = {
  config: SandboxConfigV1;
  createChildHarness: (
    scope: SandboxHarnessRunScope,
    options: HarnessCreateOptions,
  ) => Promise<AgentHarness>;
  readOnlyToolRuntime?: SandboxToolRuntime;
  stateDir?: string;
  redactor?: Redactor;
  maxDepth?: number;
  maxParallel?: number;
  resultLimit?: number;
};

export class ExploreRuntime {
  private readonly active = new Map<string, ActiveChild>();
  private readonly maxDepth: number;
  private readonly maxParallel: number;
  private readonly resultLimit: number;
  private readonly redactor: Redactor;

  constructor(private readonly options: ExploreRuntimeOptions) {
    const configDepth = options.config.agent.maxExploreDepth ?? 2;
    const toolDepth = options.config.tools?.groups?.explore?.maxDepth ?? 2;
    this.maxDepth = options.maxDepth ?? Math.min(configDepth, toolDepth);
    this.maxParallel =
      options.maxParallel ??
      options.config.tools?.groups?.explore?.maxParallel ??
      2;
    this.resultLimit = options.resultLimit ?? 8_000;
    this.redactor = options.redactor ?? new Redactor({ secrets: [] });
  }

  async execute(input: ExploreRequest): Promise<ExploreResult> {
    const task = input.task.trim();
    if (!task) throw new Error("VALIDATION_FAILED: explore task is required");
    if (task.length > 16_000)
      throw new Error("VALIDATION_FAILED: explore task is too large");
    if ((input.context?.length ?? 0) > 32_000)
      throw new Error("VALIDATION_FAILED: explore context is too large");
    const depth = input.depth ?? 1;
    if (depth > this.maxDepth)
      throw new Error(`explore depth limit exceeded: ${this.maxDepth}`);
    const parentScope = {
      conversationId: input.conversationId ?? "conv_unknown",
      agentId: input.agentId ?? "agent_main",
      runId: input.runId ?? "run_unknown",
    };
    const parentActive = Array.from(this.active.values()).filter(
      (entry) =>
        entry.conversationId === parentScope.conversationId &&
        entry.parentAgentId === parentScope.agentId &&
        entry.parentRunId === parentScope.runId,
    ).length;
    if (parentActive >= this.maxParallel)
      throw new Error(
        `explore parallelism limit exceeded: ${this.maxParallel}`,
      );

    const now = new Date().toISOString();
    const childAgentId = `agent_explore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const childRunId = `run_explore_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const childScope: SandboxHarnessRunScope = {
      conversationId: parentScope.conversationId,
      agentId: childAgentId,
      runId: childRunId,
      executionId: `exec_explore_${Date.now()}`,
    };
    let relationship: SandboxAgentRelationshipRecord = {
      conversationId: parentScope.conversationId,
      parentAgentId: parentScope.agentId,
      childAgentId,
      parentRunId: parentScope.runId,
      childRunId,
      relationship: "explore",
      depth,
      label: input.label,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      summary: {
        text: bound(this.redactor.redactText(`Queued: ${task}`), 500),
      },
    };
    await this.persist(relationship);

    const abortController = new AbortController();
    const abortFromParent = () => abortController.abort();
    input.signal?.addEventListener("abort", abortFromParent, { once: true });
    const active: ActiveChild = {
      key: activeKey(parentScope, childRunId),
      conversationId: parentScope.conversationId,
      parentAgentId: parentScope.agentId,
      parentRunId: parentScope.runId,
      childAgentId,
      childRunId,
      abortController,
      status: "queued",
    };
    this.active.set(active.key, active);
    try {
      relationship = await this.transition(relationship, "running", {
        text: bound(this.redactor.redactText(`Running: ${task}`), 500),
      });
      active.status = "running";
      const harness = await this.options.createChildHarness(childScope, {
        modelSelection:
          this.options.config.agent.defaultExploreModel ??
          this.options.config.agent.defaultModel,
        toolRuntime: this.options.readOnlyToolRuntime,
        systemPromptAmendment:
          "Explore subagent mode: perform a read-only investigation only. Do not modify files, start long-running tasks, ask the user, or use write/shell/python/task/edit tools. Return a concise answer with relevant file paths.",
        followUpMode: "one-at-a-time",
        steeringMode: "one-at-a-time",
      });
      active.harness = harness;
      if (abortController.signal.aborted) throw new ExploreCancelledError();
      abortController.signal.addEventListener(
        "abort",
        () => void harness.abort().catch(() => undefined),
        { once: true },
      );
      const message = await harness.prompt(buildPrompt(task, input.context));
      if (abortController.signal.aborted) throw new ExploreCancelledError();
      const summary = bound(
        this.redactor.redactText(messageText(message) || "Explore completed."),
        this.resultLimit,
      );
      relationship = await this.transition(relationship, "completed", {
        text: summary,
        truncated: summary.length >= this.resultLimit || undefined,
      });
      active.status = "completed";
      return {
        content: summary,
        details: { childAgentId, childRunId, relationship },
      };
    } catch (error) {
      if (
        abortController.signal.aborted ||
        error instanceof ExploreCancelledError
      ) {
        await this.transition(relationship, "cancelled", {
          text: "Explore cancelled.",
        });
        active.status = "cancelled";
        throw new Error("CANCELLED: explore cancelled", { cause: error });
      }
      const message = this.redactor.redactText(
        error instanceof Error ? error.message : String(error),
      );
      await this.transition(relationship, "failed", {
        text: bound(message, 1_000),
      });
      active.status = "failed";
      throw new Error(`EXPLORE_FAILED: ${bound(message, 500)}`, {
        cause: error,
      });
    } finally {
      input.signal?.removeEventListener("abort", abortFromParent);
      this.active.delete(active.key);
    }
  }

  async cancelRun(scope: {
    conversationId: string;
    agentId: string;
    runId: string;
  }): Promise<void> {
    const entries = Array.from(this.active.values()).filter(
      (entry) =>
        entry.conversationId === scope.conversationId &&
        entry.parentAgentId === scope.agentId &&
        entry.parentRunId === scope.runId,
    );
    for (const entry of entries) {
      if (entry.status === "cancelled") continue;
      entry.status = "cancelled";
      entry.abortController.abort();
      await entry.harness?.abort().catch(() => undefined);
      await this.options.readOnlyToolRuntime?.cancelRun({
        conversationId: entry.conversationId,
        agentId: entry.childAgentId,
        runId: entry.childRunId,
      });
      const existing = await this.readRelationship(
        entry.conversationId,
        entry.parentAgentId,
        entry.childAgentId,
      );
      if (existing)
        await this.transition(existing, "cancelled", {
          text: "Explore cancelled.",
        });
    }
  }

  async listRelationships(conversationId: string, parentAgentId: string) {
    if (!this.options.stateDir) return [];
    const dir = relationshipDir(
      this.options.stateDir,
      conversationId,
      parentAgentId,
    );
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }
    const records: SandboxAgentRelationshipRecord[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        records.push(JSON.parse(await readFile(path.join(dir, entry), "utf8")));
      } catch {
        // Ignore corrupt relationship records in summaries.
      }
    }
    return records;
  }

  private async readRelationship(
    conversationId: string,
    parentAgentId: string,
    childAgentId: string,
  ): Promise<SandboxAgentRelationshipRecord | undefined> {
    if (!this.options.stateDir) return undefined;
    try {
      return JSON.parse(
        await readFile(
          path.join(
            relationshipDir(
              this.options.stateDir,
              conversationId,
              parentAgentId,
            ),
            `${safe(childAgentId)}.json`,
          ),
          "utf8",
        ),
      );
    } catch {
      return undefined;
    }
  }

  private async transition(
    record: SandboxAgentRelationshipRecord,
    status: NonNullable<SandboxAgentRelationshipRecord["status"]>,
    summary: NonNullable<SandboxAgentRelationshipRecord["summary"]>,
  ): Promise<SandboxAgentRelationshipRecord> {
    const next = {
      ...record,
      status,
      updatedAt: new Date().toISOString(),
      summary,
    };
    await this.persist(next);
    return next;
  }

  private async persist(record: SandboxAgentRelationshipRecord): Promise<void> {
    if (!this.options.stateDir) return;
    const dir = relationshipDir(
      this.options.stateDir,
      record.conversationId,
      record.parentAgentId,
    );
    await mkdir(dir, { recursive: true });
    await atomicWriteFile(
      path.join(dir, `${safe(record.childAgentId)}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      0o600,
    );
  }
}

class ExploreCancelledError extends Error {}

function buildPrompt(task: string, context?: string): string {
  return [
    "Read-only explore task. Investigate using only safe inspection tools and answer concisely.",
    `Task:\n${task}`,
    context ? `Context:\n${bound(context, 32_000)}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function messageText(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((block) => {
        const value = block as { type?: string; text?: string };
        return value.type === "text" || value.type === "thinking"
          ? (value.text ?? "")
          : "";
      })
      .filter(Boolean)
      .join("\n");
  return "";
}

function activeKey(
  scope: { conversationId: string; agentId: string; runId: string },
  childRunId: string,
): string {
  return `${scope.conversationId}/${scope.agentId}/${scope.runId}/${childRunId}`;
}

function relationshipDir(
  stateDir: string,
  conversationId: string,
  parentAgentId: string,
): string {
  return path.join(
    stateDir,
    "conversations",
    safe(conversationId),
    "agents",
    safe(parentAgentId),
    "relationships",
  );
}

function bound(text: string, max = 4_000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
