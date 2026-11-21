import type {
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  Provider,
} from "@earendil-works/pi-ai";
import { createId } from "@nervekit/contracts";
import type {
  OAuthFlowInfo,
  OAuthInteraction,
  RespondOAuthFlowRequest,
} from "@nervekit/contracts/auth";
import { ApplicationError } from "../../core/application-error.js";
import {
  listenForLoopbackRedirect,
  type LoopbackExpectation,
  type LoopbackListener,
} from "./loopback-listener.js";
import type { AuthManager } from "./auth-manager.js";
import {
  deriveOAuthLoopbackRelayTarget,
  relayOAuthLoopbackRedirect,
  validateOAuthLoopbackRedirect,
  type OAuthLoopbackRelayTarget,
} from "./oauth-loopback-relay.js";

type PendingResponse = {
  interactionId: string;
  type: "select" | "text" | "authorization";
  options?: ReadonlySet<string>;
  allowEmpty?: boolean;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  cleanup?: () => void;
};

type OAuthProvider = Provider & {
  auth: Provider["auth"] & { oauth: NonNullable<Provider["auth"]["oauth"]> };
};

/** What a flow signs in: a model provider, or an extension account. */
type FlowSubject = {
  /** Key of the one flow at a time: the provider id, or `account:<id>`. */
  id: string;
  name: string;
  account?: { kind: string; id: string };
};

type FlowRecord = {
  info: OAuthFlowInfo;
  subject: FlowSubject;
  /** Performs the sign-in with the interaction; resolves when credentials are saved. */
  login: (interaction: SignInInteraction) => Promise<void>;
  /** Called once after the flow succeeded (events, notices). */
  succeeded: (info: OAuthFlowInfo) => Promise<void>;
  listeners: Set<LoopbackListener>;
  timeout?: NodeJS.Timeout;
  abortController: AbortController;
  pending?: PendingResponse;
  relay?: { interactionId: string; target: OAuthLoopbackRelayTarget };
  updateTail: Promise<void>;
  updateError?: Error;
  terminalAt?: number;
};

type AccountSignInTarget = { kind: string; id: string; name: string };

type OAuthAuthPort = Pick<AuthManager, "getProvider" | "loginOAuth">;
type OAuthEventPort = {
  publish<T>(type: string, data: T): Promise<unknown>;
};

/** The interaction an account provider's sign-in gets: the shared prompts and events, plus loopback listeners. */
export type SignInInteraction = AuthInteraction & {
  signal: AbortSignal;
  /** Listens on 127.0.0.1 for the one redirect of an authorization request; the flow closes it. */
  listenLoopback(expected: LoopbackExpectation): Promise<LoopbackListener>;
};

/** Account sign-ins end without an answer after this long. */
const ACCOUNT_SIGN_IN_TIMEOUT_MS = 10 * 60_000;
const TERMINAL_RETENTION_MS = 15 * 60_000;

function now(): string {
  return new Date().toISOString();
}

export function formatOAuthLoginFailure(message: string): string {
  const hint = oauthFailureHint(message);
  return hint ? `${message}\n\n${hint}` : message;
}

function oauthFailureHint(message: string): string | undefined {
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
      "When starting a fresh login, use device-code login or paste the final redirect URL if that option is offered.",
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

function isTerminal(
  info: OAuthFlowInfo,
): info is Exclude<OAuthFlowInfo, { state: "active" }> {
  return info.state !== "active";
}

function isOAuthProvider(
  provider: Provider | undefined,
): provider is OAuthProvider {
  return Boolean(provider?.auth.oauth);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function callbackTargetKey(target: OAuthLoopbackRelayTarget): string {
  const callback = new URL(target.redirectUri);
  return `${callback.origin}${callback.pathname}`;
}

export class SignInService {
  private readonly flows = new Map<string, FlowRecord>();
  private readonly activeByProvider = new Map<string, string>();
  private readonly activeCallbackTargets = new Map<string, string>();

  constructor(
    private readonly auth: OAuthAuthPort,
    private readonly events: OAuthEventPort,
  ) {}

  get(flowId: string): OAuthFlowInfo {
    this.pruneTerminalFlows();
    const flow = this.flows.get(flowId);
    if (!flow) {
      throw new ApplicationError(
        404,
        "OAUTH_FLOW_NOT_FOUND",
        "OAuth flow not found.",
      );
    }
    return flow.info;
  }

  /** Signs in a model provider; its credentials stay in pi-ai's store. */
  async start(providerId: string): Promise<OAuthFlowInfo> {
    this.pruneTerminalFlows();
    this.assertIdle(providerId, `OAuth login for ${providerId}`);
    const provider = this.auth.getProvider(providerId);
    if (!isOAuthProvider(provider)) {
      throw new ApplicationError(
        404,
        "OAUTH_PROVIDER_NOT_FOUND",
        "OAuth provider not found.",
      );
    }
    return this.begin({
      subject: { id: provider.id, name: provider.name },
      login: async (interaction) => {
        await this.auth.loginOAuth(provider.id, interaction);
      },
      succeeded: async (info) => {
        await this.events.publish("auth.oauth_login_succeeded", {
          provider: provider.id,
          flow: info,
        });
        await this.events.publish("auth.providers_changed", {
          provider: provider.id,
        });
        await this.events.publish("providers.catalog_changed", {
          provider: provider.id,
        });
      },
    });
  }

  /**
   * Signs in an extension account. `login` runs the account provider with the interaction (a
   * browser link, a device code, progress, loopback listeners) and stores what it obtains;
   * `succeeded` runs after it did. The flow ends after `timeoutMs`.
   */
  async startAccount(
    account: AccountSignInTarget,
    login: (interaction: SignInInteraction) => Promise<void>,
    succeeded: (info: OAuthFlowInfo) => Promise<void>,
    options: { timeoutMs?: number } = {},
  ): Promise<OAuthFlowInfo> {
    this.pruneTerminalFlows();
    const id = `account:${account.id}`;
    this.assertIdle(id, `Sign-in of "${account.name}"`);
    return this.begin(
      {
        subject: {
          id,
          name: account.name,
          account: { kind: account.kind, id: account.id },
        },
        login,
        succeeded,
      },
      options.timeoutMs ?? ACCOUNT_SIGN_IN_TIMEOUT_MS,
    );
  }

  private assertIdle(subjectId: string, label: string): void {
    const existing = this.activeByProvider.get(subjectId);
    const flow = existing ? this.flows.get(existing) : undefined;
    if (flow && !isTerminal(flow.info))
      throw new ApplicationError(
        409,
        "OAUTH_FLOW_ACTIVE",
        `${label} is already active.`,
      );
  }

  private async begin(
    input: Pick<FlowRecord, "subject" | "login" | "succeeded">,
    timeoutMs?: number,
  ): Promise<OAuthFlowInfo> {
    const timestamp = now();
    const flow: FlowRecord = {
      ...input,
      listeners: new Set(),
      abortController: new AbortController(),
      updateTail: Promise.resolve(),
      info: {
        flowId: createId("authflow"),
        provider: input.subject.id,
        providerName: input.subject.name,
        ...(input.subject.account ? { account: input.subject.account } : {}),
        state: "active",
        interaction: { type: "starting" },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    };

    this.flows.set(flow.info.flowId, flow);
    this.activeByProvider.set(input.subject.id, flow.info.flowId);
    if (timeoutMs !== undefined) {
      flow.timeout = setTimeout(() => {
        void this.fail(flow, "Sign-in timed out.").catch(() => undefined);
        flow.abortController.abort();
      }, timeoutMs);
      flow.timeout.unref();
    }
    await this.publish(flow);
    void this.run(flow)
      .catch((error) => this.fail(flow, asError(error).message))
      .catch(() => undefined);
    return flow.info;
  }

  async respond(
    flowId: string,
    response: RespondOAuthFlowRequest,
  ): Promise<OAuthFlowInfo> {
    this.pruneTerminalFlows();
    const flow = this.flows.get(flowId);
    if (!flow) {
      throw new ApplicationError(
        404,
        "OAUTH_FLOW_NOT_FOUND",
        "OAuth flow not found.",
      );
    }
    if (isTerminal(flow.info)) return flow.info;

    if (response.type === "manual_redirect") {
      const interaction = flow.info.interaction;
      const manual =
        interaction.type === "browser" ? interaction.manualEntry : undefined;
      if (!manual || manual.interactionId !== response.interactionId) {
        throw this.promptMismatch();
      }
      if (manual.acceptedInput === "authorization_input") {
        const pending = flow.pending;
        if (
          !pending ||
          pending.type !== "authorization" ||
          pending.interactionId !== response.interactionId
        ) {
          throw this.promptMismatch();
        }
        flow.pending = undefined;
        pending.cleanup?.();
        pending.resolve(response.value);
        return flow.info;
      }
      if (!flow.relay || flow.relay.interactionId !== response.interactionId) {
        throw this.promptMismatch();
      }
      try {
        validateOAuthLoopbackRedirect(flow.relay.target, response.value);
      } catch (error) {
        throw new ApplicationError(
          400,
          "OAUTH_REDIRECT_INVALID",
          asError(error).message,
        );
      }
      try {
        const result = await relayOAuthLoopbackRedirect(
          flow.relay.target,
          response.value,
          flow.abortController.signal,
        );
        if (result.status >= 400) {
          throw new Error(
            `The local OAuth callback returned ${result.status}.`,
          );
        }
      } catch (error) {
        throw new ApplicationError(
          502,
          "OAUTH_CALLBACK_UNREACHABLE",
          `Could not deliver the redirect to the local OAuth callback: ${asError(error).message}`,
          { retryable: true },
        );
      }
      return flow.info;
    }

    const pending = flow.pending;
    if (!pending || pending.interactionId !== response.interactionId) {
      throw this.promptMismatch();
    }
    if (response.type === "select") {
      if (
        pending.type !== "select" ||
        !pending.options?.has(response.selectedId)
      ) {
        throw new ApplicationError(
          400,
          "OAUTH_OPTION_INVALID",
          "The selected OAuth option is not available.",
        );
      }
      flow.pending = undefined;
      pending.cleanup?.();
      pending.resolve(response.selectedId);
      return flow.info;
    }
    if (pending.type !== "text") throw this.promptMismatch();
    if (!pending.allowEmpty && response.value.trim().length === 0) {
      throw new ApplicationError(
        400,
        "OAUTH_RESPONSE_REQUIRED",
        "A response is required.",
      );
    }
    flow.pending = undefined;
    pending.cleanup?.();
    pending.resolve(response.value);
    return flow.info;
  }

  async cancel(flowId: string): Promise<OAuthFlowInfo> {
    this.pruneTerminalFlows();
    const flow = this.flows.get(flowId);
    if (!flow) {
      throw new ApplicationError(
        404,
        "OAUTH_FLOW_NOT_FOUND",
        "OAuth flow not found.",
      );
    }
    if (isTerminal(flow.info)) return flow.info;
    flow.abortController.abort();
    flow.pending?.cleanup?.();
    flow.pending?.reject(new Error("Login cancelled"));
    flow.pending = undefined;
    try {
      await this.setTerminal(flow, { state: "cancelled" });
    } finally {
      this.release(flow);
    }
    return flow.info;
  }

  private promptMismatch(): ApplicationError {
    return new ApplicationError(
      409,
      "OAUTH_PROMPT_MISMATCH",
      "OAuth flow is not waiting for that response.",
    );
  }

  private async run(flow: FlowRecord): Promise<void> {
    const interaction: SignInInteraction = {
      signal: flow.abortController.signal,
      prompt: (prompt) => this.handlePrompt(flow, prompt),
      notify: (event) => this.enqueueEvent(flow, event),
      listenLoopback: (expected) => this.listen(flow, expected),
    };

    await flow.login(interaction);
    await flow.updateTail;
    if (flow.updateError) throw flow.updateError;
    if (flow.abortController.signal.aborted) throw new Error("Login cancelled");
    if (isTerminal(flow.info)) return;
    try {
      await this.setTerminal(flow, {
        state: "succeeded",
        successMessage: `Connected to ${flow.subject.name}.`,
      });
      await flow.succeeded(flow.info);
    } finally {
      this.release(flow);
    }
  }

  /** A loopback listener the flow owns: closed when the flow ends or is cancelled. */
  private async listen(
    flow: FlowRecord,
    expected: LoopbackExpectation,
  ): Promise<LoopbackListener> {
    const listener = await listenForLoopbackRedirect(
      expected,
      flow.abortController.signal,
    );
    flow.listeners.add(listener);
    return listener;
  }

  private enqueueEvent(flow: FlowRecord, event: AuthEvent): void {
    flow.updateTail = flow.updateTail
      .then(async () => {
        if (!isTerminal(flow.info)) await this.handleEvent(flow, event);
      })
      .catch((error) => {
        flow.updateError ??= asError(error);
        flow.abortController.abort();
      });
  }

  private async handlePrompt(
    flow: FlowRecord,
    prompt: AuthPrompt,
  ): Promise<string> {
    await flow.updateTail;
    if (flow.updateError) throw flow.updateError;
    if (isTerminal(flow.info)) throw new Error("OAuth flow has ended");

    const interactionId = createId("authflow");
    if (prompt.type === "select") {
      return this.waitForResponse(
        flow,
        {
          type: "choice",
          interactionId,
          message: prompt.message,
          options: prompt.options.map((option) => ({ ...option })),
        },
        {
          interactionId,
          type: "select",
          options: new Set(prompt.options.map((option) => option.id)),
        },
        prompt.signal,
      );
    }

    if (prompt.type === "manual_code") {
      const current = flow.info.interaction;
      const browser = current.type === "browser" ? current : undefined;
      return this.waitForResponse(
        flow,
        browser
          ? {
              ...browser,
              instructions:
                browser.instructions || "Complete sign-in in your browser.",
              manualEntry: {
                interactionId,
                label: "Authorization code or redirect URL",
                placeholder:
                  prompt.placeholder?.trim() ||
                  "Paste the code or redirect URL",
                acceptedInput: "authorization_input",
              },
            }
          : {
              type: "text_input",
              interactionId,
              message: prompt.message,
              placeholder: prompt.placeholder,
              inputKind: "authorization",
              allowEmpty: false,
            },
        { interactionId, type: "authorization" },
        prompt.signal,
      );
    }

    return this.waitForResponse(
      flow,
      {
        type: "text_input",
        interactionId,
        message: prompt.message,
        placeholder: prompt.placeholder,
        inputKind: prompt.type === "secret" ? "secret" : "text",
        allowEmpty: prompt.type === "text",
      },
      {
        interactionId,
        type: "text",
        allowEmpty: prompt.type === "text",
      },
      prompt.signal,
    );
  }

  private async handleEvent(flow: FlowRecord, event: AuthEvent): Promise<void> {
    if (event.type === "auth_url") {
      const target = deriveOAuthLoopbackRelayTarget(event.url);
      let manualEntry: Extract<
        OAuthInteraction,
        { type: "browser" }
      >["manualEntry"];
      if (target) {
        const key = callbackTargetKey(target);
        const owner = this.activeCallbackTargets.get(key);
        if (owner && owner !== flow.info.flowId) {
          throw new ApplicationError(
            409,
            "OAUTH_CALLBACK_FLOW_ACTIVE",
            "Another OAuth login is already using this local callback.",
          );
        }
        this.activeCallbackTargets.set(key, flow.info.flowId);
        const interactionId = createId("authflow");
        flow.relay = { interactionId, target };
        manualEntry = {
          interactionId,
          label: "Final redirect URL",
          placeholder: "Paste the final localhost redirect URL",
          acceptedInput: "redirect_url",
        };
      }
      await this.setInteraction(flow, {
        type: "browser",
        authorizationUrl: event.url,
        instructions:
          event.instructions?.trim() || "Complete sign-in in your browser.",
        ...(manualEntry ? { manualEntry } : {}),
      });
      return;
    }
    if (event.type === "device_code") {
      await this.setInteraction(flow, {
        type: "device_code",
        verificationUrl: event.verificationUri,
        userCode: event.userCode,
        ...(event.intervalSeconds
          ? { intervalSeconds: event.intervalSeconds }
          : {}),
        ...(event.expiresInSeconds
          ? {
              expiresAt: new Date(
                Date.now() + event.expiresInSeconds * 1000,
              ).toISOString(),
            }
          : {}),
      });
      return;
    }
    await this.setInteraction(flow, {
      type: "progress",
      message: event.message,
      ...(event.type === "info" && event.links
        ? { links: event.links.map((link) => ({ ...link })) }
        : {}),
    });
  }

  private async waitForResponse(
    flow: FlowRecord,
    interaction: OAuthInteraction,
    expected: Omit<PendingResponse, "resolve" | "reject" | "cleanup">,
    signal?: AbortSignal,
  ): Promise<string> {
    let resolveResponse!: (value: string) => void;
    let rejectResponse!: (error: Error) => void;
    const response = new Promise<string>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    const onAbort = () => {
      if (flow.pending?.interactionId !== expected.interactionId) return;
      flow.pending = undefined;
      rejectResponse(new Error("Login prompt cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    flow.pending = {
      ...expected,
      resolve: resolveResponse,
      reject: rejectResponse,
      cleanup: () => signal?.removeEventListener("abort", onAbort),
    };
    if (flow.abortController.signal.aborted || signal?.aborted) onAbort();
    else await this.setInteraction(flow, interaction);
    return response;
  }

  private async fail(flow: FlowRecord, message: string): Promise<void> {
    if (flow.info.state === "cancelled" || flow.info.state === "succeeded") {
      return;
    }
    await flow.updateTail;
    if (flow.info.state !== "active") return;
    const detail = formatOAuthLoginFailure(message);
    try {
      await this.setTerminal(flow, {
        state: "failed",
        failure: {
          message: "The login attempt ended before credentials were saved.",
          ...(detail ? { detail } : {}),
        },
      });
      if (!flow.subject.account)
        await this.events.publish("auth.oauth_login_failed", {
          provider: flow.subject.id,
          flow: flow.info,
        });
    } finally {
      this.release(flow);
    }
  }

  private async setInteraction(
    flow: FlowRecord,
    interaction: OAuthInteraction,
  ): Promise<void> {
    if (flow.info.state !== "active") return;
    flow.info = {
      ...flow.info,
      interaction,
      updatedAt: now(),
    };
    await this.publish(flow);
  }

  private async setTerminal(
    flow: FlowRecord,
    terminal:
      | { state: "succeeded"; successMessage: string }
      | { state: "failed"; failure: { message: string; detail?: string } }
      | { state: "cancelled" },
  ): Promise<void> {
    const identity = {
      flowId: flow.info.flowId,
      provider: flow.info.provider,
      providerName: flow.info.providerName,
      ...(flow.subject.account ? { account: flow.subject.account } : {}),
      createdAt: flow.info.createdAt,
      updatedAt: now(),
    };
    flow.info = { ...identity, ...terminal };
    flow.terminalAt = Date.now();
    await this.publish(flow);
  }

  private async publish(flow: FlowRecord): Promise<void> {
    await this.events.publish("auth.oauth_flow_updated", { flow: flow.info });
  }

  private release(flow: FlowRecord): void {
    if (this.activeByProvider.get(flow.subject.id) === flow.info.flowId) {
      this.activeByProvider.delete(flow.subject.id);
    }
    clearTimeout(flow.timeout);
    for (const listener of flow.listeners) listener.close();
    flow.listeners.clear();
    if (flow.relay) {
      const key = callbackTargetKey(flow.relay.target);
      if (this.activeCallbackTargets.get(key) === flow.info.flowId) {
        this.activeCallbackTargets.delete(key);
      }
    }
    flow.pending?.cleanup?.();
    flow.pending = undefined;
    flow.relay = undefined;
  }

  private pruneTerminalFlows(): void {
    const cutoff = Date.now() - TERMINAL_RETENTION_MS;
    for (const [flowId, flow] of this.flows) {
      if (flow.terminalAt !== undefined && flow.terminalAt < cutoff) {
        this.flows.delete(flowId);
      }
    }
  }
}
