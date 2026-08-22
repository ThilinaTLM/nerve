<script lang="ts">
import * as AlertDialog from "@nervekit/ui-kit/components/ui/alert-dialog";
import {
  acknowledgeCriticalError,
  criticalErrorState,
} from "./critical-errors.svelte";

const open = $derived(Boolean(criticalErrorState.current));
</script>

<AlertDialog.Root
  {open}
  onOpenChange={(next) => {
    if (!next && !criticalErrorState.current) return;
  }}
>
  <AlertDialog.Content
    onEscapeKeydown={(event) => event.preventDefault()}
    onInteractOutside={(event) => event.preventDefault()}
  >
    <AlertDialog.Header>
      <AlertDialog.Title>{criticalErrorState.current?.title}</AlertDialog.Title>
      <AlertDialog.Description class="whitespace-pre-wrap break-words">
        {criticalErrorState.current?.details}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Action size="sm" onclick={acknowledgeCriticalError}>
        OK
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
