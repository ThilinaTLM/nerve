<!--
  A project's extension settings file is ignored until its exact content is
  trusted. Decided here: trust, decline, or revoke a trusted file.
-->
<script lang="ts">
import UntrustedProjectCallout from "../capabilities/UntrustedProjectCallout.svelte";
import type { ScopedExtensionsState } from "$lib/application/extensions/scoped-extensions-state.svelte";

let {
  extensions,
}: {
  extensions: ScopedExtensionsState;
} = $props();

const file = $derived(extensions.view?.file);
</script>

{#if file?.trustState && file.status !== "missing"}
  <UntrustedProjectCallout
    state={file.trustState}
    subject="This project's extension settings file"
    busy={extensions.saving}
    showTrusted
    onTrust={() => void extensions.trustProject(true)}
    onDecline={() => void extensions.trustProject(false)}
    onRevoke={() => void extensions.trustProject(false)}
  />
{/if}
