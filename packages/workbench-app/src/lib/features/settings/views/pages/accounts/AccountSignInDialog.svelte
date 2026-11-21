<!--
  The sign-in of one account: shows the prompts of the server's sign-in flow (login page, device
  code, choices) and how it ended. Closing it cancels a flow that still waits.
-->
<script lang="ts">
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { onDestroy } from "svelte";
import OAuthInteractionPanel from "$lib/presentation/settings/OAuthInteractionPanel.svelte";
import type { AccountSignInFlow } from "./account-sign-in.svelte";

type Props = { flow: AccountSignInFlow };
let { flow }: Props = $props();

const interaction = $derived(
  flow.flow?.state === "active" ? flow.flow.interaction : undefined,
);
const needsSubmit = $derived(
  interaction?.type === "text_input" ||
    (interaction?.type === "browser" && interaction.manualEntry !== undefined),
);

onDestroy(() => void flow.dispose());
</script>

<Dialog
  open={flow.open}
  onOpenChange={(next) => {
    if (!next) void flow.close();
  }}
  title={flow.account ? `Sign in to ${flow.account.name}` : "Sign in"}
  description="Complete the sign-in in your browser. Your credentials stay on this computer."
>
  <div class="grid gap-3" aria-live="polite">
    <OAuthInteractionPanel
      flow={flow.flow}
      busy={flow.busy}
      bind:responseValue={flow.responseValue}
      copiedLoginUrl={flow.copiedLoginUrl}
      copiedDeviceCode={flow.copiedDeviceCode}
      deviceCodeSecondsRemaining={flow.deviceCodeSecondsRemaining}
      onSelect={(id) => void flow.selectOption(id)}
      onSubmit={() => void flow.submitResponse()}
      onCopyLoginUrl={() => void flow.copyLoginUrl()}
      onCopyDeviceCode={() => void flow.copyDeviceCode()}
      onOpen={(url) => flow.openExternal(url)}
      onRetry={() => void flow.restart()}
    />
    {#if flow.error}
      <p class="flex items-center gap-2 text-ui text-destructive">
        <TriangleAlert size={14} strokeWidth={2} />
        {flow.error}
      </p>
    {/if}
  </div>
  {#snippet footer()}
    {#if flow.flow?.state === "succeeded"}
      <Button onclick={() => void flow.close()}>Done</Button>
    {:else}
      <Button variant="ghost" onclick={() => void flow.close()}>Cancel</Button>
      {#if needsSubmit}
        <Button
          onclick={() => void flow.submitResponse()}
          disabled={flow.busy || flow.responseValue.trim().length === 0}
          >Submit</Button
        >
      {/if}
    {/if}
  {/snippet}
</Dialog>
