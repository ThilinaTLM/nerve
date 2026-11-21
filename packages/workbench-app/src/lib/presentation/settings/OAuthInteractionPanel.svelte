<!--
  The prompts of one sign-in flow, whatever it signs in (a model provider or an account): a login
  page link, a device code, a choice, a text answer, progress, and how it ended. Stateless: the
  owner follows the flow and handles the actions.
-->
<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import Copy from "@lucide/svelte/icons/copy";
import ExternalLink from "@lucide/svelte/icons/external-link";
import type { OAuthFlowInfo } from "@nervekit/contracts/auth";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";

type Props = {
  flow: OAuthFlowInfo | undefined;
  busy: boolean;
  /** The answer being typed (manual redirect or text prompt). */
  responseValue: string;
  copiedLoginUrl: boolean;
  copiedDeviceCode: boolean;
  deviceCodeSecondsRemaining: number | undefined;
  onSelect: (optionId: string) => void;
  onSubmit: () => void;
  onCopyLoginUrl: () => void;
  onCopyDeviceCode: () => void;
  onOpen: (url: string) => void;
  onRetry: () => void;
};
let {
  flow,
  busy,
  responseValue = $bindable(),
  copiedLoginUrl,
  copiedDeviceCode,
  deviceCodeSecondsRemaining,
  onSelect,
  onSubmit,
  onCopyLoginUrl,
  onCopyDeviceCode,
  onOpen,
  onRetry,
}: Props = $props();
</script>

{#if flow?.state === "active"}
  {@const interaction = flow.interaction}
  {#if interaction.type === "starting"}
    <p class="flex items-center gap-2 text-ui text-muted-foreground">
      <Spinner /> Starting login…
    </p>
  {:else if interaction.type === "choice"}
    <p class="text-ui text-foreground">{interaction.message}</p>
    <div class="grid gap-2">
      {#each interaction.options as option (option.id)}
        <Button
          variant="outline"
          disabled={busy}
          onclick={() => onSelect(option.id)}
        >
          <span class="grid text-left">
            <span>{option.label}</span>
            {#if option.description}<span class="text-ui text-muted-foreground"
                >{option.description}</span
              >{/if}
          </span>
        </Button>
      {/each}
    </div>
  {:else if interaction.type === "browser"}
    <div class="grid gap-2 sm:grid-cols-2">
      <Button
        variant="outline"
        onclick={() => onOpen(interaction.authorizationUrl)}
      >
        <ExternalLink size={15} strokeWidth={2} /> Open login page
      </Button>
      <Button variant="outline" onclick={() => onCopyLoginUrl()}>
        {#if copiedLoginUrl}
          <Check size={15} strokeWidth={2} /> Copied login URL
        {:else}
          <Copy size={15} strokeWidth={2} /> Copy login URL
        {/if}
      </Button>
    </div>
    <p class="text-ui text-muted-foreground">
      {interaction.instructions}
    </p>
    {#if interaction.manualEntry}
      <form
        class="grid gap-2"
        onsubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label class="text-ui" for="oauth-manual-redirect"
          >{interaction.manualEntry.label}</label
        >
        <Input
          id="oauth-manual-redirect"
          type="text"
          autocomplete="off"
          placeholder={interaction.manualEntry.placeholder}
          bind:value={responseValue}
          disabled={busy}
        />
      </form>
    {/if}
  {:else if interaction.type === "device_code"}
    <Button
      variant="outline"
      onclick={() => onOpen(interaction.verificationUrl)}
    >
      <ExternalLink size={15} strokeWidth={2} /> Open verification page
    </Button>
    <div class="grid justify-items-start gap-2">
      <p class="text-ui text-muted-foreground">Enter this code:</p>
      <Button
        variant="outline"
        onclick={() => onCopyDeviceCode()}
        aria-label="Copy device code"
      >
        <code class="font-mono text-title tracking-widest"
          >{interaction.userCode}</code
        >
        {#if copiedDeviceCode}<Check size={15} strokeWidth={2} />{:else}<Copy
            size={15}
            strokeWidth={2}
          />{/if}
      </Button>
      {#if deviceCodeSecondsRemaining !== undefined}
        <p class="text-ui text-muted-foreground">
          {deviceCodeSecondsRemaining === 0
            ? "Code expired. Waiting for the provider…"
            : `Expires in ${deviceCodeSecondsRemaining}s`}
        </p>
      {/if}
    </div>
  {:else if interaction.type === "text_input"}
    <p class="text-ui text-foreground">{interaction.message}</p>
    <form
      class="grid gap-2"
      onsubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Input
        type={interaction.inputKind === "secret" ? "password" : "text"}
        autocomplete="off"
        placeholder={interaction.placeholder ?? "Enter a response"}
        bind:value={responseValue}
        disabled={busy}
      />
    </form>
  {:else if interaction.type === "progress"}
    <p class="flex items-center gap-2 text-ui text-muted-foreground">
      <Spinner />
      {interaction.message}
    </p>
    {#if interaction.links?.length}
      <div class="grid gap-2">
        {#each interaction.links as link (link.url)}
          <Button variant="outline" onclick={() => onOpen(link.url)}>
            <ExternalLink size={15} strokeWidth={2} />
            {link.label ?? "Open link"}
          </Button>
        {/each}
      </div>
    {/if}
  {/if}
{:else if flow?.state === "failed"}
  <p class="text-ui text-destructive">
    {flow.failure.message}
  </p>
  {#if flow.failure.detail}<p class="text-ui text-muted-foreground">
      {flow.failure.detail}
    </p>{/if}
  <Button variant="outline" disabled={busy} onclick={() => onRetry()}
    >Try again</Button
  >
{:else if flow?.state === "succeeded"}
  <p class="text-ui text-success">
    {flow.successMessage}
  </p>
{:else if flow?.state === "cancelled"}
  <p class="text-ui text-muted-foreground">Login was cancelled.</p>
  <Button variant="outline" disabled={busy} onclick={() => onRetry()}
    >Try again</Button
  >
{:else if busy}
  <p class="flex items-center gap-2 text-ui text-muted-foreground">
    <Spinner /> Starting login…
  </p>
{:else}
  <Button variant="outline" onclick={() => onRetry()}>Try again</Button>
{/if}
