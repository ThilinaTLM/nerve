<script lang="ts">
  import Mic from "@lucide/svelte/icons/mic";
  import Settings from "@lucide/svelte/icons/settings";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import { Button } from "$lib/components/ui/button";
  import Dialog from "$lib/components/ui/dialog-shell";
  import { openSettingsPane } from "$lib/features/settings/state/settings-actions.svelte";

  type Props = {
    open?: boolean;
  };

  let { open = $bindable(false) }: Props = $props();

  function closeDialog() {
    open = false;
  }

  function openProviderSettings() {
    closeDialog();
    void openSettingsPane();
  }
</script>

<Dialog
  bind:open
  title="Connect ChatGPT to use voice input"
  description="Voice input needs a ChatGPT OAuth connection before Nerve can transcribe recordings."
  class="audio-auth-required-dialog"
>
  <div class="audio-auth-body">
    <div class="audio-auth-summary">
      <span class="audio-auth-icon" aria-hidden="true">
        <Mic size={18} strokeWidth={2.2} />
      </span>
      <div>
        <h3>Audio input is not configured yet</h3>
        <p>
          Nerve records from your microphone locally, then sends the captured audio to ChatGPT for transcription through the OpenAI Codex OAuth provider.
        </p>
      </div>
    </div>

    <div class="audio-auth-detail">
      <ShieldCheck size={16} strokeWidth={2.1} aria-hidden="true" />
      <p>
        A free or paid ChatGPT account can be used. It just needs to be connected so the orchestrator can request transcription securely.
      </p>
    </div>

    <p class="audio-auth-path">
      To enable it, open <strong>Settings</strong> → <strong>Models & providers</strong> → <strong>Providers</strong>, then add <strong>OpenAI Codex</strong>.
    </p>
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={closeDialog}>Close</Button>
    <Button onclick={openProviderSettings}>
      <Settings size={15} strokeWidth={2.1} />
      Open settings
    </Button>
  {/snippet}
</Dialog>

<style>
  :global(.audio-auth-required-dialog) {
    width: min(560px, calc(100vw - 32px));
  }

  .audio-auth-body {
    display: grid;
    gap: 0.85rem;
    padding: 1rem;
  }

  .audio-auth-summary {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.75rem;
    border: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--accent) 35%, transparent);
    padding: 0.85rem;
  }

  .audio-auth-icon {
    display: grid;
    width: 2.25rem;
    height: 2.25rem;
    place-items: center;
    border: 1px solid color-mix(in oklab, var(--primary) 26%, var(--border));
    border-radius: 999px;
    background: color-mix(in oklab, var(--primary) 10%, transparent);
    color: var(--primary);
  }

  .audio-auth-summary h3 {
    margin: 0;
    color: var(--foreground);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .audio-auth-summary p,
  .audio-auth-detail p,
  .audio-auth-path {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .audio-auth-summary p {
    margin-top: 0.2rem;
  }

  .audio-auth-detail {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    color: var(--success);
  }

  .audio-auth-detail p {
    color: var(--foreground);
  }

  .audio-auth-path strong {
    color: var(--foreground);
    font-weight: 600;
  }
</style>
