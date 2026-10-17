<script lang="ts">
// Transient ask_user controls for the card footer: Dismiss and Send. The
// answers stay in the sheet sections; these only exist while waiting.
import Send from "@lucide/svelte/icons/send";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { getConversationUiCapabilities } from "../../context.svelte";
import type { AskUserController } from "./ask-user-controller.svelte";

let { controller }: { controller: AskUserController } = $props();

const AudioInputAuthRequiredDialog =
  getConversationUiCapabilities().voice?.AudioAuthDialog;
const total = $derived(controller.questions.length);
</script>

<Button
  variant="outline"
  type="button"
  disabled={Boolean(controller.submitting)}
  onclick={() => void controller.dismiss()}
>
  {#if controller.submitting === "dismiss"}
    <Spinner data-icon="inline-start" />Dismissing…
  {:else}
    <X data-icon="inline-start" />Dismiss
  {/if}
</Button>
<Button
  type="button"
  disabled={Boolean(controller.submitting) ||
    (controller.answeredCount === 0 && !controller.voiceActive)}
  title={controller.voiceActive
    ? "Stop recording, transcribe, and send"
    : undefined}
  onclick={() => void controller.send()}
>
  {#if controller.submitting === "answer"}
    <Spinner data-icon="inline-start" />{controller.transcribingForSend
      ? "Transcribing…"
      : "Sending…"}
  {:else}
    <Send data-icon="inline-start" />{total > 1
      ? `Send ${controller.answeredCount}/${total}`
      : "Send"}
  {/if}
</Button>

{#if AudioInputAuthRequiredDialog}
  <AudioInputAuthRequiredDialog bind:open={controller.authDialogOpen} />
{/if}
