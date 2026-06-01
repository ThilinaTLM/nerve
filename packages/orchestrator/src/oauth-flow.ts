import type {
  OAuthAuthInfo,
  OAuthDeviceCodeInfo,
  OAuthLoginCallbacks,
  OAuthPrompt,
  OAuthProviderInterface,
  OAuthSelectPrompt,
} from "@earendil-works/pi-ai/oauth";
import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";
import {
  createId,
  type OAuthFlowInfo,
  type RespondOAuthFlowRequest,
} from "@nerve/shared";
import type { AuthManager } from "./auth.js";
import type { EventBus } from "./events.js";
import { HttpError } from "./registry.js";

type PendingResponse = {
  promptId: string;
  resolve: (response: RespondOAuthFlowRequest) => void;
  reject: (error: Error) => void;
};

type FlowRecord = {
  info: OAuthFlowInfo;
  provider: OAuthProviderInterface;
  abortController: AbortController;
  pending?: PendingResponse;
};

function now(): string {
  return new Date().toISOString();
}

function terminal(status: OAuthFlowInfo["status"]): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled"
  );
}

export class OAuthFlowManager {
  private readonly flows = new Map<string, FlowRecord>();
  private readonly activeByProvider = new Map<string, string>();
  private activeCallbackFlowId: string | undefined;

  constructor(
    private readonly auth: AuthManager,
    private readonly events: EventBus,
  ) {}

  get(flowId: string): OAuthFlowInfo {
    const flow = this.flows.get(flowId);
    if (!flow)
      throw new HttpError(404, "OAUTH_FLOW_NOT_FOUND", "OAuth flow not found.");
    return flow.info;
  }

  start(providerId: string): OAuthFlowInfo {
    const existing = this.activeByProvider.get(providerId);
    if (existing) {
      const flow = this.flows.get(existing);
      if (flow && !terminal(flow.info.status)) {
        throw new HttpError(
          409,
          "OAUTH_FLOW_ACTIVE",
          `OAuth login for ${providerId} is already active.`,
        );
      }
    }

    const provider = getOAuthProvider(providerId);
    if (!provider) {
      throw new HttpError(
        404,
        "OAUTH_PROVIDER_NOT_FOUND",
        "OAuth provider not found.",
      );
    }
    if (providerId !== "openai-codex" && providerId !== "anthropic") {
      throw new HttpError(
        400,
        "OAUTH_PROVIDER_UNSUPPORTED",
        "This OAuth provider is not enabled in Nerve yet.",
      );
    }
    if (provider.usesCallbackServer && this.activeCallbackFlowId) {
      throw new HttpError(
        409,
        "OAUTH_CALLBACK_FLOW_ACTIVE",
        "Another callback-server OAuth login is already active.",
      );
    }

    const timestamp = now();
    const flow: FlowRecord = {
      provider,
      abortController: new AbortController(),
      info: {
        flowId: createId("authflow") as `authflow_${string}`,
        provider: provider.id,
        providerName: provider.name,
        status: "starting",
        message: "Starting login...",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    };

    this.flows.set(flow.info.flowId, flow);
    this.activeByProvider.set(provider.id, flow.info.flowId);
    if (provider.usesCallbackServer)
      this.activeCallbackFlowId = flow.info.flowId;

    void this.run(flow).catch((error) => {
      void this.fail(
        flow,
        error instanceof Error ? error.message : String(error),
      );
    });
    void this.publish(flow);
    return flow.info;
  }

  async respond(
    flowId: string,
    response: RespondOAuthFlowRequest,
  ): Promise<OAuthFlowInfo> {
    const flow = this.flows.get(flowId);
    if (!flow)
      throw new HttpError(404, "OAUTH_FLOW_NOT_FOUND", "OAuth flow not found.");
    if (terminal(flow.info.status)) return flow.info;
    const pending = flow.pending;
    if (!pending || pending.promptId !== response.promptId) {
      throw new HttpError(
        409,
        "OAUTH_PROMPT_MISMATCH",
        "OAuth flow is not waiting for that response.",
      );
    }
    flow.pending = undefined;
    pending.resolve(response);
    return flow.info;
  }

  async cancel(flowId: string): Promise<OAuthFlowInfo> {
    const flow = this.flows.get(flowId);
    if (!flow)
      throw new HttpError(404, "OAUTH_FLOW_NOT_FOUND", "OAuth flow not found.");
    if (terminal(flow.info.status)) return flow.info;
    flow.abortController.abort();
    flow.pending?.reject(new Error("Login cancelled"));
    flow.pending = undefined;
    await this.update(flow, {
      status: "cancelled",
      message: "Login cancelled.",
      promptId: undefined,
      options: undefined,
      authUrl: undefined,
      instructions: undefined,
      deviceCode: undefined,
      placeholder: undefined,
      allowEmpty: undefined,
    });
    this.release(flow);
    return flow.info;
  }

  private async run(flow: FlowRecord): Promise<void> {
    const callbacks: OAuthLoginCallbacks = {
      onAuth: (info) => {
        void this.handleAuth(flow, info);
      },
      onDeviceCode: (info) => {
        void this.update(flow, {
          status: "device_code",
          message: "Complete login using the device code.",
          deviceCode: normalizeDeviceCode(info),
          promptId: undefined,
          options: undefined,
          authUrl: undefined,
          instructions: undefined,
        });
      },
      onPrompt: (prompt) => this.handlePrompt(flow, prompt),
      onProgress: (message) => {
        void this.update(flow, { status: "progress", message });
      },
      onManualCodeInput: () => this.waitForManualCode(flow),
      onSelect: (prompt) => this.handleSelect(flow, prompt),
      signal: flow.abortController.signal,
    };

    const credentials = await flow.provider.login(callbacks);
    if (flow.abortController.signal.aborted) throw new Error("Login cancelled");
    await this.auth.setOAuth(flow.provider.id, credentials);
    await this.update(flow, {
      status: "succeeded",
      message: `Logged in to ${flow.provider.name}.`,
      promptId: undefined,
      options: undefined,
      authUrl: undefined,
      instructions: undefined,
      deviceCode: undefined,
      placeholder: undefined,
      allowEmpty: undefined,
    });
    await this.events.publish("auth.oauth_login_succeeded", {
      provider: flow.provider.id,
      flow: flow.info,
    });
    await this.events.publish("auth.providers_changed", {
      provider: flow.provider.id,
    });
    this.release(flow);
  }

  private async handleSelect(
    flow: FlowRecord,
    prompt: OAuthSelectPrompt,
  ): Promise<string | undefined> {
    const response = await this.waitForResponse(flow, {
      status: "select",
      message: prompt.message,
      options: prompt.options,
      promptId: createId("authflow"),
      authUrl: undefined,
      instructions: undefined,
      deviceCode: undefined,
      placeholder: undefined,
    });
    return response.selectedId;
  }

  private async handlePrompt(
    flow: FlowRecord,
    prompt: OAuthPrompt,
  ): Promise<string> {
    const response = await this.waitForResponse(flow, {
      status: "prompt",
      message: prompt.message,
      placeholder: prompt.placeholder,
      allowEmpty: prompt.allowEmpty,
      promptId: createId("authflow"),
      options: undefined,
      authUrl: undefined,
      instructions: undefined,
      deviceCode: undefined,
    });
    return response.value ?? "";
  }

  private async handleAuth(
    flow: FlowRecord,
    info: OAuthAuthInfo,
  ): Promise<void> {
    await this.update(flow, {
      status: "auth_url",
      message:
        "Open the login URL, then complete authentication in your browser.",
      authUrl: info.url,
      instructions: info.instructions,
      promptId: createId("authflow"),
      options: undefined,
      deviceCode: undefined,
      placeholder: "Paste redirect URL or authorization code",
    });
  }

  private async waitForManualCode(flow: FlowRecord): Promise<string> {
    const promptId = flow.info.promptId ?? createId("authflow");
    if (flow.info.promptId !== promptId) {
      await this.update(flow, { promptId });
    }
    const response = await this.waitForPending(flow, promptId);
    return response.value ?? "";
  }

  private async waitForResponse(
    flow: FlowRecord,
    patch: Partial<OAuthFlowInfo> & { promptId: string },
  ): Promise<RespondOAuthFlowRequest> {
    await this.update(flow, patch);
    return this.waitForPending(flow, patch.promptId);
  }

  private waitForPending(
    flow: FlowRecord,
    promptId: string,
  ): Promise<RespondOAuthFlowRequest> {
    return new Promise((resolve, reject) => {
      flow.pending = { promptId, resolve, reject };
      if (flow.abortController.signal.aborted) {
        flow.pending = undefined;
        reject(new Error("Login cancelled"));
      }
    });
  }

  private async fail(flow: FlowRecord, message: string): Promise<void> {
    if (flow.info.status === "cancelled") return;
    await this.update(flow, {
      status: "failed",
      error: message,
      message: `Login failed: ${message}`,
      promptId: undefined,
      options: undefined,
      authUrl: undefined,
      instructions: undefined,
      deviceCode: undefined,
      placeholder: undefined,
      allowEmpty: undefined,
    });
    await this.events.publish("auth.oauth_login_failed", {
      provider: flow.provider.id,
      flow: flow.info,
    });
    this.release(flow);
  }

  private async update(
    flow: FlowRecord,
    patch: Partial<OAuthFlowInfo>,
  ): Promise<void> {
    flow.info = {
      ...flow.info,
      ...patch,
      updatedAt: now(),
    };
    await this.publish(flow);
  }

  private async publish(flow: FlowRecord): Promise<void> {
    await this.events.publish("auth.oauth_flow_updated", { flow: flow.info });
  }

  private release(flow: FlowRecord): void {
    if (this.activeByProvider.get(flow.provider.id) === flow.info.flowId) {
      this.activeByProvider.delete(flow.provider.id);
    }
    if (this.activeCallbackFlowId === flow.info.flowId) {
      this.activeCallbackFlowId = undefined;
    }
    flow.pending = undefined;
  }
}

function normalizeDeviceCode(
  info: OAuthDeviceCodeInfo,
): OAuthFlowInfo["deviceCode"] {
  return {
    userCode: info.userCode,
    verificationUri: info.verificationUri,
    intervalSeconds: info.intervalSeconds,
    expiresInSeconds: info.expiresInSeconds,
  };
}
