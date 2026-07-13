import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import type { RunInteractionRecord } from "@nervekit/contracts";
import { createOrchestratorState } from "../src/app/orchestrator-state.js";
import { WorkbenchRunUnitOfWork } from "../src/domains/runs/run-transition.repository.js";
import {
  initializeStorage,
  type InitializedStorage,
} from "../src/infrastructure/storage/index.js";
import type { OrchestratorState } from "../src/app/orchestrator-state.js";

const TERMINAL = ["completed", "failed", "cancelled"];

describe("workbench real-host run parity", () => {
  it("passes the shared production-host parity matrix", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-workbench-parity-"));
    const adapter = await WorkbenchParityAdapter.create(root);
    try {
      const result = await runRealHostParityMatrix(adapter);
      assert.equal(result.totalRuns, 20);
      assert.deepEqual(
        result.scenarios.map((scenario) => scenario.name),
        [
          "completion",
          "tools",
          "interactions",
          "cancellation",
          "retry-recovery",
          "redelivery-races",
        ],
      );
    } finally {
      await adapter.close();
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
    }
  });
});

class WorkbenchParityAdapter implements RealHostRunMatrixFixture {
  private orchestrator!: OrchestratorState;
  private readonly unitOfWork: WorkbenchRunUnitOfWork;
  private counter = 0;
  private projectId = "";

  private constructor(
    private readonly root: string,
    private readonly storage: InitializedStorage,
  ) {
    this.unitOfWork = new WorkbenchRunUnitOfWork(storage.paths.home);
  }

  static async create(root: string): Promise<WorkbenchParityAdapter> {
    const storage = await initializeStorage(root);
    const adapter = new WorkbenchParityAdapter(root, storage);
    await adapter.recreate();
    const project = await adapter.orchestrator.registry.createProject({
      dir: process.cwd(),
    });
    adapter.projectId = project.id;
    return adapter;
  }

  async prepare(
    options: RealHostScenarioPreparation,
  ): Promise<RealHostScenarioSession> {
    const ordinal = ++this.counter;
    const provider = `nerve-scripted-workbench-parity-${ordinal}`;
    const planPath = options.planContent
      ? join(this.storage.paths.home, "plans", `${safe(options.name)}.md`)
      : undefined;
    if (planPath) await writeFile(planPath, options.planContent!, "utf8");
    const registration = registerAgentScriptedProvider({
      provider,
      steps: replacePlanPath(options.steps, planPath),
    });
    const conversation = await this.orchestrator.registry.createConversation({
      projectId: this.projectId,
    });
    const agent = await this.orchestrator.registry.createAgent({
      projectId: this.projectId,
      conversationId: conversation.id,
      model: { provider, modelId: "scripted-fast" },
      mode: options.mode ?? "coding",
      permissionLevel: options.permissionLevel ?? "autonomous",
    });
    return this.session(
      options.name,
      conversation.id,
      agent.id,
      planPath,
      registration.unregister,
    );
  }

  async close(): Promise<void> {
    this.orchestrator.registry.shutdown();
    this.orchestrator.index.close();
  }

  private session(
    name: string,
    conversationId: string,
    agentId: string,
    planPath: string | undefined,
    unregister: () => void,
  ): RealHostScenarioSession {
    let disposed = false;
    return {
      name,
      planPath,
      start: async (prompt, images) => {
        await this.orchestrator.registry.promptAgent(agentId, {
          text: prompt,
          images,
        });
        return waitForValue(async () => {
          const states = await this.unitOfWork.list();
          return states.filter((state) => state.run.agentId === agentId).at(-1)
            ?.run.runId;
        }, "workbench run start");
      },
      steer: async (runId, text, images) => {
        await this.orchestrator.registry.promptAgent(agentId, {
          text,
          images,
          behavior: "steer",
        });
        return this.latestPromptId(runId, text);
      },
      followUp: async (runId, text, images) => {
        await this.orchestrator.registry.promptAgent(agentId, {
          text,
          images,
          behavior: "follow-up",
        });
        return this.latestPromptId(runId, text);
      },
      continue: async () => {
        await normalizeCheckpointError(() =>
          this.orchestrator.registry.continueFromFailedTurn(
            agentId,
            "entry_parity",
          ),
        );
      },
      cancel: async () => {
        await this.orchestrator.registry.abortAgent(agentId);
      },
      cancelPrompt: async (runId, promptId) => {
        void runId;
        await this.orchestrator.registry.cancelQueuedPrompt(agentId, promptId);
      },
      answerQuestion: async (externalId, answer) => {
        await normalizeCheckpointError(() =>
          this.orchestrator.registry.answerUserQuestion(externalId, answer),
        );
      },
      dismissQuestion: async (externalId, reason) => {
        await normalizeCheckpointError(() =>
          this.orchestrator.registry.dismissUserQuestion(externalId, reason),
        );
      },
      resolveApproval: async (externalId, decision) => {
        await normalizeCheckpointError(() =>
          decision === "allow"
            ? this.orchestrator.registry.grantApproval(externalId)
            : this.orchestrator.registry.denyApproval(externalId),
        );
      },
      resolvePlan: async (externalId, decision, feedback) => {
        await normalizeCheckpointError(() =>
          decision === "accept"
            ? this.orchestrator.registry.acceptPlanReview(externalId, feedback)
            : this.orchestrator.registry.requestPlanChanges(
                externalId,
                feedback,
              ),
        );
      },
      restart: () => this.recreate(),
      load: (runId) => this.unitOfWork.load(runId),
      snapshot: (runId) => this.snapshot(conversationId, runId),
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
    if (this.orchestrator) {
      this.orchestrator.registry.shutdown();
      this.orchestrator.index.close();
    }
    this.orchestrator = createOrchestratorState(this.storage, "127.0.0.1", 0);
    await this.orchestrator.events.hydrate();
    await this.orchestrator.registry.hydrate();
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

  private async snapshot(conversationId: string, runId: string) {
    const [snapshot, state] = await Promise.all([
      this.orchestrator.registry.getConversationSnapshot(conversationId),
      this.unitOfWork.load(runId),
    ]);
    return {
      runId,
      status: state?.run.status ?? "missing",
      entries: snapshot.entries
        .filter((entry) => entry.runId === runId)
        .map((entry) => ({
          id: entry.id,
          role: entry.role,
          text: entry.text,
        })),
      toolCalls: snapshot.toolCalls
        .filter((tool) => tool.runId === runId)
        .map((tool) => ({
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
    const events = await this.orchestrator.events.replayPersistedSince(0);
    return events
      .filter(
        (event) =>
          (event.data as { runId?: string } | undefined)?.runId === runId,
      )
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
    let externalId = interaction.id;
    if (interaction.kind === "question") {
      externalId =
        this.orchestrator.registry
          .listUserQuestions("pending")
          .find((question) => question.toolCallId === interaction.toolCallId)
          ?.id ?? externalId;
    } else if (interaction.kind === "approval") {
      externalId =
        this.orchestrator.registry.tools
          .listApprovals("pending")
          .find((approval) => approval.toolCallId === interaction.toolCallId)
          ?.id ?? externalId;
    } else {
      externalId =
        this.orchestrator.registry
          .listPlanReviews("pending")
          .find((review) => review.toolCallId === interaction.toolCallId)?.id ??
        externalId;
    }
    return {
      interactionId: interaction.id,
      externalId,
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
    const path = this.transitionsPath(runId);
    const records = parseJsonLines(await readFile(path, "utf8"));
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
    await writeJsonLines(path, records);
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
    const path = this.deliveriesPath(runId);
    const records = parseJsonLines(await readFile(path, "utf8")).filter(
      (record) => !intentIds.has(String(record.intentId)),
    );
    await writeJsonLines(path, records);
  }

  private transitionsPath(runId: string): string {
    return join(
      this.storage.paths.home,
      "run-runtime",
      "runs",
      safe(runId),
      "transitions.jsonl",
    );
  }

  private deliveriesPath(runId: string): string {
    return join(
      this.storage.paths.home,
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
  path: string,
  records: Array<Record<string, unknown>>,
): Promise<void> {
  await writeFile(
    path,
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
