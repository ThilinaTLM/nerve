<script lang="ts">
import { PanelPropertyRow } from "$lib/presentation/panel";
import type { SessionField } from "./context-session-fields";

let { fields }: { fields: readonly SessionField[] } = $props();
</script>

{#each fields as field (field.label)}
  <PanelPropertyRow
    label={field.label}
    labelClass="w-24"
    value={field.value}
    title={field.value}
    mono={field.mono ?? false}
    dense
  />
{/each}
