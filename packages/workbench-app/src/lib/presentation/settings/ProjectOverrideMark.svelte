<!--
  Small brand briefcase right after a row title: the open project overrides the
  row while its column is hidden (User-only General and Tools).
-->
<script lang="ts">
import BriefcaseBusiness from "@lucide/svelte/icons/briefcase-business";
import HoverTip from "./HoverTip.svelte";

let { projectName }: { projectName: string } = $props();
</script>

<HoverTip tip={`Overridden in ${projectName}`}>
  <BriefcaseBusiness
    class="size-3 text-primary"
    aria-label={`Overridden in ${projectName}`}
  />
</HoverTip>
