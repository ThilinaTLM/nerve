import type { AuthProviderMetadata, OAuthFlowInfo } from "$lib/api";
import {
  cancelOAuthFlow,
  getCredentialKey,
  getOAuthFlow,
  respondOAuthFlow,
  setProviderApiKey,
  startOAuthFlow,
} from "$lib/api";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { encryptApiKey } from "$lib/platform/crypto/credential-crypto";
import {
  deviceCodeSecondsRemaining,
  routeProviderAuth,
  type ProviderDialogKind,
} from "./provider-auth-routing";

export type AddProviderStep = "choose" | "method" | "api-key" | "oauth";

/** Owns the add-provider dialog's state, polling, and browser side effects. */
export class AddProviderFlow {
  step = $state<AddProviderStep>("choose");
  selected = $state<AuthProviderMetadata | undefined>(undefined);
  apiKey = $state("");
  responseValue = $state("");
  busy = $state(false);
  error = $state<string | undefined>(undefined);
  flow = $state<OAuthFlowInfo | undefined>(undefined);
  now = $state(Date.now());
  copiedDeviceCode = $state(false);
  copiedLoginUrl = $state(false);

  #pollTimer: ReturnType<typeof setTimeout> | undefined;
  #countdownTimer: ReturnType<typeof setInterval> | undefined;
  #generation = 0;
  #pollFailures = 0;
  readonly #onClosed: () => void;

  constructor(onClosed: () => void) {
    this.#onClosed = onClosed;
  }

  get dialogTitle(): string {
    if (this.step === "choose") return "Add provider";
    return this.selected
      ? `Connect ${this.selected.displayName}`
      : "Add provider";
  }

  get dialogDescription(): string {
    if (this.step === "method") return "Choose how you want to authenticate.";
    if (this.step === "api-key") {
      return "Your API key is encrypted in your browser before it is sent to the orchestrator.";
    }
    if (this.step === "oauth") {
      return "Complete the subscription login. Secrets are exchanged directly between the orchestrator and the provider.";
    }
    return "Authenticate with a subscription or an API key.";
  }

  get deviceCodeSecondsRemaining(): number | undefined {
    const flow = this.flow;
    return flow?.state === "active" && flow.interaction.type === "device_code"
      ? deviceCodeSecondsRemaining(flow.interaction.expiresAt, this.now)
      : undefined;
  }

  #stopTimers(): void {
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    if (this.#countdownTimer) clearInterval(this.#countdownTimer);
    this.#pollTimer = undefined;
    this.#countdownTimer = undefined;
  }

  #setFlow(flow: OAuthFlowInfo): void {
    const previousCode =
      this.flow?.state === "active" &&
      this.flow.interaction.type === "device_code"
        ? this.flow.interaction.userCode
        : undefined;
    this.flow = flow;
    const nextCode =
      flow.state === "active" && flow.interaction.type === "device_code"
        ? flow.interaction.userCode
        : undefined;
    if (nextCode !== previousCode) this.copiedDeviceCode = false;
    if (this.#countdownTimer) clearInterval(this.#countdownTimer);
    this.#countdownTimer = undefined;
    if (
      flow.state === "active" &&
      flow.interaction.type === "device_code" &&
      flow.interaction.expiresAt
    ) {
      this.now = Date.now();
      this.#countdownTimer = setInterval(() => (this.now = Date.now()), 1_000);
    }
  }

  #schedulePoll(generation = this.#generation): void {
    if (this.flow?.state !== "active" || generation !== this.#generation)
      return;
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    const delay = Math.min(1_000 * 2 ** this.#pollFailures, 5_000);
    this.#pollTimer = setTimeout(() => void this.#poll(generation), delay);
  }

  async #poll(generation: number): Promise<void> {
    this.#pollTimer = undefined;
    const current = this.flow;
    if (
      generation !== this.#generation ||
      !current ||
      current.state !== "active"
    )
      return;
    try {
      const next = await getOAuthFlow(current.flowId);
      if (generation !== this.#generation) return;
      this.error = undefined;
      this.#pollFailures = 0;
      this.#setFlow(next);
    } catch (err) {
      if (generation !== this.#generation) return;
      this.#pollFailures += 1;
      this.error = `Could not refresh login status: ${this.#errorMessage(err)}`;
    }
    this.#schedulePoll(generation);
  }

  #errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  reset(): void {
    this.#generation += 1;
    this.#stopTimers();
    this.step = "choose";
    this.selected = undefined;
    this.apiKey = "";
    this.responseValue = "";
    this.busy = false;
    this.error = undefined;
    this.flow = undefined;
    this.copiedDeviceCode = false;
    this.copiedLoginUrl = false;
    this.#pollFailures = 0;
  }

  async close(): Promise<void> {
    this.#generation += 1;
    this.#stopTimers();
    await this.#cancelActiveFlow();
    this.reset();
    this.#onClosed();
  }

  async dispose(): Promise<void> {
    this.#generation += 1;
    this.#stopTimers();
    await this.#cancelActiveFlow();
    this.flow = undefined;
  }

  async #cancelActiveFlow(): Promise<void> {
    const active = this.flow;
    if (!active || active.state !== "active") return;
    try {
      await cancelOAuthFlow(active.flowId);
    } catch {
      // Closing must remain responsive even if cancellation cannot be delivered.
    }
  }

  chooseProvider(
    provider: AuthProviderMetadata,
    kind: ProviderDialogKind,
  ): void {
    this.selected = provider;
    this.error = undefined;
    const route = routeProviderAuth(provider, kind);
    if (route === "method") this.step = "method";
    else if (route === "oauth") void this.beginOAuth(provider);
    else this.step = "api-key";
  }

  chooseMethod(method: "oauth" | "api-key"): void {
    const provider = this.selected;
    if (!provider) return;
    if (method === "oauth") void this.beginOAuth(provider);
    else this.step = "api-key";
  }

  async submitApiKey(): Promise<void> {
    if (!this.selected || this.apiKey.trim().length === 0) return;
    this.busy = true;
    this.error = undefined;
    try {
      const credentialKey = await getCredentialKey();
      const envelope = await encryptApiKey(this.apiKey.trim(), credentialKey);
      await setProviderApiKey(this.selected.provider, envelope);
      this.apiKey = "";
      await this.close();
    } catch (err) {
      this.error = this.#errorMessage(err);
    } finally {
      this.busy = false;
    }
  }

  async restartOAuth(): Promise<void> {
    const provider = this.selected;
    if (!provider) return;
    this.responseValue = "";
    this.error = undefined;
    await this.#cancelActiveFlow();
    await this.beginOAuth(provider);
  }

  async beginOAuth(provider: AuthProviderMetadata): Promise<void> {
    this.#generation += 1;
    const generation = this.#generation;
    this.#stopTimers();
    this.step = "oauth";
    this.busy = true;
    this.error = undefined;
    this.flow = undefined;
    this.copiedLoginUrl = false;
    this.#pollFailures = 0;
    try {
      const flow = await startOAuthFlow(provider.provider);
      if (generation !== this.#generation) return;
      this.#setFlow(flow);
      this.#schedulePoll(generation);
    } catch (err) {
      if (generation === this.#generation) this.error = this.#errorMessage(err);
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }

  async submitResponse(): Promise<void> {
    const current = this.flow;
    if (!current || current.state !== "active") return;
    const interaction = current.interaction;
    if (interaction.type !== "text_input" && interaction.type !== "browser")
      return;

    const manualEntry =
      interaction.type === "browser" ? interaction.manualEntry : undefined;
    const interactionId =
      interaction.type === "text_input"
        ? interaction.interactionId
        : manualEntry?.interactionId;
    if (!interactionId) return;
    const value = this.responseValue;
    const allowEmpty =
      interaction.type === "text_input" && interaction.allowEmpty;
    if (!allowEmpty && value.trim().length === 0) return;

    await this.#respond(
      interaction.type === "browser"
        ? { type: "manual_redirect", interactionId, value: value.trim() }
        : { type: "text", interactionId, value },
    );
  }

  async selectOption(optionId: string): Promise<void> {
    const current = this.flow;
    if (
      !current ||
      current.state !== "active" ||
      current.interaction.type !== "choice"
    )
      return;
    await this.#respond({
      type: "select",
      interactionId: current.interaction.interactionId,
      selectedId: optionId,
    });
  }

  async #respond(body: Parameters<typeof respondOAuthFlow>[1]): Promise<void> {
    const current = this.flow;
    if (!current || current.state !== "active") return;
    this.#generation += 1;
    const generation = this.#generation;
    this.#stopTimers();
    this.busy = true;
    this.error = undefined;
    try {
      const flow = await respondOAuthFlow(current.flowId, body);
      if (generation !== this.#generation) return;
      this.responseValue = "";
      this.#setFlow(flow);
      this.#schedulePoll(generation);
    } catch (err) {
      if (generation === this.#generation) {
        this.error = this.#errorMessage(err);
        this.#setFlow(current);
        this.#schedulePoll(generation);
      }
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }

  async copyLoginUrl(): Promise<void> {
    const flow = this.flow;
    if (flow?.state !== "active" || flow.interaction.type !== "browser") return;
    try {
      await writeClipboardText(flow.interaction.authorizationUrl);
      this.copiedLoginUrl = true;
      this.error = undefined;
    } catch (err) {
      this.error = this.#errorMessage(err);
    }
  }

  async copyDeviceCode(): Promise<void> {
    const flow = this.flow;
    if (flow?.state !== "active" || flow.interaction.type !== "device_code")
      return;
    try {
      await writeClipboardText(flow.interaction.userCode);
      this.copiedDeviceCode = true;
      this.error = undefined;
    } catch (err) {
      this.error = this.#errorMessage(err);
    }
  }

  openExternal(url: string): void {
    window.open(url, "_blank", "noopener");
  }
}
