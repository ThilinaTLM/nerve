/* eslint-disable max-lines -- Store coordinates manager websocket, lifecycle, chat, and workspace tab state while this app is still being factored. */
import type {
  CreatePinnedCommandRequest,
  EventEnvelope,
  ManagedSandboxRecord,
  ModelInfo,
  ModelSelection,
  OperationName,
  RemoveOptions,
  SandboxActivitySummary,
  SandboxConfigYamlResult,
  SandboxConversationSnapshot,
  SandboxCreateRequest,
  SandboxManagerCredentialProfile,
  SandboxManagerSecretMetadata,
  SandboxManagerStatus,
  SandboxPinnedCommand,
  StartTaskRequest,
  TaskRecord,
  ThinkingLevel,
  UpdatePinnedCommandRequest,
} from "@nervekit/contracts";
import {
  deriveConversationTitle,
  managedSandboxLifecycleStateSchema,
  sandboxActivitySummarySchema,
  runAcceptedResultSchema,
} from "@nervekit/contracts";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { notify } from "@nervekit/ui-kit/core/notify";
import {
  applyConversationEvent,
  fromSandboxConversationViewSnapshot,
} from "@nervekit/workbench-ui/state";
import {
  appendTaskLogPage,
  prependTaskLogPage,
} from "@nervekit/workbench-ui/tasks";
import { getContext, setContext } from "svelte";
import { createOperationId } from "../api/idempotency";
import * as api from "../api/manager-client";
import { protocolRequest } from "../api/manager-protocol-client";
import {
  ManagerWsClient,
  type ManagerStreamEventEnvelope,
  type ManagerWsConnectionState,
} from "../api/manager-ws-client.svelte";
import {
  checkoutSandboxGithubPr,
  getSandboxGithubPr,
} from "../api/sandbox-git.api";
import {
  createSandboxPinnedCommand,
  deleteSandboxPinnedCommand,
  listSandboxPinnedCommands,
  updateSandboxPinnedCommand,
} from "../api/sandbox-pinned-commands.api";
import {
  cancelSandboxTask,
  deleteSandboxTask,
  getSandboxTaskLogs,
  listSandboxTasks,
  pruneSandboxTasks,
  restartSandboxTask,
  startSandboxTask,
} from "../api/sandbox-tasks.api";
import {
  activeConversationKey,
  activeQueuedPrompt,
  createPendingConversationId,
  ensurePendingConversation,
  isPendingConversationId,
  replacePendingConversation,
  selectDurableConversation,
  selectPendingConversation as selectPendingConversationInDetail,
  setActiveComposerText,
  setActiveQueuedPrompt,
} from "./sandbox-conversation-state";
import { applySandboxEvent } from "./sandbox-event-reducers";
import {
  sandboxCanCreateConversation,
  sandboxCanForwardCommand,
  sandboxCanQueuePrompt,
  sandboxIsConnected,
  sandboxLifecycleMessage,
} from "./sandbox-lifecycle";
import { applySnapshot } from "./sandbox-snapshot-adapter";
import type { SandboxFleetFilter } from "./sandbox-status";
import {
  createSandboxDetailState,
  type PendingSandboxOperation,
  type SandboxDetailState,
  type SandboxDiagnosticTabId,
  type SandboxWorkspaceTabIdentity,
} from "./sandbox-ui-types";
import {
  closeWorkspaceTab as closeWorkspaceTabInDetail,
  closeWorkspaceTabs as closeWorkspaceTabsInDetail,
  openWorkspaceConversationTab as openWorkspaceConversationTabInDetail,
  openWorkspaceDiagnosticTab as openWorkspaceDiagnosticTabInDetail,
  openWorkspaceFile as openWorkspaceFileInDetail,
  openWorkspaceSummaryTab as openWorkspaceSummaryTabInDetail,
  refreshWorkspaceFile as refreshWorkspaceFileInDetail,
  selectWorkspaceTab as selectWorkspaceTabInDetail,
  toggleWorkspaceFileDisplayMode as toggleWorkspaceFileDisplayModeInDetail,
  toggleWorkspaceFileLineWrap as toggleWorkspaceFileLineWrapInDetail,
  workspaceTabsExcept,
  workspaceTabsLeftOf,
  workspaceTabsRightOf,
} from "./sandbox-workspace-tabs";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeUnique(
  first: string[] | undefined,
  second: string[] | undefined,
): string[] | undefined {
  const merged = [...new Set([...(first ?? []), ...(second ?? [])])];
  return merged.length > 0 ? merged : undefined;
}

function sandboxPrViewId(repo: string, number: number): string {
  return `${repo}#${number}`;
}

/**
 * Only forward a real conversation id (`conv_…`) to the sandbox daemon. The UI
 * uses a `"default"` placeholder key for the empty conversation view; sending it
 * as a conversation id makes the agent adopt an invalid id and crash when it
 * later encodes outbound events (the protocol requires the `conv_` prefix).
 */
function outboundConversationId(id: string | undefined): string | undefined {
  return id?.startsWith("conv_") ? id : undefined;
}

function recordForDetail(
  store: {
    details: Record<string, SandboxDetailState>;
    sandboxes: ManagedSandboxRecord[];
  },
  sandboxId: string,
): ManagedSandboxRecord | undefined {
  return (
    store.details[sandboxId]?.record ??
    store.sandboxes.find((record) => record.sandboxId === sandboxId)
  );
}

export class SandboxManagerStore {
  connection = $state<ManagerWsConnectionState>("idle");
  connectionError = $state<string | undefined>(undefined);
  managerStatus = $state<SandboxManagerStatus | undefined>(undefined);
  models = $state<ModelInfo[]>([]);
  credentialProfiles = $state<SandboxManagerCredentialProfile[]>([]);
  secretMetadata = $state<SandboxManagerSecretMetadata[]>([]);
  sandboxes = $state<ManagedSandboxRecord[]>([]);
  activityById = $state<Record<string, SandboxActivitySummary>>({});
  selectedSandboxId = $state<string | undefined>(undefined);
  details = $state<Record<string, SandboxDetailState>>({});
  pendingOperations = $state<Record<string, PendingSandboxOperation>>({});
  createDialogOpen = $state(false);
  fleetFilter = $state<SandboxFleetFilter>("all");
  searchQuery = $state("");
  loadingFleet = $state(false);
  fleetError = $state<string | undefined>(undefined);

  private ws: ManagerWsClient;
  private readonly conversationsLoading = new SvelteSet<string>();
  private readonly taskLogRefreshes = new SvelteMap<string, Promise<void>>();
  private readonly taskLogHistoryLoads = new SvelteMap<string, Promise<void>>();
  private fleetRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly operationCleanupTimers = new SvelteSet<
    ReturnType<typeof setTimeout>
  >();
  private disposed = false;
  private selectionGeneration = 0;
  constructor() {
    this.ws = new ManagerWsClient({
      onEvent: (envelope) => this.handleEvent(envelope),
      onConnectionChange: (state, error) => {
        this.connection = state;
        this.connectionError = error;
      },
      onSnapshotRecovery: () =>
        this.recoverProtocolSnapshot(this.selectedSandboxId),
    });
  }

  async init(): Promise<void> {
    await Promise.all([
      this.refreshManagerStatus(),
      this.refreshModels(),
      this.refreshCredentials(),
      this.refreshFleet(),
    ]);
    this.ws.connect();
  }

  dispose(): void {
    this.disposed = true;
    if (this.fleetRefreshTimer) clearTimeout(this.fleetRefreshTimer);
    for (const timer of this.operationCleanupTimers) clearTimeout(timer);
    this.operationCleanupTimers.clear();
    this.ws.close();
  }

  async refreshManagerStatus(): Promise<void> {
    try {
      this.managerStatus = await api.getManagerStatus();
    } catch (error) {
      this.fleetError = errorMessage(error);
    }
  }

  async refreshModels(): Promise<void> {
    try {
      this.models = await api.listModels();
    } catch (error) {
      this.fleetError = errorMessage(error);
    }
  }

  async refreshCredentials(): Promise<void> {
    try {
      const [profiles, metadata] = await Promise.all([
        api.listCredentialProfiles(),
        api.listSecretMetadata(),
      ]);
      this.credentialProfiles = profiles;
      this.secretMetadata = metadata;
    } catch (error) {
      this.fleetError = errorMessage(error);
    }
  }

  async refreshFleet(): Promise<void> {
    this.loadingFleet = true;
    try {
      const items = await api.listSandboxes();
      this.sandboxes = items.map((record) => {
        const result = { ...record };
        Reflect.deleteProperty(result, "activity");
        return result;
      });
      const activity: Record<string, SandboxActivitySummary> = {};
      for (const item of items)
        if (item.activity) activity[item.sandboxId] = item.activity;
      this.activityById = activity;
      this.fleetError = undefined;
    } catch (error) {
      this.fleetError = errorMessage(error);
    } finally {
      this.loadingFleet = false;
    }
  }

  detail(sandboxId: string): SandboxDetailState {
    let detail = this.details[sandboxId];
    if (!detail) {
      detail = createSandboxDetailState(sandboxId);
      this.details[sandboxId] = detail;
    }
    return detail;
  }

  async selectSandbox(sandboxId: string | undefined): Promise<void> {
    const generation = ++this.selectionGeneration;
    this.selectedSandboxId = sandboxId;
    this.ws.suspendSelection();
    if (!sandboxId) {
      const cursors = await this.recoverProtocolSnapshot(undefined);
      if (generation === this.selectionGeneration)
        this.ws.activateManager(cursors);
      return;
    }
    this.detail(sandboxId);
    await this.loadDetail(sandboxId);
    if (
      generation !== this.selectionGeneration ||
      this.selectedSandboxId !== sandboxId
    )
      return;
    const cursors = await this.recoverProtocolSnapshot(sandboxId);
    if (
      generation === this.selectionGeneration &&
      this.selectedSandboxId === sandboxId
    )
      this.ws.activateSelection(sandboxId, cursors);
  }

  private async recoverProtocolSnapshot(
    sandboxId: string | undefined,
  ): Promise<readonly { stream: string; processedSeq: number }[]> {
    const detail = sandboxId ? this.detail(sandboxId) : undefined;
    const { result } = await protocolRequest(
      "sandbox.manager.recovery.get",
      {
        sandboxId,
        conversationId: detail?.selectedConversationId,
        agentId: detail?.selectedAgentId,
        runId: detail?.selectedRunId,
      },
      { target: { role: "sandbox_manager" } },
    );
    if (this.selectedSandboxId !== sandboxId) return [];
    this.sandboxes = result.sandboxes.map((item) => {
      const record = { ...item };
      Reflect.deleteProperty(record, "activity");
      return record;
    });
    if (sandboxId && detail && result.selectedSandbox)
      applySnapshot(detail, result.selectedSandbox);
    if (sandboxId && detail && result.selectedConversation) {
      const renderState = fromSandboxConversationViewSnapshot(
        result.selectedConversation,
      );
      const key =
        renderState.conversationId ??
        result.selectedConversation.conversationId;
      if (key) detail.conversationViewsById[key] = renderState;
    }
    return result.cursors;
  }
  async loadDetail(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    detail.loading = true;
    try {
      const record = await api.getSandboxRecord(sandboxId);
      if (!record) {
        detail.record = undefined;
        detail.status = undefined;
        detail.snapshot = undefined;
        detail.controllerConnected = false;
        detail.latestSession = undefined;
        detail.error = "Sandbox not found";
        return;
      }
      this.patchRecord(record);
      const status = await api
        .getSandboxStatus(sandboxId)
        .catch(() => undefined);
      if (status) {
        detail.status = status;
        detail.controllerConnected = status.connected;
      }
      try {
        const snapshot = await api.getSandboxSnapshot(sandboxId);
        applySnapshot(detail, snapshot);
      } catch {
        // Snapshot may be unavailable when no controller session is connected.
      }
      await this.recoverConversationSnapshot(sandboxId).catch(() => undefined);
      try {
        detail.latestSession = await api.getLatestSession(sandboxId);
      } catch {
        detail.latestSession = undefined;
      }
      await this.refreshSandboxPinnedCommands(sandboxId).catch(() => undefined);
      if (sandboxIsConnected(detail))
        await this.refreshSandboxTasks(sandboxId).catch(() => undefined);
      if (sandboxIsConnected(detail)) void this.flushQueuedPrompt(sandboxId);
      detail.error = undefined;
    } catch (error) {
      detail.error = errorMessage(error);
    } finally {
      detail.loading = false;
    }
  }

  /**
   * Lazily load a sandbox's conversation list (for the navigator group) without
   * the full status polling of `loadDetail`. Cached once the snapshot is
   * present; safe to call repeatedly (e.g. on group expand/select).
   */
  async ensureConversations(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    if (detail.snapshot) return;
    if (this.conversationsLoading.has(sandboxId)) return;
    this.conversationsLoading.add(sandboxId);
    try {
      const snapshot = await api.getSandboxSnapshot(sandboxId);
      applySnapshot(detail, snapshot);
    } catch {
      // Snapshot may be unavailable when no controller session is connected.
    } finally {
      this.conversationsLoading.delete(sandboxId);
    }
  }

  async recoverConversationSnapshot(
    sandboxId: string,
    conversationId?: string,
    options: { select?: boolean } = {},
  ): Promise<void> {
    const detail = this.detail(sandboxId);
    const target = conversationId ?? detail.selectedConversationId;
    if (isPendingConversationId(target)) return;
    if (!target && detail.selectedPendingConversationId) return;
    const { result } = await protocolRequest(
      "sandbox.conversation.snapshot.get",
      {
        sandboxId,
        conversationId: outboundConversationId(target),
        agentId: detail.selectedAgentId,
        runId: detail.selectedRunId,
      },
      { target: { role: "sandbox_manager" } },
    );
    const renderState = fromSandboxConversationViewSnapshot(result);
    const key = renderState.conversationId ?? result.conversationId;
    if (!key) return;
    detail.conversationViewsById[key] = renderState;
    if (result.snapshot?.conversation) {
      const conversation = result.snapshot.conversation;
      this.upsertLocalConversation(sandboxId, {
        conversationId: conversation.id,
        agentIds: conversation.activeAgentId
          ? [conversation.activeAgentId]
          : [],
        title: conversation.title,
        mode: conversation.mode,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        activeRunIds: result.snapshot.activeRun?.runId
          ? [result.snapshot.activeRun.runId]
          : [],
      });
    }
    if (options.select || (!activeConversationKey(detail) && !target)) {
      selectDurableConversation(detail, key);
      detail.selectedAgentId = result.agentId ?? renderState.activeRun?.agentId;
      detail.selectedRunId = result.runId ?? renderState.activeRun?.runId;
      openWorkspaceConversationTabInDetail(detail, key);
    } else if (detail.selectedConversationId === key) {
      detail.selectedAgentId = result.agentId ?? renderState.activeRun?.agentId;
      detail.selectedRunId = result.runId ?? renderState.activeRun?.runId;
    }
    detail.lastRichSnapshot = {
      generatedAt: result.generatedAt,
      cursorSeq: renderState.cursorSeq,
      stale: result.stale,
      readOnly: result.fallback?.readOnly,
      reason: result.fallback?.reason,
    };
  }

  async previewSandboxConfigYaml(
    request: SandboxCreateRequest,
  ): Promise<SandboxConfigYamlResult> {
    return api.previewSandboxConfigYaml(request);
  }

  async loadSandboxConfigYaml(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    detail.configYamlLoading = true;
    try {
      const result = await api.getSandboxConfigYaml(sandboxId);
      detail.configYaml = result.yaml;
      detail.configYamlSource = result.source;
      detail.configYamlDigest = result.configDigest;
      detail.configYamlError = undefined;
    } catch (error) {
      detail.configYamlError = errorMessage(error);
    } finally {
      detail.configYamlLoading = false;
    }
  }

  async loadLogs(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    try {
      const logs = await api.getSandboxLogs(sandboxId, {
        tail: 500,
        maxBytes: 256 * 1024,
      });
      detail.logChunks = logs.chunks;
      detail.logsText = logs.chunks.map((chunk) => chunk.chunk).join("");
      detail.logsTruncated = logs.truncated;
      detail.logsAvailable = logs.available ?? true;
      detail.logsLimitations = logs.limitations;
    } catch (error) {
      detail.logsAvailable = false;
      detail.logsLimitations = [errorMessage(error)];
      detail.error = errorMessage(error);
    }
  }

  // --- workspace tab actions ---

  selectWorkspaceTab(
    sandboxId: string,
    tab: SandboxWorkspaceTabIdentity,
  ): void {
    selectWorkspaceTabInDetail(this.detail(sandboxId), tab);
  }

  closeWorkspaceTab(sandboxId: string, tab: SandboxWorkspaceTabIdentity): void {
    closeWorkspaceTabInDetail(this.detail(sandboxId), tab);
  }

  openWorkspaceConversationTab(sandboxId: string): void {
    openWorkspaceConversationTabInDetail(this.detail(sandboxId));
  }

  openWorkspaceSummaryTab(sandboxId: string): void {
    openWorkspaceSummaryTabInDetail(this.detail(sandboxId));
  }

  selectConversation(sandboxId: string, conversationId: string): void {
    const detail = this.detail(sandboxId);
    selectDurableConversation(detail, conversationId);
    const runs =
      detail.snapshot?.runs.filter(
        (run) => run.conversationId === conversationId,
      ) ?? [];
    const activeRun =
      runs.find((run) => run.status === "running") ??
      [...runs].sort((a, b) =>
        (b.updatedAt ?? b.createdAt ?? "").localeCompare(
          a.updatedAt ?? a.createdAt ?? "",
        ),
      )[0];
    detail.selectedRunId = activeRun?.runId;
    detail.selectedAgentId = activeRun?.agentId;
    openWorkspaceConversationTabInDetail(detail, conversationId);
    void this.recoverConversationSnapshot(sandboxId, conversationId, {
      select: true,
    }).catch(() => undefined);
  }

  selectPendingConversation(sandboxId: string, pendingId: string): void {
    const detail = this.detail(sandboxId);
    selectPendingConversationInDetail(detail, pendingId);
    openWorkspaceConversationTabInDetail(detail, pendingId);
  }

  startNewConversation(sandboxId: string): void {
    const detail = this.detail(sandboxId);
    const record = recordForDetail(this, sandboxId);
    if (!sandboxCanCreateConversation(record, detail)) {
      notify.message("Sandbox is read-only", {
        description: sandboxLifecycleMessage(record, detail),
      });
      return;
    }
    const pendingId = createPendingConversationId();
    ensurePendingConversation(detail, pendingId);
    selectPendingConversationInDetail(detail, pendingId);
    openWorkspaceConversationTabInDetail(detail, pendingId);
  }

  closeOtherWorkspaceTabs(
    sandboxId: string,
    tab: SandboxWorkspaceTabIdentity,
  ): void {
    const detail = this.detail(sandboxId);
    closeWorkspaceTabsInDetail(
      detail,
      workspaceTabsExcept(detail.openWorkspaceTabs, tab),
      tab,
    );
  }

  closeWorkspaceTabsRight(
    sandboxId: string,
    tab: SandboxWorkspaceTabIdentity,
  ): void {
    const detail = this.detail(sandboxId);
    closeWorkspaceTabsInDetail(
      detail,
      workspaceTabsRightOf(detail.openWorkspaceTabs, tab),
      tab,
    );
  }

  closeWorkspaceTabsLeft(
    sandboxId: string,
    tab: SandboxWorkspaceTabIdentity,
  ): void {
    const detail = this.detail(sandboxId);
    closeWorkspaceTabsInDetail(
      detail,
      workspaceTabsLeftOf(detail.openWorkspaceTabs, tab),
      tab,
    );
  }

  openWorkspaceDiagnosticTab(
    sandboxId: string,
    id: SandboxDiagnosticTabId,
  ): void {
    openWorkspaceDiagnosticTabInDetail(this.detail(sandboxId), id);
  }

  openWorkspaceTaskOutput(sandboxId: string, taskId: string): void {
    const detail = this.detail(sandboxId);
    detail.selectedTaskId = taskId;
    selectWorkspaceTabInDetail(detail, { kind: "task", id: taskId });
    void this.refreshSandboxTaskLogs(sandboxId, taskId).catch(() => undefined);
  }

  openWorkspacePr(sandboxId: string, repo: string, number: number): void {
    const detail = this.detail(sandboxId);
    const id = sandboxPrViewId(repo, number);
    detail.prViewsById[id] ??= { id, repo, number, loading: false };
    selectWorkspaceTabInDetail(detail, { kind: "pr", id, repo, number });
    void this.refreshSandboxPr(sandboxId, repo, number).catch(() => undefined);
  }

  async openWorkspaceFile(
    sandboxId: string,
    path: string,
    line?: number,
  ): Promise<void> {
    await openWorkspaceFileInDetail(
      this.detail(sandboxId),
      sandboxId,
      path,
      line,
    );
  }

  async refreshWorkspaceFile(
    sandboxId: string,
    fileTabId: string,
    line?: number,
  ): Promise<void> {
    await refreshWorkspaceFileInDetail(
      this.detail(sandboxId),
      sandboxId,
      fileTabId,
      line,
    );
  }

  toggleWorkspaceFileDisplayMode(sandboxId: string, fileTabId: string): void {
    toggleWorkspaceFileDisplayModeInDetail(this.details[sandboxId], fileTabId);
  }

  toggleWorkspaceFileLineWrap(sandboxId: string, fileTabId: string): void {
    toggleWorkspaceFileLineWrapInDetail(this.details[sandboxId], fileTabId);
  }

  async refreshSandboxTasks(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    try {
      detail.tasks = await listSandboxTasks(sandboxId);
      detail.error = undefined;
    } catch (error) {
      detail.error = errorMessage(error);
      throw error;
    }
  }

  async refreshSandboxTaskLogs(
    sandboxId: string,
    taskId = this.detail(sandboxId).selectedTaskId,
  ): Promise<void> {
    if (!taskId) return;
    const key = `${sandboxId}:${taskId}`;
    const existing = this.taskLogRefreshes.get(key);
    if (existing) return existing;

    const request = (async () => {
      const detail = this.detail(sandboxId);
      let current = detail.taskLogsById[taskId];
      if (!current) {
        const initial = await getSandboxTaskLogs(sandboxId, taskId, {
          mode: "recent",
          limit: 500,
        });
        if (this.details[sandboxId]?.tasks.some((task) => task.id === taskId)) {
          this.detail(sandboxId).taskLogsById[taskId] = initial;
        }
        return;
      }

      let newer = await getSandboxTaskLogs(sandboxId, taskId, {
        mode: "since_cursor",
        sinceSeq: current.nextCursor,
        limit: 500,
      });
      while (true) {
        current = this.details[sandboxId]?.taskLogsById[taskId];
        if (!current) return;
        this.detail(sandboxId).taskLogsById[taskId] = appendTaskLogPage(
          current,
          newer,
        );
        if (!newer.hasMoreAfter) return;
        newer = await getSandboxTaskLogs(sandboxId, taskId, {
          mode: "since_cursor",
          sinceSeq: newer.nextCursor,
          limit: 500,
        });
      }
    })().finally(() => this.taskLogRefreshes.delete(key));
    this.taskLogRefreshes.set(key, request);
    return request;
  }

  async loadEarlierSandboxTaskLogs(
    sandboxId: string,
    taskId: string,
  ): Promise<void> {
    const key = `${sandboxId}:${taskId}`;
    const existing = this.taskLogHistoryLoads.get(key);
    if (existing) return existing;
    const current = this.details[sandboxId]?.taskLogsById[taskId];
    const beforeSeq = current?.events[0]?.seq;
    if (!current?.hasMoreBefore || beforeSeq === undefined) return;

    const request = getSandboxTaskLogs(sandboxId, taskId, {
      mode: "recent",
      beforeSeq,
      limit: 500,
    })
      .then((older) => {
        const latest = this.details[sandboxId]?.taskLogsById[taskId];
        if (!latest) return;
        this.detail(sandboxId).taskLogsById[taskId] = prependTaskLogPage(
          latest,
          older,
        );
      })
      .finally(() => this.taskLogHistoryLoads.delete(key));
    this.taskLogHistoryLoads.set(key, request);
    return request;
  }

  async runSandboxTask(
    sandboxId: string,
    request: Omit<StartTaskRequest, "cwd"> & { cwd?: string },
  ): Promise<void> {
    const task = await startSandboxTask(sandboxId, request);
    const detail = this.detail(sandboxId);
    detail.tasks = [
      task,
      ...detail.tasks.filter((item) => item.id !== task.id),
    ];
    this.openWorkspaceTaskOutput(sandboxId, task.id);
  }

  async cancelSandboxTask(sandboxId: string, taskId: string): Promise<void> {
    const task = await cancelSandboxTask(sandboxId, taskId);
    this.upsertSandboxTask(sandboxId, task);
  }

  async restartSandboxTask(sandboxId: string, taskId: string): Promise<void> {
    const task = await restartSandboxTask(sandboxId, taskId);
    this.upsertSandboxTask(sandboxId, task);
    this.openWorkspaceTaskOutput(sandboxId, task.id);
  }

  async removeSandboxTask(sandboxId: string, taskId: string): Promise<void> {
    await deleteSandboxTask(sandboxId, taskId);
    const detail = this.detail(sandboxId);
    detail.tasks = detail.tasks.filter((task) => task.id !== taskId);
    delete detail.taskLogsById[taskId];
  }

  async pruneSandboxTasks(sandboxId: string): Promise<void> {
    const result = await pruneSandboxTasks(sandboxId);
    const removed = new SvelteSet(result.removed);
    const detail = this.detail(sandboxId);
    detail.tasks = detail.tasks.filter((task) => !removed.has(task.id));
    for (const taskId of removed) delete detail.taskLogsById[taskId];
  }

  async refreshSandboxPinnedCommands(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    detail.pinnedCommandsLoading = true;
    try {
      detail.pinnedCommands = await listSandboxPinnedCommands(sandboxId);
    } finally {
      detail.pinnedCommandsLoading = false;
    }
  }

  async createSandboxPinnedCommand(
    sandboxId: string,
    request: CreatePinnedCommandRequest,
  ): Promise<void> {
    const command = await createSandboxPinnedCommand(sandboxId, request);
    const detail = this.detail(sandboxId);
    detail.pinnedCommands = [command, ...detail.pinnedCommands];
  }

  async updateSandboxPinnedCommand(
    sandboxId: string,
    command: SandboxPinnedCommand,
    request: UpdatePinnedCommandRequest,
  ): Promise<void> {
    const updated = await updateSandboxPinnedCommand(
      sandboxId,
      command.id,
      request,
    );
    const detail = this.detail(sandboxId);
    detail.pinnedCommands = detail.pinnedCommands.map((item) =>
      item.id === updated.id ? updated : item,
    );
  }

  async deleteSandboxPinnedCommand(
    sandboxId: string,
    command: SandboxPinnedCommand,
  ): Promise<void> {
    await deleteSandboxPinnedCommand(sandboxId, command.id);
    const detail = this.detail(sandboxId);
    detail.pinnedCommands = detail.pinnedCommands.filter(
      (item) => item.id !== command.id,
    );
  }

  async refreshSandboxPr(
    sandboxId: string,
    repo: string,
    number: number,
  ): Promise<void> {
    const detail = this.detail(sandboxId);
    const id = sandboxPrViewId(repo, number);
    let view = detail.prViewsById[id];
    if (!view) {
      view = { id, repo, number, loading: false };
      detail.prViewsById[id] = view;
    }
    view.loading = true;
    view.error = undefined;
    try {
      view.detail = await getSandboxGithubPr(sandboxId, repo, number);
    } catch (error) {
      view.error = errorMessage(error);
    } finally {
      view.loading = false;
    }
  }

  async checkoutSandboxPr(
    sandboxId: string,
    repo: string,
    number: number,
  ): Promise<void> {
    await checkoutSandboxGithubPr(sandboxId, repo, number);
    await this.refreshSandboxPr(sandboxId, repo, number).catch(() => undefined);
  }

  private upsertSandboxTask(sandboxId: string, task: TaskRecord): void {
    const detail = this.detail(sandboxId);
    detail.tasks = [
      task,
      ...detail.tasks.filter((item) => item.id !== task.id),
    ];
  }

  // --- lifecycle actions ---

  async writeSecret(request: {
    key: string;
    value: string;
    version?: string;
    expiresAt?: string;
  }): Promise<void> {
    await api.writeManagerSecret(request);
    await this.refreshCredentials();
  }

  async createCredentialProfile(
    request: Parameters<typeof api.createCredentialProfile>[0],
  ): Promise<void> {
    await api.createCredentialProfile(request);
    await this.refreshCredentials();
  }

  async refreshCredentialProfile(profileId: string): Promise<void> {
    await api.refreshCredentialProfile(profileId);
    await this.refreshCredentials();
  }

  async createSandbox(request: SandboxCreateRequest): Promise<string> {
    const record = await this.runOperation(
      "create",
      undefined,
      "Create sandbox",
      (key) => api.createSandbox(request, key),
    );
    this.patchRecord(record);
    await this.refreshFleet();
    return record.sandboxId;
  }

  async startSandbox(sandboxId: string): Promise<void> {
    const record = await this.runOperation(
      "start",
      sandboxId,
      "Start sandbox",
      (key) => api.startSandbox(sandboxId, key),
    );
    this.patchRecord(record);
  }

  async stopSandbox(sandboxId: string): Promise<void> {
    const record = await this.runOperation(
      "stop",
      sandboxId,
      "Stop sandbox",
      (key) => api.stopSandbox(sandboxId, key),
    );
    this.patchRecord(record);
  }

  async restartSandbox(sandboxId: string): Promise<void> {
    const record = await this.runOperation(
      "restart",
      sandboxId,
      "Restart sandbox",
      (key) => api.restartSandbox(sandboxId, key),
    );
    this.patchRecord(record);
  }

  async removeSandbox(
    sandboxId: string,
    options: RemoveOptions,
  ): Promise<void> {
    await this.runOperation("remove", sandboxId, "Remove sandbox", (key) =>
      api.removeSandbox(sandboxId, options, key),
    );
    this.sandboxes = this.sandboxes.filter(
      (record) => record.sandboxId !== sandboxId,
    );
    if (this.selectedSandboxId === sandboxId)
      this.selectedSandboxId = undefined;
    delete this.details[sandboxId];
    delete this.activityById[sandboxId];
  }

  // --- chat / command actions ---

  /**
   * Submit a prompt from the composer. When the sandbox is not yet ready for
   * chat, hold the prompt and auto-dispatch it once the controller connects
   * (see `flushQueuedPrompt`).
   */
  async submitPrompt(sandboxId: string, prompt: string): Promise<void> {
    const detail = this.detail(sandboxId);
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const record = recordForDetail(this, sandboxId);
    if (!sandboxCanQueuePrompt(record, detail)) {
      notify.message("Sandbox is read-only", {
        description: sandboxLifecycleMessage(record, detail),
      });
      return;
    }
    if (sandboxCanForwardCommand(record, detail)) {
      await this.sendPrompt(sandboxId, trimmed);
      return;
    }
    setActiveQueuedPrompt(detail, trimmed);
    setActiveComposerText(detail, "");
  }

  setComposerText(sandboxId: string, text: string): void {
    setActiveComposerText(this.detail(sandboxId), text);
  }

  /** Dispatch queued prompts once the sandbox is ready for chat. */
  async flushQueuedPrompt(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    const record = recordForDetail(this, sandboxId);
    if (!sandboxCanQueuePrompt(record, detail)) return;
    if (!sandboxCanForwardCommand(record, detail)) return;
    const activeKey = activeConversationKey(detail);
    const activeQueued = activeQueuedPrompt(detail);
    if (activeQueued) {
      setActiveQueuedPrompt(detail, undefined);
      await this.sendPrompt(sandboxId, activeQueued);
    }
    for (const pending of Object.values(detail.pendingConversationsById)) {
      if (pending.id === activeKey) continue;
      if (!pending.queuedPrompt) continue;
      const queued = pending.queuedPrompt;
      pending.queuedPrompt = undefined;
      selectPendingConversationInDetail(detail, pending.id);
      openWorkspaceConversationTabInDetail(detail, pending.id);
      await this.sendPrompt(sandboxId, queued);
    }
    for (const [conversationId, queued] of Object.entries(
      detail.queuedPromptByConversationId,
    )) {
      if (!queued) continue;
      detail.queuedPromptByConversationId[conversationId] = undefined;
      this.selectConversation(sandboxId, conversationId);
      await this.sendPrompt(sandboxId, queued);
    }
  }

  async sendPrompt(sandboxId: string, prompt: string): Promise<void> {
    const detail = this.detail(sandboxId);
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const record = recordForDetail(this, sandboxId);
    if (!sandboxCanForwardCommand(record, detail)) {
      setActiveComposerText(detail, trimmed);
      notify.message("Sandbox command disabled", {
        description: sandboxLifecycleMessage(record, detail),
      });
      return;
    }
    const conversationId = outboundConversationId(
      detail.selectedConversationId,
    );
    const pendingId =
      detail.selectedPendingConversationId ??
      (!conversationId &&
      detail.activeWorkspaceTab?.kind === "conversation" &&
      isPendingConversationId(detail.activeWorkspaceTab.id)
        ? detail.activeWorkspaceTab.id
        : undefined);
    if (pendingId) {
      ensurePendingConversation(detail, pendingId);
      if (!detail.selectedPendingConversationId)
        selectPendingConversationInDetail(detail, pendingId);
    }
    detail.sending = true;
    if (pendingId) detail.pendingConversationsById[pendingId].sending = true;
    try {
      const behavior =
        conversationId && detail.selectedRunId ? "follow_up" : "start";
      const raw = await this.sendOperation(
        sandboxId,
        behavior === "follow_up" ? "run.followUp" : "run.start",
        () => ({
          conversationId,
          agentId: detail.selectedAgentId,
          text: trimmed,
        }),
      );
      const result = runAcceptedResultSchema
        .required({ conversationId: true, agentId: true, runId: true })
        .parse(raw);
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Timestamp is read immediately and is not reactive state.
      const now = new Date().toISOString();
      const pendingCreatedAt = pendingId
        ? detail.pendingConversationsById[pendingId]?.createdAt
        : undefined;
      this.upsertLocalConversation(sandboxId, {
        conversationId: result.conversationId,
        agentIds: [result.agentId],
        title: deriveConversationTitle(trimmed),
        mode: detail.agentControls.mode === "planning" ? "planning" : "coding",
        createdAt: pendingCreatedAt ?? now,
        updatedAt: now,
        activeRunIds: [result.runId],
      });
      if (pendingId) {
        replacePendingConversation(detail, pendingId, result);
      } else {
        selectDurableConversation(detail, result.conversationId);
        detail.selectedAgentId = result.agentId;
        detail.selectedRunId = result.runId;
        openWorkspaceConversationTabInDetail(detail, result.conversationId);
      }
      detail.composerTextByConversationId[result.conversationId] = "";
      setActiveComposerText(detail, "");
      // Start snapshot polling immediately — we know a run is starting, so do not
      // wait for a `run.started` event (which can be dropped by live delivery).
    } finally {
      if (pendingId && detail.pendingConversationsById[pendingId])
        detail.pendingConversationsById[pendingId].sending = false;
      detail.sending = false;
    }
  }

  async cancelRun(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    if (!this.canForwardSandboxCommand(sandboxId)) return;
    if (!detail.selectedRunId) return;
    await this.sendOperation(sandboxId, "run.cancel", () => ({
      conversationId: outboundConversationId(detail.selectedConversationId),
      agentId: detail.selectedAgentId,
      runId: detail.selectedRunId,
    }));
  }

  async continueRun(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    if (!this.canForwardSandboxCommand(sandboxId)) return;
    if (!detail.selectedRunId) return;
    await this.sendOperation(sandboxId, "run.continue", () => ({
      conversationId: outboundConversationId(detail.selectedConversationId),
      agentId: detail.selectedAgentId,
      runId: detail.selectedRunId,
      reason: "manual",
    }));
  }

  async submitInput(
    sandboxId: string,
    waitId: string,
    text: string,
  ): Promise<void> {
    const detail = this.detail(sandboxId);
    if (!this.canForwardSandboxCommand(sandboxId)) return;
    await this.sendOperation(sandboxId, "userQuestion.answer", () => ({
      questionId: waitId,
      answer: text,
    }));
    const wait = detail.waitsById[waitId];
    if (wait) wait.status = "submitted";
  }

  async resolvePlanReview(
    sandboxId: string,
    reviewId: string,
    decision: "accept" | "request_changes" | "discard",
    options: {
      feedback?: string;
      implementationModel?: ModelSelection;
      implementationThinkingLevel?: ThinkingLevel;
    } = {},
  ): Promise<void> {
    const detail = this.detail(sandboxId);
    if (!this.canForwardSandboxCommand(sandboxId)) return;
    const method =
      decision === "accept"
        ? "planReview.accept"
        : decision === "request_changes"
          ? "planReview.requestChanges"
          : "planReview.discard";
    await this.sendOperation(sandboxId, method, () => ({
      reviewId,
      ...options,
    }));
    const wait = detail.waitsById[reviewId];
    if (wait) {
      wait.status = "submitted";
      if (wait.planReview) {
        wait.planReview.status =
          decision === "accept"
            ? "accepted"
            : decision === "request_changes"
              ? "changes_requested"
              : "discarded";
      }
    }
    if (decision === "accept" && detail.agentControls) {
      detail.agentControls.mode = "normal";
      if (options.implementationModel) {
        detail.agentControls.provider = options.implementationModel.provider;
        detail.agentControls.model = options.implementationModel.modelId;
      }
      if (options.implementationThinkingLevel)
        detail.agentControls.thinkingLevel =
          options.implementationThinkingLevel;
    }
    await this.recoverConversationSnapshot(
      sandboxId,
      detail.selectedConversationId,
    );
  }

  async resolveApproval(
    sandboxId: string,
    waitId: string,
    decision: "grant" | "deny",
  ): Promise<void> {
    const detail = this.detail(sandboxId);
    if (!this.canForwardSandboxCommand(sandboxId)) return;
    await this.sendOperation(
      sandboxId,
      decision === "grant" ? "approval.grant" : "approval.deny",
      () => ({ approvalId: waitId }),
    );
    const wait = detail.waitsById[waitId];
    if (wait) wait.status = decision === "grant" ? "granted" : "denied";
  }

  /**
   * Apply runtime agent controls (model/thinking/mode/permission/policy). Model,
   * thinking, and mode changes take effect on the next model request; permission
   * and approval-policy changes apply immediately. `run.start` has no
   * per-run overrides, so every control change routes through configure.
   */
  async configureAgent(
    sandboxId: string,
    patch: {
      model?: {
        provider: string;
        model: string;
        thinkingLevel?: ThinkingLevel;
      };
      mode?: "normal" | "planning";
      permissionLevel?: "read_only" | "supervised" | "autonomous";
      approvalPolicy?: { autoApproveReadOnly?: boolean };
    },
  ): Promise<void> {
    const detail = this.detail(sandboxId);
    if (!this.canForwardSandboxCommand(sandboxId, false)) return;
    if (!detail.selectedAgentId) return;
    await this.sendOperation(sandboxId, "agent.configure", () => ({
      agentId: detail.selectedAgentId,
      model: patch.model
        ? { provider: patch.model.provider, modelId: patch.model.model }
        : undefined,
      thinkingLevel: patch.model?.thinkingLevel,
      mode: patch.mode,
      permissionLevel: patch.permissionLevel,
      approvalPolicy: patch.approvalPolicy,
    }));
  }

  private canForwardSandboxCommand(
    sandboxId: string,
    notifyUser = true,
  ): boolean {
    const detail = this.detail(sandboxId);
    const record = recordForDetail(this, sandboxId);
    if (sandboxCanForwardCommand(record, detail)) return true;
    if (notifyUser)
      notify.message("Sandbox command disabled", {
        description: sandboxLifecycleMessage(record, detail),
      });
    return false;
  }

  private async sendOperation(
    sandboxId: string,
    method: OperationName,
    buildParams: (key: string) => Record<string, unknown>,
  ): Promise<unknown> {
    return this.runOperation("command", sandboxId, method, (key) =>
      api.sendSandboxOperation(sandboxId, method, buildParams(key), key),
    );
  }

  private async runOperation<T>(
    kind: PendingSandboxOperation["kind"],
    sandboxId: string | undefined,
    label: string,
    fn: (key: string) => Promise<T>,
  ): Promise<T> {
    const key = createOperationId(kind);
    this.pendingOperations[key] = {
      key,
      kind,
      sandboxId,
      label,
      status: "pending",
      startedAt: Date.now(),
    };
    try {
      const result = await fn(key);
      this.pendingOperations[key].status = "completed";
      this.scheduleOpCleanup(key);
      return result;
    } catch (error) {
      this.pendingOperations[key].status = "error";
      this.pendingOperations[key].error = errorMessage(error);
      this.scheduleOpCleanup(key, 6000);
      throw error;
    }
  }

  private scheduleOpCleanup(key: string, delay = 2500): void {
    const timer = setTimeout(() => {
      this.operationCleanupTimers.delete(timer);
      if (this.disposed) return;
      delete this.pendingOperations[key];
    }, delay);
    this.operationCleanupTimers.add(timer);
  }

  private upsertLocalConversation(
    sandboxId: string,
    conversation: SandboxConversationSnapshot,
  ): void {
    const detail = this.detail(sandboxId);
    const snapshotIndex = detail.snapshot?.conversations.findIndex(
      (item) => item.conversationId === conversation.conversationId,
    );
    const existing =
      snapshotIndex !== undefined && snapshotIndex >= 0
        ? detail.snapshot?.conversations[snapshotIndex]
        : detail.localConversationsById[conversation.conversationId];
    const next = {
      ...existing,
      ...conversation,
      agentIds: mergeUnique(existing?.agentIds, conversation.agentIds),
      activeRunIds: conversation.activeRunIds ?? existing?.activeRunIds,
    };
    if (detail.snapshot && snapshotIndex !== undefined && snapshotIndex >= 0) {
      detail.snapshot.conversations = detail.snapshot.conversations.map(
        (item, index) => (index === snapshotIndex ? next : item),
      );
      delete detail.localConversationsById[conversation.conversationId];
      return;
    }
    detail.localConversationsById[conversation.conversationId] = next;
  }

  private applyLifecycleChange(data: unknown): void {
    if (typeof data !== "object" || data === null) return;
    const payload = data as {
      sandboxId?: unknown;
      current?: unknown;
      changedAt?: unknown;
    };
    if (typeof payload.sandboxId !== "string") return;
    const parsed = managedSandboxLifecycleStateSchema.safeParse(
      payload.current,
    );
    if (!parsed.success) return;
    const record = this.sandboxes.find(
      (existing) => existing.sandboxId === payload.sandboxId,
    );
    if (!record || record.lifecycleState === parsed.data) return;
    this.patchRecord({
      ...record,
      lifecycleState: parsed.data,
      lifecycleUpdatedAt:
        typeof payload.changedAt === "string"
          ? payload.changedAt
          : new Date().toISOString(),
    });
  }

  private patchRecord(record: ManagedSandboxRecord): void {
    const index = this.sandboxes.findIndex(
      (existing) => existing.sandboxId === record.sandboxId,
    );
    if (index === -1) this.sandboxes = [...this.sandboxes, record];
    else
      this.sandboxes = this.sandboxes.map((existing, position) =>
        position === index ? record : existing,
      );
    const detail = this.details[record.sandboxId];
    if (detail) detail.record = record;
  }

  private handleEvent(envelope: ManagerStreamEventEnvelope): void {
    if (envelope.stream === "manager") {
      if (envelope.type === "sandbox.activity.changed") {
        const parsed = sandboxActivitySummarySchema.safeParse(envelope.data);
        if (parsed.success)
          this.activityById = {
            ...this.activityById,
            [parsed.data.sandboxId]: parsed.data,
          };
        return;
      }
      // Apply lifecycle changes immediately so the UI tracks boot progress
      // and failures in real time; the debounced fleet refresh reconciles
      // the rest of the record afterwards.
      if (envelope.type === "sandbox.lifecycle.changed")
        this.applyLifecycleChange(envelope.data);
      this.scheduleFleetRefresh();
      return;
    }
    const sandboxId = envelope.sandboxId;
    if (!sandboxId) return;
    const detail = this.details[sandboxId];
    if (!detail) return;
    const uiEvent = {
      stream: envelope.stream,
      seq: envelope.seq,
      id: envelope.id,
      ts: envelope.ts,
      type: envelope.type,
      durability: envelope.durability,
      data: envelope.data,
      sandboxId,
    };
    if (envelope.type.startsWith("conversation.")) {
      this.applyConversationUiEvent(sandboxId, detail, uiEvent);
    }
    applySandboxEvent(detail, uiEvent);
    if (envelope.type === "sandbox.controller.disconnected") {
      if (detail.status) detail.status.connected = false;
    }
    if (
      envelope.type === "sandbox.ready" ||
      envelope.type === "sandbox.controller.reconnected"
    ) {
      void this.flushQueuedPrompt(sandboxId);
      void this.loadDetail(sandboxId);
    }
    if (envelope.type === "sandbox.ready") {
      // Toast only for a live boot, not for replayed history after a reload.
      const eventTime = Date.parse(envelope.ts ?? "");
      if (Number.isFinite(eventTime) && Date.now() - eventTime < 30_000) {
        const record = this.sandboxes.find(
          (item) => item.sandboxId === sandboxId,
        );
        notify.success("Sandbox ready", {
          description: `${record?.name ?? sandboxId} finished starting and can chat now.`,
        });
      }
    }
  }

  private applyConversationUiEvent(
    sandboxId: string,
    detail: SandboxDetailState,
    event: {
      seq: number;
      id?: string;
      ts: string;
      type: string;
      durability?: "durable" | "transient";
      data?: unknown;
    },
  ): void {
    const data = isRecord(event.data) ? event.data : {};
    const conversationId =
      typeof data.conversationId === "string"
        ? data.conversationId
        : (detail.selectedConversationId ?? "default");
    const current = detail.conversationViewsById[conversationId] ?? {
      conversationId,
      entries: [],
      activeEntryIds: [],
      toolCalls: [],
      cursorSeq: 0,
    };
    detail.conversationViewsById[conversationId] = applyConversationEvent(
      current,
      {
        id: event.id ?? `evt_${event.seq}`,
        seq: event.seq,
        ts: event.ts,
        type: event.type,
        durability: event.durability ?? "durable",
        data: event.data as EventEnvelope["data"],
      },
      {
        onGap: (reason) => {
          void this.recoverConversationSnapshot(
            sandboxId,
            reason.conversationId ?? conversationId,
          ).catch(() => undefined);
        },
      },
    );
    const isActiveConversation =
      detail.selectedConversationId === conversationId;
    if (!activeConversationKey(detail)) {
      selectDurableConversation(detail, conversationId);
      openWorkspaceConversationTabInDetail(detail, conversationId);
    }
    if (
      isActiveConversation ||
      detail.selectedConversationId === conversationId
    ) {
      if (typeof data.agentId === "string")
        detail.selectedAgentId = data.agentId;
      if (typeof data.runId === "string") detail.selectedRunId = data.runId;
    }
  }

  private scheduleFleetRefresh(): void {
    if (this.fleetRefreshTimer || this.disposed) return;
    this.fleetRefreshTimer = setTimeout(() => {
      this.fleetRefreshTimer = undefined;
      if (this.disposed) return;
      void this.refreshFleet();
      if (this.selectedSandboxId) void this.loadDetail(this.selectedSandboxId);
    }, 400);
  }
}

const STORE_KEY = Symbol.for("nerve.sandboxManager.store");

export function setSandboxManagerStore(
  store: SandboxManagerStore,
): SandboxManagerStore {
  return setContext(STORE_KEY, store);
}

export function useSandboxManagerStore(): SandboxManagerStore {
  const store = getContext<SandboxManagerStore | undefined>(STORE_KEY);
  if (!store)
    throw new Error(
      "SandboxManagerStore is not available. Mount SandboxManagerProvider first.",
    );
  return store;
}
