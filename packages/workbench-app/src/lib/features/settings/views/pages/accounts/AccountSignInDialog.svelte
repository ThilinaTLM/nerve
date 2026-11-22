<!--
  The sign-in of an existing account: shows the prompts of the server's sign-in flow (login page,
  device code, choices) and how it ended. Closing it cancels a flow that still waits.
-->
<script lang="ts">
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { onDestroy } from "svelte";
import AccountSignInPanel from "./AccountSignInPanel.svelte";
import type { AccountSignInFlow } from "./account-sign-in.svelte";

type Props = {
  flow: AccountSignInFlow;
  /** Closes the dialog as soon as the sign-in succeeds, instead of waiting for Done. */
  closeOnSuccess?: boolean;
};
let { flow, closeOnSuccess = false }: Props = $props();

$effect(() => {
  if (closeOnSuccess && flow.open && flow.flow?.state === "succeeded")
    void flow.close();
});

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
  <AccountSignInPanel {flow} />
  {#snippet footer()}
    {#if flow.flow?.state === "succeeded"}
      <Button onclick={() => void flow.close()}>Done</Button>
    {:else}
      <Button variant="ghost" onclick={() => void flow.close()}>Cancel</Button>
      {#if flow.needsSubmit}
        <Button
          onclick={() => void flow.submitResponse()}
          disabled={flow.busy || flow.responseValue.trim().length === 0}
          >Submit</Button
        >
      {/if}
    {/if}
  {/snippet}
</Dialog>
