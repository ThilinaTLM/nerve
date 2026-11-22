<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import { LevelMenu } from "$lib/presentation/settings";
import type { SuggestionsPageState } from "./suggestions-page-state.svelte";

let { pageState }: { pageState: SuggestionsPageState } = $props();
</script>

<LevelMenu
  label="New suggestion"
  icon={Plus}
  projectName={pageState.projectName}
  onSelect={(layer) => pageState.openCreate(layer)}
/>
