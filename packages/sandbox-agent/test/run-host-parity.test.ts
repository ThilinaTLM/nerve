import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  REAL_HOST_PLAN_PATH,
  runRealHostParityMatrix,
  type CheckpointFault,
  type PendingInteractionObservation,
  type RealHostEventObservation,
  type RealHostRunMatrixFixture,
  type RealHostScenarioPreparation,
  type RealHostScenarioSession,
} from "@nervekit/host-runtime/test-support";
import { registerAgentScriptedProvider } from "@nervekit/host-runtime/harness";
import type {
  RunInteractionRecord,
  SandboxConfigV1,
} from "@nervekit/contracts";
import { SandboxRunUnitOfWork } from "../src/agent/run-transition-store.js";
import { SandboxDaemon } from "../src/daemon/sandbox-daemon.js";
import { SandboxStateStores } from "../src/state/sandbox-state.js";

const config: SandboxConfigV1 = {
  version: 1,
  identity: { sandboxId: "sbx_parity" },
  agent: {
    defaultModel: {
      provider: "nerve-faux",
      model: "faux-fast",
    },
  },
  controller: {
    websocket: { url: "ws://manager.invalid/ws" },
    auth: { type: "api_key", apiKey: { env: "TOKEN" } },
  },
  tools: {
    groups: {
      fileInspection: { enabled: true },
      shell: {
        enabled: true,
        requireApproval: "risky",
        allowLongRunning: true,
        maxTimeoutMs: 60_000,
      },
      input: { enabled: true },
      planMode: { enabled: true },
    },
  },
};

const TERMINAL = ["completed", "failed", "cancelled"];

describe("sandbox real-host run parity", () => {
  it("passes the shared production-host parity matrix", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-sandbox-parity-"));
    const adapter = await SandboxParityAdapter.create(dir);
    try {
      const result = await runRealHostParityMatrix(adapter);
      assert.equal(result.totalRuns, 20);
      assert.equal(result.scenarios.length, 6);
    } finally {
      await adapter.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

class SandboxParityAdapter implements RealHostRunMatrixFixture {
  private stores!: SandboxStateStores;
  private daemon!: SandboxDaemon;
  private readonly unitOfWork: SandboxRunUnitOfWork;
  private counter = 0;

  private constructor(private readonly dir: string) {
    // This adapter observes a separately owned host, so it must not cache.
    this.unitOfWork = new SandboxRunUnitOfWork(dir, 0);
  }

  static async create(dir: string): Promise<SandboxParityAdapter> {
    const adapter = new SandboxParityAdapter(dir);
    await adapter.recreate();
    return adapter;
  }

  async prepare(
    options: RealHostScenarioPreparation,
  ): Promise<RealHostScenarioSession> {
    const ordinal = ++this.counter;
    const provider = `nerve-scripted-sandbox-parity-${ordinal}`;
    const conversationId = `conv_parity_${ordinal}`;
    const agentId = `agent_parity_${ordinal}`;
    const planPath = options.planContent
      ? path.join(this.dir, "plans", `${safe(options.name)}.md`)
      : undefined;
    if (planPath) {
      await mkdir(path.dirname(planPath), { recursive: true });
      await writeFile(planPath, options.planContent!, "utf8");
    }
    const registration = registerAgentScriptedProvider({
      provider,
      steps: replacePlanPath(options.steps, planPath),
    });
    await this.daemon.router.dispatch("agent.configure", {
      agentId,
      model: { provider, modelId: "scripted-fast" },
      mode: options.mode ?? "coding",
      permissionLevel: options.permissionLevel ?? "autonomous",
    });
    return this.session(
      options.name,
      conversationId,
      agentId,
      planPath,
      registration.unregister,
    );
  }

  async close(): Promise<void> {
    // Daemons are reconstructed only at durable boundaries and own no server
    // handle. Matrix cancellation assertions prove model/tool processes ended.
  }

  private session(
    name: string,
    conversationId: string,
    agentId: string,
    planPath: string | undefined,
    unregister: () => void,
  ): RealHostScenarioSession {
    const request = (suffix: string) =>
      `cmd_${safe(name)}_${safe(suffix)}_${Date.now()}`;
    let disposed = false;
    return {
      name,
      planPath,
      start: async (prompt, images) => {
        const result = (await this.daemon.router.dispatch(
          "run.start",
          { conversationId, agentId, text: prompt, images },
          { idempotencyKey: request("start") },
        )) as { runId: string };
        return result.runId;
      },
      steer: async (runId, text, images) => {
        await this.daemon.router.dispatch("run.steer", {
          conversationId,
          agentId,
          runId,
          text,
          images,
        });
        return this.latestPromptId(runId, text);
      },
      followUp: async (runId, text, images) => {
        await this.daemon.router.dispatch("run.followUp", {
          conversationId,
          agentId,
          runId,
          text,
          images,
        });
        return this.latestPromptId(runId, text);
      },
      continue: async (runId) => {
        await normalizeCheckpointError(() =>
          this.daemon.router.dispatch("run.continue", { runId }),
        );
      },
      cancel: async (runId) => {
        await this.daemon.router.dispatch("run.cancel", {
          conversationId,
          agentId,
          runId,
        });
      },
      cancelPrompt: async (runId, promptId) => {
        void runId;
        await this.daemon.router.dispatch("agent.promptQueue.cancel", {
          agentId,
          queuedPromptId: promptId,
        });
      },
      answerQuestion: async (externalId, answer) => {
        await normalizeCheckpointError(() =>
          this.daemon.router.dispatch(
            "userQuestion.answer",
            { questionId: externalId, answer },
            { idempotencyKey: request(`answer-${externalId}`) },
          ),
        );
      },
      dismissQuestion: async (externalId, reason) => {
        await normalizeCheckpointError(() =>
          this.daemon.router.dispatch(
            "userQuestion.dismiss",
            { questionId: externalId, reason },
            { idempotencyKey: request(`dismiss-${externalId}`) },
          ),
        );
      },
      resolveApproval: async (externalId, decision) => {
        await normalizeCheckpointError(() =>
          this.daemon.router.dispatch(
            decision === "allow" ? "approval.grant" : "approval.deny",
            {
              conversationId,
              agentId,
              approvalId: externalId,
            },
            { idempotencyKey: request(`approval-${externalId}-${decision}`) },
          ),
        );
      },
      resolvePlan: async (externalId, decision, feedback) => {
        await normalizeCheckpointError(() =>
          this.daemon.router.dispatch(
            decision === "accept"
              ? "planReview.accept"
              : "planReview.requestChanges",
            {
              conversationId,
              agentId,
              reviewId: externalId,
              feedback,
            },
            { idempotencyKey: request(`plan-${externalId}-${decision}`) },
          ),
        );
      },
      restart: () => this.recreate(),
      load: (runId) => this.unitOfWork.load(runId),
      snapshot: (runId) => this.snapshot(runId),
      events: (runId) => this.events(runId),
      tools: (runId) => this.tools(runId),
      pendingInteraction: (runId, kind) => this.pendingInteraction(runId, kind),
      waitForStatus: (runId, statuses) => this.waitForStatus(runId, statuses),
      waitForToolStatus: (runId, status) =>
        this.waitForToolStatus(runId, status),
      faultCheckpoint: (runId, fault) => this.faultCheckpoint(runId, fault),
      removeDeliveryMarker: (runId, eventType) =>
        this.removeDeliveryMarker(runId, eventType),
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        unregister();
      },
    };
  }

  private async recreate(): Promise<void> {
    this.stores = new SandboxStateStores(this.dir);
    await this.stores.load();
    this.daemon = new SandboxDaemon(
      config,
      "sha256:parity",
      {
        sandboxId: "sbx_parity",
        instanceId: `inst_parity_${Date.now()}`,
      },
      this.stores,
      { workspaceDir: process.cwd() },
    );
    this.daemon.start();
    await this.daemon.router.dispatch("sandbox.status.get", {});
  }

  private async latestPromptId(runId: string, text: string): Promise<string> {
    return waitForValue(async () => {
      const state = await this.unitOfWork.load(runId);
      return [...(state?.prompts ?? [])]
        .reverse()
        .find((prompt) => prompt.text === text)?.id;
    }, `prompt ${text}`);
  }

  private async waitForStatus(runId: string, statuses: string[]) {
    return waitForValue(
      async () => {
        const state = await this.unitOfWork.load(runId);
        if (state && statuses.includes(state.run.status)) return state;
        if (
          state &&
          TERMINAL.includes(state.run.status) &&
          !statuses.includes(state.run.status)
        ) {
          throw new Error(
            `Run ${runId} settled as ${state.run.status}: ${state.run.failure?.message ?? ""}`,
          );
        }
        return undefined;
      },
      `${runId} status ${statuses.join("/")}`,
      15_000,
    );
  }

  private async waitForToolStatus(
    runId: string,
    status: string,
  ): Promise<void> {
    await waitForValue(async () => {
      const state = await this.unitOfWork.load(runId);
      return state?.transitions.some((transition) =>
        transition.toolCalls.some((tool) => tool.status === status),
      )
        ? true
        : undefined;
    }, `${runId} tool status ${status}`);
  }

  private async snapshot(runId: string) {
    const [response, state] = await Promise.all([
      this.daemon.router.dispatch("sandbox.conversation.snapshot.get", {
        runId,
      }) as Promise<{
        snapshot?: {
          entries: Array<{ id: string; role: string; text: string }>;
          toolCalls: Array<{
            id: string;
            toolName: string;
            status: string;
            resultPreview?: unknown;
          }>;
        };
      }>,
      this.unitOfWork.load(runId),
    ]);
    return {
      runId,
      status: state?.run.status ?? "missing",
      entries: (response.snapshot?.entries ?? []).map((entry) => ({
        id: entry.id,
        role: entry.role,
        text: entry.text,
      })),
      toolCalls: (response.snapshot?.toolCalls ?? []).map((tool) => ({
        id: tool.id,
        toolName: tool.toolName,
        status: tool.status,
        resultPreview: tool.resultPreview,
      })),
    };
  }

  private async events(runId: string): Promise<RealHostEventObservation[]> {
    await waitForValue(async () => {
      const state = await this.unitOfWork.load(runId);
      const intentIds = new Set(
        state?.transitions.flatMap((transition) =>
          transition.events.map((event) => event.id),
        ) ?? [],
      );
      const delivered = new Set(
        state?.deliveries.map((delivery) => delivery.intentId) ?? [],
      );
      return [...intentIds].every((intentId) => delivered.has(intentId))
        ? true
        : undefined;
    }, `${runId} durable event delivery`);
    return this.stores.events
      .all()
      .filter((event) => (event.data as { runId?: string }).runId === runId)
      .map((event) => ({
        id: event.id,
        type: event.type,
        durability: event.durability,
        runId,
        sequence: event.seq,
      }));
  }

  private async tools(runId: string) {
    const state = await this.unitOfWork.load(runId);
    const tools = new Map();
    for (const transition of state?.transitions ?? []) {
      for (const tool of transition.toolCalls) tools.set(tool.id, tool);
    }
    return [...tools.values()];
  }

  private async pendingInteraction(
    runId: string,
    kind?: RunInteractionRecord["kind"],
  ): Promise<PendingInteractionObservation | undefined> {
    const state = await this.unitOfWork.load(runId);
    const interaction = [...(state?.interactions ?? [])]
      .reverse()
      .find(
        (candidate) =>
          candidate.status === "pending" && (!kind || candidate.kind === kind),
      );
    if (!interaction) return undefined;
    return {
      interactionId: interaction.id,
      externalId: interaction.id,
      toolCallId: interaction.toolCallId,
      kind: interaction.kind,
      status: interaction.status,
      checkpointId: interaction.checkpointId,
    };
  }

  private async faultCheckpoint(
    runId: string,
    fault: CheckpointFault,
  ): Promise<void> {
    const state = await this.unitOfWork.load(runId);
    const checkpointId = state?.run.lastCheckpointId;
    if (!checkpointId) throw new Error(`Run ${runId} has no checkpoint`);
    const journal = this.transitionsPath(runId);
    const records = parseJsonLines(await readFile(journal, "utf8"));
    for (const record of records) {
      const checkpoints = record.checkpoints as Array<Record<string, unknown>>;
      const index = checkpoints.findIndex(
        (checkpoint) => checkpoint.checkpointId === checkpointId,
      );
      if (index < 0) continue;
      if (fault === "missing") checkpoints.splice(index, 1);
      if (fault === "corrupt") {
        checkpoints[index]!.checksum = `sha256:${"0".repeat(64)}`;
      }
      if (fault === "stale") {
        checkpoints.push({
          ...checkpoints[index],
          checkpointId: `checkpoint_stale_${"a".repeat(16)}`,
          createdAt: new Date(Date.now() + 1_000).toISOString(),
        });
      }
    }
    await writeJsonLines(journal, records);
    await this.recreate();
  }

  private async removeDeliveryMarker(
    runId: string,
    eventType: string,
  ): Promise<void> {
    const state = await this.unitOfWork.load(runId);
    const intentIds = new Set(
      state?.transitions.flatMap((transition) =>
        transition.events
          .filter((event) => event.type === eventType)
          .map((event) => event.id),
      ) ?? [],
    );
    const deliveries = this.deliveriesPath(runId);
    const records = parseJsonLines(await readFile(deliveries, "utf8")).filter(
      (record) => !intentIds.has(String(record.intentId)),
    );
    await writeJsonLines(deliveries, records);
  }

  private transitionsPath(runId: string): string {
    return path.join(
      this.dir,
      "run-runtime",
      "runs",
      safe(runId),
      "transitions.jsonl",
    );
  }

  private deliveriesPath(runId: string): string {
    return path.join(
      this.dir,
      "run-runtime",
      "runs",
      safe(runId),
      "event-deliveries.jsonl",
    );
  }
}

function replacePlanPath(
  steps: RealHostScenarioPreparation["steps"],
  planPath: string | undefined,
): RealHostScenarioPreparation["steps"] {
  return JSON.parse(
    JSON.stringify(steps).replaceAll(
      REAL_HOST_PLAN_PATH,
      planPath ?? REAL_HOST_PLAN_PATH,
    ),
  ) as RealHostScenarioPreparation["steps"];
}

async function normalizeCheckpointError<T>(
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (/valid latest checkpoint|INVALID_CHECKPOINT/i.test(String(error))) {
      const normalized = new Error(String(error));
      Object.assign(normalized, { code: "INVALID_CHECKPOINT" });
      throw normalized;
    }
    throw error;
  }
}

function parseJsonLines(raw: string): Array<Record<string, unknown>> {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function writeJsonLines(
  filePath: string,
  records: Array<Record<string, unknown>>,
): Promise<void> {
  await writeFile(
    filePath,
    records.length > 0
      ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
      : "",
    "utf8",
  );
}

async function waitForValue<T>(
  read: () => Promise<T | undefined>,
  description: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
