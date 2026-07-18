import { randomUUID } from "node:crypto";
import {
  type AuthEvent,
  type AuthInteraction,
  type AuthPrompt,
  InMemoryCredentialStore,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import {
  createId,
  type OAuthFlowInfo,
  type RespondOAuthFlowRequest,
  type SandboxManagerCredentialProfile,
  type SandboxManagerCredentialProviderKind,
} from "@nervekit/contracts";
import type { CredentialProfileService } from "./credential-profile-service.js";
import { registerSandboxManagerProvider } from "./model-catalog.js";

type PendingResponse = {
  promptId: string;
  resolve: (value: string | undefined) => void;
  reject: (error: Error) => void;
  cleanup?: () => void;
};

type OAuthProvider = Provider & {
  auth: Provider["auth"] & { oauth: NonNullable<Provider["auth"]["oauth"]> };
};

type FlowRecord = {
  info: OAuthFlowInfo;
  provider: OAuthProvider;
  models: MutableModels;
  abortController: AbortController;
  pending?: PendingResponse;
  profileId?: string;
};

const providerKindByOAuthProvider: Partial<
  Record<string, SandboxManagerCredentialProviderKind>
> = {
  anthropic: "anthropic_oauth",
  "github-copilot": "github_copilot_oauth",
  "openai-codex": "openai_codex_oauth",
  radius: "radius_oauth",
  xai: "xai_oauth",
};

function isOAuthProvider(
  provider: Provider | undefined,
): provider is OAuthProvider {
  return Boolean(provider?.auth.oauth);
}

function stringHeaders(
  headers: Record<string, string | null> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string] => entry[1] !== null,
    ),
  );
}

export class SandboxManagerOAuthFlowManager {
  private readonly flows = new Map<string, FlowRecord>();

  constructor(private readonly profiles: CredentialProfileService) {}

  start(input: {
    provider: string;
    profileId?: string;
    displayName?: string;
    defaultModel?: string;
  }): OAuthFlowInfo {
    const credentials = new InMemoryCredentialStore();
    const models = builtinModels({ credentials });
    const provider = models.getProvider(input.provider);
    const providerKind = providerKindByOAuthProvider[input.provider];
    if (!isOAuthProvider(provider) || !providerKind)
      throw new Error("OAuth provider is not supported by sandbox-manager");
    const now = new Date().toISOString();
    const flow: FlowRecord = {
      provider,
      models,
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
    void this.run(flow, {
      displayName: input.displayName,
      defaultModel: input.defaultModel,
    }).catch((error) =>
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
    pending.cleanup?.();
    pending.resolve(response.selectedId ?? response.value);
    return flow.info;
  }

  async cancel(flowId: string): Promise<OAuthFlowInfo> {
    const flow = this.flows.get(flowId);
    if (!flow) throw new Error("OAuth flow not found");
    flow.abortController.abort();
    flow.pending?.cleanup?.();
    flow.pending?.reject(new Error("Login cancelled"));
    flow.pending = undefined;
    this.update(flow, {
      status: "cancelled",
      message: "Login cancelled.",
      promptId: undefined,
      authUrl: undefined,
      deviceCode: undefined,
      options: undefined,
      links: undefined,
    });
    return flow.info;
  }

  private async run(
    flow: FlowRecord,
    input: { displayName?: string; defaultModel?: string },
  ): Promise<void> {
    const interaction: AuthInteraction = {
      signal: flow.abortController.signal,
      prompt: (prompt) => this.waitForPrompt(flow, prompt),
      notify: (event) => this.handleEvent(flow, event),
    };
    const credential = await flow.models.login(
      flow.provider.id,
      "oauth",
      interaction,
    );
    if (credential.type !== "oauth")
      throw new Error("Subscription login returned a non-OAuth credential");
    await flow.models.refresh({
      force: true,
      signal: flow.abortController.signal,
    });
    registerSandboxManagerProvider(flow.provider);
    const resolution = await flow.models.getAuth(flow.provider.id);
    const expiresAt = new Date(credential.expires).toISOString();
    const profile = await this.profiles.create({
      profileId: flow.profileId,
      kind: "model_provider",
      providerKind: providerKindByOAuthProvider[
        flow.provider.id
      ] as SandboxManagerCredentialProfile["providerKind"],
      displayName: input.displayName ?? flow.provider.name,
      provider: flow.provider.id,
      defaultModel: input.defaultModel,
      baseUrl: resolution?.auth.baseUrl,
      headers: stringHeaders(resolution?.auth.headers),
      env: resolution?.env,
      oauthImport: {
        rawBundle: credential,
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
      links: undefined,
    });
    flow.info = {
      ...flow.info,
      message: `Connected profile ${profile.displayName}.`,
    };
  }

  private waitForPrompt(flow: FlowRecord, prompt: AuthPrompt): Promise<string> {
    return new Promise((resolve, reject) => {
      const promptId = `oauthprompt_${randomUUID()}`;
      const onAbort = () => {
        if (flow.pending?.promptId !== promptId) return;
        flow.pending = undefined;
        reject(new Error("Login prompt cancelled"));
      };
      prompt.signal?.addEventListener("abort", onAbort, { once: true });
      flow.pending = {
        promptId,
        resolve: (value) => resolve(value ?? ""),
        reject,
        cleanup: () => prompt.signal?.removeEventListener("abort", onAbort),
      };
      if (prompt.type === "select") {
        this.update(flow, {
          status: "select",
          promptId,
          message: prompt.message,
          options: prompt.options.map((option) => ({ ...option })),
          links: undefined,
        });
      } else {
        const manual = prompt.type === "manual_code";
        this.update(flow, {
          status: "prompt",
          promptId,
          message: prompt.message,
          placeholder: prompt.placeholder,
          allowEmpty: false,
          options: undefined,
          links: undefined,
          authUrl: manual ? flow.info.authUrl : undefined,
          instructions: manual ? flow.info.instructions : undefined,
        });
      }
      if (flow.abortController.signal.aborted || prompt.signal?.aborted)
        onAbort();
    });
  }

  private handleEvent(flow: FlowRecord, event: AuthEvent): void {
    if (event.type === "auth_url") {
      this.update(flow, {
        status: "auth_url",
        message: "Open the authorization URL to continue.",
        authUrl: event.url,
        instructions: event.instructions,
        links: undefined,
      });
      return;
    }
    if (event.type === "device_code") {
      this.update(flow, {
        status: "device_code",
        message: "Complete login using the device code.",
        deviceCode: {
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          intervalSeconds: event.intervalSeconds,
          expiresInSeconds: event.expiresInSeconds,
        },
        links: undefined,
      });
      return;
    }
    if (event.type === "info") {
      this.update(flow, {
        status: "progress",
        message: event.message,
        links: event.links?.map((link) => ({ ...link })),
      });
      return;
    }
    this.update(flow, { status: "progress", message: event.message });
  }

  private update(flow: FlowRecord, patch: Partial<OAuthFlowInfo>): void {
    flow.info = {
      ...flow.info,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
  }
}
