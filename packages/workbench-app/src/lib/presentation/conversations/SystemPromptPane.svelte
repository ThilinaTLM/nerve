<script lang="ts">
import { notifyCopyResult } from "@nervekit/ui-kit/browser/notifications";
import { CodeMirrorViewer } from "$lib/presentation/code";

let { text }: { text: string } = $props();
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-background">
  <p
    class="m-0 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground"
  >
    System prompt for the next request. Snapshot from when this pane was opened.
  </p>
  <CodeMirrorViewer
    class="min-h-0 flex-1"
    {text}
    wrap={true}
    editable={false}
    ariaLabel="System prompt for the next request"
    onCopy={(ok) => notifyCopyResult(ok, "selection")}
  />
</section>
