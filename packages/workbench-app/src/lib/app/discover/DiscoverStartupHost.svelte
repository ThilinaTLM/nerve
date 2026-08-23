<script lang="ts">
import { responsive } from "$lib/app/shell/responsive.svelte";
import { considerAutomaticDiscover } from "./state.svelte.js";

$effect(() => {
  if (responsive.isPhone) return;
  considerAutomaticDiscover();
});
</script>

<!-- This host coordinates startup state and intentionally renders no UI. -->
