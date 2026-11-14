<!--
  A project's extension settings file is ignored until its exact content is
  trusted. Trust is bound to the digest the user reviewed.
-->
<script lang="ts">
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ScopedExtensionsState } from "$lib/application/extensions/scoped-extensions-state.svelte";

let { extensions }: { extensions: ScopedExtensionsState } = $props();

const file = $derived(extensions.view?.file);
</script>

{#if file?.trusted === false}
  <Callout
    layout="block"
    tone="warning"
    icon={ShieldCheck}
    title="Project extension settings are not trusted"
    text={`${file.path} is ignored until you trust it. Review the file, then trust it.`}
  >
    {#snippet actions()}
      <Button
        size="sm"
        variant="outline"
        disabled={extensions.saving}
        onclick={() => void extensions.trustProject(true)}>Trust file</Button
      >
    {/snippet}
  </Callout>
{/if}
