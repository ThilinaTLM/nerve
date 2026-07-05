import type {
  ManagedSandboxRecord,
  ModelInfo,
  RemoveOptions,
  SandboxCreateRequest,
  SandboxManagerCredentialProfile,
  SandboxManagerEventEnvelope,
  SandboxManagerSecretMetadata,
  SandboxManagerStatus,
} from "@nervekit/shared";
import { getContext, setContext } from "svelte";
import { createOperationId } from "../api/idempotency";
import * as api from "../api/manager-client";
import {
  ManagerWsClient,
  type ManagerWsConnectionState,
} from "../api/manager-ws-client.svelte";
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

export class SandboxManagerStore {
  connection = $state<ManagerWsConnectionState>("idle");
  connectionError = $state<string | undefined>(undefined);
  managerStatus = $state<SandboxManagerStatus | undefined>(undefined);
  models = $state<ModelInfo[]>([]);
  credentialProfiles = $state<SandboxManagerCredentialProfile[]>([]);
  secretMetadata = $state<SandboxManagerSecretMetadata[]>([]);
  sandboxes = $state<ManagedSandboxRecord[]>([]);
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
      this.sandboxes = await api.listSandboxes();
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
    this.selectedSandboxId = sandboxId;
    if (!sandboxId) return;
    this.detail(sandboxId);
    this.ws.subscribeStream(sandboxId);
    await this.loadDetail(sandboxId);
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
      if (status) detail.status = status;
      try {
        const snapshot = await api.getSandboxSnapshot(sandboxId);
        applySnapshot(detail, snapshot);
      } catch {
        // Snapshot may be unavailable when no controller session is connected.
      }
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
  }

  // --- chat / command actions ---

  async sendPrompt(sandboxId: string, prompt: string): Promise<void> {
    const detail = this.detail(sandboxId);
    if (!prompt.trim()) return;
    detail.sending = true;
    try {
      const behavior = detail.selectedRunId ? "follow_up" : "start";
      await this.sendCommand(sandboxId, "sandbox.run.start", (key) => ({
        commandId: key,
        conversationId: detail.selectedConversationId,
        agentId: detail.selectedAgentId,
        prompt,
        behavior,
      }));
      detail.composerText = "";
    } finally {
      detail.sending = false;
    }
  }

  async cancelRun(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    if (!detail.selectedRunId) return;
    await this.sendCommand(sandboxId, "sandbox.run.cancel", (key) => ({
      commandId: key,
      conversationId: detail.selectedConversationId,
      agentId: detail.selectedAgentId,
      runId: detail.selectedRunId,
    }));
  }

  async continueRun(sandboxId: string): Promise<void> {
    const detail = this.detail(sandboxId);
    if (!detail.selectedRunId) return;
    await this.sendCommand(sandboxId, "sandbox.run.continue", (key) => ({
      commandId: key,
      conversationId: detail.selectedConversationId,
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
      conversationId: detail.selectedConversationId,
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
      conversationId: detail.selectedConversationId,
      agentId: detail.selectedAgentId,
      runId: detail.selectedRunId,
      approvalId: waitId,
      decision,
    }));
    const wait = detail.waitsById[waitId];
    if (wait) wait.status = decision === "grant" ? "granted" : "denied";
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
    setTimeout(() => {
      delete this.pendingOperations[key];
    }, delay);
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
      this.scheduleFleetRefresh();
      return;
    }
    const sandboxId = envelope.sandboxId;
    if (!sandboxId) return;
    const detail = this.details[sandboxId];
    if (!detail) return;
    applySandboxEvent(detail, {
      stream: envelope.stream,
      seq: envelope.seq,
      id: envelope.id,
      ts: envelope.ts,
      type: envelope.type,
      durability: envelope.durability,
      data: envelope.data,
      sandboxId,
    });
  }

  private scheduleFleetRefresh(): void {
    if (this.fleetRefreshTimer || this.disposed) return;
    this.fleetRefreshTimer = setTimeout(() => {
      this.fleetRefreshTimer = undefined;
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
