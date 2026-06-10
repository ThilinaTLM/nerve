<script lang="ts">
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Loader from "@lucide/svelte/icons/loader-circle";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type { AuthProviderMetadata, OAuthFlowInfo } from "../../../../api";
  import {
    cancelOAuthFlow,
    getCredentialKey,
    getOAuthFlow,
    respondOAuthFlow,
    setProviderApiKey,
    startOAuthFlow,
  } from "../../../../api";
  import { encryptApiKey } from "../../../../utils/credential-crypto";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import Dialog from "$lib/components/ui/dialog-shell";
  import { Input } from "$lib/components/ui/input";

  type Props = {
    open?: boolean;
    authProviders?: AuthProviderMetadata[];
    onClose?: () => void;
  };

  let { open = $bindable(false), authProviders = [], onClose }: Props = $props();

  type Step = "choose" | "api-key" | "oauth";

  let step = $state<Step>("choose");
  let selected = $state<AuthProviderMetadata | undefined>(undefined);
  let apiKey = $state("");
  let promptValue = $state("");
  let busy = $state(false);
  let error = $state<string | undefined>(undefined);
  let flow = $state<OAuthFlowInfo | undefined>(undefined);
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  const available = $derived(
    [...authProviders]
      .filter(
        (provider) =>
          !provider.configured &&
          (provider.supportsOAuth || provider.supportsApiKey),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = undefined;
    }
  }

  function isTerminal(info: OAuthFlowInfo): boolean {
    return (
      info.status === "succeeded" ||
      info.status === "failed" ||
      info.status === "cancelled"
    );
  }

  function schedulePoll() {
    stopPolling();
    pollTimer = setTimeout(async () => {
      const current = flow;
      if (!current || isTerminal(current)) return;
      try {
        flow = await getOAuthFlow(current.flowId);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      if (flow && !isTerminal(flow)) schedulePoll();
    }, 800);
  }

  function resetState() {
    stopPolling();
    step = "choose";
    selected = undefined;
    apiKey = "";
    promptValue = "";
    busy = false;
    error = undefined;
    flow = undefined;
  }

  async function closeDialog() {
    const active = flow;
    if (active && !isTerminal(active)) {
      try {
        await cancelOAuthFlow(active.flowId);
      } catch {
        // best effort
      }
    }
    resetState();
    open = false;
    onClose?.();
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      void closeDialog();
    }
  }

  function chooseProvider(provider: AuthProviderMetadata) {
    selected = provider;
    error = undefined;
    if (provider.supportsOAuth) {
      void beginOAuth(provider);
    } else {
      step = "api-key";
    }
  }

  async function submitApiKey() {
    if (!selected || apiKey.trim().length === 0) return;
    busy = true;
    error = undefined;
    try {
      const credentialKey = await getCredentialKey();
      const envelope = await encryptApiKey(apiKey.trim(), credentialKey);
      await setProviderApiKey(selected.provider, envelope);
      apiKey = "";
      await closeDialog();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function beginOAuth(provider: AuthProviderMetadata) {
    step = "oauth";
    busy = true;
    error = undefined;
    try {
      flow = await startOAuthFlow(provider.provider);
      schedulePoll();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function submitPrompt() {
    if (!flow?.promptId) return;
    const value = promptValue;
    if (!flow.allowEmpty && value.trim().length === 0) return;
    busy = true;
    error = undefined;
    try {
      flow = await respondOAuthFlow(flow.flowId, {
        promptId: flow.promptId,
        value,
      });
      promptValue = "";
      schedulePoll();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function selectOption(optionId: string) {
    if (!flow?.promptId) return;
    busy = true;
    error = undefined;
    try {
      flow = await respondOAuthFlow(flow.flowId, {
        promptId: flow.promptId,
        selectedId: optionId,
      });
      schedulePoll();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function openExternal(url: string) {
    window.open(url, "_blank", "noopener");
  }

  const dialogTitle = $derived(
    step === "choose"
      ? "Add provider"
      : selected
        ? `Connect ${selected.displayName}`
        : "Add provider",
  );
  const dialogDescription = $derived(
    step === "api-key"
      ? "Your API key is encrypted in your browser before it is sent to the orchestrator."
      : step === "oauth"
        ? "Complete the subscription login. Secrets are exchanged directly between the orchestrator and the provider."
        : "Authenticate with a subscription or an API key.",
  );
</script>

<Dialog
  bind:open
  title={dialogTitle}
  description={dialogDescription}
  class="add-provider-dialog"
  onOpenChange={handleOpenChange}
>
  <div class="add-provider-body">
    {#if step === "choose"}
      {#if available.length === 0}
        <p class="add-provider-empty">All known providers are already connected.</p>
      {:else}
        <ul class="provider-choices">
          {#each available as provider (provider.provider)}
            <li>
              <button type="button" class="provider-choice" onclick={() => chooseProvider(provider)}>
                <span class="provider-choice-icon" aria-hidden="true">
                  {#if provider.supportsOAuth}
                    <Sparkles size={16} strokeWidth={2} />
                  {:else}
                    <KeyRound size={16} strokeWidth={2} />
                  {/if}
                </span>
                <span class="provider-choice-text">
                  <strong>{provider.displayName}</strong>
                  <span>{provider.provider}</span>
                </span>
                <span class="provider-choice-tags">
                  {#if provider.supportsOAuth}
                    <Badge tone="accent" size="sm">Subscription</Badge>
                  {/if}
                  {#if provider.supportsApiKey}
                    <Badge tone="neutral" size="sm">API key</Badge>
                  {/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if step === "api-key"}
      <form
        class="api-key-form"
        onsubmit={(event) => {
          event.preventDefault();
          void submitApiKey();
        }}
      >
        <label class="api-key-label" for="add-provider-api-key">
          API key
          {#if selected?.envVar}
            <span class="api-key-env">{selected.envVar}</span>
          {/if}
        </label>
        <Input
          id="add-provider-api-key"
          type="password"
          autocomplete="off"
          placeholder="Paste your API key"
          bind:value={apiKey}
          disabled={busy}
        />
      </form>
    {:else if step === "oauth"}
      <div class="oauth-flow" aria-live="polite">
        {#if flow}
          {#if flow.message}
            <p class="oauth-message">{flow.message}</p>
          {/if}

          {#if flow.status === "auth_url" && flow.authUrl}
            <Button variant="outline" onclick={() => flow?.authUrl && openExternal(flow.authUrl)}>
              <ExternalLink size={15} strokeWidth={2} />
              Open login page
            </Button>
            {#if flow.instructions}
              <p class="oauth-hint">{flow.instructions}</p>
            {/if}
          {:else if flow.status === "device_code" && flow.deviceCode}
            <div class="device-code">
              <Button variant="outline" onclick={() => flow?.deviceCode && openExternal(flow.deviceCode.verificationUri)}>
                <ExternalLink size={15} strokeWidth={2} />
                Open verification page
              </Button>
              <p class="oauth-hint">Enter this code:</p>
              <code class="device-user-code">{flow.deviceCode.userCode}</code>
            </div>
          {:else if flow.status === "select" && flow.options}
            <div class="oauth-options">
              {#each flow.options as option (option.id)}
                <Button variant="outline" disabled={busy} onclick={() => void selectOption(option.id)}>
                  {option.label}
                </Button>
              {/each}
            </div>
          {:else if flow.status === "prompt"}
            <form
              class="oauth-prompt"
              onsubmit={(event) => {
                event.preventDefault();
                void submitPrompt();
              }}
            >
              {#if flow.authUrl}
                <Button variant="outline" onclick={() => flow?.authUrl && openExternal(flow.authUrl)}>
                  <ExternalLink size={15} strokeWidth={2} />
                  Open login page
                </Button>
              {/if}
              {#if flow.instructions}
                <p class="oauth-hint">{flow.instructions}</p>
              {/if}
              <Input
                type="text"
                autocomplete="off"
                placeholder={flow.placeholder ?? "Paste the code or redirect URL"}
                bind:value={promptValue}
                disabled={busy}
              />
            </form>
          {:else if flow.status === "succeeded"}
            <p class="oauth-success">Connected to {flow.providerName}.</p>
          {:else}
            <p class="oauth-progress">
              <Loader class="spin" size={16} strokeWidth={2} />
              Working…
            </p>
          {/if}
        {:else}
          <p class="oauth-progress">
            <Loader class="spin" size={16} strokeWidth={2} />
            Starting login…
          </p>
        {/if}
      </div>
    {/if}

    {#if error}
      <p class="add-provider-error">
        <TriangleAlert size={14} strokeWidth={2} />
        {error}
      </p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => void closeDialog()}>Cancel</Button>
    {#if step === "api-key"}
      <Button onclick={() => void submitApiKey()} disabled={busy || apiKey.trim().length === 0}>
        {busy ? "Saving…" : "Save API key"}
      </Button>
    {:else if step === "oauth" && flow?.status === "prompt"}
      <Button
        onclick={() => void submitPrompt()}
        disabled={busy || (!flow.allowEmpty && promptValue.trim().length === 0)}
      >
        Submit
      </Button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .add-provider-body {
    display: grid;
    gap: 1rem;
    padding: 1rem 1.1rem;
  }

  .add-provider-empty {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
  }

  .provider-choices {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .provider-choice {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    border: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--foreground);
    padding: 0.65rem 0.75rem;
    text-align: left;
    cursor: pointer;
  }

  .provider-choice:hover {
    background: color-mix(in oklab, var(--accent) 45%, transparent);
  }

  .provider-choice-icon {
    display: grid;
    place-items: center;
    color: var(--muted-foreground);
  }

  .provider-choice-text {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 0.1rem;
  }

  .provider-choice-text strong {
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .provider-choice-text span {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .provider-choice-tags {
    display: flex;
    flex: none;
    gap: 0.3rem;
  }

  .api-key-form,
  .oauth-prompt {
    display: grid;
    gap: 0.5rem;
  }

  .api-key-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    color: var(--foreground);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .api-key-env {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .oauth-flow {
    display: grid;
    gap: 0.7rem;
    justify-items: start;
  }

  .oauth-message {
    margin: 0;
    color: var(--foreground);
    font-size: var(--text-sm);
  }

  .oauth-hint {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .device-code,
  .oauth-options {
    display: grid;
    gap: 0.5rem;
    justify-items: start;
  }

  .device-user-code {
    border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    border-radius: var(--radius-sm);
    background: var(--sidebar);
    color: var(--foreground);
    padding: 0.3rem 0.55rem;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    letter-spacing: 0.12em;
  }

  .oauth-success {
    margin: 0;
    color: var(--success);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .oauth-progress {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
  }

  .add-provider-error {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    color: var(--destructive);
    font-size: var(--text-xs);
  }

  :global(.oauth-progress .spin) {
    animation: add-provider-spin 1s linear infinite;
  }

  @keyframes add-provider-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
