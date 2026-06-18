<script lang="ts">
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Loader from "@lucide/svelte/icons/loader-circle";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type { AuthProviderMetadata } from "$lib/api";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import Dialog from "$lib/components/ui/dialog-shell";
  import { Input } from "$lib/components/ui/input";
  import { AddProviderFlow } from "./add-provider-flow.svelte";

  type Props = {
    open?: boolean;
    authProviders?: AuthProviderMetadata[];
    onClose?: () => void;
  };

  let { open = $bindable(false), authProviders = [], onClose }: Props = $props();

  const flowController = new AddProviderFlow(() => {
    open = false;
    onClose?.();
  });

  const available = $derived(
    [...authProviders]
      .filter(
        (provider) =>
          !provider.configured &&
          (provider.supportsOAuth || provider.supportsApiKey),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );

  function handleOpenChange(next: boolean) {
    if (!next) {
      void flowController.close();
    }
  }
</script>

<Dialog
  bind:open
  title={flowController.dialogTitle}
  description={flowController.dialogDescription}
  class="add-provider-dialog"
  onOpenChange={handleOpenChange}
>
  <div class="add-provider-body">
    {#if flowController.step === "choose"}
      {#if available.length === 0}
        <p class="add-provider-empty">All known providers are already connected.</p>
      {:else}
        <ul class="provider-choices">
          {#each available as provider (provider.provider)}
            <li>
              <button type="button" class="provider-choice" onclick={() => flowController.chooseProvider(provider)}>
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
    {:else if flowController.step === "api-key"}
      <form
        class="api-key-form"
        onsubmit={(event) => {
          event.preventDefault();
          void flowController.submitApiKey();
        }}
      >
        <label class="api-key-label" for="add-provider-api-key">
          API key
          {#if flowController.selected?.envVar}
            <span class="api-key-env">{flowController.selected.envVar}</span>
          {/if}
        </label>
        <Input
          id="add-provider-api-key"
          type="password"
          autocomplete="off"
          placeholder="Paste your API key"
          bind:value={flowController.apiKey}
          disabled={flowController.busy}
        />
      </form>
    {:else if flowController.step === "oauth"}
      <div class="oauth-flow" aria-live="polite">
        {#if flowController.flow}
          {#if flowController.flow.message}
            <p class="oauth-message">{flowController.flow.message}</p>
          {/if}

          {#if flowController.flow.status === "auth_url" && flowController.flow.authUrl}
            <Button variant="outline" onclick={() => flowController.flow?.authUrl && flowController.openExternal(flowController.flow.authUrl)}>
              <ExternalLink size={15} strokeWidth={2} />
              Open login page
            </Button>
            {#if flowController.flow.instructions}
              <p class="oauth-hint">{flowController.flow.instructions}</p>
            {/if}
          {:else if flowController.flow.status === "device_code" && flowController.flow.deviceCode}
            <div class="device-code">
              <Button variant="outline" onclick={() => flowController.flow?.deviceCode && flowController.openExternal(flowController.flow.deviceCode.verificationUri)}>
                <ExternalLink size={15} strokeWidth={2} />
                Open verification page
              </Button>
              <p class="oauth-hint">Enter this code:</p>
              <code class="device-user-code">{flowController.flow.deviceCode.userCode}</code>
            </div>
          {:else if flowController.flow.status === "select" && flowController.flow.options}
            <div class="oauth-options">
              {#each flowController.flow.options as option (option.id)}
                <Button variant="outline" disabled={flowController.busy} onclick={() => void flowController.selectOption(option.id)}>
                  {option.label}
                </Button>
              {/each}
            </div>
          {:else if flowController.flow.status === "prompt"}
            <form
              class="oauth-prompt"
              onsubmit={(event) => {
                event.preventDefault();
                void flowController.submitPrompt();
              }}
            >
              {#if flowController.flow.authUrl}
                <Button variant="outline" onclick={() => flowController.flow?.authUrl && flowController.openExternal(flowController.flow.authUrl)}>
                  <ExternalLink size={15} strokeWidth={2} />
                  Open login page
                </Button>
              {/if}
              {#if flowController.flow.instructions}
                <p class="oauth-hint">{flowController.flow.instructions}</p>
              {/if}
              <Input
                type="text"
                autocomplete="off"
                placeholder={flowController.flow.placeholder ?? "Paste the code or redirect URL"}
                bind:value={flowController.promptValue}
                disabled={flowController.busy}
              />
            </form>
          {:else if flowController.flow.status === "succeeded"}
            <p class="oauth-success">Connected to {flowController.flow.providerName}.</p>
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

    {#if flowController.error}
      <p class="add-provider-error">
        <TriangleAlert size={14} strokeWidth={2} />
        {flowController.error}
      </p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => void flowController.close()}>Cancel</Button>
    {#if flowController.step === "api-key"}
      <Button onclick={() => void flowController.submitApiKey()} disabled={flowController.busy || flowController.apiKey.trim().length === 0}>
        {flowController.busy ? "Saving…" : "Save API key"}
      </Button>
    {:else if flowController.step === "oauth" && flowController.flow?.status === "prompt"}
      <Button
        onclick={() => void flowController.submitPrompt()}
        disabled={flowController.busy || (!flowController.flow.allowEmpty && flowController.promptValue.trim().length === 0)}
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

</style>
