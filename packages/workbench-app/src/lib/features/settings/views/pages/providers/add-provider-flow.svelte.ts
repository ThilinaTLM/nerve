import type { AuthProviderMetadata } from "$lib/api";
import { getCredentialKey, setProviderApiKey, startOAuthFlow } from "$lib/api";
import { OAuthFlowSession } from "$lib/application/auth/oauth-flow-session.svelte";
import { encryptApiKey } from "$lib/platform/crypto/credential-crypto";
import {
  routeProviderAuth,
  type ProviderDialogKind,
} from "./provider-auth-routing";

export type AddProviderStep = "choose" | "method" | "api-key" | "oauth";

/** Owns the add-provider dialog's steps; the sign-in flow itself is the session it extends. */
export class AddProviderFlow extends OAuthFlowSession {
  step = $state<AddProviderStep>("choose");
  selected = $state<AuthProviderMetadata | undefined>(undefined);
  apiKey = $state("");

  readonly #onClosed: () => void;

  constructor(onClosed: () => void) {
    super();
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

  reset(): void {
    this.resetSession();
    this.step = "choose";
    this.selected = undefined;
    this.apiKey = "";
  }

  async close(): Promise<void> {
    await this.endSession();
    this.reset();
    this.#onClosed();
  }

  async dispose(): Promise<void> {
    await this.endSession();
    this.flow = undefined;
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
      this.error = this.errorMessage(err);
    } finally {
      this.busy = false;
    }
  }

  async beginOAuth(provider: AuthProviderMetadata): Promise<void> {
    this.step = "oauth";
    await this.begin(() => startOAuthFlow(provider.provider));
  }
}
