import type {
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  Provider,
} from "@earendil-works/pi-ai";
import {
  createId,
  type OAuthFlowInfo,
  type RespondOAuthFlowRequest,
} from "@nervekit/contracts";
import { HttpError } from "../../http/errors.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { AuthManager } from "./auth-manager.js";

type PendingResponse = {
  promptId: string;
  resolve: (response: RespondOAuthFlowRequest) => void;
  reject: (error: Error) => void;
  cleanup?: () => void;
};

type OAuthProvider = Provider & {
  auth: Provider["auth"] & { oauth: NonNullable<Provider["auth"]["oauth"]> };
};

type FlowRecord = {
  info: OAuthFlowInfo;
  provider: OAuthProvider;
  abortController: AbortController;
  pending?: PendingResponse;
};

const CALLBACK_PROVIDER_IDS = new Set(["anthropic", "openai-codex", "radius"]);

function now(): string {
  return new Date().toISOString();
}

const OAUTH_MANUAL_FALLBACK_HINT =
  "If the browser lands on a proxy/certificate error page or the callback does not complete, copy the final redirect URL from the address bar or paste the authorization code here.";

function oauthManualFallbackInstructions(
  instructions: string | undefined,
): string {
  if (!instructions) return OAUTH_MANUAL_FALLBACK_HINT;
  if (instructions.includes(OAUTH_MANUAL_FALLBACK_HINT)) return instructions;
  return `${instructions}\n\n${OAUTH_MANUAL_FALLBACK_HINT}`;
}

export function formatOAuthLoginFailure(
  providerId: string,
  message: string,
): string {
  const hint = oauthFailureHint(providerId, message);
  return hint ? `${message}\n\n${hint}` : message;
}

function oauthFailureHint(
  providerId: string,
  message: string,
): string | undefined {
  const normalized = message.toLowerCase();
  if (isTlsTrustFailure(normalized)) {
    return [
      "This looks like a TLS certificate trust failure during OAuth token exchange. In corporate proxy environments, make sure the corporate root CA is trusted by Node. Nerve Desktop enables Node system CA trust for owned daemons; if your company provides a PEM bundle, set NODE_EXTRA_CA_CERTS before starting Nerve, then start a fresh login.",
      "The authorization code may already be tied to the ended PKCE flow, so retrying with a new login is safer than pasting a stale code after this failure.",
    ].join(" ");
  }
  if (isNetworkOrProxyFailure(normalized)) {
    return [
      "This looks like a network or proxy failure during OAuth token exchange. Ensure HTTPS_PROXY/HTTP_PROXY and NO_PROXY are available to the Nerve process, then start a fresh login.",
      providerId === "openai-codex"
        ? "If local browser redirects are blocked, choose device-code login when restarting the OpenAI Codex login."
        : "If the browser callback itself is blocked, paste the final redirect URL while the login prompt is still active.",
    ].join(" ");
  }
  return undefined;
}

function isTlsTrustFailure(normalizedMessage: string): boolean {
  return /self[_ -]signed|self signed certificate|unable_to_verify|unable to verify|cert[_ -]in[_ -]chain|certificate chain|depth_zero_self_signed_cert|unable_to_get_issuer_cert/i.test(
    normalizedMessage,
  );
}

function isNetworkOrProxyFailure(normalizedMessage: string): boolean {
  return /fetch failed|etimedout|econnreset|econnrefused|enotfound|eai_again|proxy|tunnel|connect timeout|socket hang up/i.test(
    normalizedMessage,
  );
}

function terminal(status: OAuthFlowInfo["status"]): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled"
  );
}

function isOAuthProvider(
  provider: Provider | undefined,
): provider is OAuthProvider {
  return Boolean(provider?.auth.oauth);
}

export class OAuthFlowManager {
  private readonly flows = new Map<string, FlowRecord>();
  private readonly activeByProvider = new Map<string, string>();
  private activeCallbackFlowId: string | undefined;

  constructor(
    private readonly auth: AuthManager,
    private readonly events: StreamLogRegistry,
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

    const provider = this.auth.getProvider(providerId);
    if (!isOAuthProvider(provider)) {
      throw new HttpError(
        404,
        "OAUTH_PROVIDER_NOT_FOUND",
        "OAuth provider not found.",
      );
    }
    if (CALLBACK_PROVIDER_IDS.has(providerId) && this.activeCallbackFlowId) {
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
    if (CALLBACK_PROVIDER_IDS.has(providerId)) {
      this.activeCallbackFlowId = flow.info.flowId;
    }

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
    pending.cleanup?.();
    pending.resolve(response);
    return flow.info;
  }

  async cancel(flowId: string): Promise<OAuthFlowInfo> {
    const flow = this.flows.get(flowId);
    if (!flow)
      throw new HttpError(404, "OAUTH_FLOW_NOT_FOUND", "OAuth flow not found.");
    if (terminal(flow.info.status)) return flow.info;
    flow.abortController.abort();
    flow.pending?.cleanup?.();
    flow.pending?.reject(new Error("Login cancelled"));
    flow.pending = undefined;
    await this.update(flow, {
      status: "cancelled",
      message: "Login cancelled.",
      promptId: undefined,
      options: undefined,
      links: undefined,
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
    const interaction: AuthInteraction = {
      signal: flow.abortController.signal,
      prompt: (prompt) => this.handlePrompt(flow, prompt),
      notify: (event) => {
        void this.handleEvent(flow, event);
      },
    };

    await this.auth.loginOAuth(flow.provider.id, interaction);
    if (flow.abortController.signal.aborted) throw new Error("Login cancelled");
    await this.update(flow, {
      status: "succeeded",
      message: `Logged in to ${flow.provider.name}.`,
      promptId: undefined,
      options: undefined,
      links: undefined,
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
    await this.events.publish("providers.catalog_changed", {
      provider: flow.provider.id,
    });
    this.release(flow);
  }

  private async handlePrompt(
    flow: FlowRecord,
    prompt: AuthPrompt,
  ): Promise<string> {
    if (prompt.type === "select") {
      const response = await this.waitForResponse(
        flow,
        {
          status: "select",
          message: prompt.message,
          options: prompt.options.map((option) => ({ ...option })),
          promptId: createId("authflow"),
          links: undefined,
          authUrl: undefined,
          instructions: undefined,
          deviceCode: undefined,
          placeholder: undefined,
          allowEmpty: undefined,
        },
        prompt.signal,
      );
      return response.selectedId ?? response.value ?? "";
    }

    const manual = prompt.type === "manual_code";
    const response = await this.waitForResponse(
      flow,
      {
        status: "prompt",
        message: prompt.message,
        placeholder: prompt.placeholder,
        allowEmpty: false,
        promptId: createId("authflow"),
        options: undefined,
        links: undefined,
        authUrl: manual ? flow.info.authUrl : undefined,
        instructions: manual
          ? oauthManualFallbackInstructions(flow.info.instructions)
          : undefined,
        deviceCode: undefined,
      },
      prompt.signal,
    );
    return response.value ?? response.selectedId ?? "";
  }

  private async handleEvent(flow: FlowRecord, event: AuthEvent): Promise<void> {
    if (event.type === "auth_url") {
      await this.update(flow, {
        status: "auth_url",
        message:
          "Open the login URL, then complete authentication in your browser.",
        authUrl: event.url,
        instructions: oauthManualFallbackInstructions(event.instructions),
        links: undefined,
        promptId: undefined,
        options: undefined,
        deviceCode: undefined,
        placeholder: undefined,
      });
      return;
    }
    if (event.type === "device_code") {
      await this.update(flow, {
        status: "device_code",
        message: "Complete login using the device code.",
        deviceCode: {
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          intervalSeconds: event.intervalSeconds,
          expiresInSeconds: event.expiresInSeconds,
        },
        links: undefined,
        promptId: undefined,
        options: undefined,
        authUrl: undefined,
        instructions: undefined,
      });
      return;
    }
    if (event.type === "info") {
      await this.update(flow, {
        status: "progress",
        message: event.message,
        links: event.links?.map((link) => ({ ...link })),
      });
      return;
    }
    await this.update(flow, {
      status: "progress",
      message: event.message,
    });
  }

  private async waitForResponse(
    flow: FlowRecord,
    patch: Partial<OAuthFlowInfo> & { promptId: string },
    signal?: AbortSignal,
  ): Promise<RespondOAuthFlowRequest> {
    await this.update(flow, patch);
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (flow.pending?.promptId !== patch.promptId) return;
        flow.pending = undefined;
        reject(new Error("Login prompt cancelled"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      flow.pending = {
        promptId: patch.promptId,
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener("abort", onAbort),
      };
      if (flow.abortController.signal.aborted || signal?.aborted) onAbort();
    });
  }

  private async fail(flow: FlowRecord, message: string): Promise<void> {
    if (flow.info.status === "cancelled") return;
    await this.update(flow, {
      status: "failed",
      error: message,
      message: `Login failed: ${formatOAuthLoginFailure(flow.provider.id, message)}`,
      promptId: undefined,
      options: undefined,
      links: undefined,
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
    flow.info = { ...flow.info, ...patch, updatedAt: now() };
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
    flow.pending?.cleanup?.();
    flow.pending = undefined;
  }
}
