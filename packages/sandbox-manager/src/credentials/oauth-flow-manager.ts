import { randomUUID } from "node:crypto";
import type {
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
  type SandboxManagerCredentialProfile,
} from "@nervekit/shared";
import type { CredentialProfileService } from "./credential-profile-service.js";

type PendingResponse = {
  promptId: string;
  resolve: (value: string | undefined) => void;
  reject: (error: Error) => void;
};

type FlowRecord = {
  info: OAuthFlowInfo;
  provider: OAuthProviderInterface;
  profileId?: string;
  abortController: AbortController;
  pending?: PendingResponse;
};

const providerKindByOAuthProvider: Record<string, string> = {
  anthropic: "anthropic_oauth",
  "openai-codex": "openai_codex_oauth",
};

export class SandboxManagerOAuthFlowManager {
  private readonly flows = new Map<string, FlowRecord>();

  constructor(private readonly profiles: CredentialProfileService) {}

  start(input: {
    provider: string;
    profileId?: string;
    displayName?: string;
  }): OAuthFlowInfo {
    const provider = getOAuthProvider(input.provider);
    if (!provider) throw new Error("OAuth provider not found");
    if (!providerKindByOAuthProvider[provider.id])
      throw new Error("OAuth provider is not supported by sandbox-manager");
    const now = new Date().toISOString();
    const flow: FlowRecord = {
      provider,
      profileId: input.profileId,
      abortController: new AbortController(),
      info: {
        flowId: createId("authflow") as `authflow_${string}`,
        provider: provider.id,
        providerName: provider.name,
        status: "starting",
        message: "Starting login...",
        createdAt: now,
        updatedAt: now,
      },
    };
    this.flows.set(flow.info.flowId, flow);
    void this.run(flow, input.displayName).catch((error) =>
      this.update(flow, {
        status: "failed",
        message: "OAuth login failed.",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return flow.info;
  }

  get(flowId: string): OAuthFlowInfo {
    const flow = this.flows.get(flowId);
    if (!flow) throw new Error("OAuth flow not found");
    return flow.info;
  }

  async respond(
    flowId: string,
    response: RespondOAuthFlowRequest,
  ): Promise<OAuthFlowInfo> {
    const flow = this.flows.get(flowId);
    if (!flow) throw new Error("OAuth flow not found");
    const pending = flow.pending;
    if (!pending || pending.promptId !== response.promptId)
      throw new Error("OAuth flow is not waiting for that prompt");
    flow.pending = undefined;
    pending.resolve(response.selectedId ?? response.value);
    return flow.info;
  }

  async cancel(flowId: string): Promise<OAuthFlowInfo> {
    const flow = this.flows.get(flowId);
    if (!flow) throw new Error("OAuth flow not found");
    flow.abortController.abort();
    flow.pending?.reject(new Error("Login cancelled"));
    flow.pending = undefined;
    this.update(flow, {
      status: "cancelled",
      message: "Login cancelled.",
      promptId: undefined,
      authUrl: undefined,
      deviceCode: undefined,
      options: undefined,
    });
    return flow.info;
  }

  private async run(flow: FlowRecord, displayName?: string): Promise<void> {
    const callbacks: OAuthLoginCallbacks = {
      onAuth: (info) => {
        this.update(flow, {
          status: "auth_url",
          message: "Open the authorization URL to continue.",
          authUrl: info.url,
          instructions: info.instructions,
        });
      },
      onDeviceCode: (info) => {
        this.update(flow, {
          status: "device_code",
          message: "Complete login using the device code.",
          deviceCode: normalizeDeviceCode(info),
        });
      },
      onPrompt: (prompt) => this.waitForPrompt(flow, prompt),
      onManualCodeInput: () =>
        this.waitForPrompt(flow, {
          message: "Paste the final redirect URL or authorization code.",
        }),
      onSelect: (prompt) => this.waitForSelect(flow, prompt),
      onProgress: (message) =>
        this.update(flow, { status: "progress", message }),
      signal: flow.abortController.signal,
    };
    const credentials = await flow.provider.login(callbacks);
    const expiresAt = new Date(credentials.expires).toISOString();
    const profile = await this.profiles.create({
      profileId: flow.profileId,
      kind: "model_provider",
      providerKind: providerKindByOAuthProvider[
        flow.provider.id
      ] as SandboxManagerCredentialProfile["providerKind"],
      displayName: displayName ?? flow.provider.name,
      provider: flow.provider.id,
      oauthImport: {
        rawBundle: credentials,
        expiresAt,
      },
    });
    this.update(flow, {
      status: "succeeded",
      message: `Connected ${flow.provider.name}.`,
      promptId: undefined,
      authUrl: undefined,
      deviceCode: undefined,
      options: undefined,
    });
    flow.info = {
      ...flow.info,
      message: `Connected profile ${profile.displayName}.`,
    };
  }

  private waitForPrompt(
    flow: FlowRecord,
    prompt: OAuthPrompt,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const promptId = `oauthprompt_${randomUUID()}`;
      flow.pending = {
        promptId,
        resolve: (value) => {
          if (value === undefined)
            reject(new Error("Prompt response is required"));
          else resolve(value);
        },
        reject,
      };
      this.update(flow, {
        status: "prompt",
        promptId,
        message: prompt.message,
        placeholder: prompt.placeholder,
        allowEmpty: prompt.allowEmpty,
      });
    });
  }

  private waitForSelect(
    flow: FlowRecord,
    prompt: OAuthSelectPrompt,
  ): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const promptId = `oauthprompt_${randomUUID()}`;
      flow.pending = { promptId, resolve, reject };
      this.update(flow, {
        status: "select",
        promptId,
        message: prompt.message,
        options: prompt.options,
      });
    });
  }

  private update(flow: FlowRecord, patch: Partial<OAuthFlowInfo>): void {
    flow.info = {
      ...flow.info,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
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
