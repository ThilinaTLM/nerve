import { prepareAgentInputCommands } from "./agent-input-preparation.js";
import {
  ModelHistoryInvalidError,
  modelHistoryIntegrityError,
  validateModelHistoryPath,
} from "../../conversations/model-history-navigation.js";
import { hasExecutableCommandBlocks } from "@nervekit/contracts/completions";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { WorkbenchPermissionContext } from "../../tools/permission/types.js";
import { resolveCompactionOwner } from "../../conversations/compaction-owner.js";
import {
  effectiveTurnConfigurationSchema,
  agentRecordSchema,
  type AgentRecord,
} from "@nervekit/contracts/agents";
import { resolveAgentModel, getAgentModelInfo } from "@nervekit/harness/models";
import { NodeExecutionEnv } from "@nervekit/harness/node";
import type { AgentMessage } from "@nervekit/harness/agent";
import { convertToLlm } from "@nervekit/harness/messages";
import type { WorkbenchAgentMechanics } from "./workbench-agent-mechanics.js";
import type { CoordinatorExecutionOptions } from "./coordinator-execution-options.js";
import { loadHarnessResources } from "../prompting/resource-loader.js";
import { createAgentToolsForAgent } from "../../tools/orchestration/agent-tool-adapter.js";
import { toToolCallTranscriptRecord } from "../../tools/artifacts/tool-call-transcript-preview.js";
import { composeAgentSystemPrompt } from "./system-prompt-builder.js";
import { planDirForStorageHome } from "../../plans/plan-paths.js";

/** A coherent record and resource selection, adopted only at a safe turn boundary. */
export class AgentTurnPreparationBlocker extends Error {
  constructor(
    message: string,
    readonly configurationRevision: number,
  ) {
    super(message);
  }
}
export type WorkbenchTurnPreparationFailure =
  | AgentTurnPreparationBlocker
  | ModelHistoryInvalidError;

export function isWorkbenchTurnPreparationFailure(
  error: unknown,
): error is WorkbenchTurnPreparationFailure {
  return (
    error instanceof AgentTurnPreparationBlocker ||
    error instanceof ModelHistoryInvalidError
  );
}
class SnapshotSuperseded extends Error {}

export interface WorkbenchPreparationSession {
  turnId: string;
  cutoffSequence?: number;
  budget: { remaining: number; hasImages: boolean };
  supersessions: number;
}

export function createWorkbenchPreparationSession(
  turnId: string,
): WorkbenchPreparationSession {
  return {
    turnId,
    budget: { remaining: 32, hasImages: false },
    supersessions: 0,
  };
}

/** Read the persisted context owner, never the transcript/cache or agent kind. */
export async function assertWorkbenchModelHistory(
  mechanics: WorkbenchAgentMechanics,
  agent: AgentRecord,
): Promise<void> {
  try {
    const storage = await mechanics.deps.harnessStorage.openAgentStorage(agent);
    const entries = await storage.getEntries();
    validateModelHistoryPath(
      new Map(entries.map((entry) => [entry.id, entry])),
      await storage.getLeafId(),
    );
  } catch (error) {
    throw modelHistoryIntegrityError(error) ?? error;
  }
}

export async function prepareWorkbenchTurn(
  options: Parameters<typeof resolveWorkbenchTurn>[0],
) {
  try {
    return await prepareVerifiedWorkbenchTurn(options);
  } catch (error) {
    throw modelHistoryIntegrityError(error) ?? error;
  }
}

async function prepareVerifiedWorkbenchTurn(
  options: Parameters<typeof resolveWorkbenchTurn>[0],
) {
  await assertWorkbenchModelHistory(options.mechanics, options.agent);
  const sourceId = options.coordinator.run.initialInputId;
  if (sourceId) {
    const source = await options.mechanics.deps.agentInputs?.get(
      options.agent.id,
      sourceId,
    );
    if (source?.state === "cancelled" || source?.state === "obsolete") {
      options.runAbortController.abort();
      throw new Error("Initial input was cancelled before invocation");
    }
  }
  const context = await options.conversation?.buildContext();
  const hasContextImages = convertToLlm(context?.messages ?? []).some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "image"),
  );
  const session =
    options.session ?? createWorkbenchPreparationSession(options.turnId);
  const budget = session.budget;
  budget.hasImages ||=
    Boolean(options.initialPromptHasImages) || hasContextImages;
  const readCommitted = async () => {
    const document =
      await options.mechanics.deps.storage.canonicalStore?.readDocument<unknown>(
        "agent",
        "global",
        options.agent.id,
      );
    const actor = document
      ? agentRecordSchema.parse(document.data)
      : (options.mechanics.deps.state.agents.get(options.agent.id) ??
        options.agent);
    if (
      actor.id !== options.agent.id ||
      actor.conversationId !== options.agent.conversationId ||
      actor.projectId !== options.agent.projectId ||
      actor.parentAgentId !== options.agent.parentAgentId ||
      actor.rootAgentId !== options.agent.rootAgentId ||
      resolveCompactionOwner(actor.conversationId, actor).ownerAgentId !==
        resolveCompactionOwner(options.agent.conversationId, options.agent)
          .ownerAgentId
    )
      throw new Error("Committed agent configuration context scope is corrupt");
    return actor;
  };
  let failedRevision = 1;
  while (session.supersessions < 8) {
    const cut = await options.mechanics.deps.agentInputs?.captureCut(
      options.agent.id,
      readCommitted,
    );
    const actor = cut?.actor ?? (await readCommitted());
    session.cutoffSequence ??= cut?.cutoffSequence;
    const captured = actor.configurationRevision ?? 1;
    failedRevision = captured;
    const generation = cut?.generation;
    try {
      return await resolveWorkbenchTurn(
        options,
        budget,
        generation,
        actor,
        session.cutoffSequence,
        readCommitted,
      );
    } catch (error) {
      const invalidHistory = modelHistoryIntegrityError(error);
      if (invalidHistory) throw invalidHistory;
      if (
        options.runAbortController.signal.aborted ||
        options.turnSignal?.aborted ||
        error instanceof ModelHistoryInvalidError
      )
        throw error;
      if (
        error instanceof SnapshotSuperseded ||
        captured !== ((await readCommitted()).configurationRevision ?? 1)
      ) {
        session.supersessions++;
        continue;
      }
      throw new AgentTurnPreparationBlocker(
        error instanceof Error ? error.message : String(error),
        captured,
      );
    }
  }
  throw new AgentTurnPreparationBlocker(
    "Configuration changed too frequently to prepare a coherent turn",
    (await readCommitted()).configurationRevision ?? failedRevision,
  );
}

async function resolveWorkbenchTurn(
  options: {
    mechanics: WorkbenchAgentMechanics;
    agent: AgentRecord;
    coordinator: CoordinatorExecutionOptions;
    runAbortController: AbortController;
    turnSignal?: AbortSignal;
    shellPath: string | undefined;
    turnId: string;
    session?: WorkbenchPreparationSession;
    initialPromptHasImages?: boolean;
    conversation?: import("@nervekit/harness/conversation").Conversation;
  },
  budget: { remaining: number; hasImages: boolean },
  generation?: number,
  capturedActor?: AgentRecord,
  cutoffSequence?: number,
  readCommitted?: () => Promise<AgentRecord>,
) {
  const { mechanics, agent, coordinator, runAbortController, shellPath } =
    options;
  const runId = coordinator.run.runId;
  const latestAgent = async () =>
    readCommitted
      ? await readCommitted()
      : (mechanics.deps.state.agents.get(agent.id) ?? agent);

  // Capture exactly one committed record. Do not re-read mutable agent
  // configuration during the provider request or its tool batch.
  const current = structuredClone(capturedActor ?? (await latestAgent()));
  if (
    current.activationState === "paused" ||
    (await mechanics.deps.agentInputs?.isPaused(agent.id))
  ) {
    runAbortController.abort();
    throw new Error("Agent activation is paused");
  }
  const turnId = options.turnId;
  if (!(await stat(current.projectDir)).isDirectory())
    throw new Error("Configured working directory is not a directory");
  const settings = await mechanics.effectiveSettings(current.projectDir);
  const selectionModel = current.model ?? settings.defaultModel;
  const nextModel = resolveAgentModel(
    selectionModel,
    await mechanics.customModels(current.projectDir),
  );
  if (
    selectionModel &&
    (nextModel.provider !== selectionModel.provider ||
      nextModel.id !== selectionModel.modelId)
  )
    throw new Error(
      `Configured model is unavailable: ${selectionModel.provider}/${selectionModel.modelId}`,
    );
  if (
    !getAgentModelInfo(nextModel).supportedThinkingLevels.includes(
      current.thinkingLevel,
    )
  )
    throw new Error(
      "Configured reasoning effort is unsupported by the selected model",
    );
  const effectiveAgent = {
    ...current,
    model: { provider: nextModel.provider, modelId: nextModel.id },
    permissionLevel: current.readOnlyCeiling
      ? ("read_only" as const)
      : current.permissionLevel,
  };
  const selection = await mechanics.deps.capabilities.resolve(
    current.projectId,
    current.conversationId,
  );
  const resources = await loadHarnessResources(current.projectDir, {
    storageHome: mechanics.deps.storage.paths.home,
    disabledSkillNames: selection.disabledFileSkills,
    enabledNerveSkillNames: selection.enabledNerveSkills,
    nerveSkills: mechanics.deps.nerveSkills.skills,
    enabledAgentBrowserSkillNames: selection.enabledAgentBrowserSkills,
    agentBrowserSkills: mechanics.deps.agentBrowserSkills.skills,
  });
  const activeToolNames = (
    await mechanics.activeToolNamesFor(effectiveAgent, selection)
  ).filter((name) => current.tools == null || current.tools.includes(name));
  const unavailableSkills =
    current.skills?.filter(
      (name) => !resources.skills.some((skill) => skill.name === name),
    ) ?? [];
  if (unavailableSkills.length)
    throw new Error(
      `Configured skills are unavailable: ${unavailableSkills.join(", ")}`,
    );
  const skills =
    current.skills == null
      ? resources.skills
      : resources.skills.filter((skill) =>
          current.skills!.includes(skill.name),
        );
  const resolvedActor: AgentRecord = {
    ...effectiveAgent,
    tools: activeToolNames,
    skills: skills.map((skill) => skill.name),
    permissionRuleSetId:
      current.permissionRuleSetId ??
      settings.defaultPermissionRuleSetId ??
      effectiveAgent.permissionLevel,
    systemPrompt: composeAgentSystemPrompt(
      effectiveAgent,
      activeToolNames,
      { ...resources, skills },
      { planDir: planDirForStorageHome(mechanics.deps.storage.paths.home) },
    ),
  };
  const permissionContext =
    await mechanics.deps.tools.capturePermissionContext(resolvedActor);
  if (permissionContext.policyDiagnostic)
    throw new Error(
      `Effective permission policy is blocked: ${permissionContext.policyDiagnostic}`,
    );
  resolvedActor.permissionRuleSetId =
    permissionContext.policy?.selectedRuleSetId ??
    resolvedActor.permissionRuleSetId;
  const { tools, toolAuthority } = await createWorkbenchTurnTools(
    mechanics,
    resolvedActor,
    coordinator,
    permissionContext,
  );
  const unavailableTools =
    current.tools?.filter(
      (name) =>
        !tools.some((tool) => tool.name === name) ||
        !activeToolNames.some((activeName) => activeName === name),
    ) ?? [];
  if (unavailableTools.length)
    throw new Error(
      `Configured tools are unavailable: ${unavailableTools.join(", ")}`,
    );
  if (
    ((await latestAgent()).configurationRevision ?? 1) !==
      (current.configurationRevision ?? 1) ||
    generation !==
      (await mechanics.deps.agentInputs?.controlGeneration(agent.id))
  )
    throw new SnapshotSuperseded();
  if (budget.hasImages && !nextModel.input.includes("image"))
    throw new Error("Selected model does not support input images");
  const preparedText = new Map<string, string>();
  if (options.conversation && mechanics.deps.agentInputs) {
    const pending = (await mechanics.deps.agentInputs.list(agent.id)).filter(
      (input) => input.sequence <= (cutoffSequence ?? Number.MAX_SAFE_INTEGER),
    );
    const eligible = [];
    for (const input of pending) {
      if (input.eligibility.kind === "run" && input.eligibility.runId !== runId)
        continue;
      if (
        input.eligibility.kind === "next_run" &&
        input.eligibility.afterRunId
      ) {
        const previous = await mechanics.deps.loadRunState?.(
          input.eligibility.afterRunId,
        );
        if (
          input.eligibility.afterRunId === runId ||
          !previous ||
          !["completed", "failed", "cancelled"].includes(previous.run.status)
        )
          continue;
      }
      eligible.push(input);
      if (eligible.length >= budget.remaining) break;
    }
    for (const input of eligible) {
      if (!hasExecutableCommandBlocks(input.text) || input.role !== "user") {
        preparedText.set(input.id, input.text);
        continue;
      }
      const text = await mechanics.deps.agentInputs.prepareContent(
        agent.id,
        input.id,
        options.turnSignal ?? runAbortController.signal,
        (record, signal) =>
          prepareAgentInputCommands({
            storage: mechanics.deps.storage,
            input: record,
            actor: resolvedActor,
            runId,
            attemptId: coordinator.run.executionId,
            signal,
            recover: (id, recordId) =>
              recordId
                ? mechanics.deps.tools.getToolCallDetails(recordId)
                : mechanics.deps.tools.findToolCallByProviderToolCallId(id),
            execute: (command, executionId, recordTool) =>
              mechanics.deps.tools.requestToolAndWait(
                resolvedActor,
                "bash",
                { command },
                {
                  runId,
                  signal,
                  agentSnapshot: resolvedActor,
                  permissionContext,
                  toolAuthority,
                  providerToolCallId: executionId,
                  onLifecycle: (tool) => recordTool(tool.id),
                  hidden: true,
                  useForegroundBash: false,
                  continueAfterPromotedTask: false,
                },
              ),
          }),
      );
      if (text !== undefined) preparedText.set(input.id, text);
      if (options.turnSignal?.aborted || runAbortController.signal.aborted)
        throw new Error("Turn interrupted during command preparation");
    }
    // A config-only turn can switch to a smaller model after the iteration
    // hook ran. Check its resolved window even with no pending input rows.
    if (budget.remaining > 0)
      await mechanics.maybeAutoCompactBeforeQueuedTurn({
        actor: resolvedActor,
        conversationId: agent.conversationId,
        agentId: agent.id,
        runId,
        text: eligible
          .map((input) => preparedText.get(input.id) ?? input.text)
          .join("\n"),
        images: eligible.flatMap((input) => input.images ?? []),
        conversation: options.conversation,
        signal: runAbortController.signal,
      });
  }
  if (
    ((await latestAgent()).configurationRevision ?? 1) !==
      (current.configurationRevision ?? 1) ||
    generation !==
      (await mechanics.deps.agentInputs?.controlGeneration(agent.id))
  )
    throw new SnapshotSuperseded();
  const delivered = await mechanics.deps.agentInputs?.prepare(
    {
      agentId: agent.id,
      conversationId: agent.conversationId,
      runId,
      attemptId: coordinator.run.executionId,
      turnId,
    },
    (input, id, insertionTarget) =>
      insertWorkbenchAgentInput(
        mechanics,
        current,
        coordinator,
        { ...input, text: preparedText.get(input.id) ?? input.text },
        id,
        insertionTarget,
      ),
    async (id) => {
      const state = await mechanics.deps.loadRunState?.(id);
      return Boolean(
        state &&
        ["completed", "failed", "cancelled"].includes(state.run.status),
      );
    },
    budget.remaining,
    async (id) =>
      Boolean(
        await (
          await mechanics.deps.harnessStorage.openAgentStorage(current)
        ).getEntry(id),
      ),
    undefined,
    async (input) => {
      if (input.images?.length && !nextModel.input.includes("image"))
        throw new Error("Selected model does not support queued input images");
    },
    cutoffSequence,
  );
  budget.remaining -= delivered?.length ?? 0;
  budget.hasImages ||= Boolean(
    delivered?.some((input) => input.images?.length),
  );
  if (
    ((await latestAgent()).configurationRevision ?? 1) !==
      (current.configurationRevision ?? 1) ||
    generation !==
      (await mechanics.deps.agentInputs?.controlGeneration(agent.id))
  )
    throw new SnapshotSuperseded();
  const effective = effectiveTurnConfigurationSchema.parse({
    agentId: current.id,
    runId,
    attemptId: coordinator.run.executionId,
    turnId,
    configurationRevision: current.configurationRevision ?? 1,
    configurationProvenance: "resolved",
    acceptedConfiguration: current,
    permissionPolicyHash: createHash("sha256")
      .update(JSON.stringify(permissionContext))
      .digest("hex"),
    configuration: resolvedActor,
  });
  return {
    effective,
    actor: resolvedActor,
    permissionContext,
    toolAuthority,
    model: nextModel,
    thinkingLevel: current.thinkingLevel,
    tools,
    activeToolNames,
    resources: { skills },
    env: new NodeExecutionEnv({
      cwd: current.projectDir,
      shellPath: settings.runtime.shellPath ?? shellPath,
    }),
    systemPrompt: effective.configuration.systemPrompt ?? "",
  };
}

export type WorkbenchOriginatingTurn = Pick<
  Awaited<ReturnType<typeof prepareWorkbenchTurn>>,
  "actor" | "permissionContext" | "toolAuthority"
>;

/** Record only snapshots that actually reach dispatch, not speculative final-boundary checks. */
export async function commitWorkbenchTurn(
  mechanics: WorkbenchAgentMechanics,
  effective: import("@nervekit/contracts/agents").EffectiveTurnConfiguration,
  turnId: string,
  sink: import("../../runs/runtime/index.js").RunExecutionSink,
): Promise<void> {
  await mechanics.deps.agentInputs?.bindTurn(
    effective.agentId,
    effective.turnId,
    turnId,
  );
  const snapshot = { ...effective, turnId };
  await sink.recordEffectiveTurnConfiguration(snapshot);
}

export async function dispatchWorkbenchTurn(
  mechanics: WorkbenchAgentMechanics,
  effective: import("@nervekit/contracts/agents").EffectiveTurnConfiguration,
  allocateTurn: () => string,
  coordinator: CoordinatorExecutionOptions,
  signal: AbortSignal,
  scope: AgentRecord,
): Promise<{ kind: "ready" } | { kind: "refresh" }> {
  const dispatch = async () => {
    await assertWorkbenchDispatch(mechanics, { id: effective.agentId }, signal);
    const commit = async () => {
      await assertWorkbenchDispatch(
        mechanics,
        { id: effective.agentId },
        signal,
      );
      const liveTurnId = allocateTurn();
      await commitWorkbenchTurn(
        mechanics,
        effective,
        liveTurnId,
        coordinator.sink,
      );
    };
    return mechanics.deps.claimPreparedTurn(
      {
        ...scope,
        id: effective.agentId,
        configurationRevision: effective.configurationRevision,
      },
      commit,
      async () => {
        await assertWorkbenchDispatch(
          mechanics,
          { id: effective.agentId },
          signal,
        );
        await mechanics.deps.agentInputs?.recordProviderDispatch(
          effective.agentId,
        );
      },
    );
  };
  return coordinator.withProviderDispatchFence
    ? coordinator.withProviderDispatchFence(dispatch)
    : dispatch();
}

export async function createWorkbenchTurnTools(
  mechanics: WorkbenchAgentMechanics,
  agent: AgentRecord,
  coordinator: CoordinatorExecutionOptions,
  capturedPermissionContext?: WorkbenchPermissionContext,
) {
  const runId = coordinator.run.runId;
  const permissionContext =
    capturedPermissionContext ??
    (await mechanics.deps.tools.capturePermissionContext(agent));
  const toolAuthority = await mechanics.deps.tools.captureToolAuthority(
    agent,
    permissionContext,
    { configurationProvenance: "resolved" },
  );
  return {
    toolAuthority,
    tools: createAgentToolsForAgent(agent, mechanics.deps.tools, {
      permissionContext,
      toolAuthority,
      runId,
      hidden: Boolean(agent.parentAgentId),
      resolveToolAnchor: (id) =>
        mechanics.deps.state.conversationRuntime.resolveToolAnchor(runId, id),
      onLifecycle: (toolCall) =>
        coordinator.sink.upsertToolCalls([
          toToolCallTranscriptRecord(toolCall),
        ]),
    }),
  };
}

export async function assertWorkbenchDispatch(
  mechanics: WorkbenchAgentMechanics,
  agent: Pick<AgentRecord, "id">,
  signal: AbortSignal,
): Promise<void> {
  if (
    signal.aborted ||
    mechanics.deps.state.agents.get(agent.id)?.activationState === "paused" ||
    (await mechanics.deps.agentInputs?.isPaused(agent.id))
  )
    throw new Error("Agent dispatch is paused or cancelled");
}

export async function insertWorkbenchAgentInput(
  mechanics: WorkbenchAgentMechanics,
  current: AgentRecord,
  coordinator: CoordinatorExecutionOptions,
  input: import("@nervekit/contracts/agents").AgentInputRecord,
  id: string,
  insertionTarget: import("../../runs/runtime/agent-inputs.js").AgentInputTarget,
): Promise<void> {
  const runId = coordinator.run.runId;
  // Provider-neutral adaptation: notification envelopes are data,
  // never promoted child output or impersonated system instructions.
  const text =
    input.role === "system"
      ? `[Trusted notification from ${input.origin.kind === "system" ? input.origin.producer : "unknown"}]\n${input.text}`
      : input.text;
  const message: AgentMessage =
    input.role === "system"
      ? {
          role: "harness",
          eventType:
            input.notice?.type === "user_intervention"
              ? "subagent_event"
              : (input.notice?.type ?? "agent_notification"),
          content: text,
          details: {
            ...input.notice,
            inputId: input.id,
            origin: input.origin,
            displayText: input.text,
          },
          images: input.images,
          timestamp: Date.parse(input.acceptedAt),
        }
      : {
          role: "user",
          content: [{ type: "text", text }, ...(input.images ?? [])],
          timestamp: Date.parse(input.acceptedAt),
        };
  await mechanics.deps.harnessStorage.appendAgentMessageWithId(
    current,
    id,
    message,
    input.acceptedAt,
  );
  // Materialize the stable input identity before acknowledging delivery.
  // A crash after context insertion retries this fenced callback.
  const storage = await mechanics.deps.harnessStorage.openAgentStorage(current);
  const known = new Set(
    (await storage.getEntries())
      .filter((entry) => entry.id !== id)
      .map((entry) => entry.id),
  );
  const mirrored = await mechanics.deps.messageMirror.mirrorNewHarnessEntries(
    current,
    storage,
    known,
    { runId: insertionTarget.runId },
  );
  if (mirrored.length && insertionTarget.runId === runId)
    await coordinator.sink.appendEntries(mirrored);
  if (
    resolveCompactionOwner(current.conversationId, current).ownerAgentId ===
      undefined &&
    input.role === "user"
  )
    await mechanics.deps.messageMirror.maybeDeriveInitialConversationTitle(
      current.conversationId,
      text,
    );
}
