<!--
@component
Collapsible section root; `bind:open`. Holds a `Collapsible.Trigger` and a `Collapsible.Content`.
-->

<script lang="ts">
import { Collapsible as CollapsiblePrimitive } from "bits-ui";

let {
  ref = $bindable(null),
  open = $bindable(false),
  ...restProps
}: CollapsiblePrimitive.RootProps = $props();
</script>

<CollapsiblePrimitive.Root
  bind:ref
  bind:open
  data-slot="collapsible"
  {...restProps}
/>
