import {
  applyConversationEvent,
  fromSandboxConversationViewSnapshot,
} from "@nervekit/conversation-ui/state";
import type {
  EventEnvelope,
  ManagedSandboxRecord,
  ModelInfo,
  RemoveOptions,
  SandboxActivitySummary,
  SandboxCreateRequest,
  SandboxManagerCredentialProfile,
  SandboxManagerEventEnvelope,
  SandboxManagerSecretMetadata,
  SandboxManagerStatus,
  ThinkingLevel,
} from "@nervekit/shared";
import { sandboxActivitySummarySchema } from "@nervekit/shared";
import { getContext, setContext } from "svelte";
import { createOperationId } from "../api/idempotency";
import * as api from "../api/manager-client";
import { protocolRequest } from "../api/manager-protocol-client";
import {
  ManagerWsClient,
  type ManagerWsConnectionState,
} from "../api/manager-ws-client.svelte";
import {
  isSandboxConnected,
  isSandboxReadyForChat,
  isSandboxTerminal,
} from "./sandbox-boot-progress";
import { applySandboxEvent } from "./sandbox-event-reducers";
import { applySnapshot } from "./sandbox-snapshot-adapter";
import type { SandboxFleetFilter } from "./sandbox-status";
import {
  createSandboxDetailState,
  type PendingSandboxOperation,
  type SandboxDetailState,
} from "./sandbox-ui-types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  private fleetRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly statusPollTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly runSnapshotTimers = new Map<
    string,
    ReturnType<typeof setInterval>
  >();
  private readonly operationCleanupTimers = new Set<
    ReturnType<typeof setTimeout>
  >();
  private disposed = false;

  constructor() {
    this.ws = new ManagerWsClient({
      onEvent: (envelope) => this.handleEvent(envelope),
      onConnectionChange: (state, error) => {
        this.connection = state;
        this.connectionError = error;
      },
      onReconnected: () => {
        void this.refreshFleet();
        if (this.selectedSandboxId)
          void this.loadDetail(this.selectedSandboxId);
      },
      onReplayUnavailable: (streams) => {
        for (const stream of streams) {
          const sandboxId = stream.startsWith("sandbox:")
            ? stream.slice("sandbox:".length)
            : undefined;
          if (sandboxId) void this.recoverConversationSnapshot(sandboxId);
          else void this.refreshFleet();
        }
      },
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
    this.stopStatusPolling();
    this.stopAllRunSnapshotRefresh();
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
      this.sandboxes = items.map(
        ({ activity: _activity, ...record }) => record,
      );
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
    this.stopStatusPolling();
    this.stopAllRunSnapshotRefresh();
    this.selectedSandboxId = sandboxId;
    if (!sandboxId) return;
    this.detail(sandboxId);
    this.ws.subscribeStream(sandboxId);
    await this.loadDetail(sandboxId);
    // The status snapshot is only fetched on load and live boot events can be
    // missed on a fresh subscription, so poll until the controller connects to
    // reliably observe the boot -> ready transition.
    this.ensureStatusPolling(sandboxId);
  }

  private ensureStatusPolling(sandboxId: string): void {
    if (this.disposed || this.selectedSandboxId !== sandboxId) return;
    if (this.statusPollTimers.has(sandboxId)) return;
    const detail = this.details[sandboxId];
    const record = this.sandboxes.find((item) => item.sandboxId === sandboxId);
    const observed = record?.observedState;
    if (
      isSandboxConnected(detail) ||
      isSandboxTerminal(record) ||
      observed === "failed"
    )
      return;
    const timer = setTimeout(() => {
      this.statusPollTimers.delete(sandboxId);
      void this.pollStatusOnce(sandboxId);
    }, 1500);
    this.statusPollTimers.set(sandboxId, timer);
  }

  private async pollStatusOnce(sandboxId: string): Promise<void> {
    if (this.disposed || this.selectedSandboxId !== sandboxId) return;
    const detail = this.details[sandboxId];
    if (!detail) return;
    try {
      const status = await api.getSandboxStatus(sandboxId);
      const wasConnected = isSandboxConnected(detail);
      detail.status = status;
      detail.controllerConnected = status.connected;
      if (status.connected && !wasConnected) {
        // Fully sync record/snapshot/session once the controller is live.
        void this.loadDetail(sandboxId);
        return;
      }
    } catch {
      // Status can be unavailable while the controller is still booting.
    }
    this.ensureStatusPolling(sandboxId);
  }

  private stopStatusPolling(sandboxId?: string): void {
    if (sandboxId) {
      const timer = this.statusPollTimers.get(sandboxId);
      if (timer) clearTimeout(timer);
      this.statusPollTimers.delete(sandboxId);
      return;
    }
    for (const timer of this.statusPollTimers.values()) clearTimeout(timer);
    this.statusPollTimers.clear();
  }

  async loadDetail(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    detail.loading = true;
    try {
      const [record, status] = await Promise.all([
        api.getSandboxRecord(sandboxId),
        api.getSandboxStatus(sandboxId).catch(() => undefined),
      ]);
      detail.record = record;
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
      detail.error = undefined;
    } catch (error) {
      detail.error = errorMessage(error);
    } finally {
      detail.loading = false;
    }
  }

  async recoverConversationSnapshot(
    sandboxId: string,
    conversationId?: string,
  ): Promise<void> {
    const detail = this.detail(sandboxId);
    const { result } = await protocolRequest<
      import("@nervekit/shared").SandboxConversationViewSnapshot
    >("sandbox.conversation.snapshot.get", {
      sandboxId,
      conversationId: outboundConversationId(
        conversationId ?? detail.selectedConversationId,
      ),
      agentId: detail.selectedAgentId,
      runId: detail.selectedRunId,
    });
    const renderState = fromSandboxConversationViewSnapshot(result);
    const key =
      renderState.conversationId ?? result.conversationId ?? "default";
    detail.conversationViewsById[key] = renderState;
    detail.selectedConversationId = key;
    detail.selectedAgentId = result.agentId ?? renderState.activeRun?.agentId;
    detail.selectedRunId = result.runId ?? renderState.activeRun?.runId;
    detail.lastRichSnapshot = {
      generatedAt: result.generatedAt,
      cursorSeq: renderState.cursorSeq,
      stale: result.stale,
      readOnly: result.fallback?.readOnly,
      reason: result.fallback?.reason,
    };
    this.ws.markSnapshotRecovered(`sandbox:${sandboxId}`);
  }

  async loadLogs(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    try {
      const logs = await api.getSandboxLogs(sandboxId, {
        tail: 500,
        maxBytes: 256 * 1024,
      });
      detail.logsText = logs.chunks.map((chunk) => chunk.chunk).join("");
      detail.logsTruncated = logs.truncated;
    } catch (error) {
      detail.error = errorMessage(error);
    }
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
    if (request.start) await this.startSandbox(record.sandboxId);
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
    if (isSandboxReadyForChat(detail)) {
      await this.sendPrompt(sandboxId, trimmed);
      return;
    }
    detail.queuedPrompt = trimmed;
    detail.composerText = "";
  }

  /** Dispatch a queued first prompt once the sandbox is ready for chat. */
  async flushQueuedPrompt(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    const queued = detail.queuedPrompt;
    if (!queued || !isSandboxReadyForChat(detail)) return;
    detail.queuedPrompt = undefined;
    await this.sendPrompt(sandboxId, queued);
  }

  async sendPrompt(sandboxId: string, prompt: string): Promise<void> {
    const detail = this.detail(sandboxId);
    if (!prompt.trim()) return;
    detail.sending = true;
    try {
      const behavior = detail.selectedRunId ? "follow_up" : "start";
      await this.sendCommand(sandboxId, "sandbox.run.start", (key) => ({
        commandId: key,
        conversationId: outboundConversationId(detail.selectedConversationId),
        agentId: detail.selectedAgentId,
        prompt,
        behavior,
      }));
      detail.composerText = "";
      // Start snapshot polling immediately — we know a run is starting, so do not
      // wait for a `run.started` event (which can be dropped by live delivery).
      this.startRunSnapshotRefresh(sandboxId);
    } finally {
      detail.sending = false;
    }
  }

  async cancelRun(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    if (!detail.selectedRunId) return;
    await this.sendCommand(sandboxId, "sandbox.run.cancel", (key) => ({
      commandId: key,
      conversationId: outboundConversationId(detail.selectedConversationId),
      agentId: detail.selectedAgentId,
      runId: detail.selectedRunId,
    }));
  }

  async continueRun(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    if (!detail.selectedRunId) return;
    await this.sendCommand(sandboxId, "sandbox.run.continue", (key) => ({
      commandId: key,
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
    await this.sendCommand(sandboxId, "sandbox.input.submit", (key) => ({
      commandId: key,
      conversationId: outboundConversationId(detail.selectedConversationId),
      agentId: detail.selectedAgentId,
      runId: detail.selectedRunId,
      requestId: waitId,
      text,
    }));
    const wait = detail.waitsById[waitId];
    if (wait) wait.status = "submitted";
  }

  async resolveApproval(
    sandboxId: string,
    waitId: string,
    decision: "grant" | "deny",
  ): Promise<void> {
    const detail = this.detail(sandboxId);
    await this.sendCommand(sandboxId, "sandbox.approval.resolve", (key) => ({
      commandId: key,
      conversationId: outboundConversationId(detail.selectedConversationId),
      agentId: detail.selectedAgentId,
      runId: detail.selectedRunId,
      approvalId: waitId,
      decision,
    }));
    const wait = detail.waitsById[waitId];
    if (wait) wait.status = decision === "grant" ? "granted" : "denied";
  }

  /**
   * Apply runtime agent controls (model/thinking/mode/permission/policy). Model,
   * thinking, and mode changes take effect on the next model request; permission
   * and approval-policy changes apply immediately. `sandbox.run.start` has no
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
    await this.sendCommand(sandboxId, "sandbox.agent.configure", (key) => ({
      commandId: key,
      conversationId: outboundConversationId(detail.selectedConversationId),
      agentId: detail.selectedAgentId,
      ...patch,
    }));
  }

  private async sendCommand(
    sandboxId: string,
    method: string,
    buildParams: (key: string) => Record<string, unknown>,
  ): Promise<void> {
    await this.runOperation("command", sandboxId, method, (key) =>
      api.sendSandboxCommand(sandboxId, method, buildParams(key), key),
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

  private handleEvent(envelope: SandboxManagerEventEnvelope): void {
    if (envelope.stream === "manager") {
      if (envelope.type === "manager.sandbox.activity") {
        const parsed = sandboxActivitySummarySchema.safeParse(envelope.data);
        if (parsed.success)
          this.activityById = {
            ...this.activityById,
            [parsed.data.sandboxId]: parsed.data,
          };
        return;
      }
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
    this.trackRunActivity(sandboxId, envelope.type);
  }

  /**
   * While a run is active, periodically refresh the conversation snapshot so the
   * transcript stays current even if a live event batch is dropped (the daemon
   * snapshot includes in-progress streaming content). Guarantees the user sees
   * the agent's response/processing without needing a manual refresh.
   */
  private trackRunActivity(sandboxId: string, type: string): void {
    // A live run event is a hint to (re)start polling; the poll self-terminates
    // when the snapshot shows no active run. We do not stop on terminal events
    // because those can be dropped too — idle detection handles it.
    if (type === "run.started" || type === "conversation.run.started")
      this.startRunSnapshotRefresh(sandboxId);
  }

  private startRunSnapshotRefresh(sandboxId: string): void {
    if (this.runSnapshotTimers.has(sandboxId)) return;
    if (this.selectedSandboxId !== sandboxId) return;
    let ticks = 0;
    let idle = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (
        this.disposed ||
        this.selectedSandboxId !== sandboxId ||
        ticks > 300
      ) {
        this.stopRunSnapshotRefresh(sandboxId);
        return;
      }
      void this.recoverConversationSnapshot(sandboxId)
        .then(() => {
          const detail = this.details[sandboxId];
          const view = detail?.selectedConversationId
            ? detail.conversationViewsById[detail.selectedConversationId]
            : undefined;
          // `activeRun` is only present while a run is in progress
          // (running/retrying/aborting); it clears once the run finishes.
          const active = Boolean(view?.activeRun);
          idle = active ? 0 : idle + 1;
          // A few idle refreshes after the run finishes guarantee the final
          // committed transcript is rendered before we stop polling.
          if (idle >= 3) this.stopRunSnapshotRefresh(sandboxId);
        })
        .catch(() => undefined);
    }, 1200);
    if (typeof timer.unref === "function") timer.unref();
    this.runSnapshotTimers.set(sandboxId, timer);
  }

  private stopRunSnapshotRefresh(sandboxId: string): void {
    const timer = this.runSnapshotTimers.get(sandboxId);
    if (timer) clearInterval(timer);
    this.runSnapshotTimers.delete(sandboxId);
  }

  private stopAllRunSnapshotRefresh(): void {
    for (const timer of this.runSnapshotTimers.values()) clearInterval(timer);
    this.runSnapshotTimers.clear();
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
    detail.selectedConversationId = conversationId;
    if (typeof data.agentId === "string") detail.selectedAgentId = data.agentId;
    if (typeof data.runId === "string") detail.selectedRunId = data.runId;
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
