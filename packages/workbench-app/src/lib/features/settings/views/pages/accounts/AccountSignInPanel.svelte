<!--
  The interaction of one account sign-in: what the server's flow asks for (login page, device
  code, choices, progress) and its error. Shared by the sign-in dialog and the add-account dialog.
-->
<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import OAuthInteractionPanel from "$lib/presentation/settings/OAuthInteractionPanel.svelte";
import type { AccountSignInFlow } from "./account-sign-in.svelte";

type Props = { flow: AccountSignInFlow };
let { flow }: Props = $props();
</script>

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
