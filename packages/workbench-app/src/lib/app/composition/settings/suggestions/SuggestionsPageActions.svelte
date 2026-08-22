<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { SuggestionsPageState } from "./suggestions-page-state.svelte";

let { pageState }: { pageState: SuggestionsPageState } = $props();
</script>

<Button size="sm" onclick={() => (pageState.createDialogOpen = true)}>
  <Plus class="size-3.5" aria-hidden="true" />
  New suggestion
</Button>
