import type { AuthProviderMetadata, OAuthFlowInfo } from "$lib/api";
import {
  cancelOAuthFlow,
  getCredentialKey,
  getOAuthFlow,
  respondOAuthFlow,
  setProviderApiKey,
  startOAuthFlow,
} from "$lib/api";
import { encryptApiKey } from "$lib/core/utils/credential-crypto";

export type AddProviderStep = "choose" | "api-key" | "oauth";

/**
 * Controller for the add-provider dialog: owns the multi-step API-key / OAuth
 * flow state and side effects so the component stays presentational.
 */
export class AddProviderFlow {
  step = $state<AddProviderStep>("choose");
  selected = $state<AuthProviderMetadata | undefined>(undefined);
  apiKey = $state("");
  promptValue = $state("");
  busy = $state(false);
  error = $state<string | undefined>(undefined);
  flow = $state<OAuthFlowInfo | undefined>(undefined);

  #pollTimer: ReturnType<typeof setTimeout> | undefined;
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
    if (this.step === "api-key") {
      return "Your API key is encrypted in your browser before it is sent to the orchestrator.";
    }
    if (this.step === "oauth") {
      return "Complete the subscription login. Secrets are exchanged directly between the orchestrator and the provider.";
    }
    return "Authenticate with a subscription or an API key.";
  }

  #stopPolling(): void {
    if (this.#pollTimer) {
      clearTimeout(this.#pollTimer);
      this.#pollTimer = undefined;
    }
  }

  #isTerminal(info: OAuthFlowInfo): boolean {
    return (
      info.status === "succeeded" ||
      info.status === "failed" ||
      info.status === "cancelled"
    );
  }

  #schedulePoll(): void {
    this.#stopPolling();
    this.#pollTimer = setTimeout(async () => {
      const current = this.flow;
      if (!current || this.#isTerminal(current)) return;
      try {
        this.flow = await getOAuthFlow(current.flowId);
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
      }
      if (this.flow && !this.#isTerminal(this.flow)) this.#schedulePoll();
    }, 800);
  }

  reset(): void {
    this.#stopPolling();
    this.step = "choose";
    this.selected = undefined;
    this.apiKey = "";
    this.promptValue = "";
    this.busy = false;
    this.error = undefined;
    this.flow = undefined;
  }

  async close(): Promise<void> {
    const active = this.flow;
    if (active && !this.#isTerminal(active)) {
      try {
        await cancelOAuthFlow(active.flowId);
      } catch {
        // best effort
      }
    }
    this.reset();
    this.#onClosed();
  }

  chooseProvider(provider: AuthProviderMetadata): void {
    this.selected = provider;
    this.error = undefined;
    if (provider.supportsOAuth) {
      void this.beginOAuth(provider);
    } else {
      this.step = "api-key";
    }
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
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  async beginOAuth(provider: AuthProviderMetadata): Promise<void> {
    this.step = "oauth";
    this.busy = true;
    this.error = undefined;
    try {
      this.flow = await startOAuthFlow(provider.provider);
      this.#schedulePoll();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  async submitPrompt(): Promise<void> {
    const current = this.flow;
    if (!current?.promptId) return;
    const value = this.promptValue;
    if (!current.allowEmpty && value.trim().length === 0) return;
    this.busy = true;
    this.error = undefined;
    try {
      this.flow = await respondOAuthFlow(current.flowId, {
        promptId: current.promptId,
        value,
      });
      this.promptValue = "";
      this.#schedulePoll();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  async selectOption(optionId: string): Promise<void> {
    const current = this.flow;
    if (!current?.promptId) return;
    this.busy = true;
    this.error = undefined;
    try {
      this.flow = await respondOAuthFlow(current.flowId, {
        promptId: current.promptId,
        selectedId: optionId,
      });
      this.#schedulePoll();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  openExternal(url: string): void {
    window.open(url, "_blank", "noopener");
  }
}
